/**
 * Revue des symboles de la palette (outil temporaire de mise au point) : on marque chaque symbole « à garder » (o) ou « à masquer » (m).
 * Les choix sont conservés dans le navigateur et se copient en une liste à transmettre pour corriger la bibliothèque.
 */
const KEY = 'albertschema.review'
export interface Review { keep: string[]; hide: string[] }

let state: Review = { keep: [], hide: [] }
try {
  const raw = JSON.parse(localStorage.getItem(KEY) || 'null') as Review | null
  if (raw && Array.isArray(raw.keep) && Array.isArray(raw.hide)) state = raw
} catch { /* stockage indisponible */ }
const listeners = new Set<() => void>()
export const reviewListeners = listeners

const save = () => {
  try { localStorage.setItem(KEY, JSON.stringify(state)) } catch { /* ignoré */ }
  listeners.forEach((f) => f())
}
const keepSet = () => new Set(state.keep)
const hideSet = () => new Set(state.hide)

export const isKept = (id: string) => state.keep.includes(id)
export const isHidden = (id: string) => state.hide.includes(id)
export const reviewCounts = () => ({ keep: state.keep.length, hide: state.hide.length })
export const hasKept = () => state.keep.length > 0

export function mark(id: string, as: 'keep' | 'hide' | null): void {
  const k = keepSet(), h = hideSet()
  k.delete(id); h.delete(id)
  if (as === 'keep') k.add(id)
  if (as === 'hide') h.add(id)
  state = { keep: [...k], hide: [...h] }
  save()
}
export function clearReview(): void {
  state = { keep: [], hide: [] }
  save()
}
/** Liste lisible à copier : identifiant et nom de chaque symbole gardé ou masqué. */
export function reviewExport(names: (id: string) => string): string {
  const line = (id: string) => `${id} | ${names(id)}`
  return ['À GARDER (' + state.keep.length + ')', ...state.keep.map(line), '', 'À MASQUER (' + state.hide.length + ')', ...state.hide.map(line)].join('\n')
}
