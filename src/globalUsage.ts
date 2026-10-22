/**
 * Classement commun : statistiques d'usage agrégées et anonymes de tous les utilisateurs.
 *
 * - Lecture : GET /api/usage au démarrage (échec silencieux : l'appli fonctionne sans).
 * - Envoi : uniquement si l'utilisateur a accepté (réglage `albertschema.share` = 'yes').
 *   On n'envoie que des identifiants de symboles, par lots (jamais le contenu d'un schéma).
 */

const SHARE_KEY = 'albertschema.share'
const ENDPOINT = import.meta.env.BASE_URL + 'api/usage'

export type ShareChoice = 'yes' | 'no' | null

export function getShare(): ShareChoice {
  try {
    const v = localStorage.getItem(SHARE_KEY)
    return v === 'yes' || v === 'no' ? v : null
  } catch {
    return null
  }
}

export function setShare(v: 'yes' | 'no') {
  try {
    localStorage.setItem(SHARE_KEY, v)
  } catch {
    /* ignoré */
  }
  if (v === 'no') queue.length = 0
}

let counts: Record<string, number> = {}
let total = 0
let maxCount = 0

export async function loadGlobalUsage(): Promise<void> {
  try {
    const r = await fetch(ENDPOINT)
    if (!r.ok) return
    const d = (await r.json()) as { total?: number; counts?: Record<string, number> }
    counts = d.counts ?? {}
    total = d.total ?? 0
    maxCount = Math.max(0, ...Object.values(counts))
  } catch {
    /* hors ligne, pas de serveur (développement local) : classement personnel et a priori seulement */
  }
}

/** Confiance (0 à 1) dans les statistiques communes : nulle sous 200 poses collectées, pleine à 3 000. */
const confidence = () => (total < 200 || maxCount <= 0 ? 0 : Math.min(1, total / 3000))

/**
 * Part du classement due à l'usage réel de tous les utilisateurs (0 à 100), relative au symbole le plus posé
 * (racine carrée : un symbole posé 4 fois moins que le premier garde la moitié de la part).
 */
export function globalShare(id: string): number {
  const c = counts[id]
  return c ? 100 * confidence() * Math.sqrt(c / maxCount) : 0
}

/**
 * Combine le score éditorial (a priori) et l'usage commun : plus les données collectives sont nombreuses,
 * moins l'a priori pèse (jusqu'à la moitié de son poids), et plus l'usage réel compte.
 */
export function blendGlobal(id: string, prior: number): number {
  return prior * (1 - 0.5 * confidence()) + globalShare(id)
}

// ── envoi par lots
const queue: string[] = []
let timer: number | undefined

function flush() {
  window.clearTimeout(timer)
  timer = undefined
  if (!queue.length || getShare() !== 'yes') {
    queue.length = 0
    return
  }
  const body = JSON.stringify({ ids: queue.splice(0, 40) })
  try {
    if (!(navigator.sendBeacon && navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' })))) {
      void fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true })
    }
  } catch {
    /* ignoré : ce ne sont que des statistiques */
  }
  if (queue.length) timer = window.setTimeout(flush, 15_000)
}

export function shareUse(id: string) {
  if (getShare() !== 'yes') return
  queue.push(id)
  if (queue.length >= 20) flush()
  else timer ??= window.setTimeout(flush, 15_000)
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush()
  })
}
