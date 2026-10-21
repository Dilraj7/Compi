import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '.' }, shell: { openExternal: vi.fn() } }))
vi.mock('../src/main/log', () => ({ log: vi.fn() }))

const { buildSearchSql, searchWords } = await import('../src/main/windows/search')
const { encodeCommand, parseHostLine, PowerShellHost } = await import('../src/main/windows/host')
const { log } = await import('../src/main/log')
const { formatStatus, matchApps } = await import('../src/main/windows/system')
const { isSettingsPage, SETTINGS_PAGES } = await import('../src/shared/windows')

const NOW = new Date('2026-10-13T12:00:00Z')

describe('recherche Windows Search', () => {
  it('requête de base : vrais chemins, sans AppData, la plus récente d’abord', () => {
    expect(buildSearchSql({ query: 'facture' }, { now: NOW })).toBe(
      'SELECT TOP 15 System.ItemUrl, System.ItemNameDisplay, System.DateModified, System.Size, System.Kind FROM SYSTEMINDEX ' +
        "WHERE SCOPE='file:' AND System.ItemUrl NOT LIKE '%/AppData/%' AND ((System.FileName LIKE '%facture%') OR CONTAINS(*, '\"facture*\"')) " +
        'ORDER BY System.DateModified DESC'
    )
  })

  it('échappe le texte de l’utilisateur (apostrophes, jokers, guillemets, contrôles)', () => {
    const sql = buildSearchSql({ query: 'l\'été 100%_[x] "devis"\u0000; DROP' }, { now: NOW })!
    expect(sql).toContain("System.FileName LIKE '%l''été%'")
    expect(sql).toContain("System.FileName LIKE '%100[%][_][[]x]%'")
    expect(sql).toContain('CONTAINS(*, \'"l\'\'été*" AND "100%_[x]*" AND "devis*" AND "DROP*"\')')
    // L'hôte refuse toute requête contenant « ; » : il ne doit pas venir du texte de l'utilisateur.
    expect(sql).not.toContain(';')
    // Aucune apostrophe isolée : le littéral SQL ne peut pas être refermé.
    expect(sql.replace(/''/g, '').match(/'/g)!.length % 2).toBe(0)
  })

  it('mots : 6 au plus, 40 caractères chacun', () => {
    expect(searchWords('a b c d e f g h')).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
    expect(searchWords('x'.repeat(60))[0]).toHaveLength(40)
  })

  it('filtres : type connu seulement, date, nombre de résultats borné, repli sur les noms', () => {
    const sql = buildSearchSql({ query: 'rapport', kind: 'document', modifiedWithinDays: 7, limit: 500 }, { now: NOW })!
    expect(sql).toMatch(/^SELECT TOP 50 /)
    expect(sql).toContain("System.Kind = 'document'")
    expect(sql).toContain("System.DateModified >= '2026-10-06 12:00:00'")
    expect(buildSearchSql({ query: 'x', kind: "document' OR 1=1" as 'document' }, { now: NOW })).not.toContain('OR 1=1')
    expect(buildSearchSql({ query: 'rapport' }, { content: false, now: NOW })).not.toContain('CONTAINS')
    expect(buildSearchSql({ query: '   ' })).toBeNull()
  })
})

describe('pont PowerShell', () => {
  it('commande encodée en UTF-16LE base 64 (format de -EncodedCommand)', () => {
    expect(Buffer.from(encodeCommand('Write-Output "é"'), 'base64').toString('utf16le')).toBe('Write-Output "é"')
  })

  it('lit les réponses et ignore le reste (bruit, JSON incomplet)', () => {
    expect(parseHostLine('{"ready":true}')).toEqual({ ready: true })
    expect(parseHostLine('{"ok":true,"result":{"pong":true},"id":3}')).toEqual({ id: 3, ok: true, result: { pong: true }, error: undefined })
    expect(parseHostLine('{"ok":false,"error":"Fonction inconnue.","id":4}')).toEqual({ id: 4, ok: false, result: undefined, error: 'Fonction inconnue.' })
    expect(parseHostLine('#< CLIXML')).toBeNull()
    expect(parseHostLine('{"id":1')).toBeNull()
    expect(parseHostLine('{"id":"1","ok":true}')).toBeNull()
  })

  it('le script n’expose que des fonctions nommées, sans exécution libre', () => {
    const script = readFileSync('src/main/windows/host.ps1', 'utf8')
    expect(script).not.toMatch(/Invoke-Expression|\biex\b|ScriptBlock\]::Create|Start-Process\s+\$|-Command\s/i)
    // Rien d'irréversible : ni arrêt, ni verrouillage, ni suppression.
    expect(script).not.toMatch(/Stop-Computer|Restart-Computer|LockWorkStation|SetSuspendState|Remove-Item|shutdown/i)
    const fns = [...script.matchAll(/^\$Fns\.(\w+) =/gm)].map((m) => m[1])
    expect(fns.sort()).toEqual([
      'apps',
      'copy',
      'focus',
      'foreground',
      'launch',
      'media',
      'ocr_image',
      'ocr_languages',
      'ocr_pdf',
      'paste',
      'ping',
      'search',
      'status',
      'theme',
      'volume',
      'windows'
    ])
  })
})

describe('pont PowerShell : appel trop lent', () => {
  // Petit hôte de test, même protocole que host.ps1 : « slow » met 1,2 s à répondre.
  const script = [
    '[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)',
    `[Console]::Out.WriteLine('{"ready":true}')`,
    'while ($null -ne ($line = [Console]::In.ReadLine())) {',
    '  $req = $line | ConvertFrom-Json',
    `  if ($req.fn -eq 'slow') { Start-Sleep -Milliseconds 1200 }`,
    '  [Console]::Out.WriteLine((@{ id = $req.id; ok = $true; result = @{ fn = $req.fn; pid = $PID } } | ConvertTo-Json -Compress))',
    '}'
  ].join('\n')
  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

  it.runIf(process.platform === 'win32')(
    'l’appel échoue à temps, mais PowerShell n’est pas relancé et répond ensuite',
    async () => {
      const host = new PowerShellHost<'slow' | 'fast'>('hôte test', script)
      try {
        const first = await host.call<{ pid: number }>('fast', {}, 15_000)
        await expect(host.call('slow', {}, 300)).rejects.toThrow('pas répondu à temps')
        const after = await host.call<{ pid: number }>('fast', {}, 15_000)
        expect(after.pid).toBe(first.pid)
        expect(vi.mocked(log)).toHaveBeenCalledWith('info', expect.stringContaining('« slow » a répondu en retard'))
      } finally {
        host.stop()
      }
    },
    30_000
  )

  it.runIf(process.platform === 'win32')(
    'PowerShell muet bien après le délai : relancé',
    async () => {
      const host = new PowerShellHost<'slow' | 'fast'>('hôte test', script)
      try {
        const first = await host.call<{ pid: number }>('fast', {}, 15_000)
        await expect(host.call('slow', {}, 100, 200)).rejects.toThrow('pas répondu à temps')
        await sleep(500)
        expect(vi.mocked(log)).toHaveBeenCalledWith('warn', expect.stringContaining('« slow » toujours sans réponse'))
        const after = await host.call<{ pid: number }>('fast', {}, 15_000)
        expect(after.pid).not.toBe(first.pid)
      } finally {
        host.stop()
      }
    },
    30_000
  )
})

describe('Paramètres et applications', () => {
  it('liste fixe de pages ms-settings', () => {
    for (const page of Object.keys(SETTINGS_PAGES)) expect(page).toMatch(/^[a-z-]+$/)
    expect(isSettingsPage('bluetooth')).toBe(true)
    expect(isSettingsPage('../../cmd')).toBe(false)
    expect(isSettingsPage('toString')).toBe(false)
  })

  it('trouve l’application la plus probable', () => {
    const apps = [
      { name: 'Word Viewer', id: 'a' },
      { name: 'Word', id: 'b' },
      { name: 'Calculatrice', id: 'c' },
      { name: 'Microsoft Edge', id: 'd' }
    ]
    expect(matchApps(apps, 'word')[0].id).toBe('b')
    expect(matchApps(apps, 'calculatrice')[0].id).toBe('c')
    expect(matchApps(apps, 'EDGE')[0].id).toBe('d')
    expect(matchApps(apps, 'photoshop')).toEqual([])
  })

  it('état du PC lisible', () => {
    const text = formatStatus({
      volume: 40,
      muted: false,
      battery: { percent: 82, plugged: false },
      network: { connected: true, wifi: true, ssid: 'Maison', level: 'InternetAccess' },
      disks: [{ drive: 'C:', freeGb: 126.3, sizeGb: 952.8 }],
      memory: { totalGb: 16, freeGb: 4 },
      cpu: 12,
      theme: 'dark',
      uptimeHours: 3.2
    })
    expect(text).toContain('Batterie : 82 % (sur batterie)')
    expect(text).toContain('Son : 40 %')
    expect(text).toContain('Réseau : Wi-Fi « Maison », Internet OK')
    expect(text).toContain('Disque C: : 126,3 Go libres sur 952,8 Go')
    expect(text).toContain('Thème : sombre')
  })
})
