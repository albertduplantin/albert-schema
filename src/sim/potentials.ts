import type { Doc, PlacedSymbol, SymbolDef } from '../types'

/**
 * Potentiels des sources. Un potentiel est un nom (L, L1, N, +, -, PE…) éventuellement suivi de la tension de sa source
 * quand elle n'est pas la valeur usuelle : « L@24 » est la phase d'une source de 24 V. Deux sources de tensions différentes
 * ne se confondent donc jamais, et la tension entre deux points se déduit des noms.
 */
export const basePot = (p: string) => p.split('@')[0]
export const potVolts = (p: string): number | undefined => {
  const m = /@(\d+(?:\.\d+)?)$/.exec(p)
  return m ? Number(m[1]) : undefined
}

/** Tension usuelle d'une source selon ses potentiels : triphasé 400 V (entre phases), monophasé 230 V, continu 24 V. */
export function defaultVolts(pots: string[]): number | undefined {
  const b = pots.map(basePot)
  if (b.some((p) => /^L[123]$/.test(p))) return 400
  if (b.includes('L')) return 230
  if (b.includes('+')) return 24
  return undefined
}

/** Blocs « source » configurables : monophasé / continu (nature au choix) et triphasé. */
export const isSourceBlock = (defId: string) => defId === 'sim-src1' || defId === 'sim-src3'

/** Potentiels effectifs d'une source posée (sans la tension) : un bloc monophasé réglé en continu fournit + et −. */
export function sourcePots(s: PlacedSymbol, def: SymbolDef): Record<string, string> {
  const m = def.sim
  if (m?.k !== 'source') return {}
  if (def.id === 'sim-src1' && s.dc) return { ...m.pot, a: '+', b: '-' }
  return m.pot
}

/** Tension réglée sur la source (ou la valeur usuelle). */
export function sourceVolts(s: PlacedSymbol, def: SymbolDef): number | undefined {
  const dv = defaultVolts(Object.values(sourcePots(s, def)))
  return s.volts && s.volts > 0 ? s.volts : dv
}

/** Légende affichée dans un bloc source : « 230 V AC », « 24 V DC », « 3 AC 400 V ». */
export function sourceCaption(s: PlacedSymbol, def: SymbolDef): string {
  const v = sourceVolts(s, def)
  const pots = Object.values(sourcePots(s, def))
  if (v === undefined) return ''
  if (pots.includes('+')) return `${v} V DC`
  if (pots.some((p) => /^L[123]$/.test(p))) return `3 AC ${v} V`
  return `${v} V AC`
}

/**
 * Pour la simulation : les sources dont la tension (ou la nature) diffère de l'usuel reçoivent des potentiels suffixés
 * (« L@24 ») grâce à une définition synthétique ; le reste du moteur n'a plus qu'à lire les noms.
 */
export function withSourceVoltages(doc: Doc, defs: Record<string, SymbolDef>): { doc: Doc; defs: Record<string, SymbolDef> } {
  let defs2: Record<string, SymbolDef> | null = null
  let changed = false
  const symbols = doc.symbols.map((s) => {
    const d = defs[s.defId]
    const m = d?.sim
    if (m?.k !== 'source') return s
    const pots = sourcePots(s, d)
    const vals = Object.values(pots)
    if (vals.some((p) => p.includes('@'))) return s
    const dv = defaultVolts(vals)
    if (dv === undefined) return s
    const v = s.volts && s.volts > 0 ? s.volts : dv
    const remap = pots !== m.pot // nature changée (continu)
    if (v === dv && !remap) return s
    const id = `${d.id}@${v}${remap ? 'dc' : ''}`
    defs2 ??= { ...defs }
    if (!defs2[id]) defs2[id] = { ...d, id, sim: { ...m, pot: Object.fromEntries(Object.entries(pots).map(([k, p]) => [k, p === 'PE' || v === dv ? p : `${p}@${v}`])) } }
    changed = true
    return { ...s, defId: id }
  })
  return changed ? { doc: { ...doc, symbols }, defs: defs2! } : { doc, defs }
}
