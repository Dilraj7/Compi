// Réglages « Comptes » (Google : agenda et e-mails) et « Ta journée »
// (résumé du matin, météo, alertes de réunion). Les sources de l'agenda sont
// dans AgendaSourcesSection.

import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { CalendarDays, Check, ChevronDown, ExternalLink, FileJson, Mail, MapPin } from 'lucide-react'
import type { PublicSettings, Settings } from '@shared/types'
import { useCompi } from '../store'
import { Badge, Button, cx, LedDots, Row, Section, Segmented, TextInput, Toggle } from '../components/ui'

const GOOGLE = '#4C8DF6'
const CONSOLE_URL = 'https://console.cloud.google.com/auth/clients'

type Props = { s: PublicSettings; apply: (p: Promise<PublicSettings>) => void; update: (patch: Partial<Settings>) => void }

/** Case à cocher en forme de puce (Agenda, E-mails). */
function Chip({ on, onClick, icon, children }: { on: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      onClick={onClick}
      className={cx(
        'inline-flex h-8 items-center gap-1.5 rounded-xl px-3 text-[12px] ring-1 ring-inset transition-colors',
        on ? 'bg-[#4C8DF6]/14 text-fog-100 ring-[#4C8DF6]/40' : 'bg-white/[0.03] text-fog-500 ring-white/[0.08] hover:text-fog-300'
      )}
    >
      {on ? <Check size={13} style={{ color: GOOGLE }} /> : icon}
      {children}
    </button>
  )
}

const STEPS = [
  'Sur console.cloud.google.com, crée un projet « Compi ».',
  'API et services › Bibliothèque : active « Gmail API » et « Google Calendar API ».',
  'Google Auth Platform › Commencer : nom « Compi », audience « Externe ».',
  'Audience › Publier l’application (sinon Google te déconnecte tous les 7 jours).',
  'Clients › Créer un client › « Application de bureau », puis télécharge le fichier JSON.'
]

export function GoogleSection({ s, apply }: Props) {
  const setSettings = useCompi((st) => st.setSettings)
  const [want, setWant] = useState({ calendar: true, mail: true })
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [help, setHelp] = useState(false)
  const g = s.google
  const connected = g.calendar || g.mail

  const connect = async (): Promise<void> => {
    setBusy(true)
    setMessage(null)
    const r = await window.compi.googleConnect(want)
    setBusy(false)
    setMessage(r.ok ? { ok: true, text: `Connecté${r.email ? ` : ${r.email}` : ''}.` } : { ok: false, text: r.message })
    setSettings(await window.compi.getSettings())
  }

  return (
    <Section title="Comptes" hint="Ton agenda et tes e-mails Google. Compi n’envoie jamais d’e-mail : il prépare des brouillons.">
      <div className="space-y-3 px-3.5 py-3.5">
        <div className="flex items-center gap-2.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-white text-[15px] font-bold" style={{ color: GOOGLE }}>
            G
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[12.5px] text-fog-100">Compte Google</div>
            <div className="truncate text-[11.5px] text-fog-500">
              {connected ? g.email || 'Connecté' : s.hasGoogleClient ? 'Prêt à connecter' : 'Pas encore configuré'}
            </div>
          </div>
          {connected && (
            <div className="flex gap-1">
              {g.calendar && <Badge color={GOOGLE}>Agenda</Badge>}
              {g.mail && <Badge color={GOOGLE}>E-mails</Badge>}
            </div>
          )}
        </div>

        {!s.hasGoogleClient && (
          <>
            <p className="text-[11.5px] leading-snug text-fog-500">
              Pour lire ton agenda et tes e-mails, Compi a besoin de sa propre « identité » chez Google. Tu la crées une seule fois, en 10 minutes environ, puis
              tu importes le fichier téléchargé.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" accent={GOOGLE} onClick={() => apply(window.compi.googleImportClient())}>
                <FileJson size={14} /> Importer le fichier JSON…
              </Button>
              <Button variant="ghost" onClick={() => void window.compi.openExternal(CONSOLE_URL)}>
                <ExternalLink size={13} /> Console Google
              </Button>
              <Button variant="ghost" onClick={() => setHelp(!help)} aria-expanded={help}>
                Comment faire ? <ChevronDown size={13} className={cx('transition-transform', help && 'rotate-180')} />
              </Button>
            </div>
            <AnimatePresence initial={false}>
              {help && (
                <motion.ol
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="space-y-1.5 overflow-hidden"
                >
                  {STEPS.map((step, i) => (
                    <li key={i} className="flex gap-2 text-[11.5px] leading-snug text-fog-300">
                      <span className="led-text mt-px w-3 shrink-0 text-fog-500">{i + 1}</span>
                      {step}
                    </li>
                  ))}
                  <li className="pt-1 text-[11px] text-fog-500">
                    À la connexion, Google affichera « application non validée » : clique sur Paramètres avancés › Accéder à Compi. C’est normal pour une app
                    personnelle.
                  </li>
                </motion.ol>
              )}
            </AnimatePresence>
          </>
        )}

        {s.hasGoogleClient && !connected && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Chip on={want.calendar} onClick={() => setWant({ ...want, calendar: !want.calendar })} icon={<CalendarDays size={13} />}>
                Agenda
              </Chip>
              <Chip on={want.mail} onClick={() => setWant({ ...want, mail: !want.mail })} icon={<Mail size={13} />}>
                E-mails
              </Chip>
              <div className="flex-1" />
              {busy ? (
                <Button variant="ghost" onClick={() => void window.compi.googleCancel()}>
                  Annuler
                </Button>
              ) : (
                <Button variant="primary" accent={GOOGLE} disabled={!want.calendar && !want.mail} onClick={() => void connect()}>
                  Se connecter à Google
                </Button>
              )}
            </div>
            {busy && (
              <div className="flex items-center gap-2 text-[11.5px] text-fog-300">
                <LedDots color={GOOGLE} /> Termine la connexion dans ton navigateur…
              </div>
            )}
            <button className="text-[11px] text-fog-700 hover:text-fog-300" onClick={() => apply(window.compi.googleImportClient())}>
              Changer de fichier client
            </button>
          </>
        )}

        {connected && (
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11.5px] leading-snug text-fog-500">
              Ce que je lis suit tes choix de <span className="text-fog-300">Confidentialité</span> (E-mails, Agenda). Créer un rendez-vous ou un brouillon
              passe toujours par ton OK.
            </p>
            <Button variant="subtle" size="sm" onClick={() => apply(window.compi.googleDisconnect())}>
              Déconnecter
            </Button>
          </div>
        )}

        {message && <div className={cx('text-[11.5px]', message.ok ? 'text-led-green' : 'text-led-amber')}>{message.text}</div>}
      </div>
    </Section>
  )
}

export function DaySection({ s, apply, update }: Props) {
  const d = s.day
  const [city, setCity] = useState(d.city)
  const [cityError, setCityError] = useState('')
  const saveCity = (): void => {
    if (city.trim() === d.city) return
    setCityError('')
    window.compi.setCity(city).then(
      (next) => {
        setCity(next.day.city)
        apply(Promise.resolve(next))
      },
      (e: Error) => setCityError(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    )
  }

  return (
    <Section title="Ta journée" hint="Calculé sur ton PC : rien n’est envoyé à un cerveau pour ça.">
      <Row label="Résumé du matin" hint="Tes rendez-vous, e-mails non lus, rappels et la météo, une fois par jour.">
        <div className="flex items-center gap-2">
          {d.morning && (
            <input
              type="time"
              aria-label="Heure du résumé"
              value={d.morningTime}
              onChange={(e) => e.target.value && update({ day: { ...d, morningTime: e.target.value } })}
              className="h-8 rounded-lg bg-white/[0.05] px-2 text-[12px] text-fog-100 ring-1 ring-inset ring-white/[0.08] outline-none [color-scheme:dark] focus:ring-[var(--led)]/50"
            />
          )}
          <Toggle checked={d.morning} onChange={(morning) => update({ day: { ...d, morning } })} label="Résumé du matin" />
        </div>
      </Row>
      <Row
        label="Ville pour la météo"
        hint={cityError ? <span className="text-led-amber">{cityError}</span> : 'Seule ta ville est envoyée à Open-Meteo (gratuit, sans compte).'}
      >
        <div className="relative">
          <MapPin size={13} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-fog-700" />
          <TextInput
            className="w-48 pl-7"
            placeholder="Ex. Lyon"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            onBlur={saveCity}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
        </div>
      </Row>
      <Row
        label="Alerte avant une réunion"
        hint={g(s) ? 'Avec un bouton « Rejoindre » pour Meet, Zoom ou Teams.' : 'Ajoute une source d’agenda (ci-dessous) pour l’activer.'}
      >
        <div className="flex items-center gap-2">
          {d.meetingAlerts && g(s) && (
            <Segmented<string>
              id="meeting-minutes"
              value={String(d.meetingMinutes)}
              options={[
                { value: '1', label: '1 min' },
                { value: '5', label: '5 min' },
                { value: '10', label: '10 min' }
              ]}
              onChange={(v) => update({ day: { ...d, meetingMinutes: Number(v) } })}
            />
          )}
          <Toggle checked={d.meetingAlerts} onChange={(meetingAlerts) => update({ day: { ...d, meetingAlerts } })} label="Alerte avant une réunion" />
        </div>
      </Row>
    </Section>
  )
}

/** Au moins une source d'agenda active (Google ou une source ajoutée). */
const g = (s: PublicSettings): boolean => s.google.calendar || s.agenda.sources.some((x) => x.enabled)
