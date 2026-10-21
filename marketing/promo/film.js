// Film promo de Compi : chaque image est une fonction pure du temps t (secondes).
// window.__seek(t) met toute la scène à l'instant t ; render.cjs capture ensuite l'image.
// Le calendrier des scènes vient de timeline.js, partagé avec la bande-son.
// Données entièrement fictives : aucun compte, aucun nom réel.

;(() => {
  const { V, Q, A, B, P, L, T, C, N, G, END, DURATION } = window.TL
  // Les scènes « actions rapides », « rangement » et la carte de fin gardent leurs
  // horaires d'origine (film de 15 s), décalés jusqu'à leur place dans le calendrier.
  const QS = Q - 6.3
  const TS = T - 9.0
  const ES = END - 13.0
  const CY = '#38e1ff'
  const VI = '#a78bfa'
  const AM = '#fbbf24'
  const GR = '#4ade80'
  const BL = '#60a5fa'
  const OR = '#f59e7b'
  const PK = '#f472b6'
  const MG = '#34d399'
  const $ = (id) => document.getElementById(id)

  // ── Outils d'animation ────────────────────────────────────────────
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x))
  const lerp = (a, b, p) => a + (b - a) * p
  const seg = (t, a, b) => clamp((t - a) / (b - a))
  const within = (t, a, b) => t >= a && t < b
  const E = {
    linear: (p) => p,
    outCubic: (p) => 1 - Math.pow(1 - p, 3),
    inCubic: (p) => p * p * p,
    inOutCubic: (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2),
    outQuint: (p) => 1 - Math.pow(1 - p, 5),
    outBack: (p) => 1 + 2.70158 * Math.pow(p - 1, 3) + 1.70158 * Math.pow(p - 1, 2)
  }
  /** Ressort amorti (réponse à un échelon), comme les ressorts de l'app. */
  function spring(dt, k = 380, c = 32, m = 0.85) {
    if (dt <= 0) return 0
    const w0 = Math.sqrt(k / m)
    const z = c / (2 * Math.sqrt(k * m))
    if (z >= 1) return 1 - Math.exp(-w0 * dt) * (1 + w0 * dt)
    const wd = w0 * Math.sqrt(1 - z * z)
    return 1 - Math.exp(-z * w0 * dt) * (Math.cos(wd * dt) + ((z * w0) / wd) * Math.sin(wd * dt))
  }
  /** Images clés : [[t, v], [t, v, easing], …]. */
  function kf(t, frames) {
    if (t <= frames[0][0]) return frames[0][1]
    for (let i = 1; i < frames.length; i++) {
      const [t1, v1, ease = E.inOutCubic] = frames[i]
      const [t0, v0] = frames[i - 1]
      if (t <= t1) return lerp(v0, v1, ease((t - t0) / (t1 - t0)))
    }
    return frames[frames.length - 1][1]
  }
  /** Valeur menée par un ressort d'un état à l'autre : [[t, v], …]. */
  function springTo(t, states, k, c) {
    let i = states.length - 1
    while (i > 0 && t < states[i][0]) i--
    // Valeur au début de chaque transition, calculée de proche en proche.
    let v = states[0][1]
    for (let j = 1; j <= i; j++) {
      const [tj, vj] = states[j]
      const tEnd = j < i ? states[j + 1][0] : t
      v = v + (vj - v) * spring(tEnd - tj, k, c)
    }
    return v
  }
  /** Apparition floutée (comme le « Fade » de l'app) sur une ou plusieurs fenêtres de temps. */
  function show(el, t, windows, fin = 0.16, fout = 0.09, blur = 6) {
    let o = 0
    for (const [a, b] of windows) o = Math.max(o, Math.min(seg(t, a, a + fin), 1 - seg(t, b, b + fout)))
    el.style.opacity = o
    el.style.filter = o > 0 && o < 1 ? `blur(${((1 - o) * blur).toFixed(2)}px)` : 'none'
    el.style.visibility = o > 0 ? 'visible' : 'hidden'
    return o
  }
  /** Fondu enchaîné d'une ligne de texte dans une pile (apparaît à a, disparaît à b). */
  function swap(el, t, a, b = 1e9, d = 0.14) {
    const pin = seg(t, a, a + d)
    const pout = seg(t, b, b + d)
    el.style.opacity = Math.min(pin, 1 - pout)
    el.style.transform = `translateY(${((1 - pin) * 7 - pout * 7).toFixed(2)}px)`
    el.style.filter = pin < 1 || pout > 0 ? `blur(${(Math.max(1 - pin, pout) * 4).toFixed(2)}px)` : 'none'
  }
  function mulberry32(seed) {
    return () => {
      seed |= 0
      seed = (seed + 0x6d2b79f5) | 0
      let x = Math.imul(seed ^ (seed >>> 15), 1 | seed)
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296
    }
  }
  const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16))
  const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

  // ── Icônes ────────────────────────────────────────────────────────
  const icon = (name) => `<svg class="i" viewBox="0 0 24 24">${window.ICONS[name] ?? ''}</svg>`
  document.querySelectorAll('[data-i]').forEach((el) => el.insertAdjacentHTML('afterbegin', icon(el.dataset.i)))

  // ── Yeux LED (mêmes matrices 5×5 que l'app) ────────────────────────
  const GRIDS = {
    open: ['.....', '.###.', '#####', '.###.', '.....'],
    closed: ['.....', '.....', '#####', '.....', '.....'],
    happy: ['.....', '..#..', '.#.#.', '#...#', '.....'],
    surprised: ['.###.', '#...#', '#...#', '#...#', '.###.'],
    waiting: ['.....', '.....', '.###.', '.###.', '.....']
  }
  const RING = [
    [1, 0],
    [2, 0],
    [3, 0],
    [4, 1],
    [4, 2],
    [4, 3],
    [3, 4],
    [2, 4],
    [1, 4],
    [0, 3],
    [0, 2],
    [0, 1]
  ]
  function ring(step) {
    const rows = Array.from({ length: 5 }, () => Array(5).fill('.'))
    for (const off of [0, 1]) {
      const [x, y] = RING[(((step - off) % 12) + 12) % 12]
      rows[y][x] = '#'
    }
    rows[2][2] = '#'
    return rows.map((r) => r.join(''))
  }
  function expr(mood, t) {
    if (mood === 'thinking') {
      const f = Math.floor(t / 0.085)
      return [ring(f), ring(f + 6)]
    }
    if (mood === 'wink') return [GRIDS.happy, GRIDS.open]
    if (mood === 'blink') return [GRIDS.closed, GRIDS.closed]
    return [GRIDS[mood], GRIDS[mood]]
  }
  function eyeCircles(dot, gap, eyeGap) {
    const span = 5 * dot + 4 * gap
    const r = dot / 2
    let base = ''
    let lit = ''
    for (let e = 0; e < 2; e++)
      for (let row = 0; row < 5; row++)
        for (let col = 0; col < 5; col++) {
          const cx = (e * (span + eyeGap) + col * (dot + gap) + r).toFixed(2)
          const cy = (row * (dot + gap) + r).toFixed(2)
          base += `<circle cx="${cx}" cy="${cy}" r="${(r * 0.82).toFixed(2)}" fill="rgb(255 255 255 / 0.07)"/>`
          lit += `<circle cx="${cx}" cy="${cy}" r="${r.toFixed(2)}"/>`
        }
    return { base, lit, span, width: span * 2 + eyeGap }
  }
  let uid = 0
  function makeEyes(host, dot, gap, eyeGap) {
    const c = eyeCircles(dot, gap, eyeGap)
    const pad = dot * 2.4
    const w = c.width + pad * 2
    const h = c.span + pad * 2
    const id = `glow${uid++}`
    host.innerHTML =
      `<svg width="${w}" height="${h}" viewBox="${-pad} ${-pad} ${w} ${h}" style="display:block;overflow:visible">` +
      `<defs><filter id="${id}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${dot * 0.7}" result="b"/>` +
      `<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>` +
      `<g>${c.base}</g><g class="lit" filter="url(#${id})">${c.lit}</g></svg>`
    const g = host.querySelector('.lit')
    return { g, dots: [...g.children] }
  }
  /** Peint les yeux : moyenne de 5 instants sur 110 ms, pour le fondu des LED de l'app. */
  function paintEyes(eyes, fn, t) {
    const acc = new Float32Array(50)
    const S = 5
    for (let k = 0; k < S; k++) {
      const tk = t - k * 0.0275
      const st = fn(tk)
      const [Le, Re] = expr(st.mood, tk)
      for (let i = 0; i < 50; i++) {
        const grid = i < 25 ? Le : Re
        const j = i % 25
        const on = grid[Math.floor(j / 5)][j % 5] === '#'
        if (on && (!st.power || st.power(i, tk))) acc[i] += 1
      }
    }
    const rgb = [0, 0, 0]
    for (let k = 0; k < 4; k++) hex(fn(t - k * 0.1).color).forEach((v, i) => (rgb[i] += v / 4))
    eyes.dots.forEach((d, i) => d.setAttribute('opacity', (acc[i] / S).toFixed(3)))
    eyes.g.setAttribute('fill', `rgb(${rgb.map(Math.round).join(' ')})`)
    const look = fn(t).look ?? [0, 0]
    eyes.g.setAttribute('transform', `translate(${look[0].toFixed(2)} ${look[1].toFixed(2)})`)
  }

  const rand = mulberry32(7)
  const powerRank = Array.from({ length: 50 }, (_, i) => i).sort(() => rand() - 0.5)
  const rank = []
  powerRank.forEach((led, k) => (rank[led] = k))

  const panelEyes = (id) => makeEyes($(id), 3.4, 1.5, 13)
  const peekEyes = (id) => makeEyes($(id), 3.2, 1.4, 12)
  const eyesCompact = makeEyes($('eyesCompact'), 2.9, 1.3, 11)

  const BLINKS = [1.45, Q + 0.4, A + 0.05, B + 0.05, L - 0.2, N - 0.05]
  const HAPPY = [
    [2.35, 3.0],
    [Q + 2.3, Q + 2.7],
    [A + 4.15, A + 4.6],
    [B + 4.6, B + 5.0],
    [T + 2.0, T + 2.4],
    [C + 4.35, C + 4.75],
    [N + 4.1, N + 4.5]
  ]
  const islandMood = (t) => {
    let mood = 'open'
    if (HAPPY.some(([a, b]) => within(t, a, b))) mood = 'happy'
    if (BLINKS.some((b) => within(t, b, b + 0.12))) mood = 'blink'
    const lx = kf(t, [
      [1.7, 0],
      [1.87, 1.3, E.outCubic],
      [2.15, 1.3],
      [2.3, 0]
    ])
    const power = t < 1.0 ? (i, tk) => tk >= 0.36 + rank[i] * 0.009 : null
    return { mood, color: CY, power, look: [lx, 0] }
  }
  const panelMood = (t) => {
    if (within(t, 4.46, 5.02)) return { mood: 'thinking', color: VI }
    if (within(t, 6.0, 6.4)) return { mood: 'happy', color: CY }
    if (within(t, 3.95, 4.07)) return { mood: 'blink', color: CY }
    return { mood: 'open', color: CY }
  }
  const quickMood = (t) => {
    const tq = t - QS
    if (within(tq, 8.08, 8.33)) return { mood: 'thinking', color: VI }
    if (tq >= 8.33) return { mood: 'happy', color: CY }
    return { mood: 'open', color: CY }
  }
  const voiceMood = (t) => {
    if (t >= V + 2.85) return { mood: 'happy', color: BL }
    if (t >= V + 2.3) return { mood: 'thinking', color: VI }
    return { mood: within(t, V + 1.6, V + 1.72) ? 'blink' : 'open', color: CY }
  }
  const agAskMood = (t) => {
    if (within(t, A + 1.1, A + 1.45)) return { mood: 'thinking', color: VI }
    return { mood: within(t, A + 0.9, A + 1.02) ? 'blink' : 'open', color: CY }
  }
  const brainMood = (t) => {
    if (t >= B + 3.92) return { mood: 'happy', color: GR }
    if (t >= B + 3.2) return { mood: 'thinking', color: VI }
    if (within(t, B + 1.15, B + 1.27)) return { mood: 'blink', color: CY }
    return { mood: 'open', color: t >= B + 1.9 ? GR : CY, look: t >= B + 0.9 && t < B + 2.0 ? [0, 1.2] : [0, 0] }
  }
  const privMood = (t) => {
    if (within(t, P + 0.68, P + 1.35) || within(t, P + 2.15, P + 2.6)) return { mood: 'thinking', color: VI }
    if (within(t, P + 1.85, P + 2.15)) return { mood: 'surprised', color: VI }
    if (t >= P + 3.4) return { mood: 'happy', color: CY }
    return { mood: 'open', color: CY }
  }
  const meetMood = (t) => {
    if (t >= L + 5.0) return { mood: 'happy', color: MG }
    if (t < L + 4.45) return { mood: 'surprised', color: MG }
    return { mood: 'open', color: MG }
  }
  const apMood = () => ({ mood: 'waiting', color: AM })
  const succMood = () => ({ mood: 'happy', color: GR })
  const ccMood = () => ({ mood: 'thinking', color: OR })
  const ccOkMood = (t) => (t < C + 3.85 ? { mood: 'thinking', color: GR } : { mood: 'happy', color: GR })
  const connMood = (t) => {
    if (within(t, N + 2.0, N + 2.45) || within(t, N + 3.2, N + 3.8)) return { mood: 'happy', color: CY }
    if (within(t, N + 1.4, N + 2.0) || within(t, N + 2.65, N + 3.2)) return { mood: 'thinking', color: VI }
    return { mood: 'open', color: CY }
  }

  // Calques de l'îlot qui portent des yeux, et leur humeur.
  const EYES = {
    lCompact: [eyesCompact, islandMood],
    lPanel: [panelEyes('eyesPanel'), panelMood],
    lQuick: [panelEyes('eyesQuick'), quickMood],
    lApproval: [makeEyes($('eyesAp'), 3.6, 1.6, 13), apMood],
    lSuccess: [peekEyes('eyesSucc'), succMood],
    lVoice: [peekEyes('eyesVoice'), voiceMood],
    lAgAsk: [peekEyes('eyesAgAsk'), agAskMood],
    lAgCard: [makeEyes($('eyesAgCard'), 3.6, 1.6, 13), apMood],
    lAgOk: [peekEyes('eyesAgOk'), succMood],
    lBrain: [panelEyes('eyesBrain'), brainMood],
    lPriv: [panelEyes('eyesPriv'), privMood],
    lMeeting: [peekEyes('eyesMeet'), meetMood],
    lCc: [peekEyes('eyesCc'), ccMood],
    lCcCard: [makeEyes($('eyesCcCard'), 3.6, 1.6, 13), apMood],
    lCcOk: [peekEyes('eyesCcOk'), ccOkMood],
    lConn: [panelEyes('eyesConn'), connMood]
  }

  // ── Robot de la carte de fin (même dessin que RobotHead) ───────────
  function drawRobot() {
    const dot = 10
    const gap = 3.6
    const eg = 26
    const c = eyeCircles(dot, gap, eg)
    $('robot').innerHTML = `
      <svg viewBox="0 0 256 210" width="300" height="246" style="overflow:visible;display:block">
        <defs>
          <filter id="rg" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
          <linearGradient id="rshell" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a3a4c"/><stop offset="1" stop-color="#1c1c26"/></linearGradient>
          <radialGradient id="rvisor" cx="0.5" cy="0.25" r="0.9"><stop offset="0" stop-color="#14141c"/><stop offset="1" stop-color="#000"/></radialGradient>
        </defs>
        <rect x="6" y="88" width="26" height="62" rx="13" fill="#23232e"/>
        <rect x="224" y="88" width="26" height="62" rx="13" fill="#23232e"/>
        <rect x="14" y="104" width="10" height="30" rx="5" fill="${CY}" opacity="0.55" filter="url(#rg)"/>
        <rect x="232" y="104" width="10" height="30" rx="5" fill="${CY}" opacity="0.55" filter="url(#rg)"/>
        <rect x="124" y="20" width="8" height="38" rx="4" fill="#2e2e3c"/>
        <circle id="antenna" cx="128" cy="18" r="12" fill="${CY}" filter="url(#rg)"/>
        <rect x="22" y="52" width="212" height="140" rx="70" fill="url(#rshell)"/>
        <rect x="28" y="58" width="200" height="128" rx="64" fill="#101017"/>
        <rect x="44" y="76" width="168" height="92" rx="46" fill="url(#rvisor)"/>
        <path d="M70 84 Q128 70 186 84" stroke="rgb(255 255 255 / 0.07)" stroke-width="4" fill="none" stroke-linecap="round"/>
        <g transform="translate(${128 - c.width / 2} ${122 - c.span / 2})"><g>${c.base}</g><g class="lit" filter="url(#rg)">${c.lit}</g></g>
      </svg>`
  }
  drawRobot()
  const robotG = $('robot').querySelector('.lit')
  const eyesRobot = { g: robotG, dots: [...robotG.children] }
  const robotMood = (t) => {
    const te = t - ES
    if (within(te, 13.5, 13.62) || within(te, 15.7, 15.82)) return { mood: 'blink', color: CY }
    if (within(te, 14.22, 14.62) || within(te, 16.6, 17.0)) return { mood: 'wink', color: CY }
    if (te >= 13.72) return { mood: 'happy', color: CY }
    return { mood: 'open', color: CY }
  }

  // ── Textes découpés en mots ───────────────────────────────────────
  const words = (text, cls = '') => text.split(/(?<= )/).map((w) => `<span class="w ${cls}">${w}</span>`)
  $('h1').innerHTML = words('Ton compagnon IA.').join('')
  $('h2').innerHTML = [...words('Toujours là, '), ...words('en haut de ton écran.', 'glow')].join('')
  const h1w = [...$('h1').children]
  const h2w = [...$('h2').children]
  $('fTitle').innerHTML = words('Et bien plus encore.').join('')
  const ftw = [...$('fTitle').children]

  // Réponse de Compi, révélée mot à mot.
  const ANSWER = [
    { p: [{ b: 'Voici ta journée :' }] },
    {
      ul: [
        [{ tm: '10:00' }, 'Point d’équipe (Meet)'],
        [{ tm: '12:30' }, 'Déjeuner avec Léa'],
        [{ tm: '18:30' }, 'Club de natation']
      ]
    },
    { p: ['Et 3 e-mails non lus. Prends un parapluie : averses, 15 °C.'] }
  ]
  const part = (x) => (typeof x === 'string' ? words(x).join('') : x.b ? `<strong>${words(x.b).join('')}</strong>` : `<span class="w tm">${x.tm}</span>`)
  $('answer').innerHTML = ANSWER.map((blk) =>
    blk.p ? `<p>${blk.p.map(part).join('')}</p>` : `<ul>${blk.ul.map((li) => `<li>${li.map(part).join('')}</li>`).join('')}</ul>`
  ).join('')
  const answerW = [...$('answer').querySelectorAll('.w')]
  const answerLi = [...$('answer').querySelectorAll('li')]

  const QUESTION = 'Qu’est-ce que j’ai aujourd’hui ?'

  // E-mail : ancien texte (lettre par lettre, pour la sélection) et texte corrigé (mot à mot).
  const OLD = 'bonjour claire,\n\nmerci pour ton message. je te confirme notre rdv de jeudi a 14h.\n\nbonne journée'
  const NEW = 'Bonjour Claire,\n\nMerci pour ton message. Je te confirme notre rendez-vous de jeudi à 14 h.\n\nBonne journée,'
  $('mOld').innerHTML = [...OLD].map((ch) => (ch === '\n' ? '\n' : `<span class="ch">${ch}</span>`)).join('')
  const oldCh = [...$('mOld').querySelectorAll('.ch')]
  $('mNew').innerHTML = NEW.split(/(\s+)/)
    .map((w) => (/^\s+$/.test(w) ? w : `<span class="w">${w}</span>`))
    .join('')
  const newW = [...$('mNew').querySelectorAll('.w')]
  const qNewW = (() => {
    $('qNew').innerHTML = words($('qNew').textContent.trim()).join('')
    return [...$('qNew').children]
  })()

  // Dictée : la phrase s'écrit pendant qu'on parle.
  $('vWords').innerHTML = words('Rappelle-moi d’appeler Paul demain à 9 h').join('')
  const voiceW = [...$('vWords').children]

  // Agenda : la demande s'écrit, puis le déjeuner du matin glisse d'une heure.
  $('agWords').innerHTML = words('Décale le déjeuner avec Léa d’une heure').join('')
  const agW = [...$('agWords').children]

  // Garde-fou : résumé du bail (le document a été lu sur le PC, l'IBAN masqué avant l'envoi).
  $('pAnswer').innerHTML =
    `<p>${words('Bail de 3 ans dès le 1er novembre. Loyer de 780 € charges comprises, payé le 5 du mois. Préavis d’un mois.').join('')}</p>`
  const privW = [...$('pAnswer').querySelectorAll('.w')]

  // ── Bureau : fichiers en vrac et dossiers ─────────────────────────
  const FOLDERS = ['Documents', 'Images', 'Factures', 'À trier']
  const FILES = [
    ['facture-mars.pdf', 'PDF', '#e5484d', 2],
    ['IMG_2041.jpg', 'JPG', '#3e9bf5', 1],
    ['capture (3).png', 'PNG', '#14b8a6', 3],
    ['devis.docx', 'DOC', '#4c6ef5', 0],
    ['budget.xlsx', 'XLS', '#2f9e5a', 0],
    ['Sans titre.png', 'PNG', '#14b8a6', 3],
    ['contrat.pdf', 'PDF', '#e5484d', 0],
    ['vacances.jpg', 'JPG', '#3e9bf5', 1],
    ['scan001.pdf', 'PDF', '#e5484d', 3],
    ['notes.txt', 'TXT', '#868695', 0],
    ['facture-avril.pdf', 'PDF', '#e5484d', 2],
    ['IMG_2042.jpg', 'JPG', '#3e9bf5', 1],
    ['présentation.pptx', 'PPT', '#e8590c', 0],
    ['document (1).docx', 'DOC', '#4c6ef5', 3]
  ]
  const jr = mulberry32(42)
  const fileEls = FILES.map(([name, ext, color, to], i) => {
    const row = i < 5 ? 0 : i < 10 ? 1 : 2
    const col = i < 5 ? i : i < 10 ? i - 5 : i - 10
    const x = 704 + col * 104 + (row === 1 ? 26 : row === 2 ? 52 : 0) + (jr() - 0.5) * 26
    const y = 250 + row * 110 + (jr() - 0.5) * 20
    const r = (jr() - 0.5) * 22
    const el = document.createElement('div')
    el.className = 'file'
    el.innerHTML = `<div class="doc"><span class="ext" style="background:${color}">${ext}</span></div><div class="nm">${name}</div>`
    $('desk').appendChild(el)
    return { el, x, y, r, to }
  })
  const folderEls = FOLDERS.map((name, k) => {
    const el = document.createElement('div')
    el.className = 'folder'
    el.innerHTML = `<div class="fico"><svg viewBox="0 0 74 58" width="74" height="58">
        <defs><linearGradient id="fg${k}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fcd34d"/><stop offset="1" stop-color="#f59e0b"/></linearGradient></defs>
        <path d="M3 9a5 5 0 0 1 5-5h18l6 6h34a5 5 0 0 1 5 5v34a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5z" fill="#c9861a"/>
        <path d="M3 19a5 5 0 0 1 5-5h58a5 5 0 0 1 5 5v30a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5z" fill="url(#fg${k})"/></svg>
        <span class="badge">0</span></div><div class="nm">${name}</div>`
    $('desk').appendChild(el)
    const cx = 765 + k * 130
    el.style.left = `${cx - 55}px`
    el.style.top = '592px'
    return { el, cx, cy: 620, badge: el.querySelector('.badge') }
  })

  // ── Éditeur de code (scène Claude Code) ───────────────────────────
  const CODE = [
    [`<span class="kw">import</span> { createServer } <span class="kw">from</span> <span class="str">'./server'</span>`],
    [`<span class="kw">import</span> { routes } <span class="kw">from</span> <span class="str">'./routes'</span>`],
    [''],
    [`<span class="kw">const</span> app = <span class="fn">createServer</span>()`],
    [`app.<span class="fn">use</span>(routes)`],
    [`app.<span class="fn">get</span>(<span class="str">'/health'</span>, () =&gt; ({ ok: <span class="kw">true</span> }))`, true],
    [
      `app.<span class="fn">listen</span>(<span style="color:#f78c6c">3000</span>, () =&gt; console.<span class="fn">log</span>(<span class="str">'Prêt'</span>))`,
      true
    ],
    [''],
    [`<span class="kw">export default</span> app`]
  ]
  $('ecode').innerHTML = CODE.map(
    ([html, added], i) =>
      `<div class="eline${added ? ' add' : ''}"><span class="ln">${i + 1}</span>${added ? '<span class="mk">+</span>' : ''}<span class="tx">${html || ' '}</span></div>`
  ).join('')
  const addLines = [...$('ecode').querySelectorAll('.eline.add')]

  // ── Connecteurs (initiales colorées, pas de logos) ────────────────
  const CONN = [
    ['Notion', 'N', '#f1f1ef', '#191919'],
    ['Todoist', 'T', '#e44332'],
    ['Linear', 'L', '#5e6ad2'],
    ['Jira', 'J', '#2684ff'],
    ['monday.com', 'm', '#ff3d57'],
    ['ClickUp', 'C', '#7b68ee'],
    ['Airtable', 'A', '#fcb400', '#1b1b1b'],
    ['Dropbox', 'D', '#0061ff'],
    ['Figma', 'F', '#a259ff']
  ]
  $('cGrid').innerHTML = CONN.map(
    ([name, ini, bg, fg = '#fff']) =>
      `<div class="ctile"><span class="cbadge" style="background:${bg};color:${fg}">${ini}</span><div><b>${name}</b><div class="st">` +
      `<span class="s0">${icon('globe')}Compte · 1 clic</span><span class="s1">${icon('loader-circle')}Connexion…</span>` +
      `<span class="s2">${icon('circle-check')}Connecté</span></div></div></div>`
  ).join('')
  const ctiles = [...$('cGrid').children]
  // Notion puis Todoist : clic, connexion, connecté.
  const CONNECT = [
    { i: 0, click: N + 1.35, done: N + 2.0 },
    { i: 1, click: N + 2.6, done: N + 3.2 }
  ]

  // ── Fonctionnalités ───────────────────────────────────────────────
  const FEAT = [
    ['sliders-horizontal', PK, 'Pilote Windows', 'Son, thème, applis, avec ton OK'],
    ['mail', OR, 'Brouillons Gmail', 'Prêts à relire, jamais envoyés'],
    ['file-text', '#fdba74', 'Documents', 'PDF, Word, Excel, scans'],
    ['repeat', BL, 'Routines', 'Chaque lundi à 9 h, sans toi'],
    ['brain', '#c084fc', 'Mémoire', 'Que tu lis et corriges'],
    ['sun', AM, 'Résumé du matin', 'Agenda, e-mails, météo'],
    ['message-square-text', MG, 'Messages en attente', 'SMS, WhatsApp, Telegram'],
    ['file-search', VI, 'Recherche par le sens', 'Dans tes documents, sur ton PC'],
    ['clipboard', CY, 'Presse-papier', 'Historique chiffré sur ton PC'],
    ['sparkles', '#fde047', 'Compétences', 'Des savoir-faire à ta façon'],
    ['activity', GR, 'Ce PC', 'Ressources et modèle conseillé'],
    ['badge-check', '#5eead4', 'Zéro action imaginaire', 'Il dit quand rien n’a été fait']
  ]
  $('fGrid').innerHTML = FEAT.map(
    ([ic, c, h, p]) =>
      `<div class="tile"><div class="ico" style="color:${c};background:${c}22;box-shadow:0 0 30px -6px ${c}66, inset 0 0 0 1px ${c}33">${icon(ic)}</div><div><h3>${h}</h3><p>${p}</p></div></div>`
  ).join('')
  const tiles = [...$('fGrid').children]

  $('word').innerHTML = [...'COMPI'].map((ch) => `<span>${ch}</span>`).join('')
  const letters = [...$('word').children]
  const pills = [...$('pills').children]

  // ── Îlot : formes successives ─────────────────────────────────────
  const SHAPES = {
    hidden: [140, 6, 6],
    compact: [200, 36, 18],
    compactW: [252, 36, 18],
    panel: [680, 476, 30],
    quick: [680, 268, 30],
    quickDone: [680, 226, 30],
    approval: [540, 172, 28],
    success: [420, 64, 30],
    listen: [460, 64, 30],
    agAsk: [540, 64, 30],
    agCard: [600, 214, 28],
    agOk: [480, 64, 30],
    brain: [680, 384, 30],
    priv: [680, 380, 30],
    music: [460, 72, 32],
    timer: [400, 72, 32],
    meeting: [480, 64, 30],
    cc: [460, 64, 30],
    ccCard: [560, 196, 28],
    ccOk: [460, 64, 30],
    conn: [680, 372, 30]
  }
  const LAYER = {
    hidden: 'lHidden',
    compact: 'lCompact',
    compactW: 'lCompact',
    panel: 'lPanel',
    quick: 'lQuick',
    quickDone: 'lQuick',
    approval: 'lApproval',
    success: 'lSuccess',
    listen: 'lVoice',
    agAsk: 'lAgAsk',
    agCard: 'lAgCard',
    agOk: 'lAgOk',
    brain: 'lBrain',
    priv: 'lPriv',
    music: 'lMusic',
    timer: 'lTimer',
    meeting: 'lMeeting',
    cc: 'lCc',
    ccCard: 'lCcCard',
    ccOk: 'lCcOk',
    conn: 'lConn'
  }
  const ISLAND = [
    [0, 'hidden'],
    [0.12, 'compact'],
    [3.16, 'panel'],
    [6.3, 'compact'],
    [V + 0.45, 'listen'],
    [V + 4.3, 'compact'],
    [Q + 1.25, 'quick'],
    [Q + 2.06, 'quickDone'],
    [Q + 2.25, 'compact'],
    [A + 0.2, 'agAsk'],
    [A + 1.45, 'agCard'],
    [A + 2.8, 'agOk'],
    [A + 4.1, 'compact'],
    [B + 0.35, 'brain'],
    [B + 4.55, 'compact'],
    [P + 0.3, 'priv'],
    [P + 4.1, 'compact'],
    [L + 0.2, 'compactW'],
    [L + 0.75, 'music'],
    [L + 2.1, 'compactW'],
    [L + 2.75, 'timer'],
    [L + 3.8, 'compactW'],
    [L + 4.05, 'meeting'],
    [L + 5.55, 'compactW'],
    [T + 0.22, 'approval'],
    [T + 1.12, 'success'],
    [T + 2.0, 'compact'],
    [C + 0.45, 'cc'],
    [C + 1.7, 'ccCard'],
    [C + 3.15, 'ccOk'],
    [C + 4.35, 'compact'],
    [N + 0.3, 'conn'],
    [N + 4.1, 'compact']
  ]
  const DIMS = [0, 1, 2].map((d) => ISLAND.map(([ti, s]) => [ti, SHAPES[s][d]]))
  const islandDim = (t, d) => springTo(t, DIMS[d], 380, t < 0.9 ? 22 : 30)
  const stateAt = (t) => {
    let s = ISLAND[0][1]
    for (const [ti, st] of ISLAND) if (t >= ti) s = st
    return s
  }

  // Fenêtres d'affichage de chaque calque, déduites des états (états voisins du même calque fusionnés).
  const LAYER_WINDOWS = {}
  ISLAND.forEach(([ti, s], i) => {
    const id = LAYER[s]
    const end = i + 1 < ISLAND.length ? ISLAND[i + 1][0] : 999
    const list = (LAYER_WINDOWS[id] ??= { big: SHAPES[s][1] > 120, spans: [] }).spans
    const last = list[list.length - 1]
    if (last && last[1] === ti) last[1] = end
    else list.push([ti, end])
  })

  // Lueur de l'îlot : couleur de l'état en cours (violet pendant la réflexion).
  const THINK = [
    [4.46, 5.02],
    [V + 2.3, V + 2.85],
    [A + 1.1, A + 1.45],
    [B + 3.2, B + 3.92],
    [P + 0.68, P + 1.35],
    [P + 2.15, P + 2.6]
  ]
  const GLOW = { approval: AM, ccCard: AM, agCard: AM, success: GR, ccOk: GR, agOk: GR, music: GR, timer: PK, meeting: MG, cc: OR, conn: VI }
  function glowAt(t) {
    if (THINK.some(([a, b]) => within(t, a, b))) return VI
    const s = stateAt(t)
    if (s === 'listen' && t >= V + 2.85) return BL
    if (s === 'brain' && t >= B + 1.9) return GR
    return GLOW[s] ?? CY
  }

  // Légendes de gauche.
  const CAPS = [
    ['cap2', 3.62, 6.32],
    ['capV', V + 0.3, V + 4.45],
    ['cap3', Q + 0.42, Q + 2.65],
    ['capA', A + 0.35, A + 4.55],
    ['capB', B + 0.45, B + 4.6],
    ['capP', P + 0.35, P + 4.2],
    ['capL', L + 0.35, L + 5.75],
    ['cap4', T + 0.22, T + 2.32],
    ['capC', C + 0.35, C + 4.6],
    ['capN', N + 0.35, N + 4.05]
  ].map(([id, a, b]) => [$(id), a, b])

  function key(el, down) {
    el.style.transform = down ? 'translateY(5px)' : 'none'
    el.style.boxShadow = down
      ? '0 2px 0 #050507, 0 0 0 2px rgb(56 225 255 / 0.55), 0 0 30px rgb(56 225 255 / 0.45)'
      : '0 7px 0 #050507, 0 18px 30px -10px rgb(0 0 0 / 0.8)'
    el.style.color = down ? CY : ''
  }
  function keys(row, t, a, b, presses) {
    show(row, t, [[a, b]], 0.1, 0.12, 4)
    row.style.transform = `translateY(${(1 - E.outCubic(seg(t, a, a + 0.2))) * 20}px)`
    const ks = [...row.querySelectorAll('.key')]
    presses.forEach(([d, u], i) => key(ks[i], within(t, d, u)))
  }
  function caption(el, t, a, b) {
    const o = show(el, t, [[a, b]], 0.3, 0.22, 10)
    const pin = E.outCubic(seg(t, a, a + 0.45))
    const pout = E.inCubic(seg(t, b, b + 0.22))
    el.style.transform = `translateY(calc(-50% + ${(1 - pin) * 34 - pout * 20}px))`
    return o
  }
  function rise(el, t, d, dur = 0.55, dist = 36, blur = 12) {
    const p = E.outCubic(seg(t, d, d + dur))
    el.style.opacity = p
    el.style.transform = `translateY(${(1 - p) * dist}px)`
    el.style.filter = p < 1 ? `blur(${((1 - p) * blur).toFixed(2)}px)` : 'none'
  }
  /** Fenêtre posée sur le Bureau : arrive en montant, repart en descendant. */
  function windowIn(el, t, a, b) {
    const mi = E.outCubic(seg(t, a, a + 0.43))
    const mo = E.inCubic(seg(t, b, b + 0.32))
    el.style.opacity = Math.min(mi, 1 - mo)
    el.style.transform = `translateY(${(1 - mi) * 28 + mo * 36}px) scale(${0.97 + 0.03 * mi})`
    el.style.filter = mo > 0 ? `blur(${mo * 10}px)` : 'none'
    el.style.visibility = mi > 0 && mo < 1 ? 'visible' : 'hidden'
  }
  /** Égaliseur à LED : hauteurs en paliers de 4 px, pseudo-aléatoires mais fonction de t. */
  function eq(el, t, amp, seed = 0) {
    ;[...el.children].forEach((bar, i) => {
      const a = Math.abs(Math.sin(t * (7.3 + i * 2.3) + i * 1.7 + seed)) * (0.55 + 0.45 * Math.abs(Math.sin(t * 3.1 + i * 0.9 + seed)))
      const k = Math.max(1, Math.round(amp * (0.25 + 0.75 * a) * 5))
      bar.style.height = `${k * 4 - 1}px`
    })
  }
  const press = (el, t, at, s = 0.94) => {
    el.style.transform = within(t, at, at + 0.09) ? `scale(${s})` : 'none'
  }

  // ── Curseur : un trajet par scène, cibles lues sur la page ────────
  let camS = 1
  const centerOf = (el, fx = 0.55, fy = 0.55) => {
    const r = el.getBoundingClientRect()
    return [r.left + r.width * fx, r.top + r.height * fy]
  }
  const CURSOR = [
    { a: A + 1.9, b: A + 2.95, from: [1640, 1010], moves: [[A + 1.98, A + 2.5, () => centerOf($('agOkBtn'))]], clicks: [A + 2.65] },
    {
      a: B + 1.0,
      b: B + 3.45,
      from: [1640, 1010],
      moves: [
        [B + 1.08, B + 1.72, () => centerOf($('bc1'), 0.5, 0.5)],
        [B + 2.42, B + 2.98, () => centerOf($('bUse'))]
      ],
      clicks: [B + 1.85, B + 3.1]
    },
    { a: L + 0.22, b: L + 1.95, from: [1560, 960], moves: [[L + 0.26, L + 0.72, () => [960 + 40 * camS, 24 * camS]]], clicks: [] },
    { a: L + 4.15, b: L + 5.35, from: [1600, 980], moves: [[L + 4.22, L + 4.85, () => centerOf($('meetBtn'))]], clicks: [L + 5.0] },
    { a: T + 0.5, b: T + 1.25, from: [1640, 1010], moves: [[T + 0.55, T + 0.98, () => centerOf($('apOk'))]], clicks: [T + 1.0] },
    {
      a: N + 0.8,
      b: N + 3.35,
      from: [1640, 1010],
      moves: [
        [N + 0.88, N + 1.3, () => centerOf(ctiles[0], 0.17, 0.62)],
        [N + 2.15, N + 2.52, () => centerOf(ctiles[1], 0.17, 0.62)]
      ],
      clicks: CONNECT.map((c) => c.click)
    }
  ]
  function drawCursor(t) {
    const cur = $('cursor')
    for (const c of CURSOR) {
      if (t < c.a || t > c.b + 0.16) continue
      let p = c.from
      for (const [t0, t1, target] of c.moves) {
        if (t < t0) break
        const q = target()
        const e = E.inOutCubic(seg(t, t0, t1))
        p = [lerp(p[0], q[0], e), lerp(p[1], q[1], e)]
      }
      const down = c.clicks.some((k) => within(t, k, k + 0.08))
      cur.style.opacity = Math.min(seg(t, c.a, c.a + 0.12), 1 - seg(t, c.b, c.b + 0.15))
      cur.style.transform = `translate(${p[0].toFixed(1)}px, ${p[1].toFixed(1)}px) scale(${down ? 0.86 : 1})`
      return
    }
    cur.style.opacity = 0
  }

  // ── Une image ─────────────────────────────────────────────────────
  function seek(t) {
    const tq = t - QS
    const tt = t - TS
    const te = t - ES

    // Caméra : zoom sur l'îlot, collé au bord haut de l'écran.
    const s = kf(t, [
      [0, 2.42],
      [2.95, 2.66, E.linear],
      [3.62, 1.6],
      [6.3, 1.63, E.linear],
      [V + 0.6, 2.2],
      [Q - 0.05, 2.25, E.linear],
      [Q + 0.68, 1.28],
      [Q + 2.75, 1.31, E.linear],
      [A + 0.5, 1.4],
      [B - 0.1, 1.43, E.linear],
      [B + 0.65, 1.6],
      [P + 4.2, 1.64, E.linear],
      [L + 0.6, 2.3],
      [T - 0.1, 2.36, E.linear],
      [T + 0.5, 1.5],
      [C - 0.05, 1.56, E.linear],
      [C + 0.55, 1.36],
      [N - 0.05, 1.39, E.linear],
      [N + 0.6, 1.6],
      [G - 0.2, 1.63, E.linear],
      [G + 0.8, 1.8]
    ])
    camS = s
    const world = $('world')
    world.style.transform = `translate(${(960 - 960 * s).toFixed(2)}px, 0px) scale(${s.toFixed(4)})`
    const wb = kf(t, [
      [G - 0.2, 0],
      [G + 0.25, 16]
    ])
    const br = kf(t, [
      [G - 0.2, 1],
      [G + 0.25, 0.5]
    ])
    world.style.filter = wb > 0 ? `blur(${wb.toFixed(2)}px) brightness(${br.toFixed(3)})` : 'none'
    $('blob1').style.transform = `translate(${1120 + Math.sin(t * 0.5) * 70}px, ${-120 + Math.cos(t * 0.4) * 40}px)`
    $('blob2').style.transform = `translate(${380 + Math.cos(t * 0.45) * 80}px, ${520 + Math.sin(t * 0.35) * 50}px)`

    // Îlot
    const w = islandDim(t, 0)
    const h = islandDim(t, 1)
    const r = islandDim(t, 2)
    const body = $('islandBody')
    body.style.width = `${w.toFixed(2)}px`
    body.style.height = `${h.toFixed(2)}px`
    body.style.borderRadius = `0 0 ${r.toFixed(2)}px ${r.toFixed(2)}px`
    const glowC = glowAt(t)
    body.style.boxShadow =
      h > 120
        ? `0 34px 90px -24px rgb(0 0 0 / 0.85), 0 0 0 1px rgb(255 255 255 / 0.07), 0 18px 60px -30px ${glowC}`
        : `0 8px 24px -10px rgb(0 0 0 / 0.7), 0 0 0 1px rgb(255 255 255 / 0.05), 0 10px 34px -12px ${glowC}`
    $('lCompact').style.width = `${w.toFixed(2)}px`

    for (const [id, { big, spans }] of Object.entries(LAYER_WINDOWS)) {
      const o =
        id === 'lHidden'
          ? show($(id), t, [[-1, spans[0][1] + 0.01]], 0.01, 0.08)
          : show(
              $(id),
              t,
              spans.map(([a, b]) => [a + (big ? 0.05 : 0.08), b - 0.01]),
              big ? 0.2 : 0.15,
              0.08
            )
      const eyes = EYES[id]
      if (eyes && o > 0) paintEyes(eyes[0], eyes[1], t)
    }

    // Accessoires de l'îlot compact : pochette et égaliseur, puis minuteur.
    const acc = (a, b) => Math.min(seg(t, a, a + 0.25), 1 - seg(t, b, b + 0.15))
    $('cLeft').style.opacity = acc(L + 0.3, T)
    $('cEq').style.opacity = acc(L + 0.3, L + 2.75)
    $('cTimer').style.opacity = acc(L + 3.85, T)
    eq($('cEq'), t, 0.85, 1)
    const tLeft = 1500 - Math.max(0, Math.floor(t - (L + 2.3)))
    $('cTimer').textContent = mmss(tLeft)

    // Scène 1 : accroche
    h1w.forEach((el, i) => rise(el, t, 0.42 + i * 0.08))
    h2w.forEach((el, i) => rise(el, t, 0.82 + i * 0.05, 0.5, 26, 10))
    const hl = $('headline')
    const hout = E.inCubic(seg(t, 2.74, 3.02))
    hl.style.opacity = 1 - hout
    hl.style.transform = `translateY(${-hout * 30}px)`
    hl.style.filter = hout > 0 ? `blur(${hout * 12}px)` : 'none'

    keys($('keys1'), t, 2.8, 3.28, [
      [2.92, 3.2],
      [3.0, 3.2],
      [3.08, 3.18]
    ])

    for (const [el, a, b] of CAPS) caption(el, t, a, b)

    // Scène 2 : discussion
    const typing = seg(t, 3.72, 4.3)
    const n = Math.floor(typing * QUESTION.length + 0.0001)
    const sent = t >= 4.4
    const caretOn = (t >= 3.72 && t < 4.4) || Math.floor(t * 2.2) % 2 === 0
    $('inputText').innerHTML =
      !sent && n > 0
        ? `<span class="typed">${QUESTION.slice(0, n)}</span><span class="caret"></span>`
        : `${caretOn && t > 3.5 ? '<span class="caret" style="margin:0 6px 0 0"></span>' : ''}<span>Demande à Compi…</span>`
    const send = $('send')
    const ready = n > 0 && !sent
    send.style.background = ready ? CY : 'rgb(255 255 255 / 0.06)'
    send.style.color = ready ? '#050507' : ''
    send.style.boxShadow = ready ? '0 0 16px rgb(56 225 255 / 0.5)' : 'none'
    send.style.transform = within(t, 4.34, 4.42) ? 'scale(0.88)' : 'none'

    const um = E.outCubic(seg(t, 4.42, 4.66))
    const u = $('uMsg')
    u.style.opacity = um
    u.style.transform = `translateY(${(1 - um) * 14}px) scale(${0.96 + 0.04 * um})`
    u.style.transformOrigin = '100% 100%'

    const tl = E.outCubic(seg(t, 4.56, 4.74))
    $('tool').style.opacity = tl
    $('tool').style.transform = `translateY(${(1 - tl) * 8}px)`
    const done = t >= 5.02
    $('ledots').style.display = done ? 'none' : ''
    $('toolOk').style.display = done ? '' : 'none'
    $('toolText').textContent = done ? 'Agenda lu · 3 rendez-vous' : 'Lecture de ton agenda…'
    const step = Math.floor(t / 0.11) % 3
    ;[...$('ledots').children].forEach((d, i) => (d.style.opacity = i === step ? 1 : 0.28))
    ;[...$('pDots').children].forEach((d, i) => (d.style.opacity = i === step ? 1 : 0.28))

    answerW.forEach((el, i) => {
      const d = 5.06 + i * 0.03
      const p = seg(t, d, d + 0.09)
      el.style.opacity = p
      el.style.filter = p > 0 && p < 1 ? `blur(${(1 - p) * 3}px)` : 'none'
    })
    answerLi.forEach((li) => li.style.setProperty('--bo', li.querySelector('.w').style.opacity))
    const pc = E.outBack(seg(t, 6.02, 6.3))
    $('privacy').style.opacity = clamp(seg(t, 6.02, 6.14))
    $('privacy').style.transform = `scale(${0.8 + 0.2 * pc})`
    $('privacy').style.transformOrigin = '0 50%'
    const thinking = within(t, 4.46, 5.02)
    const writing = within(t, 5.02, 6.0)
    $('pStatus').textContent = thinking ? 'je réfléchis' : writing ? 'je rédige' : 'prêt'
    $('pDot').style.background = thinking ? VI : CY
    $('pDot').style.boxShadow = `0 0 8px ${thinking ? VI : CY}`

    // Scène 3 : dictée vocale (Whisper, sur le PC)
    keys($('keysV'), t, V + 0.3, V + 2.45, [
      [V + 0.42, V + 2.3],
      [V + 0.5, V + 2.3],
      [V + 0.58, V + 2.3]
    ])
    swap($('vA'), t, V + 0.5, V + 2.3)
    swap($('vB'), t, V + 2.3, V + 2.85)
    swap($('vC'), t, V + 2.85)
    voiceW.forEach((el, i) => {
      const d = V + 0.8 + i * 0.19
      const p = seg(t, d, d + 0.12)
      el.style.opacity = p
      el.style.filter = p > 0 && p < 1 ? `blur(${(1 - p) * 3}px)` : 'none'
    })
    const speaking = within(t, V + 0.72, V + 2.2)
    eq($('vEq'), t, speaking ? 0.75 + 0.25 * Math.abs(Math.sin(t * 5.3)) : 0.2, 3)
    $('vEq').style.opacity = 1 - seg(t, V + 2.3, V + 2.42)
    const vi = E.outBack(seg(t, V + 2.85, V + 3.15))
    $('vIcon').style.opacity = clamp(seg(t, V + 2.85, V + 2.95))
    $('vIcon').style.transform =
      `scale(${(0.5 + 0.5 * vi).toFixed(3)}) rotate(${(Math.sin((t - V - 2.85) * 22) * 14 * (1 - seg(t, V + 2.85, V + 3.5))).toFixed(2)}deg)`
    const vc = $('vChip')
    const vcp = E.outCubic(seg(t, V + 1.0, V + 1.4))
    const vco = seg(t, V + 4.2, V + 4.4)
    vc.style.opacity = Math.min(vcp, 1 - vco)
    vc.style.transform = `translateX(-50%) translateY(${((1 - vcp) * -10).toFixed(2)}px)`

    // Scène 4 : actions rapides (horaires d'origine, décalés)
    const mail = $('mail')
    const mi = E.outCubic(seg(tq, 6.55, 6.98))
    const mo = E.inCubic(seg(tq, 9.02, 9.34))
    mail.style.opacity = Math.min(mi, 1 - mo)
    mail.style.transform = `translateY(${(1 - mi) * 28 + mo * 36}px) scale(${0.97 + 0.03 * mi})`
    mail.style.filter = mo > 0 ? `blur(${mo * 10}px)` : 'none'
    mail.style.visibility = mi > 0 && mo < 1 ? 'visible' : 'hidden'
    const nsel = Math.floor(E.inOutCubic(seg(tq, 7.0, 7.34)) * oldCh.length)
    oldCh.forEach((el, i) => el.classList.toggle('sel', i < nsel && tq < 8.58))
    const oo = 1 - seg(tq, 8.58, 8.7)
    $('mOld').style.opacity = oo
    $('mOld').style.filter = oo < 1 ? `blur(${(1 - oo) * 6}px)` : 'none'
    newW.forEach((el, i) => {
      const d = 8.6 + i * 0.011
      const p = seg(tq, d, d + 0.07)
      const c = seg(tq, d + 0.07, d + 0.36)
      el.style.opacity = p
      const [r0, g0, b0] = hex(CY)
      el.style.color = `rgb(${Math.round(lerp(r0, 237, c))} ${Math.round(lerp(g0, 237, c))} ${Math.round(lerp(b0, 243, c))})`
      el.style.textShadow = c < 1 ? `0 0 ${((1 - c) * 14).toFixed(1)}px rgb(56 225 255 / ${(0.7 * (1 - c)).toFixed(2)})` : 'none'
    })

    keys($('keys2'), tq, 7.3, 7.95, [
      [7.4, 7.76],
      [7.48, 7.76],
      [7.56, 7.66]
    ])
    const corr = $('qCorr')
    const pressed = within(tq, 8.04, 8.36)
    corr.style.background = pressed ? 'rgb(56 225 255 / 0.14)' : ''
    corr.style.borderColor = pressed ? 'rgb(56 225 255 / 0.5)' : ''
    corr.style.transform = within(tq, 8.04, 8.12) ? 'scale(0.96)' : 'none'
    const qo = 1 - seg(tq, 8.2, 8.33)
    $('qOld').style.opacity = qo
    $('qOld').style.filter = qo < 1 ? `blur(${(1 - qo) * 5}px)` : 'none'
    qNewW.forEach((el, i) => (el.style.opacity = seg(tq, 8.33 + i * 0.008, 8.4 + i * 0.008)))
    $('qGrid').style.opacity = 1 - seg(tq, 8.33, 8.42)
    $('qActs').style.opacity = seg(tq, 8.38, 8.5)
    $('qReplace').style.transform = within(tq, 8.5, 8.57) ? 'scale(0.94)' : 'none'

    // Scène 4 bis : agenda, déplacer un rendez-vous (carte à chaque fois, sans « Toujours »)
    windowIn($('agenda'), t, A + 0.1, A + 4.55)
    agW.forEach((el, i) => {
      const d = A + 0.4 + i * 0.075
      const p = seg(t, d, d + 0.1)
      el.style.opacity = p
      el.style.filter = p > 0 && p < 1 ? `blur(${(1 - p) * 3}px)` : 'none'
    })
    swap($('agA'), t, -1, A + 1.1)
    swap($('agB'), t, A + 1.1)
    ;[...$('agDots').children].forEach((d, i) => (d.style.opacity = i === step ? 1 : 0.28))
    $('scan3').style.transform = `translateX(${(((((t - A - 1.5) % 1.2) + 1.2) % 1.2) / 1.2) * 200 - 100}%)`
    press($('agOkBtn'), t, A + 2.65, 0.93)
    $('agOkBtn').style.filter = within(t, A + 2.65, A + 2.77) ? 'brightness(1.2)' : 'none'
    // Le même événement glisse d'une heure (58 px par heure) : pas de doublon, l'ancienne place s'efface.
    const mv = spring(t - (A + 2.82), 260, 26)
    const ev = $('agEv')
    ev.style.top = `${lerp(159, 217, mv).toFixed(2)}px`
    ev.style.boxShadow = `0 0 ${(4 + 26 * (1 - seg(t, A + 3.1, A + 3.9)) * seg(t, A + 2.82, A + 2.9)).toFixed(1)}px -4px rgb(244 114 182 / 0.75)`
    $('agEvTime').textContent = t >= A + 2.95 ? '13:30 – 14:30' : '12:30 – 13:30'
    $('agGhost').style.opacity = seg(t, A + 2.82, A + 2.92) * (1 - seg(t, A + 3.5, A + 4.0))

    // Scène 5 : choix du cerveau
    ;['bc0', 'bc1', 'bc2'].forEach((id, k) => {
      const el = $(id)
      rise(el, t, B + 0.5 + k * 0.08, 0.45, 18, 8)
      const picked = k === 1 && t >= B + 1.9
      if (k !== 1 && t >= B + 1.9) el.style.opacity = Math.min(Number(el.style.opacity), 1 - 0.5 * seg(t, B + 1.9, B + 2.1))
      el.style.borderColor = picked ? 'rgb(74 222 128 / 0.6)' : ''
      el.style.background = picked ? 'rgb(74 222 128 / 0.08)' : ''
      el.style.boxShadow = picked ? '0 0 26px -8px rgb(74 222 128 / 0.6)' : 'none'
      if (k === 1 && within(t, B + 1.85, B + 1.95)) el.style.transform = 'scale(0.97)'
    })
    rise($('bRec'), t, B + 2.15, 0.45, 16, 8)
    press($('bUse'), t, B + 3.1)
    const tests = [...$('bTest').children]
    tests.forEach((el, k) => rise(el, t, k < 3 ? B + 3.3 + k * 0.2 : B + 3.95, 0.3, 8, 4))
    $('bStatus').textContent = t >= B + 3.92 ? 'prêt · sur ce PC' : t >= B + 3.2 ? 'test du modèle…' : 'réglages'

    // Scène 6 : garde-fou de confidentialité (cerveau en ligne)
    const pm = E.outCubic(seg(t, P + 0.5, P + 0.74))
    const pMsg = $('pMsg')
    pMsg.style.opacity = pm
    pMsg.style.transform = `translateY(${(1 - pm) * 14}px) scale(${0.96 + 0.04 * pm})`
    pMsg.style.transformOrigin = '100% 100%'
    const ptl = E.outCubic(seg(t, P + 0.68, P + 0.86))
    $('pTool').style.opacity = ptl
    $('pTool').style.transform = `translateY(${(1 - ptl) * 8}px)`
    const read = t >= P + 1.35
    $('pDots').style.display = read ? 'none' : ''
    $('pToolOk').style.display = read ? '' : 'none'
    $('pToolText').textContent = read ? 'bail-appartement.pdf lu sur ton PC · 2 pages' : 'Lecture de bail-appartement.pdf…'
    rise($('pEx'), t, P + 1.4, 0.35, 10, 6)
    const mk = seg(t, P + 1.85, P + 2.02)
    $('pIban').style.opacity = 1 - mk
    $('pIban').style.filter = mk > 0 ? `blur(${(mk * 6).toFixed(2)}px)` : 'none'
    const mkIn = E.outBack(seg(t, P + 1.9, P + 2.12))
    $('pMask').style.opacity = clamp(seg(t, P + 1.9, P + 2.0))
    $('pMask').style.transform = `scale(${(0.7 + 0.3 * mkIn).toFixed(3)})`
    $('pMask').style.boxShadow = `0 0 ${(22 * (1 - seg(t, P + 2.0, P + 2.6))).toFixed(1)}px rgb(167 139 250 / 0.7)`
    privW.forEach((el, i) => {
      const d = P + 2.62 + i * 0.035
      const p = seg(t, d, d + 0.09)
      el.style.opacity = p
      el.style.filter = p > 0 && p < 1 ? `blur(${(1 - p) * 3}px)` : 'none'
    })
    const pcp = E.outBack(seg(t, P + 3.45, P + 3.73))
    $('pChip').style.opacity = clamp(seg(t, P + 3.45, P + 3.57))
    $('pChip').style.transform = `scale(${0.8 + 0.2 * pcp})`
    $('pChip').style.transformOrigin = '0 50%'
    const pReading = within(t, P + 0.68, P + 1.35)
    const pThink = within(t, P + 2.15, P + 2.6)
    const pWrite = within(t, P + 2.6, P + 3.4)
    $('prStatus').textContent = pReading ? 'lecture' : pThink ? 'je réfléchis' : pWrite ? 'je rédige' : 'prêt'
    $('prDot').style.background = pReading || pThink ? VI : CY
    $('prDot').style.boxShadow = `0 0 8px ${pReading || pThink ? VI : CY}`

    // Scène 7 : îlot vivant (musique, pomodoro, réunion)
    const sec = Math.max(0, t - (L + 0.75))
    $('mTime').textContent = mmss(72 + sec)
    $('mBar').style.width = `${(((72 + sec) / 185) * 100).toFixed(2)}%`
    eq($('mEq'), t, 0.9, 2)
    const fill = E.outCubic(seg(t, L + 2.8, L + 3.25))
    $('tRing').setAttribute('stroke-dashoffset', (113.1 * (1 - fill * (tLeft / 1500))).toFixed(2))
    $('tBig').textContent = mmss(tLeft)
    press($('meetBtn'), t, L + 5.0)
    $('meetBtn').style.filter = within(t, L + 5.0, L + 5.15) ? 'brightness(1.25)' : 'none'

    // Scène 8 : autorisation et rangement (horaires d'origine, décalés)
    $('scan').style.transform = `translateX(${(((tt - 9.3) % 1.2) / 1.2) * 200 - 100}%)`
    $('apOk').style.transform = within(tt, 10.0, 10.09) ? 'scale(0.93)' : 'none'
    $('apOk').style.filter = within(tt, 10.0, 10.12) ? 'brightness(1.2)' : 'none'
    const deskOut = 1 - seg(tt, 11.3, 11.55)
    fileEls.forEach((f, i) => {
      const appear = E.outBack(seg(tt, 9.25 + i * 0.02, 9.6 + i * 0.02))
      const fly0 = 10.25 + i * 0.045
      const fp = seg(tt, fly0, fly0 + 0.42)
      const fe = E.inOutCubic(fp)
      const dest = folderEls[f.to]
      const x = lerp(f.x, dest.cx - 48, fe)
      const y = lerp(f.y, dest.cy - 40, fe) - Math.sin(Math.PI * fe) * 70
      const sc = lerp(0.85 + 0.15 * appear, 0.3, fe)
      f.el.style.left = `${x.toFixed(2)}px`
      f.el.style.top = `${y.toFixed(2)}px`
      f.el.style.transform = `rotate(${lerp(f.r, 0, fe).toFixed(2)}deg) scale(${sc.toFixed(3)})`
      f.el.style.opacity = clamp(seg(tt, 9.25 + i * 0.02, 9.45 + i * 0.02)) * (1 - seg(fp, 0.7, 1)) * deskOut
    })
    folderEls.forEach((fo, k) => {
      const p = E.outBack(seg(tt, 10.12 + k * 0.05, 10.42 + k * 0.05))
      fo.el.style.opacity = clamp(seg(tt, 10.12 + k * 0.05, 10.25 + k * 0.05)) * deskOut
      fo.el.style.transform = `scale(${(0.6 + 0.4 * p).toFixed(3)})`
      const count = fileEls.filter((f, i) => f.to === k && tt >= 10.25 + i * 0.045 + 0.38).length
      fo.badge.textContent = count
      fo.badge.style.opacity = count > 0 ? 1 : 0
      const bump = fileEls.some((f, i) => f.to === k && within(tt, 10.25 + i * 0.045 + 0.38, 10.25 + i * 0.045 + 0.5))
      fo.badge.style.transform = bump ? 'scale(1.25)' : 'none'
    })

    // Scène 9 : Claude Code, piloté depuis l'îlot
    windowIn($('editor'), t, C + 0.05, C + 4.45)
    addLines.forEach((el, k) => {
      const d = C + 0.85 + k * 0.32
      const p = seg(t, d, d + 0.28)
      el.querySelector('.tx').style.clipPath = `inset(0 ${((1 - p) * 100).toFixed(2)}% 0 0)`
      el.querySelector('.mk').style.opacity = p > 0 ? 1 : 0
      el.style.background = p > 0 ? `rgb(74 222 128 / ${(0.12 - 0.05 * seg(t, d + 0.3, d + 1.2)).toFixed(3)})` : 'transparent'
    })
    $('scan2').style.transform = `translateX(${(((((t - C - 1.75) % 1.2) + 1.2) % 1.2) / 1.2) * 200 - 100}%)`
    keys($('keysO'), t, C + 2.45, C + 3.2, [
      [C + 2.6, C + 2.95],
      [C + 2.68, C + 2.95],
      [C + 2.76, C + 2.9]
    ])
    press($('ccOkBtn'), t, C + 2.78, 0.93)
    $('ccOkBtn').style.filter = within(t, C + 2.78, C + 2.9) ? 'brightness(1.2)' : 'none'
    swap($('ccA'), t, -1, C + 3.85)
    swap($('ccB'), t, C + 3.85)

    // Scène 10 : connecteurs
    ctiles.forEach((el, i) => {
      rise(el, t, N + 0.45 + i * 0.04, 0.4, 12, 6)
      const c = CONNECT.find((x) => x.i === i)
      const state = !c || t < c.click + 0.05 ? 0 : t < c.done ? 1 : 2
      ;[...el.querySelector('.st').children].forEach((sp, k) => (sp.style.display = k === state ? 'inline-flex' : 'none'))
      if (state === 1) el.querySelector('.s1 svg').style.transform = `rotate(${((t * 540) % 360).toFixed(1)}deg)`
      const flash = c ? 1 - seg(t, c.done, c.done + 0.6) : 1
      el.style.borderColor = state === 2 ? 'rgb(74 222 128 / 0.45)' : state === 1 ? 'rgb(56 225 255 / 0.4)' : ''
      el.style.boxShadow = state === 2 ? `0 0 ${(10 + 20 * flash).toFixed(1)}px -8px rgb(74 222 128 / 0.7)` : 'none'
      if (c && within(t, c.click, c.click + 0.09)) el.style.transform = 'scale(0.97)'
    })

    // Scène 11 : tout le reste
    const fo = Math.min(seg(t, G - 0.12, G + 0.1), 1 - seg(t, END - 0.08, END + 0.06))
    $('features').style.opacity = fo
    $('features').style.visibility = fo > 0 ? 'visible' : 'hidden'
    ftw.forEach((el, i) => rise(el, t, G - 0.05 + i * 0.06, 0.45, 30, 10))
    tiles.forEach((el, i) => {
      const d = G + 0.12 + i * 0.06
      const p = E.outCubic(seg(t, d, d + 0.38))
      const x = seg(t, END - 0.16 + i * 0.015, END - 0.02 + i * 0.015)
      el.style.opacity = p * (1 - x)
      el.style.transform = `translateY(${(1 - p) * 34}px) scale(${(0.92 + 0.08 * p + 0.04 * x).toFixed(4)})`
      el.style.filter = p < 1 ? `blur(${((1 - p) * 10).toFixed(2)}px)` : 'none'
    })

    // Scène 12 : carte de fin (horaires d'origine, décalés)
    const eo = seg(te, 12.95, 13.12)
    $('end').style.opacity = eo
    $('end').style.visibility = eo > 0 ? 'visible' : 'hidden'
    if (te >= 12.9) {
      const rp = spring(te - 13.0, 300, 16)
      $('robot').style.transform = `translateY(${((1 - rp) * 50).toFixed(2)}px) scale(${(0.55 + 0.45 * rp).toFixed(4)})`
      $('robot').style.opacity = clamp(seg(te, 13.0, 13.15))
      $('antenna').setAttribute('opacity', (0.775 + 0.225 * Math.cos(((te - 13) / 2.4) * Math.PI * 2)).toFixed(3))
      paintEyes(eyesRobot, robotMood, t)
      letters.forEach((el, k) => {
        const d = 13.22 + k * 0.07
        el.style.opacity = te < d ? 0 : te < d + 0.03 ? 1 : te < d + 0.06 ? 0.15 : 1
      })
      rise($('tagline'), te, 13.6, 0.5, 24, 10)
      pills.forEach((el, k) => rise(el, te, 13.82 + k * 0.08, 0.45, 18, 8))
      rise($('credit'), te, 14.08, 0.5, 16, 8)
    }

    drawCursor(t)

    $('fade').style.opacity = Math.max(
      kf(t, [
        [0, 1],
        [0.25, 0, E.outCubic]
      ]),
      E.inCubic(seg(t, DURATION - 0.6, DURATION - 0.02))
    )
  }

  const ready = document.fonts.ready.then(() =>
    Promise.all(['600 20px Onest', '400 20px Onest', '800 20px Doto', '900 20px Doto', '400 20px "JetBrains Mono"'].map((f) => document.fonts.load(f)))
  )
  window.__duration = DURATION
  window.__ready = ready
  // Marqueur de synchronisation : le pixel (0, 0) porte le numéro de l'image, pour que
  // render.cjs sache que la capture est bien celle de cet instant (il le recouvre ensuite).
  const marker = document.createElement('div')
  marker.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;z-index:99'
  document.body.appendChild(marker)
  /** Met la scène à l'instant t, puis attend que l'image soit dessinée. */
  window.__seek = async (t, mark = 0) => {
    seek(t)
    marker.style.background = `rgb(${mark & 255} ${(mark >> 8) & 255} 77)`
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)))
    return true
  }

  // Aperçu dans un navigateur : ?t=4.5 (image fixe) ou ?play (lecture en temps réel).
  const q = new URLSearchParams(location.search)
  ready.then(() => {
    if (q.has('play')) {
      const t0 = performance.now()
      const loop = () => {
        seek(((performance.now() - t0) / 1000) % DURATION)
        requestAnimationFrame(loop)
      }
      loop()
    } else seek(Number(q.get('t') ?? 2))
  })
})()
