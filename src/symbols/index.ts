import { electrical } from './electrical'
import { pneumatic, hydraulic } from './fluid'
import type { Domain, SymbolDef } from '../types'

/** Symboles dessinés à la main : conservés pour les anciens fichiers, masqués de la palette. */
const legacy: SymbolDef[] = [...electrical, ...pneumatic, ...hydraulic].map((s) => ({ ...s, legacy: true }))

export const SYMBOLS: SymbolDef[] = [...legacy]
export const SYMBOL_MAP: Record<string, SymbolDef> = Object.fromEntries(SYMBOLS.map((s) => [s.id, s]))
export const CATEGORIES: Record<Domain, { id: string; name: { fr: string; en: string } }[]> = {
  electrical: [],
  pneumatic: [],
  hydraulic: [],
}

interface Library {
  categories: typeof CATEGORIES
  symbols: SymbolDef[]
}

let loading: Promise<void> | null = null

/** Charge la bibliothèque issue de la collection QElectroTech (CC-BY 3.0). */
export function loadLibrary(): Promise<void> {
  loading ??= fetch(import.meta.env.BASE_URL + 'qet-library.json')
    .then((r) => {
      if (!r.ok) throw new Error('library ' + r.status)
      return r.json() as Promise<Library>
    })
    .then((lib) => {
      for (const d of Object.keys(lib.categories) as Domain[]) CATEGORIES[d] = lib.categories[d]
      for (const s of lib.symbols) {
        s.std = 'QElectroTech'
        SYMBOLS.push(s)
        SYMBOL_MAP[s.id] = s
      }
    })
  return loading
}
