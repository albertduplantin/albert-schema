import { detectTrips } from './protect'
import { emptyProgram, scan, type PlcState } from './plc'
import { basePot, potVolts, sourcePots, withSourceVoltages } from './potentials'
import type { Doc, PlacedSymbol, SimModel, SymbolDef, TimerKind } from '../types'
import { cylPos, solveFluid, STROKE_S } from './fluid'
import { DEFAULT_WATTS, motorCurrent } from './estimate'

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
  /** défauts injectés : fils coupés, appareils ouverts (fusible fondu, relais thermique déclenché), `stuck:<id>` contact collé, `short:<id>` récepteur ou bobine en court-circuit */
  cut?: ReadonlySet<string>
}

/** Mémoire de simulation : état de chaque relais (par repère) et instant du dernier changement. */
export type SimMemory = Record<string, { on: boolean; since: number; p?: number; dir?: number; v?: number; plc?: PlcState }>

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
  /** un relais thermique a déclenché (surcharge moteur injectée) */
  thermalTrip: boolean
  /** intensité (A) circulant dans chaque conducteur, d'après les caractéristiques des récepteurs (estimations si non renseignées) */
  amps: Record<string, number>
  /** vérins : position de 0 (rentré) à 1 (sorti) */
  /** sélecteurs à trois positions : position courante (0 = centre, ouvert) */
  pos3: Record<string, number>
  /** moteurs triphasés alimentés : sens de rotation, +1 direct (L1, L2, L3 de gauche à droite), −1 inverse */
  rotation: Record<string, 1 | -1>
  /** protections déclenchées (disjoncteur) ou fondues (fusible) : identifiants des symboles */
  tripped: Set<string>
  cylPos: Record<string, number>
  /** distributeurs : vrai = case actionnée */
  valveA: Record<string, boolean>
  /** distributeurs à trois positions : case de droite (commande B) */
  valveB: Record<string, boolean>
  /** automates alimentés : étapes actives, entrées et sorties en direct */
  plc: Record<string, PlcState>
  /** moteurs pneumatiques : sens de rotation */
  fluidMotor: Record<string, -1 | 0 | 1>
  /** hydraulique : mesures affichées sous les appareils (pression, débit, vitesse) et vitesse des moteurs (tr/min) */
  fluidInfo: Record<string, string>
  motorRpm: Record<string, number>
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

/** Organe manœuvrable à la souris : contact, bouton, ou distributeur à commande manuelle. */
export function isOperableDef(def: SymbolDef | undefined): 'momentary' | 'toggle' | null {
  if (def?.fluid?.k === 'valve') return def.fluid.manual ?? (def.fluid.a === 'elec' ? 'toggle' : null) // une électrovanne a une commande manuelle de secours
  return isOperable(def?.sim)
}

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

/** Délai (s) avant déclenchement d'un relais thermique sous surcharge. */
export const THERMAL_S = 5
const THERMAL = '§TH'
const isThermalSlave = (s: PlacedSymbol) => /15_protection_contacts/.test(s.defId)

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
      if (s.det?.cyl) {
        // détecteur posé sur un vérin : le contact se ferme quand le piston est à la position réglée (aux extrémités : vérin rentré ou sorti)
        const cyl = x.doc.symbols.find((c) => x.defs[c.defId]?.fluid?.k === 'cyl' && c.label && devKey(c.label) === devKey(s.det!.cyl))
        if (cyl) {
          const f = x.defs[cyl.defId].fluid
          const p = cylPos(x.memory['§C:' + cyl.id], x.now, f?.k === 'cyl' && f.single === 'pull' ? 1 : 0)
          const at = Math.min(1, Math.max(0, s.det.at))
          return at <= 0.02 ? p <= 0.02 : at >= 0.98 ? p >= 0.98 : Math.abs(p - at) <= 0.06
        }
        return false
      }
      if (s.label) {
        // fin de course lié à un vérin : « A1+ » se ferme vérin A1 sorti, « A1- » vérin rentré
        const lm = /^(.+?)\s*([+-])$/.exec(s.label)
        const cyl = lm && x.doc.symbols.find((c) => x.defs[c.defId]?.fluid?.k === 'cyl' && c.label && devKey(c.label) === devKey(lm[1]))
        if (lm && cyl) {
          const f = x.defs[cyl.defId].fluid
          const p = cylPos(x.memory['§C:' + cyl.id], x.now, f?.k === 'cyl' && f.single === 'pull' ? 1 : 0)
          return lm[2] === '+' ? p >= 0.98 : p <= 0.02
        }
      }
      if (s.label) {
        // pressostat pneumatique de même repère : le contact suit la pression
        const ps = x.memory['§PS:' + devKey(s.label)]
        if (ps) return ps.on
      }
      if (isThermalSlave(s) && applyDelay(x.memory[THERMAL], 'on', THERMAL_S, x.now, x.pending)) return true // relais thermique déclenché
      return x.inp.toggled.has(s.id)
  }
}

function solve(x: Ctx) {
  const { doc, defs } = x
  const uf = new UnionFind()
  for (const w of doc.wires) uf.union(key(w.from.symId, w.from.portId), key(w.to.symId, w.to.portId))

  const closed: Record<string, boolean> = {}
  const pos3: Record<string, number> = {} // sélecteurs à plusieurs positions : 0 centre (ouvert) pour le 1-0-2, sinon numéro de la position
  const windingV: Record<string, number | undefined> = {} // tension aux bornes d'un enroulement de moteur couplé
  const swEdges: [string, string][] = [] // liaisons établies par les contacts fermés
  const link = (a: string, b: string) => {
    uf.union(a, b)
    swEdges.push([a, b])
  }
  for (const s of doc.symbols) {
    const m = defs[s.defId]?.sim
    if (m?.k === 'ssr') {
      // relais statique : la sortie suit l'entrée (mémoire propre au symbole)
      const on = !!x.memory['§S:' + s.id]?.on
      closed[s.id] = on
      if (on) for (const [a, b] of m.poles) link(key(s.id, a), key(s.id, b))
      continue
    }
    if (m?.k === 'plc') {
      // sorties à contact de l'automate : elles se ferment quand le programme les commande (et que l'automate est alimenté)
      const st = x.memory['§PLC:' + s.id]?.plc
      m.outputs.forEach((o, i) => { if (st?.out[i]) link(key(s.id, o.com), key(s.id, o.out)) })
      continue
    }
    if (m?.k !== 'switch') continue
    if (x.memory['§TRIP:' + s.id]?.on) { closed[s.id] = false; continue } // protection déclenchée ou fusible fondu : circuit ouvert
    const act = actuated(s, m, x)
    closed[s.id] = act
    if (m.sel) {
      // sélecteur à N positions : la position 1 n'a pas de marque ; la position k (k ≥ 2) est marquée « id » (k = 2) ou « id:k-1 »
      const n = m.sel.outs.length
      let p = 1
      for (let k = n; k >= 2; k--) if (x.inp.toggled.has(k === 2 ? s.id : s.id + ':' + (k - 1))) { p = k; break }
      pos3[s.id] = p
      closed[s.id] = p > 1
      link(key(s.id, m.sel.com), key(s.id, m.sel.outs[p - 1]))
      continue
    }
    if (m.pos3 && m.changeover?.length) {
      const p1 = x.inp.toggled.has(s.id), p2 = x.inp.toggled.has(s.id + ':2')
      pos3[s.id] = p2 ? 2 : p1 ? 1 : 0
      closed[s.id] = p2
      for (const [com, nc, no] of m.changeover) {
        if (p2) link(key(s.id, com), key(s.id, no))
        else if (p1) link(key(s.id, com), key(s.id, nc))
      }
      continue
    }
    if (m.ctl !== 'fixed' && x.inp.cut?.has('stuck:' + s.id)) {
      // contact collé (soudé) : il conduit quel que soit l'ordre de la commande
      for (const [a, b] of m.poles) link(key(s.id, a), key(s.id, b))
      for (const [com, nc, no] of m.changeover ?? []) link(key(s.id, com), key(s.id, no))
      continue
    }
    if (m.ctl === 'fixed') {
      for (const [a, b] of m.poles) link(key(s.id, a), key(s.id, b))
      continue
    }
    const isClosed = m.nc ? !act : act
    if (isClosed) for (const [a, b] of m.poles) link(key(s.id, a), key(s.id, b))
    // inverseurs : commun relié au contact travail (actionné) ou repos (au repos)
    for (const [com, nc, no] of m.changeover ?? []) link(key(s.id, com), key(s.id, act ? no : nc))
  }

  // court-circuit aux bornes d'un récepteur ou d'une bobine (défaut injecté)
  for (const s of doc.symbols) {
    const m = defs[s.defId]?.sim
    if ((m?.k === 'load' || m?.k === 'coil') && x.inp.cut?.has('short:' + s.id)) {
      const ports = m.ports
      for (let i = 1; i < ports.length; i++) link(key(s.id, ports[0]), key(s.id, ports[i]))
    }
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
  const resolve = (full: Set<string> | undefined): { pot: string | null; conflict: boolean } => {
    if (!full || full.size === 0) return { pot: null, conflict: false }
    // la terre (PE) ne s'oppose à aucun autre potentiel : elle ne compte que si elle est seule
    const set = full.size > 1 && full.has('PE') ? new Set([...full].filter((v) => v !== 'PE')) : full
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
  /** moteur à enroulements séparés : alimenté si chaque enroulement l'est, en étoile (point commun flottant) ou en triangle */
  const windingState = (s: PlacedSymbol, windings: [string, string][]): { on: boolean; v: number | undefined } => {
    const w = windings.map(([a, b]) => ({ pa: potOf(s.id, a), pb: potOf(s.id, b), ra: uf.find(key(s.id, a)), rb: uf.find(key(s.id, b)) }))
    const powered = w.map(() => false)
    const volt: (number | undefined)[] = w.map(() => undefined)
    w.forEach((e, i) => {
      if (e.pa && e.pb && e.pa !== e.pb) { powered[i] = true; volt[i] = voltBetween(e.pa, e.pb, doc, defs) }
    })
    // un point commun flottant (étoile) alimente les enroulements dont l'autre bout est à des phases différentes
    const groups = new Map<string, { idx: number[]; pots: Set<string> }>()
    w.forEach((e, i) => {
      if (powered[i]) return
      const far = e.pa && !e.pb ? { f: e.rb, p: e.pa } : e.pb && !e.pa ? { f: e.ra, p: e.pb } : null
      if (!far) return
      const g = groups.get(far.f) ?? { idx: [], pots: new Set<string>() }
      g.idx.push(i)
      g.pots.add(far.p)
      groups.set(far.f, g)
    })
    for (const g of groups.values()) {
      if (g.pots.size < 2) continue
      const [p1, p2] = [...g.pots]
      const line = voltBetween(p1, p2, doc, defs)
      for (const i of g.idx) { powered[i] = true; volt[i] = line === undefined ? undefined : Math.round((line / Math.sqrt(3)) * 10) / 10 }
    }
    return { on: powered.length > 0 && powered.every(Boolean), v: volt.every((q) => q === volt[0]) ? volt[0] : undefined }
  }
  for (const s of doc.symbols) {
    const m = defs[s.defId]?.sim
    if (m?.k === 'ssr') {
      const seenIn = new Set(m.input.map((p) => potOf(s.id, p)).filter((v): v is string => v !== null))
      const onIn = seenIn.size >= 2
      if (onIn) energized.add(s.id)
      coilOn['§S:' + s.id] = onIn
      continue
    }
    if (!m || (m.k !== 'coil' && m.k !== 'load')) continue
    const seen = new Set(m.ports.map((p) => potOf(s.id, p)).filter((v): v is string => v !== null))
    let on = seen.size >= 2
    if (m.k === 'load' && m.windings) {
      const st = windingState(s, m.windings)
      on = st.on
      windingV[s.id] = st.v
    }
    if (on) energized.add(s.id)
    if ((m.k === 'coil' || (m.k === 'load' && m.role === 'valve')) && s.label) coilOn[devKey(s.label)] = coilOn[devKey(s.label)] || on
    // surcharge injectée sur un moteur : le relais thermique déclenche après un délai et reste déclenché tant que la surcharge dure
    if (m.k === 'load' && m.role === 'motor' && x.inp.cut?.has('ovl:' + s.id) && (on || x.memory[THERMAL]?.on)) coilOn[THERMAL] = true
  }
  // transformateurs : alimentés quand deux bornes du primaire sont à des potentiels différents
  const trafoOn = new Set<string>()
  for (const s of doc.symbols) {
    const m = defs[s.defId]?.sim
    if (m?.k !== 'transformer') continue
    const seen = new Set(m.primary.map((p) => potOf(s.id, p)).filter((v): v is string => v !== null))
    if (seen.size >= 2) trafoOn.add(s.id)
  }
  return { closed, pos3, windingV, energized, coilOn, potOf, shorts, swEdges, trafoOn }
}

type Key = string
/** Bornes reliées par des fils (et par les bornes de passage) : ensembles de potentiels « source » atteints depuis `start`. */
interface SrcGraph { defs: Record<string, SymbolDef>; adj: Map<Key, Key[]>; srcPot: Map<Key, string> }
// le graphe des fils et des sources ne dépend que du schéma : on le garde le temps que l'objet schéma ne change pas
const SRC_GRAPHS = new WeakMap<Doc, SrcGraph>()
function srcGraph(doc: Doc, defs: Record<string, SymbolDef>): SrcGraph {
  const hit = SRC_GRAPHS.get(doc)
  if (hit && hit.defs === defs) return hit
  const adj = new Map<Key, Key[]>()
  const link = (a: Key, b: Key) => {
    if (!adj.has(a)) adj.set(a, [])
    if (!adj.has(b)) adj.set(b, [])
    adj.get(a)!.push(b)
    adj.get(b)!.push(a)
  }
  for (const w of doc.wires) link(key(w.from.symId, w.from.portId), key(w.to.symId, w.to.portId))
  const srcPot = new Map<Key, string>()
  for (const s of doc.symbols) {
    const m = defs[s.defId]?.sim
    if (m?.k === 'source') for (const [p, pot] of Object.entries(sourcePots(s, defs[s.defId]))) srcPot.set(key(s.id, p), pot)
    else if (m?.k === 'switch' && m.ctl === 'fixed') for (const [a, b] of m.poles) link(key(s.id, a), key(s.id, b)) // bornes, barrettes de terre
  }
  const g = { defs, adj, srcPot }
  SRC_GRAPHS.set(doc, g)
  return g
}

export function reachedSources(doc: Doc, defs: Record<string, SymbolDef>, start: Key): { pe: boolean; neutral: boolean } {
  const { adj, srcPot } = srcGraph(doc, defs)
  const seen = new Set<Key>([start])
  const stack = [start]
  let pe = false
  let neutral = false
  while (stack.length) {
    const n = stack.pop()!
    const pot = srcPot.get(n)
    if (pot && basePot(pot) === 'PE') pe = true
    if (pot && basePot(pot) === 'N') neutral = true
    for (const o of adj.get(n) ?? []) if (!seen.has(o)) { seen.add(o); stack.push(o) }
  }
  return { pe, neutral }
}


/** Calcul complet : les secondaires des transformateurs alimentés deviennent des sources, jusqu'à stabilité. */
function solveAll(x: Ctx) {
  let out = solve(x)
  for (let i = 0; i < 6; i++) {
    const next = new Map<string, string>()
    for (const s of x.doc.symbols) {
      const m = x.defs[s.defId]?.sim
      if (m?.k !== 'transformer' || !out.trafoOn.has(s.id)) continue
      // secondaire à deux bornes dont une est reliée à la terre ou au neutre : cette borne est le retour (neutre), l'autre la phase
      let ports = m.secondary
      if (ports.length === 2) {
        const e = ports.map((p) => { const r = reachedSources(x.doc, x.defs, key(s.id, p)); return r.pe || r.neutral })
        if (e[0] && !e[1]) ports = [ports[1], ports[0]]
      }
      ports.forEach((p, n) => next.set(key(s.id, p), `~${s.id}:${n}`))
    }
    const same = next.size === x.derived.size && [...next].every(([k, v]) => x.derived.get(k) === v)
    if (same) break
    x.derived = next
    out = solve(x)
  }
  return out
}

const PHASES = new Set(['L', 'L1', 'L2', 'L3'])
const PHASES3 = new Set(['L1', 'L2', 'L3'])

/** Tension phase-neutre d'une source triphasée réglée sur `v` volts entre phases. */
const phaseToNeutral = (v: number | undefined) => (v === undefined ? 230 : Math.round((v / Math.sqrt(3)) * 10) / 10)

/**
 * Tension (V) entre deux points du schéma d'après leurs potentiels, comme la lirait un voltmètre : 0 entre deux points au même
 * potentiel ou si l'un est en l'air ; indéfinie (undefined) si le logiciel ne sait pas l'évaluer.
 */
export function voltageBetween(a: string | null, b: string | null, doc: Doc, defs: Record<string, SymbolDef>): number | undefined {
  if (!a || !b || a === b) return 0
  const pe = a === 'PE' ? b : b === 'PE' ? a : null
  if (pe) {
    const base = basePot(pe)
    const v = potVolts(pe)
    if (base === 'N') return 0
    if (PHASES3.has(base)) return phaseToNeutral(v)
    if (PHASES.has(base)) return v ?? 230
    if (pe.startsWith('~')) return pe.endsWith(':0') ? (doc.symbols.find((x) => x.id === pe.slice(1).split(':')[0])?.volts ?? 24) : 0
  }
  return voltBetween(a, b, doc, defs)
}

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
  // deux sources de tensions différentes : la tension entre leurs bornes n'est pas déterminable
  const va = potVolts(a), vb = potVolts(b)
  if (va !== vb) return undefined
  const A = basePot(a), B = basePot(b)
  if ((A === 'LI' && B === 'NI') || (A === 'NI' && B === 'LI')) return va ?? 230 // source monophasée isolée de la terre
  if (PHASES.has(A) && PHASES.has(B)) return va ?? 400
  if (PHASES3.has(A) && B === 'N') return phaseToNeutral(va)
  if (PHASES3.has(B) && A === 'N') return phaseToNeutral(va)
  if ((PHASES.has(A) && B === 'N') || (PHASES.has(B) && A === 'N')) return va ?? 230
  if ((A === '+' && B === '-') || (A === '-' && B === '+')) return va ?? 24
  return undefined
}

const HOT = new Set(['L', 'L1', 'L2', 'L3', 'LI', '+'])
/** Potentiel « chaud » : phase, +, ou première borne d'un secondaire de transformateur. */
const isHot = (pot: string) => HOT.has(basePot(pot)) || pot.endsWith(':0')

/**
 * Conducteurs réellement parcourus par un courant et sens de circulation.
 *
 * Le circuit (fils et contacts fermés) est traité comme un réseau de résistances égales. Chaque récepteur alimenté absorbe une
 * unité de courant sur sa borne « chaude » (L, +, début d'un secondaire) et la restitue sur sa borne de retour (N, 0 V) ; les
 * sources fournissent ce qu'il faut. On résout les lois de Kirchhoff (gradient conjugué sur le laplacien du graphe) : le courant se
 * répartit entre branches parallèles, les impasses n'en reçoivent pas, et le sens est celui du courant conventionnel
 * (source chaude → récepteur → retour).
 */
function currentFlow(doc: Doc, defs: Record<string, SymbolDef>, out: ReturnType<typeof solve>): { dir: Record<string, 1 | -1>; amps: Record<string, number> } {
  interface Edge { u: string; v: string; wire?: string }
  const edges: Edge[] = []
  for (const w of doc.wires) {
    const u = key(w.from.symId, w.from.portId)
    const v = key(w.to.symId, w.to.portId)
    if (u !== v) edges.push({ u, v, wire: w.id })
  }
  for (const [u, v] of out.swEdges) if (u !== v) edges.push({ u, v })

  const inject = new Map<string, number>() // courant extrait du réseau (négatif) ou restitué (positif) par les récepteurs
  const sourceNodes = new Set<string>()
  const add = (k: string, x: number) => inject.set(k, (inject.get(k) ?? 0) + x)
  /** un récepteur absorbe `amps` ampères sur sa borne chaude (répartis entre ses bornes chaudes) et les restitue sur le retour ; sans retour (moteur triphasé), chaque phase porte `amps` */
  const load = (symId: string, ports: string[], amps: number) => {
    const hot: string[] = []
    const cold: string[] = []
    for (const p of ports) {
      const pot = out.potOf(symId, p)
      if (!pot) continue
      ;(isHot(pot) ? hot : cold).push(key(symId, p))
    }
    if (cold.length) {
      hot.forEach((k) => add(k, -amps / hot.length))
      cold.forEach((k) => add(k, amps / cold.length))
    } else hot.forEach((k) => add(k, -amps))
  }
  const volt = (s: PlacedSymbol, ports: string[]) => {
    const pots = ports.map((p) => out.potOf(s.id, p))
    let v: number | undefined
    for (let i = 0; i < pots.length; i++) for (let j = i + 1; j < pots.length; j++) v = Math.max(v ?? 0, voltBetween(pots[i], pots[j], doc, defs) ?? 0) || v
    return v
  }
  // 1. récepteurs ordinaires : courant d'après la puissance absorbée (valeurs par défaut si non renseignée) ou le courant nominal du moteur
  const trafoVA = new Map<string, number>() // puissance appelée au secondaire de chaque transformateur
  for (const s of doc.symbols) {
    const def = defs[s.defId]
    const m = def?.sim
    if (m?.k === 'source') { for (const [p, pot] of Object.entries(m.pot)) if (pot !== 'PE') sourceNodes.add(key(s.id, p)) } // la terre ne fournit aucun courant
    else if ((m?.k === 'coil' || m?.k === 'load') && out.energized.has(s.id)) {
      const lp = m.k === 'load' && m.windings ? m.windings.map((w) => w[0]) : m.ports // moteur couplé : le courant entre par les bornes de début d'enroulement
      if (m.k === 'load' && m.role === 'motor') load(s.id, lp, motorCurrent(s, def)?.value ?? 5)
      else {
        const watts = s.rated?.watts ?? DEFAULT_WATTS[m.k === 'coil' ? 'coil' : m.role] ?? 5
        const v = (m.k === 'load' ? out.windingV[s.id] : undefined) ?? volt(s, m.ports) ?? s.volts ?? 24
        load(s.id, lp, watts / v)
        for (const p of m.ports) {
          const pot = out.potOf(s.id, p)
          if (pot?.startsWith('~')) { const tid = pot.slice(1).split(':')[0]; trafoVA.set(tid, (trafoVA.get(tid) ?? 0) + watts); break }
        }
      }
    }
  }
  // 2. primaires de transformateurs : courant déduit de la puissance appelée au secondaire
  for (const s of doc.symbols) {
    const m = defs[s.defId]?.sim
    if (m?.k !== 'transformer' || !out.trafoOn.has(s.id)) continue
    const u1 = s.voltsPrimary ?? volt(s, m.primary) ?? 230
    const k = m.primary.length >= 3 ? Math.sqrt(3) : 1
    load(s.id, m.primary, Math.max(0.02, (trafoVA.get(s.id) ?? 0) / (k * u1)))
    for (const p of m.secondary) sourceNodes.add(key(s.id, p)) // le secondaire alimente le circuit aval
  }

  // composantes connexes du graphe
  const nodes = new Map<string, number>()
  const idx = (k: string) => {
    if (!nodes.has(k)) nodes.set(k, nodes.size)
    return nodes.get(k)!
  }
  edges.forEach((e) => { idx(e.u); idx(e.v) })
  const n = nodes.size
  const names = [...nodes.keys()]
  const adj: number[][] = Array.from({ length: n }, () => [])
  edges.forEach((e, i) => { adj[nodes.get(e.u)!].push(i); adj[nodes.get(e.v)!].push(i) })
  const comp = new Array<number>(n).fill(-1)
  let nc = 0
  for (let i = 0; i < n; i++) {
    if (comp[i] >= 0) continue
    const stack = [i]
    comp[i] = nc
    while (stack.length) {
      const x = stack.pop()!
      for (const ei of adj[x]) {
        const e = edges[ei]
        const y = nodes.get(e.u) === x ? nodes.get(e.v)! : nodes.get(e.u)!
        if (comp[y] < 0) { comp[y] = nc; stack.push(y) }
      }
    }
    nc++
  }

  // second membre : récepteurs + sources (réparties à égalité dans chaque composante pour que le total s'annule)
  const b = new Array<number>(n).fill(0)
  const total = new Array<number>(nc).fill(0)
  const srcs: number[][] = Array.from({ length: nc }, () => [])
  inject.forEach((x, k) => { const i = nodes.get(k); if (i !== undefined) { b[i] += x; total[comp[i]] += x } })
  sourceNodes.forEach((k) => { const i = nodes.get(k); if (i !== undefined) srcs[comp[i]].push(i) })
  for (let c = 0; c < nc; c++) {
    if (!srcs[c].length || Math.abs(total[c]) < 1e-9) { total[c] = 0; continue }
    srcs[c].forEach((i) => (b[i] -= total[c] / srcs[c].length))
  }

  // résolution L·φ = b par gradient conjugué (L : laplacien, conductances unitaires)
  const phi = new Array<number>(n).fill(0)
  const mul = (x: number[]) => {
    const y = new Array<number>(n).fill(0)
    for (const e of edges) {
      const u = nodes.get(e.u)!
      const v = nodes.get(e.v)!
      const d = x[u] - x[v]
      y[u] += d
      y[v] -= d
    }
    return y
  }
  const r = [...b]
  const pdir = [...r]
  let rs = r.reduce((a, x) => a + x * x, 0)
  for (let it = 0; it < 400 && rs > 1e-18; it++) {
    const Ap = mul(pdir)
    const pAp = pdir.reduce((a, x, i) => a + x * Ap[i], 0)
    if (Math.abs(pAp) < 1e-30) break
    const alpha = rs / pAp
    for (let i = 0; i < n; i++) { phi[i] += alpha * pdir[i]; r[i] -= alpha * Ap[i] }
    const rs2 = r.reduce((a, x) => a + x * x, 0)
    for (let i = 0; i < n; i++) pdir[i] = r[i] + (rs2 / rs) * pdir[i]
    rs = rs2
  }

  const res: Record<string, 1 | -1> = {}
  const amps: Record<string, number> = {}
  for (const e of edges) {
    if (!e.wire) continue
    const f = phi[nodes.get(e.u)!] - phi[nodes.get(e.v)!]
    if (Math.abs(f) > 1e-4) {
      res[e.wire] = f > 0 ? 1 : -1
      amps[e.wire] = Math.abs(f)
    }
  }
  void names
  return { dir: res, amps }
}

/** Calcul complet, puis déclenchement des protections (court-circuit, surcharge) : le calcul est refait tant qu'une protection déclenche. */
export function simulate(docRaw: Doc, defsRaw: Record<string, SymbolDef>, previous: SimMemory, inp: SimInputs, now = Date.now()): SimResult {
  let res = simulateOnce(docRaw, defsRaw, previous, inp, now)
  for (let i = 0; i < 6; i++) {
    const d = detectTrips(docRaw, defsRaw, res, res.state, now)
    if (d.pendingMs !== null) res.pendingMs = Math.min(res.pendingMs ?? Infinity, d.pendingMs)
    if (!d.changed) break
    res = simulateOnce(docRaw, defsRaw, res.state, inp, now)
  }
  res.tripped = new Set(Object.keys(res.state).filter((k) => k.startsWith('§TRIP:') && res.state[k].on).map((k) => k.slice(6)))
  return res
}

function simulateOnce(docRaw: Doc, defsRaw: Record<string, SymbolDef>, previous: SimMemory, inp: SimInputs, now: number): SimResult {
  // sources réglées à une tension ou à une nature inhabituelle : potentiels suffixés (L@24)
  const { doc: docIn, defs } = withSourceVoltages(docRaw, defsRaw)
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
      if (l.startsWith('§C:') || l.startsWith('§V:') || l.startsWith('§TRIP:') || l.startsWith('§OVL:') || l.startsWith('§PS:') || l.startsWith('§PLC:')) continue // mémoire des circuits de fluide : gérée plus bas
      const on = !!out.coilOn[l]
      if (on !== (memory[l]?.on ?? false)) {
        memory[l] = { on, since: now }
        changed = true
      }
    }
    // automates : lecture des entrées sur les bornes alimentées, un scan du programme, sorties reprises au calcul suivant
    for (const s of doc.symbols) {
      const m = defs[s.defId]?.sim
      if (m?.k !== 'plc') continue
      const pl = out.potOf(s.id, m.supply[0]), pm = out.potOf(s.id, m.supply[1])
      const powered = !!pl && !!pm && pl !== pm
      const prev = memory['§PLC:' + s.id]
      if (!powered) {
        if (prev) { delete memory['§PLC:' + s.id]; changed = true }
        continue
      }
      const ins = m.inputs.map((p) => { const v = out.potOf(s.id, p); return !!v && v !== pm })
      const r = scan(s.plc ?? emptyProgram(), prev?.plc, ins, now)
      ctx.pending.push(...r.pending)
      if (!prev || JSON.stringify(prev.plc) !== JSON.stringify(r.state)) {
        memory['§PLC:' + s.id] = { on: r.state.out.some(Boolean), since: now, plc: r.state }
        changed = true
      }
    }
    // circuits de fluide : positions des distributeurs (mémorisées si bistables) et sens de déplacement des vérins
    const fl = solveFluid({ doc, defs, memory, coilOn: out.coilOn, pressed: inp.pressed, toggled: inp.toggled, now })
    for (const [id, a] of Object.entries(fl.valveA)) {
      if (a !== (memory['§V:' + id]?.on ?? false)) {
        memory['§V:' + id] = { on: a, since: now }
        changed = true
      }
    }
    for (const [lab, on] of Object.entries(fl.pswitch)) {
      const m = memory['§PS:' + lab]
      if (!m || m.on !== on) {
        memory['§PS:' + lab] = { on, since: now }
        changed = true
      }
    }
    for (const [id, dir] of Object.entries(fl.cylDir)) {
      const m = memory['§C:' + id]
      const v = dir === 0 ? 1 : Math.round((fl.cylSpeed[id] ?? 1) * 100) / 100
      if ((m?.dir ?? 0) !== dir || (dir !== 0 && (m?.v ?? 1) !== v)) {
        const f = defs[doc.symbols.find((c) => c.id === id)?.defId ?? '']?.fluid
        memory['§C:' + id] = { on: dir > 0, since: now, p: cylPos(m, now, f?.k === 'cyl' && f.single === 'pull' ? 1 : 0), dir, v }
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
    if (m?.k === 'transformer' && out.trafoOn.has(s.id)) {
      energized.add(s.id)
      // tension appliquée au primaire, comparée à la tension primaire assignée
      const pp = m.primary.map((p) => out.potOf(s.id, p))
      let vp: number | undefined
      for (let i = 0; i < pp.length; i++) for (let j = i + 1; j < pp.length; j++) vp = Math.max(vp ?? 0, voltBetween(pp[i], pp[j], doc, defs) ?? 0) || vp
      if (vp !== undefined) {
        volts[s.id] = vp
        if (s.voltsPrimary && (vp < s.voltsPrimary * 0.85 || vp > s.voltsPrimary * 1.15)) badVoltage[s.id] = { applied: vp, rated: s.voltsPrimary }
      }
    }
    if (!m || (m.k !== 'coil' && m.k !== 'load') || !out.energized.has(s.id)) continue
    const pots = m.ports.map((p) => out.potOf(s.id, p))
    let v: number | undefined
    for (let i = 0; i < pots.length; i++) for (let j = i + 1; j < pots.length; j++) v = Math.max(v ?? 0, voltBetween(pots[i], pots[j], doc, defs) ?? 0) || v
    if (m.k === 'load' && m.windings) v = out.windingV[s.id] // tension réelle aux bornes d'un enroulement (étoile : tension simple)
    if (v === undefined) continue
    volts[s.id] = v
    // un moteur à enroulements séparés accepte aussi la tension d'un démarrage en étoile : tension nominale / √3
    const starStart = m.k === 'load' && !!m.windings && !!s.volts && Math.abs(v - s.volts / Math.sqrt(3)) <= 0.07 * s.volts
    if (s.volts && !starStart && (v < s.volts * 0.85 || v > s.volts * 1.15)) badVoltage[s.id] = { applied: v, rated: s.volts }
  }
  // sens de rotation des moteurs triphasés : ordre des phases sur les trois bornes, de gauche à droite (+1 : sens direct L1-L2-L3)
  const rotation: Record<string, 1 | -1> = {}
  const PH = ['L1', 'L2', 'L3']
  for (const s of doc.symbols) {
    const m = defs[s.defId]?.sim
    if (m?.k !== 'load' || m.role !== 'motor' || !out.energized.has(s.id)) continue
    const ports = (m.windings ? m.windings.map((w) => w[0]) : m.ports).map((id) => defs[s.defId].ports.find((p) => p.id === id)).filter((p): p is NonNullable<typeof p> => !!p)
    if (ports.length !== 3) continue
    const idx = [...ports].sort((a, b) => a.x - b.x).map((p) => PH.indexOf(basePot(out.potOf(s.id, p.id) ?? '')))
    if (idx.some((i) => i < 0) || new Set(idx).size !== 3) continue
    rotation[s.id] = (idx[1] - idx[0] + 3) % 3 === 1 ? 1 : -1
  }
  // fluide : état final, positions des vérins et pression aux orifices
  const fl = solveFluid({ doc, defs, memory, coilOn: out.coilOn, pressed: inp.pressed, toggled: inp.toggled, now })
  const cyl: Record<string, number> = {}
  const fluidPending: number[] = []
  for (const s of doc.symbols) {
    const f = defs[s.defId]?.fluid
    for (const p of defs[s.defId]?.ports ?? []) if (f) {
      const pr = fl.pot(s.id, p.id)
      if (pr) potentialOf[key(s.id, p.id)] = pr
    }
    if (f?.k !== 'cyl') continue
    const m = memory['§C:' + s.id]
    const pos = cylPos(m, now, f.single === 'pull' ? 1 : 0)
    cyl[s.id] = pos
    const dir = m?.dir ?? 0
    if (dir !== 0 && pos > 0 && pos < 1) fluidPending.push(Math.max(1, ((dir > 0 ? 1 - pos : pos) * STROKE_S * 1000) / (m?.v ?? 1)), 33)
    else if (dir !== 0 && ((dir > 0 && pos <= 0) || (dir < 0 && pos >= 1))) fluidPending.push(60)
  }
  // automates : état en direct pour l'affichage, et prochaine échéance de temporisation (le scan est recalculé sans rien modifier)
  const plcLive: Record<string, PlcState> = {}
  for (const s of doc.symbols) {
    const m = defs[s.defId]?.sim
    const st = memory['§PLC:' + s.id]?.plc
    if (m?.k !== 'plc' || !st) continue
    plcLive[s.id] = st
    const pm = out.potOf(s.id, m.supply[1])
    const ins = m.inputs.map((p) => { const v = out.potOf(s.id, p); return !!v && v !== pm })
    ctx.pending.push(...scan(s.plc ?? emptyProgram(), st, ins, now).pending)
  }
  const unsupported = doc.symbols.filter((s) => !defs[s.defId]?.sim && !defs[s.defId]?.fluid && !defs[s.defId]?.decor).map((s) => s.id)
  return {
    state: memory, energized, closed: out.closed, pos3: out.pos3, rotation, tripped: new Set<string>(), potentialOf, shorts: out.shorts, unstable, unsupported,
    pendingMs: ctx.pending.length || fluidPending.length ? Math.min(...ctx.pending, ...fluidPending) : null,
    ...(() => { const f = currentFlow(doc, defs, out); return { current: f.dir, amps: f.amps } })(),
    volts,
    badVoltage,
    thermalTrip: applyDelay(memory[THERMAL], 'on', THERMAL_S, now, []),
    cylPos: cyl,
    valveA: fl.valveA,
    valveB: fl.valveB,
    plc: plcLive,
    fluidMotor: fl.motor,
    fluidInfo: fl.info,
    motorRpm: fl.rpm,
  }
}
