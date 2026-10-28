import { electrical } from './electrical'
import { pneumatic, hydraulic } from './fluid'
import { simSources } from './simulation'
import { flowParts } from './flow'
import { plcParts } from './plc'
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
let loadingExt: Promise<void> | null = null
export let extendedLoaded = false
/** La bibliothèque étendue (collection QElectroTech) peut être désactivée à la construction : VITE_NO_EXTENDED=1. */
export const extendedAvailable = !import.meta.env?.VITE_NO_EXTENDED

const fetchLib = (file: string) =>
  // ?v= : l'adresse change à chaque déploiement, le navigateur peut donc garder le fichier en cache sans durée limite
  fetch((import.meta.env?.BASE_URL ?? '/') + file + '?v=' + (typeof __BUILD__ === 'string' ? __BUILD__ : 'dev')).then((r) => {
    if (!r.ok) throw new Error(file + ' ' + r.status)
    return r.json() as Promise<Library>
  })

function add(lib: Library, ext: boolean) {
  for (const s of lib.symbols) {
    if (SYMBOL_MAP[s.id]) continue
    s.std = ext ? 'QElectroTech' : s.std || 'CEI 60617'
    SYMBOLS.push(s)
    SYMBOL_MAP[s.id] = s
  }
  organizeSources(SYMBOLS)
  // un seul menu pour toutes les sources : les catégories « sources réseau » et « générateurs et sources » y sont fondues
  const merged = new Set(['10_electric_10_allpole/110_network_supplies', '10_electric_10_allpole/392_generators_sources'])
  for (const d of Object.keys(lib.categories) as Domain[]) CATEGORIES[d] = lib.categories[d]
  CATEGORIES.electrical = [{ id: SOURCES_MENU, name: SOURCES_NAME }, { id: 'plc', name: { fr: 'Automates programmables', en: 'Programmable controllers' } }, ...CATEGORIES.electrical.filter((c) => !merged.has(c.id))]
}

/** Charge la bibliothèque de symboles dessinés par l'application. */
export function loadLibrary(): Promise<void> {
  loading ??= fetchLib('library-core.json').then((lib) => add(lib, false))
  return loading
}

/** Charge la bibliothèque étendue : le reste de la collection QElectroTech (CC-BY 3.0), à la demande. */
export function loadExtended(): Promise<void> {
  if (!extendedAvailable) return Promise.resolve()
  loadingExt ??= loadLibrary()
    .then(() => fetchLib('library-extended.json'))
    .then((lib) => { add(lib, true); extendedLoaded = true })
  return loadingExt
}

/** Vrai si le document utilise des symboles que seule la bibliothèque étendue connaît. */
export const needsExtended = (docs: { symbols: { defId: string }[] }[]): boolean => docs.some((d) => d.symbols.some((s) => !SYMBOL_MAP[s.defId]))
