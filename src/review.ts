/**
 * Revue des symboles de la palette (outil temporaire de mise au point) : on marque chaque symbole « à garder » (o) ou « à masquer » (m).
 * Les choix sont conservés dans le navigateur et se copient en une liste à transmettre pour corriger la bibliothèque.
 */
const KEY = 'albertschema.review'
export interface Review { keep: string[]; hide: string[]; del: string[]; redo: string[] }

let state: Review = { keep: [], hide: [], del: [], redo: [] }
try {
  const raw = JSON.parse(localStorage.getItem(KEY) || 'null') as Review | null
  if (raw && Array.isArray(raw.keep) && Array.isArray(raw.hide)) state = { keep: raw.keep, hide: raw.hide, del: Array.isArray(raw.del) ? raw.del : [], redo: Array.isArray(raw.redo) ? raw.redo : [] }
} catch { /* stockage indisponible */ }
const listeners = new Set<() => void>()
export const reviewListeners = listeners

const save = () => {
  try { localStorage.setItem(KEY, JSON.stringify(state)) } catch { /* ignoré */ }
  listeners.forEach((f) => f())
}
const keepSet = () => new Set(state.keep)
const hideSet = () => new Set(state.hide)
const delSet = () => new Set(state.del)
const redoSet = () => new Set(state.redo)

export const isKept = (id: string) => state.keep.includes(id)
/** masqué ou à supprimer : absent de la palette */
export const isHidden = (id: string) => state.hide.includes(id) || state.del.includes(id)
export const isDeleted = (id: string) => state.del.includes(id)
/** à revoir : le symbole reste dans la palette mais son dessin est à refaire d'après une meilleure source */
export const isRedo = (id: string) => state.redo.includes(id)
export const reviewCounts = () => ({ keep: state.keep.length, hide: state.hide.length, del: state.del.length, redo: state.redo.length })
export const hasKept = () => state.keep.length > 0

export function mark(id: string, as: 'keep' | 'hide' | 'del' | 'redo' | null): void {
  const k = keepSet(), h = hideSet(), d = delSet(), r = redoSet()
  k.delete(id); h.delete(id); d.delete(id); r.delete(id)
  if (as === 'keep') k.add(id)
  if (as === 'hide') h.add(id)
  if (as === 'del') d.add(id)
  if (as === 'redo') r.add(id)
  state = { keep: [...k], hide: [...h], del: [...d], redo: [...r] }
  save()
}
export function clearReview(): void {
  state = { keep: [], hide: [], del: [], redo: [] }
  save()
}
/** Liste lisible à copier : identifiant et nom de chaque symbole gardé ou masqué. */
export function reviewExport(names: (id: string) => string): string {
  const line = (id: string) => `${id} | ${names(id)}`
  return ['À GARDER (' + state.keep.length + ')', ...state.keep.map(line), '', 'À MASQUER (' + state.hide.length + ')', ...state.hide.map(line), '', 'À SUPPRIMER (' + state.del.length + ')', ...state.del.map(line), '', 'À REVOIR (' + state.redo.length + ')', ...state.redo.map(line)].join('\n')
}
