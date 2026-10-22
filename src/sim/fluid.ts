import type { Doc, SymbolDef } from '../types'

/** Mémoire de simulation (voir engine.ts) : `p` et `dir` servent aux vérins. */
export type FluidMemory = Record<string, { on: boolean; since: number; p?: number; dir?: number }>

/** Course complète d'un vérin, en secondes. */
export const STROKE_S = 1.2

const key = (symId: string, portId: string) => `${symId}:${portId}`
const devKey = (l: string) => l.replace(/\s+/g, '').toUpperCase()

class UF {
  private p = new Map<string, string>()
  find(x: string): string {
    if (!this.p.has(x)) this.p.set(x, x)
    let r = x
    while (this.p.get(r) !== r) r = this.p.get(r)!
    this.p.set(x, r)
    return r
  }
  union(a: string, b: string) {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra !== rb) this.p.set(ra, rb)
  }
}

export type Pressure = 'P' | 'R' | 'X' | null

export interface FluidIn {
  doc: Doc
  defs: Record<string, SymbolDef>
  memory: FluidMemory
  /** bobines alimentées, par repère normalisé */
  coilOn: Record<string, boolean>
  pressed: ReadonlySet<string>
  toggled: ReadonlySet<string>
}

export interface FluidOut {
  /** pression à une borne : P (alimentée), R (échappement), X (fuite : P et R reliés), null (isolée) */
  pot: (symId: string, portId: string) => Pressure
  /** distributeurs : vrai = case actionnée (côté A) */
  valveA: Record<string, boolean>
  /** sens de déplacement de chaque vérin : +1 sortie, -1 rentrée, 0 arrêt */
  cylDir: Record<string, -1 | 0 | 1>
}

/** Position d'un vérin (0 = rentré, 1 = sorti) à l'instant `now`. */
export function cylPos(m: FluidMemory[string] | undefined, now: number, rest = 0): number {
  if (!m || m.p === undefined) return rest
  const d = m.dir ?? 0
  return Math.min(1, Math.max(0, m.p + (d * (now - m.since)) / (STROKE_S * 1000)))
}

/** Repères de commande d'un électrodistributeur : « YV1 » ou « YV1/YV2 » (bobine côté A, bobine côté B). */
export const valveCoils = (label: string): [string, string] => {
  const [a, b] = label.split(/[\s/,;]+/).filter(Boolean)
  return [a ? devKey(a) : '', b ? devKey(b) : '']
}

export function solveFluid(x: FluidIn): FluidOut {
  const { doc, defs } = x
  const pilotP = new Set<string>()
  let valveA: Record<string, boolean> = {}
  let build!: { uf: UF; pots: Map<string, Set<string>> }

  const pass = () => {
    valveA = {}
    for (const s of doc.symbols) {
      const f = defs[s.defId]?.fluid
      if (f?.k !== 'valve') continue
      const [la, lb] = valveCoils(s.label)
      const aOn =
        (f.a === 'elec' && !!la && !!x.coilOn[la]) ||
        (f.a === 'man' && (x.pressed.has(s.id) || x.toggled.has(s.id))) ||
        (f.a === 'pneu' && !!f.pilotA && pilotP.has(key(s.id, f.pilotA)))
      const bOn = (f.b === 'elec' && !!lb && !!x.coilOn[lb]) || (f.b === 'pneu' && !!f.pilotB && pilotP.has(key(s.id, f.pilotB)))
      const mem = x.memory['§V:' + s.id]?.on ?? false
      valveA[s.id] = f.b === 'spring' ? aOn : f.b === 'none' && f.a === 'man' ? aOn : aOn && !bOn ? true : bOn && !aOn ? false : mem
    }
    const uf = new UF()
    for (const w of doc.wires) uf.union(key(w.from.symId, w.from.portId), key(w.to.symId, w.to.portId))
    const pots = new Map<string, Set<string>>()
    const mark = (k: string, v: string) => {
      const r = uf.find(k)
      if (!pots.has(r)) pots.set(r, new Set())
      pots.get(r)!.add(v)
    }
    for (const s of doc.symbols) {
      const f = defs[s.defId]?.fluid
      if (!f) continue
      if (f.k === 'valve') for (const [a, b] of valveA[s.id] ? f.act : f.rest) uf.union(key(s.id, a), key(s.id, b))
      else if (f.k === 'flink') for (const p of f.ports.slice(1)) uf.union(key(s.id, f.ports[0]), key(s.id, p))
    }
    for (const s of doc.symbols) {
      const f = defs[s.defId]?.fluid
      if (f?.k === 'fsource') for (const p of f.ports) mark(key(s.id, p), 'P')
      if (f?.k === 'fsink') for (const p of f.ports) mark(key(s.id, p), 'R')
    }
    build = { uf, pots }
  }
  const potOf = (k: string): Pressure => {
    const set = build.pots.get(build.uf.find(k))
    if (!set) return null
    return set.has('P') && set.has('R') ? 'X' : set.has('P') ? 'P' : set.has('R') ? 'R' : null
  }

  // les pilotes pneumatiques dépendent de la pression, qui dépend des positions : quelques passes suffisent
  for (let i = 0; i < 5; i++) {
    pass()
    const next = new Set<string>()
    for (const s of doc.symbols) {
      const f = defs[s.defId]?.fluid
      if (f?.k !== 'valve') continue
      for (const p of [f.pilotA, f.pilotB]) if (p && potOf(key(s.id, p)) === 'P') next.add(key(s.id, p))
    }
    const same = next.size === pilotP.size && [...next].every((k) => pilotP.has(k))
    pilotP.clear()
    next.forEach((k) => pilotP.add(k))
    if (same) break
  }
  pass()

  const cylDir: Record<string, -1 | 0 | 1> = {}
  for (const s of doc.symbols) {
    const f = defs[s.defId]?.fluid
    if (f?.k !== 'cyl') continue
    const cap = potOf(key(s.id, f.cap))
    if (f.single) {
      const push = f.single === 'push'
      cylDir[s.id] = cap === 'P' ? (push ? 1 : -1) : cap === 'R' ? (push ? -1 : 1) : 0 // le ressort ramène la tige quand la chambre est à l'échappement
    } else {
      const rod = f.rod ? potOf(key(s.id, f.rod)) : null
      cylDir[s.id] = cap === 'P' && rod === 'R' ? 1 : cap === 'R' && rod === 'P' ? -1 : 0
    }
  }
  return { pot: (symId, portId) => potOf(key(symId, portId)), valveA, cylDir }
}
