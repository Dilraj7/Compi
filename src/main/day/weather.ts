// Météo par Open-Meteo : gratuit, sans compte ni clé. Seules les coordonnées
// de la ville choisie par l'utilisateur lui sont envoyées.

import { net } from 'electron'
import type { DayWeather } from '../../shared/types'

/** Codes météo de l'OMM → libellé (pur, testé). */
export function weatherLabel(code: number): string {
  if (code === 0) return 'Ciel dégagé'
  if (code === 1) return 'Plutôt ensoleillé'
  if (code === 2) return 'Partiellement nuageux'
  if (code === 3) return 'Couvert'
  if (code === 45 || code === 48) return 'Brouillard'
  if (code >= 51 && code <= 55) return 'Bruine'
  if (code === 56 || code === 57) return 'Bruine verglaçante'
  if (code === 61) return 'Pluie faible'
  if (code === 63) return 'Pluie'
  if (code === 65) return 'Forte pluie'
  if (code === 66 || code === 67) return 'Pluie verglaçante'
  if (code === 71) return 'Neige faible'
  if (code === 73) return 'Neige'
  if (code === 75) return 'Forte neige'
  if (code === 77) return 'Grésil'
  if (code >= 80 && code <= 82) return 'Averses'
  if (code === 85 || code === 86) return 'Averses de neige'
  if (code === 95) return 'Orage'
  if (code === 96 || code === 99) return 'Orage avec grêle'
  return 'Temps variable'
}

async function getJson<T>(url: string): Promise<T> {
  const res = await net.fetch(url, { signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw new Error(`Open-Meteo a répondu ${res.status}`)
  return (await res.json()) as T
}

export interface Place {
  label: string
  lat: number
  lon: number
}

/** Trouve une ville (« Lyon », « Saint-Denis, La Réunion »). */
export async function findCity(name: string): Promise<Place | null> {
  const q = name.trim().slice(0, 80)
  if (!q) return null
  const r = await getJson<{ results?: { name: string; admin1?: string; country?: string; latitude: number; longitude: number }[] }>(
    `https://geocoding-api.open-meteo.com/v1/search?${new URLSearchParams({ name: q, count: '1', language: 'fr', format: 'json' })}`
  )
  const c = r.results?.[0]
  if (!c) return null
  return { label: [c.name, c.admin1 && c.admin1 !== c.name ? c.admin1 : '', c.country].filter(Boolean).join(', '), lat: c.latitude, lon: c.longitude }
}

interface Daily {
  time: string[]
  weather_code: number[]
  temperature_2m_max: number[]
  temperature_2m_min: number[]
  precipitation_probability_max?: (number | null)[]
}

const cache = new Map<string, { at: number; days: DayWeather[] }>()

/** Prévisions jour par jour (aujourd'hui compris), 7 jours au plus. */
export async function forecast(place: { label: string; lat: number; lon: number }, days = 1): Promise<(DayWeather & { date: string })[]> {
  const n = Math.min(Math.max(days, 1), 7)
  const key = `${place.lat.toFixed(2)},${place.lon.toFixed(2)},${n}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < 30 * 60_000) return hit.days as (DayWeather & { date: string })[]
  const params = new URLSearchParams({
    latitude: String(place.lat),
    longitude: String(place.lon),
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    timezone: 'auto',
    forecast_days: String(n)
  })
  const r = await getJson<{ daily?: Daily }>(`https://api.open-meteo.com/v1/forecast?${params}`)
  const d = r.daily
  if (!d?.time?.length) throw new Error('Open-Meteo n’a pas renvoyé de prévisions.')
  const out = d.time.map((date, i) => ({
    date,
    city: place.label,
    label: weatherLabel(d.weather_code[i]),
    min: Math.round(d.temperature_2m_min[i]),
    max: Math.round(d.temperature_2m_max[i]),
    rain: d.precipitation_probability_max?.[i] ?? undefined
  }))
  cache.set(key, { at: Date.now(), days: out })
  return out
}

/** « mardi 14 : Averses, 9 à 15 °C, pluie 70 % ». */
export function formatForecast(days: (DayWeather & { date: string })[]): string {
  const fmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric' })
  return [
    `Météo à ${days[0]?.city ?? '?'} (Open-Meteo) :`,
    ...days.map((d) => `- ${fmt.format(new Date(`${d.date}T12:00:00`))} : ${d.label}, ${d.min} à ${d.max} °C${d.rain != null ? `, pluie ${d.rain} %` : ''}`)
  ].join('\n')
}
