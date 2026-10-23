import type { Doc, Lang, PlacedSymbol, SymbolDef } from './types'
import { effectiveTerms } from './terminals'
import { reachedSources, simulate } from './sim/engine'

/** Calibres normalisés (A) des fusibles et disjoncteurs modulaires. */
export const RATINGS = [0.5, 1, 1.6, 2, 3, 4, 6, 8, 10, 13, 16, 20, 25, 32, 40, 50, 63, 80, 100, 125]

const roundA = (x: number) => (x < 10 ? Math.round(x * 100) / 100 : Math.round(x * 10) / 10)

export interface TransformerInfo {
  threePhase: boolean
  /** courants nominaux (A) */
  in1?: number
  in2?: number
  /** calibres de protection conseillés (A) */
  prot1?: number
  prot2?: number
}

/**
 * Courants nominaux et protections conseillées d'un transformateur à partir de sa puissance (VA) et de ses tensions.
 *  - primaire : calibre normalisé juste au-dessus de 1,25 × In (l'appel de courant à l'enclenchement est de 10 à 15 × In :
 *    fusible aM ou disjoncteur courbe D, pour ne pas déclencher à la mise sous tension) ;
 *  - secondaire : plus grand calibre normalisé ne dépassant pas In (le secondaire protège le transformateur et les conducteurs).
 * Ces valeurs sont des repères de pré-étude : le dimensionnement final dépend du pouvoir de coupure, de la section des câbles
 * et de la norme applicable.
 */
export function transformerInfo(s: PlacedSymbol, def: SymbolDef): TransformerInfo {
  const m = def.sim
  const threePhase = m?.k === 'transformer' && m.primary.length >= 3 && m.secondary.length >= 3
  const k = threePhase ? Math.sqrt(3) : 1
  const S = s.power && s.power > 0 ? s.power : undefined
  const u1 = s.voltsPrimary && s.voltsPrimary > 0 ? s.voltsPrimary : undefined
  const u2 = s.volts && s.volts > 0 ? s.volts : undefined
  const in1 = S && u1 ? roundA(S / (k * u1)) : undefined
  const in2 = S && u2 ? roundA(S / (k * u2)) : undefined
  const above = (x: number) => RATINGS.find((r) => r >= x) ?? RATINGS[RATINGS.length - 1]
  const below = (x: number) => [...RATINGS].reverse().find((r) => r <= x) ?? RATINGS[0]
  return { threePhase, in1, in2, prot1: in1 !== undefined ? above(in1 * 1.25) : undefined, prot2: in2 !== undefined ? below(in2) : undefined }
}

/** Texte lisible des protections conseillées. */
export function describeInfo(i: TransformerInfo, lang: Lang): string[] {
  const fr = lang === 'fr'
  const out: string[] = []
  const f = (x: number) => String(x).replace('.', fr ? ',' : '.')
  if (i.in1 !== undefined) out.push(fr ? `Courant primaire ${f(i.in1)} A → protection conseillée ${f(i.prot1 ?? 0)} A (courbe D ou fusible aM)` : `Primary current ${f(i.in1)} A → suggested protection ${f(i.prot1 ?? 0)} A (D curve or aM fuse)`)
  if (i.in2 !== undefined) out.push(fr ? `Courant secondaire ${f(i.in2)} A → protection conseillée ${f(i.prot2 ?? 0)} A` : `Secondary current ${f(i.in2)} A → suggested protection ${f(i.prot2 ?? 0)} A`)
  return out
}

const key = (symId: string, portId: string) => `${symId}:${portId}`

export interface TrafoTopology {
  /** repères proposés par borne : primaire (L, N, L1…), secondaire (N si relié à la terre ou au neutre, L sinon) */
  labels: Record<string, Record<string, string>>
  /** secondaire : un des conducteurs est-il relié à la terre ou au neutre ? */
  earthed: Record<string, boolean>
}

/** Repères de bornes des transformateurs d'après le câblage (potentiel du primaire, liaison à la terre du secondaire). */
export function transformerTopology(doc: Doc, defs: Record<string, SymbolDef>): TrafoTopology {
  const labels: Record<string, Record<string, string>> = {}
  const earthed: Record<string, boolean> = {}
  const trafos = doc.symbols.filter((s) => defs[s.defId]?.sim?.k === 'transformer')
  if (!trafos.length) return { labels, earthed }
  let pot: Record<string, string | null> = {}
  try { pot = simulate(doc, defs, {}, { pressed: new Set(), toggled: new Set() }, 0).potentialOf } catch { /* schéma incomplet */ }
  for (const s of trafos) {
    const m = defs[s.defId].sim
    if (m?.k !== 'transformer') continue
    const mine: Record<string, string> = {}
    // primaire : nom du potentiel présent (L, N, L1, L2, L3)
    for (const p of m.primary) {
      const v = pot[key(s.id, p)]?.split('@')[0]
      if (v && /^(L[123]?|N)$/.test(v)) mine[p] = v
    }
    // secondaire à deux bornes : la borne reliée à la terre (ou au neutre) devient le neutre
    if (m.secondary.length === 2) {
      const [a, b] = m.secondary
      const ra = reachedSources(doc, defs, key(s.id, a))
      const rb = reachedSources(doc, defs, key(s.id, b))
      const ea = ra.pe || ra.neutral
      const eb = rb.pe || rb.neutral
      earthed[s.id] = ea || eb
      if (ea !== eb) {
        mine[ea ? a : b] = 'N'
        mine[ea ? b : a] = 'L'
      } else if (!ea) {
        mine[a] = 'L1'
        mine[b] = 'L2'
      }
    }
    labels[s.id] = mine
  }
  return { labels, earthed }
}

/** `effectiveTerms` complété par les repères déduits du câblage des transformateurs (sauf numéros saisis par l'utilisateur). */
export function termsWithTopology(doc: Doc, defs: Record<string, SymbolDef>, ignoreTerms?: string, topo?: TrafoTopology): Record<string, Record<string, string>> {
  const base = effectiveTerms(doc.symbols, defs, ignoreTerms)
  const t = topo ?? transformerTopology(doc, defs)
  for (const s of doc.symbols) {
    const auto = t.labels[s.id]
    if (!auto) continue
    const mine = (base[s.id] ??= {})
    for (const [p, v] of Object.entries(auto)) if (s.id === ignoreTerms || !s.terms?.[p]) mine[p] = v
  }
  return base
}
