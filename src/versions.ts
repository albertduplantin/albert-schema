import type { Doc } from './types'

/** Historique des versions d'un schéma, conservé dans le navigateur (jamais envoyé nulle part). */
export interface Version {
  id: string
  name: string
  at: number
  auto: boolean
  symbols: number
  doc: Doc
}

const KEY = 'albertschema.versions'
const MAX_AUTO = 8
const MAX_MANUAL = 20

export function loadVersions(): Version[] {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]') as Version[] } catch { return [] }
}

function store(list: Version[]): Version[] {
  let l = list
  // quota atteint : on abandonne les plus anciennes versions automatiques d'abord
  for (;;) {
    try { localStorage.setItem(KEY, JSON.stringify(l)); return l } catch {
      const idx = [...l].reverse().findIndex((v) => v.auto)
      if (idx >= 0) l = l.filter((_, i) => i !== l.length - 1 - idx)
      else if (l.length > 1) l = l.slice(0, -1)
      else return l
    }
  }
}

/** Ajoute une version en tête de liste et élague les plus anciennes. */
export function addVersion(doc: Doc, name: string, auto: boolean, id: string): Version[] {
  const v: Version = { id, name, at: Date.now(), auto, symbols: doc.symbols.length, doc }
  const all = [v, ...loadVersions()]
  const autos = all.filter((x) => x.auto).slice(0, MAX_AUTO).map((x) => x.id)
  const manuals = all.filter((x) => !x.auto).slice(0, MAX_MANUAL).map((x) => x.id)
  return store(all.filter((x) => autos.includes(x.id) || manuals.includes(x.id)))
}

export function removeVersion(id: string): Version[] {
  return store(loadVersions().filter((v) => v.id !== id))
}
