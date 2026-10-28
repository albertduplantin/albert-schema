import type { Doc, SymbolDef } from '../types'
import { exhaustPortIds, pilotNumbers, solenoidNames } from '../fluidNames'
import { solveHyd } from './hyd'

/** Mémoire de simulation (voir engine.ts) : `p` et `dir` servent aux vérins. */
export type FluidMemory = Record<string, { on: boolean; since: number; p?: number; dir?: number; v?: number }>

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
  /** instant de la simulation (ms) : position des vérins */
  now?: number
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
  /** vitesse relative de chaque vérin en mouvement (1 = sans étranglement), limitée par les limiteurs de débit de son alimentation et de son échappement */
  cylSpeed: Record<string, number>
  /** hydraulique : mesures affichées sous les appareils (pression, débit, vitesse…) et vitesse de rotation des moteurs (tr/min) */
  info: Record<string, string>
  rpm: Record<string, number>
  /** hydraulique : débit dans chaque appareil et chaque conducteur (L/min), passage relatif des limiteurs de débit */
  oil: Record<string, number>
  wireFlow: Record<string, number>
  needle: Record<string, number>
}

/** Position d'un vérin (0 = rentré, 1 = sorti) à l'instant `now`. */
export function cylPos(m: FluidMemory[string] | undefined, now: number, rest = 0): number {
  if (!m || m.p === undefined) return rest
  const d = m.dir ?? 0
  return Math.min(1, Math.max(0, m.p + (d * (m.v ?? 1) * (now - m.since)) / (STROKE_S * 1000)))
}

/** Repères de commande d'un électrodistributeur : « YV1 » ou « YV1/YV2 » (bobine côté A, bobine côté B). */
export const valveCoils = (label: string, def?: SymbolDef): [string[], string[]] => solenoidNames(label, def ? pilotNumbers(def) : undefined)

export function solveFluid(x: FluidIn): FluidOut {
  const { doc, defs } = x
  const pilotP = new Set<string>()
  let valveA: Record<string, boolean> = {}
  let valveB: Record<string, boolean> = {}
  type Net = { uf: UF; pots: Map<string, Set<string>> }
  let build!: Net
  /** liaisons décidées pour chaque clapet ou fonction logique (passe précédente) */
  let gates = new Map<string, [string, string][]>()
  let pumpOn = new Set<string>() // pompes dont l'aspiration est reliée à une bâche
  let decisions = ''
  const pressureIn = (b: Net, k: string): Pressure => {
    const set = b.pots.get(b.uf.find(k))
    if (!set) return null
    return set.has('P') && set.has('R') ? 'X' : set.has('P') ? 'P' : set.has('R') ? 'R' : null
  }
  /** réseau d'air d'après les positions des distributeurs et les liaisons des clapets, hors celles de `exclude` (pour lire la pression de ses entrées sans qu'il la fausse) */
  const buildNet = (exclude?: string, split = false): Net => {
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
      else if (f.k === 'fthrottle') { if (!split) uf.union(key(s.id, f.a), key(s.id, f.b)) } // `split` : réseau où les limiteurs séparent, pour calculer les vitesses
      else if (f.k === 'fnet') for (const [a, b] of f.links) uf.union(key(s.id, a), key(s.id, b))
      else if (f.k === 'check' || f.k === 'logic') {
        if (s.id !== exclude) for (const [a, b] of gates.get(s.id) ?? []) uf.union(a, b)
      }
    }
    for (const s of doc.symbols) {
      const f = defs[s.defId]?.fluid
      if (f?.k === 'fsource') for (const p of f.ports) mark(key(s.id, p), 'P')
      if (f?.k === 'fsink') for (const p of f.ports) mark(key(s.id, p), 'R')
      if (f?.k === 'valve') for (const p of exhaustPortIds(defs[s.defId])) mark(key(s.id, p), 'R') // échappement à l'air libre (silencieux dessiné sur l'orifice)
      if (f?.k === 'fpump' && pumpOn.has(s.id)) mark(key(s.id, f.out), 'P')
    }
    return { uf, pots }
  }

  const pass = () => {
    valveA = {}
    valveB = {}
    for (const s of doc.symbols) {
      const f = defs[s.defId]?.fluid
      if (f?.k !== 'valve') continue
      const [la, lb] = valveCoils(s.label, defs[s.defId])
      const coilA = la.some((n) => x.coilOn[n]), coilB = lb.some((n) => x.coilOn[n])
      const aOn =
        (f.a === 'elec' && (coilA || x.toggled.has(s.id) || x.pressed.has(s.id))) || // commande manuelle de secours : un clic sur l'électrovanne la actionne

        (f.a === 'man' && (x.pressed.has(s.id) || x.toggled.has(s.id))) ||
        (f.a === 'pneu' && !!f.pilotA && pilotP.has(key(s.id, f.pilotA)))
      const bOn = (f.b === 'elec' && (coilB || x.pressed.has(s.id + ':B'))) || (f.b === 'man' && x.pressed.has(s.id + ':B')) || (f.b === 'pneu' && !!f.pilotB && pilotP.has(key(s.id, f.pilotB)))
      const mem = x.memory['§V:' + s.id]?.on ?? false
      if (f.prop) {
        // proportionnel : la position du joystick choisit la case (gauche : négatif, droite : positif)
        const joy = s.rated?.joy ?? 0
        valveA[s.id] = joy < -2
        valveB[s.id] = joy > 2
        continue
      }
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
        const piloted = !!f.pilot && pressureIn(net, key(s.id, f.pilot)) === 'P'
        next.set(s.id, pt === 'P' && pf !== 'P' && !piloted ? [] : [[key(s.id, f.from), key(s.id, f.to)]])
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
    // pompes : elles ne refoulent que si l'aspiration est reliée à une bâche (échappement à l'air libre)
    const net0 = buildNet()
    const pumps = new Set<string>()
    for (const s of doc.symbols) {
      const f = defs[s.defId]?.fluid
      if (f?.k === 'fpump' && pressureIn(net0, key(s.id, f.in)) === 'R') pumps.add(s.id)
    }
    pumpOn = pumps
    decisions = [...next].map(([id, l]) => id + l.map((x) => x.join('>')).join(',')).join(';') + '|' + [...pumps].join(',')
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
  // vitesse des vérins : meilleur chemin (plus grand débit relatif) de la source à la chambre alimentée et de la chambre à l'échappement
  const cylSpeed: Record<string, number> = {}
  const throttles = doc.symbols.filter((s) => defs[s.defId]?.fluid?.k === 'fthrottle')
  if (throttles.length) {
    const split = buildNet(undefined, true)
    const root = (k: string) => split.uf.find(k)
    const edges: { from: string; to: string; f: number }[] = []
    for (const s of throttles) {
      const f = defs[s.defId]!.fluid
      if (f?.k !== 'fthrottle') continue
      const open = Math.min(1, Math.max(0.05, (s.rated?.open ?? 50) / 100))
      const [ra, rb] = [root(key(s.id, f.a)), root(key(s.id, f.b))]
      edges.push({ from: ra, to: rb, f: open }, { from: rb, to: ra, f: f.oneWay ? 1 : open })
    }
    const nodes = new Set(edges.flatMap((e) => [e.from, e.to]))
    const has = (n: string, v: string) => split.pots.get(n)?.has(v)
    const fromP = new Map<string, number>() // débit relatif atteignable depuis une source
    const toR = new Map<string, number>() // débit relatif atteignable vers l'échappement
    for (const n of nodes) { if (has(n, 'P')) fromP.set(n, 1); if (has(n, 'R')) toR.set(n, 1) }
    for (let i = 0; i < nodes.size + 1; i++) {
      let changed = false
      for (const e of edges) {
        const a = fromP.get(e.from)
        if (a !== undefined && Math.min(a, e.f) > (fromP.get(e.to) ?? 0)) { fromP.set(e.to, Math.min(a, e.f)); changed = true }
        const b = toR.get(e.to)
        if (b !== undefined && Math.min(b, e.f) > (toR.get(e.from) ?? 0)) { toR.set(e.from, Math.min(b, e.f)); changed = true }
      }
      if (!changed) break
    }
    for (const s of doc.symbols) {
      const f = defs[s.defId]?.fluid
      if (f?.k !== 'cyl' || !cylDir[s.id]) continue
      const dir = cylDir[s.id]
      const cap = root(key(s.id, f.cap)), rod = f.rod ? root(key(s.id, f.rod)) : undefined
      const [supply, exhaust] = dir > 0 ? [cap, rod ?? cap] : [rod ?? cap, cap]
      // simple effet : la chambre unique est alimentée (sortie) ou vidangée (rappel par ressort)
      const sup = f.single ? (dir > 0 === (f.single === 'push') ? cap : undefined) : supply
      const exh = f.single ? (dir > 0 === (f.single === 'push') ? undefined : cap) : exhaust
      cylSpeed[s.id] = Math.min(sup !== undefined ? fromP.get(sup) ?? 1 : 1, exh !== undefined ? toR.get(exh) ?? 1 : 1)
    }
  }
  // hydraulique quantitative : pressions et débits réels, qui remplacent les états qualitatifs des circuits hydrauliques
  let info: Record<string, string> = {}
  let rpm: Record<string, number> = {}
  let oil: Record<string, number> = {}
  let wireFlow: Record<string, number> = {}
  let needle: Record<string, number> = {}
  let pot = (symId: string, portId: string): Pressure => potOf(key(symId, portId))
  const hyd = solveHyd({ doc, defs, valveA, valveB, cylPos: (id) => { const f = defs[doc.symbols.find((c) => c.id === id)?.defId ?? '']?.fluid; return cylPos(x.memory['§C:' + id], x.now ?? 0, f?.k === 'cyl' && f.single === 'pull' ? 1 : 0) } })
  if (hyd) {
    info = hyd.info
    rpm = hyd.rpm
    oil = hyd.oil
    wireFlow = hyd.wireFlow
    needle = hyd.needle
    const isHyd = (symId: string) => defs[doc.symbols.find((c) => c.id === symId)?.defId ?? '']?.domain === 'hydraulic'
    pot = (symId, portId) => {
      if (!isHyd(symId)) return potOf(key(symId, portId))
      const b = hyd.bar(symId, portId)
      if (b === undefined) return null
      return b > 0.5 ? 'P' : potOf(key(symId, portId)) === 'R' ? 'R' : null
    }
    for (const s of doc.symbols) {
      const f = defs[s.defId]?.fluid
      if (defs[s.defId]?.domain !== 'hydraulic') continue
      if (f?.k === 'cyl' && hyd.cylX[s.id] !== undefined) {
        const xq = hyd.cylX[s.id]
        const dir = Math.abs(xq) > 0.02 ? (xq > 0 ? 1 : -1) : 0
        cylDir[s.id] = dir as -1 | 0 | 1
        const strokeCm = (s.rated?.stroke ?? 350) / 10
        cylSpeed[s.id] = dir ? Math.max(0.02, (STROKE_S * Math.abs(hyd.cylV[s.id])) / strokeCm) : 1
      }
      if (f?.k === 'fmotor') motor[s.id] = (hyd.rpm[s.id] > 0.5 ? (hyd.dir[s.id] * (f.rev ? -1 : 1)) : 0) as -1 | 0 | 1
    }
  }
  return { pot, valveA, valveB, pswitch, motor, cylDir, cylSpeed, info, rpm, oil, wireFlow, needle }
}
