import type { Doc, Lang, PlacedSymbol, Ratings, SymbolDef, Wire } from './types'
import { simulate } from './sim/engine'
import { DEFAULT_WATTS, motorCurrent } from './sim/estimate'
import { RATINGS, transformerInfo } from './transformer'
import { CABLE_MAX_PROTECTION, kindOf } from './ratings'
import { COIL_INRUSH_FACTOR, TRAFO_VA, contactorFor, rangeFor, typicalMotorCurrent } from './catalog'

/** Conseil de réglage pour un champ : valeur proposée, explication, et valeurs associées à appliquer en même temps. */
export interface Suggestion {
  value: number | string
  text: string
  also?: Ratings
}
export type Advice = Partial<Record<keyof Ratings | 'volts' | 'power' | 'voltsPrimary', Suggestion>>

const S = (lang: Lang, fr: string, en: string) => (lang === 'fr' ? fr : en)
const key = (symId: string, portId: string) => `${symId}:${portId}`
const HOT = new Set(['L', 'L1', 'L2', 'L3', '+'])
const fmt = (lang: Lang, x: number) => String(x).replace('.', lang === 'fr' ? ',' : '.')
const upTo = (x: number) => RATINGS.find((r) => r >= x) ?? RATINGS[RATINGS.length - 1]

interface Edge { to: string; sym?: string; wire?: string; prot: boolean }
interface Graph {
  adj: Map<string, Edge[]>
  dist: Map<string, number>
  byId: Map<string, PlacedSymbol>
}

/** Graphe du câblage (fils, pôles des appareils) et distance de chaque borne aux sources chaudes. */
function buildGraph(doc: Doc, defs: Record<string, SymbolDef>): Graph {
  const adj = new Map<string, Edge[]>()
  const link = (a: string, b: string, e: Omit<Edge, 'to'>) => {
    for (const k of [a, b]) if (!adj.has(k)) adj.set(k, [])
    adj.get(a)!.push({ to: b, ...e })
    adj.get(b)!.push({ to: a, ...e })
  }
  const origins: string[] = []
  for (const w of doc.wires) link(key(w.from.symId, w.from.portId), key(w.to.symId, w.to.portId), { wire: w.id, prot: false })
  for (const s of doc.symbols) {
    const m = defs[s.defId]?.sim
    if (m?.k === 'source') for (const [p, pot] of Object.entries(m.pot)) { if (HOT.has(pot)) origins.push(key(s.id, p)) }
    else if (m?.k === 'transformer' && m.secondary[0]) origins.push(key(s.id, m.secondary[0]))
    else if (m?.k === 'switch') {
      const id = defs[s.defId].id
      const prot = /10_fuses|11_circuit_breakers|12_magneto/.test(id) || (/50_residual/.test(id) && /^Disjoncteur/i.test(defs[s.defId].name.fr))
      for (const [a, b] of m.poles) link(key(s.id, a), key(s.id, b), { sym: s.id, prot })
      for (const [c, nc, no] of m.changeover ?? []) { link(key(s.id, c), key(s.id, nc), { sym: s.id, prot: false }); link(key(s.id, c), key(s.id, no), { sym: s.id, prot: false }) }
    }
  }
  const dist = new Map<string, number>()
  origins.forEach((k) => dist.set(k, 0))
  const queue = [...origins]
  for (let i = 0; i < queue.length; i++) for (const e of adj.get(queue[i]) ?? []) if (!dist.has(e.to)) { dist.set(e.to, dist.get(queue[i])! + 1); queue.push(e.to) }
  return { adj, dist, byId: new Map(doc.symbols.map((s) => [s.id, s])) }
}

interface Load { sym: PlacedSymbol; amps: number; motor: boolean; coil: boolean; resistive: boolean; watts: number }

/** Récepteurs situés en aval des bornes `starts` (on ne remonte jamais vers les sources) avec leur courant estimé. */
function loadsDownstream(g: Graph, doc: Doc, defs: Record<string, SymbolDef>, starts: string[]): Load[] {
  const seen = new Set(starts)
  const stack = [...starts]
  const found = new Map<string, Load>()
  const consider = (n: string) => {
    const id = n.split(':')[0]
    if (found.has(id)) return
    const s = g.byId.get(id)
    const def = s && defs[s.defId]
    const m = def?.sim
    if (!s || !m) return
    if (m.k === 'load' && m.role === 'motor') {
      const mc = motorCurrent(s, def)
      found.set(id, { sym: s, amps: mc?.value ?? 5, motor: true, coil: false, resistive: false, watts: 0 })
    } else if (m.k === 'coil' || m.k === 'load') {
      const watts = s.rated?.watts ?? DEFAULT_WATTS[m.k === 'coil' ? 'coil' : m.role] ?? 5
      found.set(id, { sym: s, amps: watts / (s.volts ?? 24), motor: false, coil: m.k === 'coil', resistive: m.k === 'load' && (m.role === 'heater' || m.role === 'lamp'), watts })
    } else if (m.k === 'transformer') {
      const info = transformerInfo(s, def)
      found.set(id, { sym: s, amps: info.in1 ?? 0.05, motor: false, coil: false, resistive: false, watts: s.power ?? 0 })
    }
  }
  while (stack.length) {
    const n = stack.pop()!
    consider(n)
    for (const e of g.adj.get(n) ?? []) {
      if ((g.dist.get(e.to) ?? -1) <= (g.dist.get(n) ?? 0) || seen.has(e.to)) continue
      seen.add(e.to)
      stack.push(e.to)
    }
  }
  return [...found.values()]
}

/** Bornes aval d'un appareil à pôles (le côté le plus éloigné des sources). */
function downstreamPorts(g: Graph, s: PlacedSymbol, def: SymbolDef): string[] {
  const m = def.sim
  if (m?.k !== 'switch') return []
  return m.poles.map(([a, b]) => ((g.dist.get(key(s.id, a)) ?? 0) >= (g.dist.get(key(s.id, b)) ?? 0) ? key(s.id, a) : key(s.id, b)))
}

/**
 * Conseils de réglage d'un appareil d'après le circuit dessiné (récepteurs en aval, tensions) et les gammes des constructeurs.
 * Un conseil n'est proposé que si le logiciel dispose de ce qu'il faut pour le calculer.
 */
export function settingsAdvice(s: PlacedSymbol, doc: Doc, defs: Record<string, SymbolDef>, lang: Lang): Advice {
  const def = defs[s.defId]
  const kind = kindOf(def)
  const out: Advice = {}
  if (!def) return out
  const m = def.sim
  const g = buildGraph(doc, defs)

  if (kind === 'motor') {
    const kw = s.rated?.kw
    if (kw && !s.rated?.ie) {
      const t = typicalMotorCurrent(kw)
      if (t) out.ie = { value: t, text: S(lang, `Courant type d'un moteur de ${fmt(lang, kw)} kW en 400 V : ${fmt(lang, t)} A (catalogues). Relevez la valeur exacte sur la plaque signalétique.`, `Typical current of a ${fmt(lang, kw)} kW motor at 400 V: ${fmt(lang, t)} A (catalogues). Read the exact value from the nameplate.`) }
    }
    out.cos = { value: 0.85, text: S(lang, 'Valeur courante pour un moteur de 1 à 22 kW à pleine charge (0,8 à 0,9). La plaque donne la valeur exacte.', 'Usual value for a 1–22 kW motor at full load (0.8 to 0.9). The nameplate gives the exact value.') }
    out.ratio = { value: 7, text: S(lang, 'Démarrage direct d’un moteur asynchrone : 5 à 8 fois le courant nominal ; 7 est la valeur usuelle.', 'Direct-on-line start of an induction motor: 5 to 8 times the rated current; 7 is the usual value.') }
    return out
  }
  if (kind === 'consumer' && m && (m.k === 'coil' || m.k === 'load')) {
    const role = m.k === 'coil' ? 'coil' : m.role
    const w = DEFAULT_WATTS[role]
    if (w) out.watts = {
      value: w,
      text: m.k === 'coil'
        ? S(lang, `Bobine de contacteur 9 à 18 A : environ ${w} VA au maintien (et ${w * COIL_INRUSH_FACTOR} VA à l’appel). Voir la fiche du constructeur.`, `9–18 A contactor coil: about ${w} VA holding (and ${w * COIL_INRUSH_FACTOR} VA inrush). See the manufacturer's datasheet.`)
        : S(lang, `Valeur courante pour ce type de récepteur : ${w} W. Voir la fiche du constructeur.`, `Usual value for this type of load: ${w} W. See the manufacturer's datasheet.`),
    }
    // tension assignée : celle réellement appliquée en simulation au repos
    try {
      const r = simulate(doc, defs, {}, { pressed: new Set(), toggled: new Set() }, 0)
      const v = r.volts[s.id]
      if (v && s.volts !== v) out.volts = { value: v, text: S(lang, `Tension appliquée à ce récepteur : ${v} V. Choisissez une bobine ou une lampe assignée à cette tension.`, `Voltage applied to this load: ${v} V. Choose a coil or lamp rated for that voltage.`) }
    } catch { /* schéma incomplet */ }
    return out
  }

  if (m?.k === 'transformer') {
    const secLoads = loadsDownstream(g, doc, defs, [key(s.id, m.secondary[0])]).filter((l) => l.sym.id !== s.id)
    const hold = secLoads.reduce((a, l) => a + l.watts, 0)
    const coilMax = Math.max(0, ...secLoads.filter((l) => l.coil).map((l) => l.watts))
    if (hold > 0) {
      // puissance de maintien de tous les récepteurs + surcroît d'appel du plus gros contacteur, avec 20 % de marge
      const need = (hold + coilMax * (COIL_INRUSH_FACTOR - 1)) * 1.2
      const va = TRAFO_VA.find((v) => v >= need) ?? TRAFO_VA[TRAFO_VA.length - 1]
      out.power = { value: va, text: S(lang, `Récepteurs du secondaire : ${fmt(lang, Math.round(hold))} VA au maintien, ${fmt(lang, Math.round(hold + coilMax * (COIL_INRUSH_FACTOR - 1)))} VA à l’appel d’un contacteur. Avec 20 % de marge : transformateur de ${va} VA (gamme courante).`, `Secondary loads: ${fmt(lang, Math.round(hold))} VA holding, ${fmt(lang, Math.round(hold + coilMax * (COIL_INRUSH_FACTOR - 1)))} VA with one contactor pulling in. With a 20 % margin: ${va} VA transformer (standard range).`) }
    }
    const volts = secLoads.map((l) => l.sym.volts).filter((v): v is number => !!v)
    if (volts.length) {
      const common = volts.sort((a, b) => volts.filter((v) => v === b).length - volts.filter((v) => v === a).length)[0]
      if (common !== s.volts) out.volts = { value: common, text: S(lang, `Les bobines et voyants du secondaire sont assignés à ${common} V : réglez le secondaire sur cette tension.`, `The coils and lamps on the secondary are rated ${common} V: set the secondary to that voltage.`) }
    }
    try {
      const r = simulate(doc, defs, {}, { pressed: new Set(), toggled: new Set() }, 0)
      const v = r.volts[s.id]
      if (v && !s.voltsPrimary) out.voltsPrimary = { value: v > 300 ? 400 : 230, text: S(lang, `Le primaire est branché sur ${v} V (${v > 300 ? 'entre deux phases' : 'phase et neutre'}) : choisissez un primaire de ${v > 300 ? 400 : 230} V.`, `The primary is connected to ${v} V (${v > 300 ? 'between two phases' : 'phase to neutral'}): choose a ${v > 300 ? 400 : 230} V primary.`) }
    } catch { /* schéma incomplet */ }
    return out
  }

  if (!kind || m?.k !== 'switch') return out
  const loads = loadsDownstream(g, doc, defs, downstreamPorts(g, s, def))
  const motors = loads.filter((l) => l.motor)
  const sumMotor = motors.reduce((a, l) => a + l.amps, 0)
  const others = loads.filter((l) => !l.motor)
  const hasTrafo = others.some((l) => l.sym && defs[l.sym.defId]?.sim?.k === 'transformer')

  if (kind === 'contactor' && motors.length) {
    const c = contactorFor(sumMotor)
    if (c) out.in = { value: c[0], text: S(lang, `Moteur de ${fmt(lang, sumMotor)} A : contacteur ${c[0]} A en AC-3 (gamme courante, jusqu’à ${fmt(lang, c[1])} kW en 400 V). À choisir en catégorie AC-3 et non AC-1.`, `${fmt(lang, sumMotor)} A motor: ${c[0]} A AC-3 contactor (standard range, up to ${fmt(lang, c[1])} kW at 400 V). Choose it in category AC-3, not AC-1.`) }
  }
  if ((kind === 'thermal' || kind === 'motorBreaker') && motors.length) {
    const i = Math.max(...motors.map((l) => l.amps))
    const r = rangeFor(i)
    out.set = { value: i, text: S(lang, `Réglage sur le courant de plaque du moteur : ${fmt(lang, i)} A.`, `Set to the motor nameplate current: ${fmt(lang, i)} A.`) }
    if (r) {
      out.min = { value: r[0], text: S(lang, `Plage de constructeur contenant ${fmt(lang, i)} A : ${fmt(lang, r[0])}–${fmt(lang, r[1])} A.`, `Manufacturer range containing ${fmt(lang, i)} A: ${fmt(lang, r[0])}–${fmt(lang, r[1])} A.`), also: { max: r[1] } }
      out.max = { value: r[1], text: S(lang, `Plage de constructeur contenant ${fmt(lang, i)} A : ${fmt(lang, r[0])}–${fmt(lang, r[1])} A.`, `Manufacturer range containing ${fmt(lang, i)} A: ${fmt(lang, r[0])}–${fmt(lang, r[1])} A.`), also: { min: r[0] } }
      if (kind === 'motorBreaker') out.in = { value: r[1], text: S(lang, `Calibre de la gamme choisie : ${fmt(lang, r[1])} A.`, `Rating of the chosen range: ${fmt(lang, r[1])} A.`) }
    }
    if (kind === 'thermal') out.curve = { value: '10', text: S(lang, 'Classe 10 : la plus courante (démarrage normal, moins de 10 s). Classe 20 pour les démarrages longs (ventilateurs, pompes lourdes).', 'Class 10: the most common (normal start, under 10 s). Class 20 for long starts (fans, heavy pumps).') }
  }
  if (kind === 'fuse' || kind === 'breaker' || kind === 'motorBreaker' || kind === 'rcd') {
    const fuse = kind === 'fuse'
    if (motors.length) {
      const rating = upTo(sumMotor)
      if (kind !== 'motorBreaker') out.in = { value: rating, text: S(lang, `Départ moteur de ${fmt(lang, sumMotor)} A : calibre ${rating} A, protégeant contre les courts-circuits (la surcharge est confiée au relais thermique).`, `${fmt(lang, sumMotor)} A motor feeder: ${rating} A rating, protecting against short circuits (overload is left to the thermal relay).`) }
      out.curve = { value: fuse ? 'aM' : 'D', text: fuse ? S(lang, 'aM (accompagnement moteur) : supporte le courant de démarrage ; à associer à un relais thermique.', 'aM (motor back-up): withstands the starting current; pair it with a thermal relay.') : S(lang, 'Courbe D (10 à 20 × In) : supporte le courant de démarrage d’un moteur.', 'D curve (10–20 × In): withstands a motor starting current.') }
    } else if (hasTrafo) {
      const t = others.find((l) => defs[l.sym.defId]?.sim?.k === 'transformer')!
      const info = transformerInfo(t.sym, defs[t.sym.defId])
      if (info.prot1) {
        out.in = { value: info.prot1, text: S(lang, `Primaire du transformateur ${t.sym.label || ''} (${fmt(lang, info.in1 ?? 0)} A) : calibre ${fmt(lang, info.prot1)} A au minimum, 1,25 × In.`, `Transformer ${t.sym.label || ''} primary (${fmt(lang, info.in1 ?? 0)} A): at least ${fmt(lang, info.prot1)} A rating, 1.25 × In.`) }
        out.curve = { value: fuse ? 'aM' : 'D', text: S(lang, 'Courbe D ou fusible aM : le courant d’enclenchement d’un transformateur atteint 10 à 15 × In.', 'D curve or aM fuse: a transformer inrush reaches 10–15 × In.') }
      }
    } else if (others.length) {
      const ib = others.reduce((a, l) => a + l.amps, 0)
      const rating = upTo(Math.max(ib * 1.25, 0.5))
      out.in = { value: rating, text: S(lang, `Circuit de commande de ${fmt(lang, Math.round(ib * 1000) / 1000)} A : calibre ${fmt(lang, rating)} A (1,25 × le courant d’emploi, valeur normalisée immédiatement supérieure).`, `Control circuit of ${fmt(lang, Math.round(ib * 1000) / 1000)} A: ${fmt(lang, rating)} A rating (1.25 × the load current, next standard value).`) }
      const resistive = others.every((l) => l.resistive)
      out.curve = { value: fuse ? 'gG' : resistive ? 'B' : 'C', text: fuse ? S(lang, 'gG : usage général, protège contre surcharges et courts-circuits.', 'gG: general purpose, protects against overloads and short circuits.') : resistive ? S(lang, 'Courbe B (3 à 5 × In) : récepteurs résistifs et câbles longs.', 'B curve (3–5 × In): resistive loads and long cables.') : S(lang, 'Courbe C (5 à 10 × In) : usage général, bobines et petits récepteurs.', 'C curve (5–10 × In): general purpose, coils and small loads.') }
    }
    out.icu = { value: 10, text: S(lang, 'Valeur usuelle en installation industrielle : 10 kA (6 kA en résidentiel, 15 à 25 kA près d’un transformateur de distribution). Elle doit dépasser le courant de court-circuit présumé à cet endroit.', 'Usual value in industrial installations: 10 kA (6 kA residential, 15–25 kA near a distribution transformer). It must exceed the prospective short-circuit current here.') }
  }
  if (kind === 'rcd' || (kind === 'breaker' && /50_residual/.test(def.id))) {
    out.idn = { value: 30, text: S(lang, '30 mA : protection des personnes contre les contacts directs. 300 mA pour la protection contre l’incendie en tête d’installation ; 10 mA pour les locaux à risque.', '30 mA: protection of people against direct contact. 300 mA for fire protection at the head of the installation; 10 mA for high-risk areas.') }
  }
  return out
}

/** Section de conducteur conseillée d'après le calibre de la protection placée en amont. */
export function wireSectionAdvice(w: Wire, doc: Doc, defs: Record<string, SymbolDef>, lang: Lang): Suggestion | undefined {
  const g = buildGraph(doc, defs)
  const start = key(w.from.symId, w.from.portId)
  const d0 = g.dist.get(start)
  if (d0 === undefined) return undefined
  // protection la plus proche en remontant vers les sources
  const seen = new Set([start])
  const stack = [start]
  let best: number | undefined
  while (stack.length) {
    const n = stack.pop()!
    for (const e of g.adj.get(n) ?? []) {
      if ((g.dist.get(e.to) ?? Infinity) >= (g.dist.get(n) ?? Infinity) || seen.has(e.to)) continue
      seen.add(e.to)
      const dev = e.sym ? g.byId.get(e.sym) : undefined
      if (e.prot && dev?.rated?.in) best = Math.min(best ?? Infinity, dev.rated.in)
      stack.push(e.to)
    }
  }
  if (!best) return undefined
  const sec = CABLE_MAX_PROTECTION.find(([, a]) => a >= best!)?.[0]
  if (!sec) return undefined
  return { value: String(sec).replace('.', lang === 'fr' ? ',' : '.'), text: S(lang, `Protégé en amont par ${fmt(lang, best)} A : section minimale usuelle ${fmt(lang, sec)} mm² en cuivre (règle Ib ≤ In ≤ Iz).`, `Protected upstream by ${fmt(lang, best)} A: usual minimum cross-section ${fmt(lang, sec)} mm² copper (rule Ib ≤ In ≤ Iz).`) }
}
