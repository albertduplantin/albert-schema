import { electrical } from './electrical'
import { pneumatic, hydraulic } from './fluid'
import { simSources } from './simulation'
import { flowParts } from './flow'
import { plcParts } from './plc'
import { staticSvg } from './fluidDraw'
import { SOURCES_MENU, SOURCES_NAME, organizeSources } from './sources'
import type { Domain, SymbolDef } from '../types'

/** Symboles dessinés à la main : conservés pour les anciens fichiers, masqués de la palette. */
const legacy: SymbolDef[] = [...electrical, ...pneumatic, ...hydraulic].map((s) => ({ ...s, legacy: true }))

export const SYMBOLS: SymbolDef[] = [...legacy, ...simSources, ...flowParts, ...plcParts]
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
      // distributeurs et vérins : dessin dynamique, dont la vignette de palette (position de repos)
      for (const s of lib.symbols) { const svg = staticSvg(s); if (svg) s.svg = svg }
      organizeSources(SYMBOLS)
      // un seul menu pour toutes les sources : les catégories « sources réseau » et « générateurs et sources » y sont fondues
      const merged = new Set(['10_electric_10_allpole/110_network_supplies', '10_electric_10_allpole/392_generators_sources'])
      CATEGORIES.electrical = [{ id: SOURCES_MENU, name: SOURCES_NAME }, { id: 'plc', name: { fr: 'Automates programmables', en: 'Programmable controllers' } }, ...CATEGORIES.electrical.filter((c) => !merged.has(c.id))]
    })
  return loading
}
