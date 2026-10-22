import type { Doc, PlacedSymbol, SimModel, SymbolDef, TimerKind } from '../types'

/**
 * Simulation « logique de relais » d'un schéma électrique.
 *
 * Principe : les conducteurs et les contacts fermés forment des réseaux (nœuds) ; les sources imposent un
 * potentiel (L1, L2, L3, N, +, -…) sur leurs bornes. Un récepteur (bobine, lampe, moteur…) est alimenté quand
 * deux de ses bornes se trouvent à des potentiels différents. Les contacts commandés par une bobine suivent
 * l'état de la bobine de même repère. On itère jusqu'à stabilité, à partir de l'état précédent : les
 * circuits à auto-maintien se comportent donc comme en réalité.
 *
 * Temporisations : chaque bobine mémorise l'instant de son dernier changement d'état. Une bobine
 * temporisée (à la montée, à la retombée ou les deux) ou un contact temporisé applique son retard par
 * rapport à cet instant ; le moteur indique dans quel délai le prochain changement doit être recalculé.
 *
 * Limites : pas de régime transitoire électrique, pas d'impédances ni de courants, un seul niveau de
 * temporisation (bobine temporisée OU contact temporisé), automates et variateurs non simulés.
 */

export interface SimInputs {
  /** boutons maintenus appuyés (poussoirs) */
  pressed: ReadonlySet<string>
  /** organes basculés (interrupteurs, disjoncteurs, arrêts d'urgence…) */
  toggled: ReadonlySet<string>
  /** défauts injectés : fils coupés et appareils ouverts (fusible fondu, relais thermique déclenché) */
  cut?: ReadonlySet<string>
}

/** Mémoire de simulation : état de chaque relais (par repère) et instant du dernier changement. */
export type SimMemory = Record<string, { on: boolean; since: number }>

export interface SimResult {
  /** mémoire à réinjecter au calcul suivant */
  state: SimMemory
  /** symboles alimentés (bobines, lampes, moteurs, vannes…) */
  energized: Set<string>
  /** contacts : état actionné par symbole (vrai = côté « travail ») */
  closed: Record<string, boolean>
  /** potentiel présent sur chaque réseau, par borne `symId:portId` */
  potentialOf: Record<string, string | null>
  /** courts-circuits détectés : potentiels en conflit et bornes concernées */
  shorts: { potentials: string[]; ports: string[] }[]
  /** le calcul n'a pas convergé (circuit oscillant, ex. contact NF de sa propre bobine) */
  unstable: boolean
  /** symboles présents sur la feuille mais sans modèle de simulation */
  unsupported: string[]
  /** délai (ms) avant le prochain changement dû à une temporisation, ou null */
  pendingMs: number | null
  /** conducteurs parcourus par un courant : +1 si le courant va de la borne `from` vers la borne `to`, -1 sinon */
  current: Record<string, 1 | -1>
  /** tension (V) aux bornes des récepteurs alimentés, quand elle est déterminable */
  volts: Record<string, number>
  /** récepteurs dont la tension appliquée s'écarte de plus de 15 % de leur tension nominale */
  badVoltage: Record<string, { applied: number; rated: number }>
}

export const DEFAULT_DELAY_S = 3

class UnionFind {
  private p = new Map<string, string>()
  find(x: string): string {
    if (!this.p.has(x)) this.p.set(x, x)
    let r = x
    while (this.p.get(r) !== r) r = this.p.get(r)!
    let c = x
    while (c !== r) {
      const n = this.p.get(c)!
      this.p.set(c, r)
      c = n
    }
    return r
  }
  union(a: string, b: string) {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra !== rb) this.p.set(ra, rb)
  }
}

const key = (symId: string, portId: string) => `${symId}:${portId}`

export function isOperable(model: SimModel | undefined): 'momentary' | 'toggle' | null {
  if (model?.k === 'switch' && (model.ctl === 'momentary' || model.ctl === 'toggle')) return model.ctl
  return null
}

/** Applique une temporisation à l'état d'un relais. `pending` reçoit le délai restant d'un changement à venir. */
function applyDelay(m: { on: boolean; since: number } | undefined, kind: TimerKind | undefined, delayS: number, now: number, pending: number[]): boolean {
  if (!m) return false
  if (!kind) return m.on
  const el = (now - m.since) / 1000
  const waiting = el < delayS
  if (waiting && Number.isFinite(el)) pending.push(Math.max(1, (delayS - el) * 1000))
  switch (kind) {
    case 'on':
      return m.on && !waiting
    case 'off':
      return m.on || (waiting && Number.isFinite(el))
    default:
      return m.on ? !waiting : waiting && Number.isFinite(el)
  }
}

/** Repère d'appareil normalisé : « km1 », « KM1 » ou « KM1 » avec espaces désignent le même relais. */
export const devKey = (l: string) => l.replace(/\s+/g, '').toUpperCase()

interface Ctx {
  doc: Doc
  defs: Record<string, SymbolDef>
  memory: SimMemory
  inp: SimInputs
  now: number
  /** temporisation de chaque relais, par repère (bobines temporisées) */
  timers: Map<string, { kind: TimerKind; delay: number }>
  pending: number[]
  /** potentiels imposés par les secondaires de transformateurs alimentés : clé de borne → potentiel (préfixe ~) */
  derived: Map<string, string>
}

/** État « actionné » d'un contact. */
function actuated(s: PlacedSymbol, m: Extract<SimModel, { k: 'switch' }>, x: Ctx): boolean {
  switch (m.ctl) {
    case 'fixed':
      return false
    case 'coil': {
      if (!s.label) return false
      const t = x.timers.get(devKey(s.label))
      const mem = x.memory[devKey(s.label)]
      if (t) return applyDelay(mem, t.kind, t.delay, x.now, x.pending) // bobine temporisée : ses contacts suivent sa sortie
      return applyDelay(mem, m.delay, s.delay ?? DEFAULT_DELAY_S, x.now, x.pending)
    }
    case 'momentary':
      return x.inp.pressed.has(s.id)
    default:
      return x.inp.toggled.has(s.id)
  }
}

function solve(x: Ctx) {
  const { doc, defs } = x
  const uf = new UnionFind()
  for (const w of doc.wires) uf.union(key(w.from.symId, w.from.portId), key(w.to.symId, w.to.portId))

  const closed: Record<string, boolean> = {}
  const swEdges: [string, string][] = [] // liaisons établies par les contacts fermés
  const link = (a: string, b: string) => {
    uf.union(a, b)
    swEdges.push([a, b])
  }
  for (const s of doc.symbols) {
    const m = defs[s.defId]?.sim
    if (m?.k !== 'switch') continue
    const act = actuated(s, m, x)
    closed[s.id] = act
    if (m.ctl === 'fixed') {
      for (const [a, b] of m.poles) link(key(s.id, a), key(s.id, b))
      continue
    }
    const isClosed = m.nc ? !act : act
    if (isClosed) for (const [a, b] of m.poles) link(key(s.id, a), key(s.id, b))
    // inverseurs : commun relié au contact travail (actionné) ou repos (au repos)
    for (const [com, nc, no] of m.changeover ?? []) link(key(s.id, com), key(s.id, act ? no : nc))
  }

  const pots = new Map<string, Set<string>>()
  const portsOfRoot = new Map<string, string[]>()
  for (const s of doc.symbols) {
    const m = defs[s.defId]?.sim
    if (m?.k !== 'source') continue
    for (const [port, pot] of Object.entries(m.pot)) {
      const k = key(s.id, port)
      const r = uf.find(k)
      if (!pots.has(r)) pots.set(r, new Set())
      pots.get(r)!.add(pot)
      if (!portsOfRoot.has(r)) portsOfRoot.set(r, [])
      portsOfRoot.get(r)!.push(k)
    }
  }
  for (const [k, pot] of x.derived) {
    const r = uf.find(k)
    if (!pots.has(r)) pots.set(r, new Set())
    pots.get(r)!.add(pot)
    if (!portsOfRoot.has(r)) portsOfRoot.set(r, [])
    portsOfRoot.get(r)!.push(k)
  }
  // Un secondaire de transformateur relié à un potentiel du réseau (terre, neutre…) prend ce potentiel : pas de court-circuit.
  const resolve = (set: Set<string> | undefined): { pot: string | null; conflict: boolean } => {
    if (!set || set.size === 0) return { pot: null, conflict: false }
    const real = [...set].filter((v) => !v.startsWith('~'))
    if (real.length === 1) return { pot: real[0], conflict: false }
    if (real.length > 1) return { pot: null, conflict: true }
    return set.size === 1 ? { pot: [...set][0], conflict: false } : { pot: null, conflict: true }
  }
  const shorts: SimResult['shorts'] = []
  for (const [r, set] of pots) {
    if (resolve(set).conflict) shorts.push({ potentials: [...set], ports: portsOfRoot.get(r) ?? [] })
  }
  const potOf = (symId: string, portId: string): string | null => resolve(pots.get(uf.find(key(symId, portId)))).pot

  const energized = new Set<string>()
  const coilOn: Record<string, boolean> = {}
  for (const s of doc.symbols) {
    const m = defs[s.defId]?.sim
    if (!m || (m.k !== 'coil' && m.k !== 'load')) continue
    const seen = new Set(m.ports.map((p) => potOf(s.id, p)).filter((v): v is string => v !== null))
    const on = seen.size >= 2
    if (on) energized.add(s.id)
    if (m.k === 'coil' && s.label) coilOn[devKey(s.label)] = coilOn[devKey(s.label)] || on
  }
  // transformateurs : alimentés quand deux bornes du primaire sont à des potentiels différents
  const trafoOn = new Set<string>()
  for (const s of doc.symbols) {
    const m = defs[s.defId]?.sim
    if (m?.k !== 'transformer') continue
    const seen = new Set(m.primary.map((p) => potOf(s.id, p)).filter((v): v is string => v !== null))
    if (seen.size >= 2) trafoOn.add(s.id)
  }
  return { closed, energized, coilOn, potOf, shorts, swEdges, trafoOn }
}

/** Calcul complet : les secondaires des transformateurs alimentés deviennent des sources, jusqu'à stabilité. */
function solveAll(x: Ctx) {
  let out = solve(x)
  for (let i = 0; i < 6; i++) {
    const next = new Map<string, string>()
    for (const s of x.doc.symbols) {
      const m = x.defs[s.defId]?.sim
      if (m?.k !== 'transformer' || !out.trafoOn.has(s.id)) continue
      m.secondary.forEach((p, n) => next.set(key(s.id, p), `~${s.id}:${n}`))
    }
    const same = next.size === x.derived.size && [...next].every(([k, v]) => x.derived.get(k) === v)
    if (same) break
    x.derived = next
    out = solve(x)
  }
  return out
}

const PHASES = new Set(['L', 'L1', 'L2', 'L3'])

/** Tension entre deux potentiels, si elle est déterminable (réseau 230/400 V, source continue 24 V, secondaires de transformateurs). */
function voltBetween(a: string | null, b: string | null, doc: Doc, defs: Record<string, SymbolDef>): number | undefined {
  if (!a || !b || a === b) return undefined
  const aD = a.startsWith('~')
  const bD = b.startsWith('~')
  if (aD && bD) {
    const [ida] = a.slice(1).split(':')
    const [idb, nb] = b.slice(1).split(':')
    if (ida !== idb) return undefined
    const s = doc.symbols.find((x) => x.id === ida)
    const volts = s?.volts ?? 24
    const m = s && defs[s.defId]?.sim
    // secondaire à point milieu : la moitié entre le point milieu et une extrémité
    if (m?.k === 'transformer' && m.secondary.length === 3 && (nb === '1' || a.endsWith(':1'))) return volts / 2
    return volts
  }
  if (aD || bD) return undefined
  if (PHASES.has(a) && PHASES.has(b)) return 400
  if ((PHASES.has(a) && b === 'N') || (PHASES.has(b) && a === 'N')) return 230
  if ((a === '+' && b === '-') || (a === '-' && b === '+')) return 24
  return undefined
}

const HOT = new Set(['L', 'L1', 'L2', 'L3', '+'])
/** Potentiel « chaud » : phase, +, ou première borne d'un secondaire de transformateur. */
const isHot = (pot: string) => HOT.has(pot) || pot.endsWith(':0')

/**
 * Conducteurs réellement parcourus par un courant et sens de circulation.
 * On garde le graphe (fils + contacts fermés), on retire de proche en proche les branches mortes (impasses
 * qui ne mènent ni à une source ni à un récepteur alimenté), puis on oriente chaque fil : depuis la source
 * vers le récepteur sur les potentiels « chauds » (L, +), du récepteur vers la source sur les retours (N, 0 V).
 */
function currentFlow(doc: Doc, defs: Record<string, SymbolDef>, out: ReturnType<typeof solve>): Record<string, 1 | -1> {
  const adj = new Map<string, Set<string>>()
  const addEdge = (a: string, b: string) => {
    if (a === b) return
    if (!adj.has(a)) adj.set(a, new Set())
    if (!adj.has(b)) adj.set(b, new Set())
    adj.get(a)!.add(b)
    adj.get(b)!.add(a)
  }
  for (const w of doc.wires) addEdge(key(w.from.symId, w.from.portId), key(w.to.symId, w.to.portId))
  for (const [a, b] of out.swEdges) addEdge(a, b)

  const pinned = new Set<string>()
  const sources: string[] = []
  for (const s of doc.symbols) {
    const m = defs[s.defId]?.sim
    if (m?.k === 'source') {
      for (const p of Object.keys(m.pot)) {
        pinned.add(key(s.id, p))
        sources.push(key(s.id, p))
      }
    } else if ((m?.k === 'coil' || m?.k === 'load') && out.energized.has(s.id)) {
      for (const p of m.ports) pinned.add(key(s.id, p))
    } else if (m?.k === 'transformer' && out.trafoOn.has(s.id)) {
      // primaire = récepteur ; secondaire = source du circuit aval
      for (const p of m.primary) pinned.add(key(s.id, p))
      for (const p of m.secondary) {
        pinned.add(key(s.id, p))
        sources.push(key(s.id, p))
      }
    }
  }

  // élagage des impasses
  const queue = [...adj.keys()].filter((n) => !pinned.has(n) && adj.get(n)!.size <= 1)
  while (queue.length) {
    const n = queue.pop()!
    const nb = adj.get(n)
    if (!nb) continue
    adj.delete(n)
    for (const o of nb) {
      const set = adj.get(o)
      if (!set) continue
      set.delete(n)
      if (!pinned.has(o) && set.size <= 1) queue.push(o)
    }
  }

  // distance depuis les sources
  const dist = new Map<string, number>()
  const bfs: string[] = []
  for (const s of sources) {
    if (adj.has(s)) {
      dist.set(s, 0)
      bfs.push(s)
    }
  }
  for (let i = 0; i < bfs.length; i++) {
    for (const o of adj.get(bfs[i]) ?? []) {
      if (!dist.has(o)) {
        dist.set(o, dist.get(bfs[i])! + 1)
        bfs.push(o)
      }
    }
  }

  const res: Record<string, 1 | -1> = {}
  for (const w of doc.wires) {
    const u = key(w.from.symId, w.from.portId)
    const v = key(w.to.symId, w.to.portId)
    if (!adj.get(u)?.has(v)) continue
    const pot = out.potOf(w.from.symId, w.from.portId)
    if (!pot || !dist.has(u) || !dist.has(v)) continue
    const du = dist.get(u)!
    const dv = dist.get(v)!
    const awayFromSource = isHot(pot)
    res[w.id] = du === dv ? 1 : (awayFromSource ? du < dv : du > dv) ? 1 : -1
  }
  return res
}

export function simulate(docIn: Doc, defs: Record<string, SymbolDef>, previous: SimMemory, inp: SimInputs, now = Date.now()): SimResult {
  const cut = inp.cut
  const doc: Doc = cut?.size ? { ...docIn, wires: docIn.wires.filter((w) => !cut.has(w.id) && !cut.has(w.from.symId) && !cut.has(w.to.symId)) } : docIn
  const timers = new Map<string, { kind: TimerKind; delay: number }>()
  for (const s of doc.symbols) {
    const m = defs[s.defId]?.sim
    if (m?.k === 'coil' && m.timer && s.label && !timers.has(devKey(s.label))) timers.set(devKey(s.label), { kind: m.timer, delay: s.delay ?? DEFAULT_DELAY_S })
  }
  const memory: SimMemory = { ...previous }
  const ctx: Ctx = { doc, defs, memory, inp, now, timers, pending: [], derived: new Map() }

  let out = solveAll(ctx)
  let unstable = true
  for (let i = 0; i < 30; i++) {
    // un relais qui change d'état démarre son chronomètre
    let changed = false
    const labels = new Set([...Object.keys(memory), ...Object.keys(out.coilOn)])
    for (const l of labels) {
      const on = !!out.coilOn[l]
      if (on !== (memory[l]?.on ?? false)) {
        memory[l] = { on, since: now }
        changed = true
      }
    }
    if (!changed) {
      unstable = false
      break
    }
    ctx.pending = []
    out = solveAll(ctx)
  }

  ctx.pending = []
  out = solveAll(ctx) // calcul final : collecte propre des échéances
  const potentialOf: Record<string, string | null> = {}
  for (const s of doc.symbols) {
    for (const p of defs[s.defId]?.ports ?? []) potentialOf[key(s.id, p.id)] = out.potOf(s.id, p.id)
  }
  // tensions aux bornes des récepteurs et écart avec la tension nominale
  const volts: Record<string, number> = {}
  const badVoltage: Record<string, { applied: number; rated: number }> = {}
  const energized = new Set(out.energized)
  for (const s of doc.symbols) {
    const m = defs[s.defId]?.sim
    if (m?.k === 'transformer' && out.trafoOn.has(s.id)) energized.add(s.id)
    if (!m || (m.k !== 'coil' && m.k !== 'load') || !out.energized.has(s.id)) continue
    const pots = m.ports.map((p) => out.potOf(s.id, p))
    let v: number | undefined
    for (let i = 0; i < pots.length; i++) for (let j = i + 1; j < pots.length; j++) v = Math.max(v ?? 0, voltBetween(pots[i], pots[j], doc, defs) ?? 0) || v
    if (v === undefined) continue
    volts[s.id] = v
    if (s.volts && (v < s.volts * 0.85 || v > s.volts * 1.15)) badVoltage[s.id] = { applied: v, rated: s.volts }
  }
  const unsupported = doc.symbols.filter((s) => !defs[s.defId]?.sim && !defs[s.defId]?.decor).map((s) => s.id)
  return {
    state: memory, energized, closed: out.closed, potentialOf, shorts: out.shorts, unstable, unsupported,
    pendingMs: ctx.pending.length ? Math.min(...ctx.pending) : null,
    current: currentFlow(doc, defs, out),
    volts,
    badVoltage,
  }
}
