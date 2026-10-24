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
  /** distributeurs à trois positions : vrai = case de droite (commande B) */
  valveB: Record<string, boolean>
  /** pressostats : état par repère normalisé (vrai = sous pression) */
  pswitch: Record<string, boolean>
  /** moteurs pneumatiques : sens de rotation (+1, -1) ou 0 à l'arrêt */
  motor: Record<string, -1 | 0 | 1>
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
  let valveB: Record<string, boolean> = {}
  type Net = { uf: UF; pots: Map<string, Set<string>> }
  let build!: Net
  /** liaisons décidées pour chaque clapet ou fonction logique (passe précédente) */
  let gates = new Map<string, [string, string][]>()
  let decisions = ''
  const pressureIn = (b: Net, k: string): Pressure => {
    const set = b.pots.get(b.uf.find(k))
    if (!set) return null
    return set.has('P') && set.has('R') ? 'X' : set.has('P') ? 'P' : set.has('R') ? 'R' : null
  }
  /** réseau d'air d'après les positions des distributeurs et les liaisons des clapets, hors celles de `exclude` (pour lire la pression de ses entrées sans qu'il la fausse) */
  const buildNet = (exclude?: string): Net => {
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
      if (f.k === 'valve') for (const [a, b] of valveA[s.id] ? f.act : valveB[s.id] ? f.actB ?? f.rest : f.rest) uf.union(key(s.id, a), key(s.id, b))
      else if (f.k === 'flink') for (const p of f.ports.slice(1)) uf.union(key(s.id, f.ports[0]), key(s.id, p))
      else if (f.k === 'check' || f.k === 'logic') {
        if (s.id !== exclude) for (const [a, b] of gates.get(s.id) ?? []) uf.union(a, b)
      }
    }
    for (const s of doc.symbols) {
      const f = defs[s.defId]?.fluid
      if (f?.k === 'fsource') for (const p of f.ports) mark(key(s.id, p), 'P')
      if (f?.k === 'fsink') for (const p of f.ports) mark(key(s.id, p), 'R')
    }
    return { uf, pots }
  }

  const pass = () => {
    valveA = {}
    valveB = {}
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
      if (f.three) {
        // trois positions, centrées par ressorts : la commande A (ou B) seule déplace le tiroir, les deux ensemble le laissent au centre
        valveA[s.id] = aOn && !bOn
        valveB[s.id] = bOn && !aOn
        continue
      }
      valveA[s.id] = f.b === 'spring' ? aOn : f.b === 'none' && f.a === 'man' ? aOn : aOn && !bOn ? true : bOn && !aOn ? false : mem
    }
    // clapets et fonctions logiques : chacun décide d'après la pression de ses entrées, lue sur un réseau où il est absent
    const next = new Map<string, [string, string][]>()
    for (const s of doc.symbols) {
      const f = defs[s.defId]?.fluid
      if (f?.k !== 'check' && f?.k !== 'logic') continue
      const net = buildNet(s.id)
      if (f.k === 'check') {
        // bloqué quand l'aval est sous pression et l'amont non
        const pf = pressureIn(net, key(s.id, f.from)), pt = pressureIn(net, key(s.id, f.to))
        next.set(s.id, pt === 'P' && pf !== 'P' ? [] : [[key(s.id, f.from), key(s.id, f.to)]])
      } else {
        const [a, b] = f.ins
        const pa = pressureIn(net, key(s.id, a)), pb = pressureIn(net, key(s.id, b))
        const link: string[] = []
        if (f.op === 'or') {
          if (pa === 'P' || pb === 'P') link.push(...(pa === 'P' ? [a] : []), ...(pb === 'P' ? [b] : []))
          else link.push(a, b) // aucune entrée sous pression : la sortie s'échappe par les deux
        } else if (pa === 'P' && pb === 'P') link.push(a, b)
        else link.push(...(pa !== 'P' ? [a] : []), ...(pb !== 'P' ? [b] : []))
        next.set(s.id, link.map((p) => [key(s.id, f.out), key(s.id, p)] as [string, string]))
      }
    }
    gates = next
    decisions = [...next].map(([id, l]) => id + l.map((x) => x.join('>')).join(',')).join(';')
    build = buildNet()
  }
  const potOf = (k: string): Pressure => {
    const set = build.pots.get(build.uf.find(k))
    if (!set) return null
    return set.has('P') && set.has('R') ? 'X' : set.has('P') ? 'P' : set.has('R') ? 'R' : null
  }

  // les pilotes pneumatiques dépendent de la pression, qui dépend des positions : quelques passes suffisent
  for (let i = 0; i < 8; i++) {
    const before = decisions
    pass()
    const next = new Set<string>()
    for (const s of doc.symbols) {
      const f = defs[s.defId]?.fluid
      if (f?.k !== 'valve') continue
      for (const p of [f.pilotA, f.pilotB]) if (p && potOf(key(s.id, p)) === 'P') next.add(key(s.id, p))
    }
    const same = next.size === pilotP.size && [...next].every((k) => pilotP.has(k)) && before === decisions
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
  const pswitch: Record<string, boolean> = {}
  const motor: Record<string, -1 | 0 | 1> = {}
  for (const s of doc.symbols) {
    const f = defs[s.defId]?.fluid
    if (f?.k === 'fpress' && s.label) pswitch[devKey(s.label)] = potOf(key(s.id, f.port)) === 'P'
    if (f?.k === 'fmotor') {
      const pa = potOf(key(s.id, f.a)), pb = f.b ? potOf(key(s.id, f.b)) : 'R'
      const d = pa === 'P' && pb !== 'P' ? 1 : pb === 'P' && pa !== 'P' ? -1 : 0
      motor[s.id] = (f.rev ? -d : d) as -1 | 0 | 1
    }
  }
  return { pot: (symId, portId) => potOf(key(symId, portId)), valveA, valveB, pswitch, motor, cylDir }
}
