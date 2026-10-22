import type { Doc, PlacedSymbol, SimModel, SymbolDef } from '../types'

/**
 * Simulation « logique de relais » d'un schéma électrique.
 *
 * Principe : les conducteurs et les contacts fermés forment des réseaux (nœuds) ; les sources imposent un
 * potentiel (L1, L2, L3, N, +, -…) sur leurs bornes. Un récepteur (bobine, lampe, moteur…) est alimenté quand
 * deux de ses bornes se trouvent à des potentiels différents. Les contacts commandés par une bobine suivent
 * l'état de la bobine de même repère. On itère jusqu'à stabilité, à partir de l'état précédent : les
 * circuits à auto-maintien se comportent donc comme en réalité.
 *
 * Limites : pas de régime transitoire, pas d'impédances ni de courants, temporisations traitées comme
 * instantanées, contacts inverseurs non simulés.
 */

export interface SimInputs {
  /** boutons maintenus appuyés (poussoirs) */
  pressed: ReadonlySet<string>
  /** organes basculés (interrupteurs, disjoncteurs, arrêts d'urgence…) */
  toggled: ReadonlySet<string>
}

export interface SimResult {
  /** bobines alimentées, par repère (mémoire pour l'itération suivante) */
  coils: Record<string, boolean>
  /** symboles alimentés (bobines, lampes, moteurs, vannes…) */
  energized: Set<string>
  /** contacts : état fermé par symbole */
  closed: Record<string, boolean>
  /** potentiel présent sur chaque réseau, par borne `symId:portId` */
  potentialOf: Record<string, string | null>
  /** courts-circuits détectés : potentiels en conflit et un symbole concerné */
  shorts: { potentials: string[]; ports: string[] }[]
  /** le calcul n'a pas convergé (circuit oscillant, ex. contact NF de sa propre bobine) */
  unstable: boolean
  /** symboles présents sur la feuille mais sans modèle de simulation */
  unsupported: string[]
}

class UnionFind {
  private p = new Map<string, string>()
  find(x: string): string {
    let r = x
    while (this.p.has(r) && this.p.get(r) !== r) r = this.p.get(r)!
    if (!this.p.has(x)) this.p.set(x, x)
    // compression de chemin
    let c = x
    while (c !== r) {
      const n = this.p.get(c)!
      this.p.set(c, r)
      c = n
    }
    if (!this.p.has(r)) this.p.set(r, r)
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

/** État fermé d'un contact selon sa commande. */
function switchClosed(s: PlacedSymbol, m: Extract<SimModel, { k: 'switch' }>, coils: Record<string, boolean>, inp: SimInputs) {
  let actuated: boolean
  switch (m.ctl) {
    case 'fixed':
      return true
    case 'coil':
      actuated = !!s.label && !!coils[s.label]
      break
    case 'momentary':
      actuated = inp.pressed.has(s.id)
      break
    default:
      actuated = inp.toggled.has(s.id)
  }
  return m.nc ? !actuated : actuated
}

function solve(doc: Doc, defs: Record<string, SymbolDef>, coils: Record<string, boolean>, inp: SimInputs) {
  const uf = new UnionFind()
  for (const w of doc.wires) uf.union(key(w.from.symId, w.from.portId), key(w.to.symId, w.to.portId))

  const closed: Record<string, boolean> = {}
  for (const s of doc.symbols) {
    const m = defs[s.defId]?.sim
    if (m?.k !== 'switch') continue
    const c = switchClosed(s, m, coils, inp)
    closed[s.id] = c
    if (c) for (const [a, b] of m.poles) uf.union(key(s.id, a), key(s.id, b))
  }

  // potentiels imposés par les sources
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
  for (const [r, set] of pots) {
    if (set.size > 1) shorts.push({ potentials: [...set], ports: portsOfRoot.get(r) ?? [] })
  }
  const potOf = (symId: string, portId: string): string | null => {
    const set = pots.get(uf.find(key(symId, portId)))
    return set && set.size === 1 ? [...set][0] : null
  }

  // récepteurs alimentés : au moins deux bornes à des potentiels différents
  const energized = new Set<string>()
  const nextCoils: Record<string, boolean> = {}
  for (const s of doc.symbols) {
    const m = defs[s.defId]?.sim
    if (!m || (m.k !== 'coil' && m.k !== 'load')) continue
    const ports = m.k === 'coil' ? m.ports : m.ports
    const seen = new Set(ports.map((p) => potOf(s.id, p)).filter((v): v is string => v !== null))
    const on = seen.size >= 2
    if (on) energized.add(s.id)
    if (m.k === 'coil' && s.label) nextCoils[s.label] = nextCoils[s.label] || on
  }
  return { closed, energized, nextCoils, potOf, shorts }
}

export function simulate(doc: Doc, defs: Record<string, SymbolDef>, previous: Record<string, boolean>, inp: SimInputs): SimResult {
  let coils = { ...previous }
  let out = solve(doc, defs, coils, inp)
  let unstable = true
  const same = (a: Record<string, boolean>, b: Record<string, boolean>) => {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)])
    for (const k of keys) if (!!a[k] !== !!b[k]) return false
    return true
  }
  for (let i = 0; i < 30; i++) {
    if (same(coils, out.nextCoils)) {
      unstable = false
      break
    }
    coils = out.nextCoils
    out = solve(doc, defs, coils, inp)
  }
  if (unstable) coils = out.nextCoils

  const potentialOf: Record<string, string | null> = {}
  for (const s of doc.symbols) {
    for (const p of defs[s.defId]?.ports ?? []) potentialOf[key(s.id, p.id)] = out.potOf(s.id, p.id)
  }
  const unsupported = doc.symbols.filter((s) => !defs[s.defId]?.sim && !defs[s.defId]?.decor).map((s) => s.id)
  return { coils, energized: out.energized, closed: out.closed, potentialOf, shorts: out.shorts, unstable, unsupported }
}
