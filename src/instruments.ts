import type { Doc, Instrument, PlacedSymbol, SymbolDef } from './types'
import { portPos } from './geometry'
import { reachedSources, voltageBetween, type SimResult } from './sim/engine'

type P = { x: number; y: number }

/** Calibres proposés : tensions alternatives (V) pour le voltmètre, intensités (A) pour la pince. */
export const RANGES = {
  voltmeter: [6, 15, 30, 60, 150, 300, 600, 1000],
  clamp: [1, 10, 100, 400],
} as const

/** Encombrement du boîtier sur la feuille (unités du dessin). */
export const BODY = {
  voltmeter: { w: 110, h: 172 },
  clamp: { w: 90, h: 206 },
} as const

/** Prises du voltmètre (COM noire, V rouge) et centre de la mâchoire de la pince, en coordonnées du boîtier. */
export const SOCKETS: [P, P] = [{ x: 32, y: 158 }, { x: 78, y: 158 }]
export const JAW: P = { x: 45, y: 34 }

export function defaultInstrument(kind: Instrument['kind'], style: Instrument['style'], x: number, y: number): Instrument {
  const range = kind === 'voltmeter' ? 600 : 10
  return {
    id: Math.random().toString(36).slice(2, 9), kind, style, x, y, range,
    ...(kind === 'voltmeter' ? { probes: [{ x: x + 10, y: y + 245 }, { x: x + 100, y: y + 245 }] as [P, P] } : {}),
  }
}

/** Pointes de touche du voltmètre (par défaut juste sous le boîtier). */
export const probesOf = (i: Instrument): [P, P] => i.probes ?? [{ x: i.x + 10, y: i.y + 245 }, { x: i.x + 100, y: i.y + 245 }]
export const jawPoint = (i: Instrument): P => ({ x: i.x + JAW.x, y: i.y + JAW.y })

export function stepRange(i: Instrument, dir: 1 | -1): number {
  const list = RANGES[i.kind] as readonly number[]
  const idx = Math.max(0, list.indexOf(i.range))
  return list[Math.min(list.length - 1, Math.max(0, idx + dir))]
}

const key = (symId: string, portId: string) => `${symId}:${portId}`

function distToSegment(p: P, a: P, b: P): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const l2 = dx * dx + dy * dy
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

export interface PickContext {
  symbols: PlacedSymbol[]
  defs: Record<string, SymbolDef>
  routes: Record<string, P[]>
  /** fils : extrémité de départ, dont le potentiel est celui du conducteur */
  wires: { id: string; from: { symId: string; portId: string } }[]
}

export interface Pick {
  /** borne touchée (`symbole:borne`) ou conducteur touché */
  port?: string
  wire?: string
  /** potentiel présent à cet endroit (null : rien) */
  node?: string
}

/** Ce que touche une pointe de touche placée au point `at` : une borne (7 unités) ou un conducteur (5 unités). */
export function pickAt(at: P, ctx: PickContext, wireTol = 5): Pick {
  let best: { d: number; k: string } | undefined
  for (const s of ctx.symbols) {
    for (const p of ctx.defs[s.defId]?.ports ?? []) {
      const pos = portPos(s, p.id)
      if (!pos) continue
      const d = Math.hypot(pos.x - at.x, pos.y - at.y)
      if (d <= 7 && (!best || d < best.d)) best = { d, k: key(s.id, p.id) }
    }
  }
  if (best) return { port: best.k, node: best.k }
  let bw: { d: number; id: string } | undefined
  for (const w of ctx.wires) {
    const r = ctx.routes[w.id]
    if (!r) continue
    for (let i = 0; i + 1 < r.length; i++) {
      const d = distToSegment(at, r[i], r[i + 1])
      if (d <= wireTol && (!bw || d < bw.d)) bw = { d, id: w.id }
    }
  }
  if (bw) {
    const w = ctx.wires.find((x) => x.id === bw!.id)!
    return { wire: bw.id, node: key(w.from.symId, w.from.portId) }
  }
  return {}
}

/** Tension (V) lue entre les deux pointes ; null si le logiciel ne sait pas l'évaluer. Pointe en l'air : 0 V. */
export function readVoltage(instr: Instrument, ctx: PickContext, sim: SimResult, doc: Doc, defs: Record<string, SymbolDef>): number | null {
  const [a, b] = probesOf(instr)
  const pa = pickAt(a, ctx)
  const pb = pickAt(b, ctx)
  // un conducteur relié à la terre (symbole terre, masse) est au potentiel de la terre, même s'il appartient à un circuit séparé
  // (secondaire d'un transformateur) : toutes les terres du schéma sont la même terre.
  const pot = (k: Pick) => {
    if (!k.node) return null
    if (reachedSources(doc, defs, k.node).pe) return 'PE'
    return sim.potentialOf[k.node] ?? null
  }
  const v = voltageBetween(pot(pa), pot(pb), doc, defs)
  return v === undefined ? null : v
}

/** Intensité (A) dans le conducteur serré par la mâchoire de la pince ; 0 si elle ne serre aucun conducteur. */
export function readCurrent(instr: Instrument, ctx: PickContext, sim: SimResult): { amps: number; clamped: boolean } {
  const pk = pickAt(jawPoint(instr), ctx, 9)
  if (!pk.wire) return { amps: 0, clamped: false }
  return { amps: sim.amps[pk.wire] ?? 0, clamped: true }
}

/** Affichage numérique : le nombre de décimales dépend du calibre (3 chiffres significatifs au moins). */
export function formatReading(value: number, range: number, lang: 'fr' | 'en'): string {
  const dec = range < 10 ? 3 : range < 100 ? 2 : range < 1000 ? 1 : 0
  const s = Math.abs(value).toFixed(dec)
  return lang === 'fr' ? s.replace('.', ',') : s
}
