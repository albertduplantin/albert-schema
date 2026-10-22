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

interface Ctx {
  doc: Doc
  defs: Record<string, SymbolDef>
  memory: SimMemory
  inp: SimInputs
  now: number
  /** temporisation de chaque relais, par repère (bobines temporisées) */
  timers: Map<string, { kind: TimerKind; delay: number }>
  pending: number[]
}

/** État « actionné » d'un contact. */
function actuated(s: PlacedSymbol, m: Extract<SimModel, { k: 'switch' }>, x: Ctx): boolean {
  switch (m.ctl) {
    case 'fixed':
      return false
    case 'coil': {
      if (!s.label) return false
      const t = x.timers.get(s.label)
      const mem = x.memory[s.label]
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
  for (const s of doc.symbols) {
    const m = defs[s.defId]?.sim
    if (m?.k !== 'switch') continue
    const act = actuated(s, m, x)
    closed[s.id] = act
    if (m.ctl === 'fixed') {
      for (const [a, b] of m.poles) uf.union(key(s.id, a), key(s.id, b))
      continue
    }
    const isClosed = m.nc ? !act : act
    if (isClosed) for (const [a, b] of m.poles) uf.union(key(s.id, a), key(s.id, b))
    // inverseurs : commun relié au contact travail (actionné) ou repos (au repos)
    for (const [com, nc, no] of m.changeover ?? []) uf.union(key(s.id, com), key(s.id, act ? no : nc))
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
  const shorts: SimResult['shorts'] = []
  for (const [r, set] of pots) if (set.size > 1) shorts.push({ potentials: [...set], ports: portsOfRoot.get(r) ?? [] })
  const potOf = (symId: string, portId: string): string | null => {
    const set = pots.get(uf.find(key(symId, portId)))
    return set && set.size === 1 ? [...set][0] : null
  }

  const energized = new Set<string>()
  const coilOn: Record<string, boolean> = {}
  for (const s of doc.symbols) {
    const m = defs[s.defId]?.sim
    if (!m || (m.k !== 'coil' && m.k !== 'load')) continue
    const seen = new Set(m.ports.map((p) => potOf(s.id, p)).filter((v): v is string => v !== null))
    const on = seen.size >= 2
    if (on) energized.add(s.id)
    if (m.k === 'coil' && s.label) coilOn[s.label] = coilOn[s.label] || on
  }
  return { closed, energized, coilOn, potOf, shorts }
}

export function simulate(doc: Doc, defs: Record<string, SymbolDef>, previous: SimMemory, inp: SimInputs, now = Date.now()): SimResult {
  const timers = new Map<string, { kind: TimerKind; delay: number }>()
  for (const s of doc.symbols) {
    const m = defs[s.defId]?.sim
    if (m?.k === 'coil' && m.timer && s.label && !timers.has(s.label)) timers.set(s.label, { kind: m.timer, delay: s.delay ?? DEFAULT_DELAY_S })
  }
  const memory: SimMemory = { ...previous }
  const ctx: Ctx = { doc, defs, memory, inp, now, timers, pending: [] }

  let out = solve(ctx)
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
    out = solve(ctx)
  }

  ctx.pending = []
  out = solve(ctx) // calcul final : collecte propre des échéances
  const potentialOf: Record<string, string | null> = {}
  for (const s of doc.symbols) {
    for (const p of defs[s.defId]?.ports ?? []) potentialOf[key(s.id, p.id)] = out.potOf(s.id, p.id)
  }
  const unsupported = doc.symbols.filter((s) => !defs[s.defId]?.sim && !defs[s.defId]?.decor).map((s) => s.id)
  return {
    state: memory, energized: out.energized, closed: out.closed, potentialOf, shorts: out.shorts, unstable, unsupported,
    pendingMs: ctx.pending.length ? Math.min(...ctx.pending) : null,
  }
}
