// Réglages « Messages » : rappels des messages en attente (téléphone via
// Mobile connecté, WhatsApp, Telegram…), à partir des notifications Windows.
// Désactivé par défaut ; la lecture du texte par Compi est une option à part.

import { useEffect, useRef, useState } from 'react'
import { BellRing, ExternalLink, Lock, MessageSquareText, TriangleAlert } from 'lucide-react'
import { MESSAGING_APPS } from '@shared/messages'
import type { MessagesSettings, MessagesStatus, PublicSettings, Settings } from '@shared/types'
import { useCompi } from '../store'
import { Button, Row, Section, Segmented, Toggle, TimeInput } from '../components/ui'

type Props = { s: PublicSettings; update: (patch: Partial<Settings>) => void }

const COLOR = '#E879F9'

const DELAYS = [
  { value: '30', label: '30 min' },
  { value: '60', label: '1 h' },
  { value: '120', label: '2 h' }
]

function Check({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 rounded-xl px-2.5 py-2 transition-colors hover:bg-white/[0.03]">
      <input type="checkbox" className="mt-0.5 size-3.5 shrink-0 accent-[#E879F9]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="min-w-0">
        <span className="block text-[12px] text-fog-100">{label}</span>
        {hint && <span className="block text-[11px] leading-snug text-fog-500">{hint}</span>}
      </span>
    </label>
  )
}

/** Réglage de Windows qui empêche les messages d'arriver jusqu'à Compi. */
function WindowsNotice({ text, tip }: { text: string; tip: string }) {
  return (
    <div className="space-y-1.5 border-t border-white/[0.05] px-3.5 py-3">
      <div className="flex gap-2 text-[11.5px] leading-snug text-led-amber">
        <TriangleAlert size={13} className="mt-[1px] shrink-0" />
        <span>{text}</span>
      </div>
      <div className="pl-[21px] text-[11px] leading-snug text-fog-500">{tip}</div>
      <div className="pl-[21px]">
        <Button size="sm" variant="subtle" onClick={() => void window.compi.openNotificationSettings('notifications')}>
          <ExternalLink size={12} /> Ouvrir les paramètres de notification
        </Button>
      </div>
    </div>
  )
}

export function MessagesSection({ s, update }: Props) {
  const m = s.messages
  const [status, setStatus] = useState<MessagesStatus | null>(null)
  const win = status?.windows
  const [busy, setBusy] = useState(false)
  const focus = useCompi((st) => st.settingsFocus)
  const focusSettings = useCompi((st) => st.focusSettings)
  const ref = useRef<HTMLDivElement>(null)
  const set = (patch: Partial<MessagesSettings>): void => update({ messages: { ...m, ...patch } })

  useEffect(() => {
    void window.compi.messagesStatus().then(setStatus)
    return window.compi.onMessages(setStatus)
  }, [])

  // Ouvert depuis Aujourd'hui (« Réglages des messages ») : on descend ici.
  useEffect(() => {
    if (focus !== 'messages') return
    // On efface la demande après le défilement : l'effacer avant annulerait le minuteur.
    const t = setTimeout(() => {
      ref.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
      focusSettings(null)
    }, 120)
    return () => clearTimeout(t)
  }, [focus, focusSettings])

  const activate = async (): Promise<void> => {
    setBusy(true)
    try {
      setStatus(await window.compi.activateMessages())
    } finally {
      setBusy(false)
    }
  }

  const toggleApp = (key: string, on: boolean): void => set({ apps: on ? [...new Set([...m.apps, key])] : m.apps.filter((a) => a !== key) })
  const known = new Set(MESSAGING_APPS.map((a) => a.key))
  const others = (status?.seenApps ?? []).filter((a) => !known.has(a.key))

  return (
    <div ref={ref} className="scroll-mt-2">
      <Section title="Messages" hint="À partir des notifications Windows de tes messageries. Rien ne part en ligne pour les rappels.">
        <Row
          label="Me rappeler les messages en attente"
          hint="Un message resté sans réponse (toujours dans les notifications) déclenche un petit rappel dans l’îlot. Rien n’est jamais envoyé ni fermé à ta place."
        >
          {m.enabled ? (
            <Toggle checked label="Rappels des messages" onChange={() => set({ enabled: false })} />
          ) : (
            <Button size="sm" variant="primary" accent={COLOR} disabled={busy} onClick={() => void activate()}>
              <BellRing size={13} /> Activer
            </Button>
          )}
        </Row>

        {status?.access === 'denied' && (
          <div className="flex flex-wrap items-center gap-2 border-t border-white/[0.05] px-3.5 py-3 text-[11.5px] text-led-amber">
            Windows bloque l’accès aux notifications pour les applications.
            <Button size="sm" variant="subtle" onClick={() => void window.compi.openNotificationSettings()}>
              <ExternalLink size={12} /> Ouvrir les paramètres de Windows
            </Button>
          </div>
        )}
        {status?.access === 'error' && !m.enabled && (
          <div className="border-t border-white/[0.05] px-3.5 py-3 text-[11.5px] text-led-amber">
            Impossible de vérifier l’accès aux notifications pour l’instant. Réessaie dans un moment.
          </div>
        )}

        {win && !win.toasts && (
          <WindowsNotice
            text="Les notifications de Windows sont coupées : WhatsApp, Mobile connecté et les autres n’envoient rien au centre de notifications, donc je ne vois aucun message."
            tip="Active « Notifications » dans les paramètres de Windows. Pour ne pas être dérangé, active plutôt « Ne pas déranger » : les messages arrivent quand même dans le centre de notifications, et je les vois."
          />
        )}
        {win?.toasts &&
          win.blocked.map((b) => (
            <WindowsNotice
              key={b.key}
              text={
                b.reason === 'off'
                  ? `${b.app} : ses notifications sont coupées dans Windows, je ne vois pas ses messages.`
                  : `${b.app} : ses notifications ne restent pas dans le centre de notifications, je ne les vois pas.`
              }
              tip={`Dans les paramètres de Windows, ouvre ${b.app} et active ses notifications, avec « Afficher les notifications dans le centre de notifications ».`}
            />
          ))}
        {m.enabled && status?.access === 'allowed' && win?.toasts && !win.blocked.length && m.apps.length > 0 && (
          <div className="border-t border-white/[0.05] px-3.5 py-2.5 text-[11.5px] text-fog-500">
            <span className="mr-1.5 inline-block size-1.5 rounded-full bg-led-green text-led-green align-middle shadow-[0_0_6px_currentColor]" />
            {status.pending.length
              ? `En ce moment : ${status.pending.length} message${status.pending.length > 1 ? 's' : ''} en attente, listé${status.pending.length > 1 ? 's' : ''} dans Aujourd’hui.`
              : 'Je surveille : aucun message en attente pour l’instant.'}{' '}
            Le rappel dans l’îlot arrive après {DELAYS.find((d) => d.value === String(m.remindAfterMin))?.label ?? `${m.remindAfterMin} min`} sans réponse.
          </div>
        )}

        {m.enabled && (
          <>
            <div className="border-t border-white/[0.05] px-3.5 py-3">
              <div className="mb-1.5 text-[12.5px] text-fog-100">Messageries à suivre</div>
              <div className="grid grid-cols-2 gap-x-2">
                {MESSAGING_APPS.map((a) => (
                  <Check key={a.key} checked={m.apps.includes(a.key)} onChange={(v) => toggleApp(a.key, v)} label={a.label} hint={a.hint} />
                ))}
              </div>
              {others.length > 0 && (
                <>
                  <div className="mt-2 mb-1 px-0.5 text-[11px] text-fog-700">Autres applications vues dans tes notifications</div>
                  <div className="grid grid-cols-2 gap-x-2">
                    {others.map((a) => (
                      <Check key={a.key} checked={m.apps.includes(a.key)} onChange={(v) => toggleApp(a.key, v)} label={a.app} />
                    ))}
                  </div>
                </>
              )}
              {!m.apps.length && <div className="mt-1 px-0.5 text-[11px] text-led-amber">Coche au moins une messagerie.</div>}
            </div>
            <Row label="Rappel après" hint="Délai sans réponse avant le rappel dans l’îlot. Aujourd’hui liste les messages tout de suite.">
              <Segmented id="messages-delay" value={String(m.remindAfterMin)} options={DELAYS} onChange={(v) => set({ remindAfterMin: Number(v) })} />
            </Row>
            <Row label="Heures calmes" hint="Aucun rappel pendant ces heures, ni pendant une réunion ou un pomodoro.">
              <div className="flex items-center gap-1.5 text-[11.5px] text-fog-500">
                <TimeInput label="Début des heures calmes" value={m.quietStart} onChange={(quietStart) => set({ quietStart })} />
                <span>→</span>
                <TimeInput label="Fin des heures calmes" value={m.quietEnd} onChange={(quietEnd) => set({ quietEnd })} />
              </div>
            </Row>
            <Row label="Noms dans l’îlot" hint="L’îlot est visible de tous : par défaut, il ne montre que l’application (« 2 messages · WhatsApp »).">
              <Toggle checked={m.preview} onChange={(preview) => set({ preview })} label="Noms des expéditeurs dans l’îlot" />
            </Row>
            <Row
              label={
                <span className="flex items-center gap-1.5">
                  <MessageSquareText size={13} style={{ color: COLOR }} /> Compi peut lire mes messages
                </span>
              }
              hint="Pour « qu’est-ce que j’ai reçu cet après-midi ? ». Le texte reste en mémoire 24 h, jamais sur le disque ; les codes reçus par SMS sont masqués."
            >
              <Toggle checked={m.readByCompi} onChange={(readByCompi) => set({ readByCompi })} label="Compi peut lire mes messages" />
            </Row>
          </>
        )}

        <div className="space-y-1 border-t border-white/[0.05] px-3.5 py-2.5 text-[11px] leading-snug text-fog-500">
          {[
            'Pour les rappels : seulement l’application, l’expéditeur et l’heure, en mémoire. Sur le disque : des heures, rien d’autre.',
            'Avec un cerveau en ligne, je te demande ton accord à chaque lecture de tes messages, sans option « Toujours ». Jamais dans une routine.',
            'Je ne peux ni répondre, ni marquer comme lu : il n’existe aucun moyen officiel de le faire.',
            'Je ne vois que ce qui arrive en notification, PC allumé, avec l’aperçu que chaque application permet. Sur iPhone, active « Afficher les notifications » dans les réglages Bluetooth du téléphone ; dans Telegram, les notifications Windows.'
          ].map((t) => (
            <div key={t} className="flex gap-2">
              <Lock size={11} className="mt-[2px] shrink-0" style={{ color: COLOR }} />
              <span>{t}</span>
            </div>
          ))}
        </div>
      </Section>
    </div>
  )
}
