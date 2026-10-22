import type { SymbolDef } from './types'

/**
 * Apprentissage de l'usage : chaque symbole posé renforce son rang dans la palette.
 *
 * - Le compteur d'un symbole décroît avec le temps (demi-vie de 30 jours) : un symbole
 *   utilisé intensément il y a six mois remonte moins qu'un symbole utilisé cette semaine.
 * - Le classement final = score a priori de la bibliothèque (usage typique sur les machines
 *   actuelles) + bonus d'usage, plafonné à +100 : un symbole rare devient « courant » pour
 *   l’utilisateur qui s’en sert régulièrement (3 poses ≈ +63 %, 8 poses ≈ +93 %).
 * - Tout reste dans le navigateur (localStorage) ; rien n'est envoyé.
 */

const KEY = 'albertschema.usage'
const HALF_LIFE_DAYS = 30
const MAX_BOOST = 100
const SATURATION = 3 // ~3 usages effectifs pour atteindre ~63 % du bonus maximal
const DAY = 86_400_000

interface Entry {
  n: number
  t: number
}

let cache: Record<string, Entry> | null = null

function load(): Record<string, Entry> {
  if (cache) return cache
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}') as Record<string, Entry>
    cache = typeof raw === 'object' && raw ? raw : {}
  } catch {
    cache = {}
  }
  return cache
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(cache))
  } catch {
    /* stockage indisponible : l'apprentissage reste valable pour la session */
  }
}

const decay = (ageMs: number) => Math.pow(0.5, Math.max(0, ageMs) / (HALF_LIFE_DAYS * DAY))

/** Compteur d'usage effectif (avec décroissance) d'un symbole. */
export function usageCount(id: string, now = Date.now()): number {
  const e = load()[id]
  return e ? e.n * decay(now - e.t) : 0
}

/** Enregistre la pose d'un symbole. */
export function recordUse(id: string, now = Date.now()) {
  const data = load()
  data[id] = { n: usageCount(id, now) + 1, t: now }
  save()
}

/** Score adaptatif : a priori + bonus d'usage. */
export function adaptiveScore(def: SymbolDef, now = Date.now()): number {
  const n = usageCount(def.id, now)
  return (def.score ?? 40) + MAX_BOOST * (1 - Math.exp(-n / SATURATION))
}

export function hasUsage(): boolean {
  return Object.keys(load()).length > 0
}

export function resetUsage() {
  cache = {}
  save()
}
