import type { Doc, Lang, PlacedSymbol, Ratings, SymbolDef } from './types'
import { devKey, simulate } from './sim/engine'
import { RATINGS, describeInfo, transformerInfo, transformerTopology } from './transformer'
import { kindOf, maxProtection, motorCurrent, parseSection } from './ratings'

export interface Issue {
  level: 'error' | 'warn' | 'info'
  text: string
  /** conséquence d'un oubli ou d'une erreur */
  why?: string
  symId?: string
  /** correction proposée : valeurs à appliquer aux caractéristiques d'un appareil */
  fix?: { symId: string; rated: Ratings }
}

const S = (lang: Lang, fr: string, en: string) => (lang === 'fr' ? fr : en)
const key = (symId: string, portId: string) => `${symId}:${portId}`
const HOT = new Set(['L', 'L1', 'L2', 'L3', '+'])

interface Edge { to: string; sc: boolean; ol: boolean; sym?: string; wire?: string }

/**
 * Conseils de conception : protections manquantes et leurs conséquences.
 * On suit le câblage depuis chaque récepteur (moteur, bobine, lampe, primaire de transformateur) vers les sources « chaudes »
 * (phases, +24 V, secondaire de transformateur) et on cherche un chemin qui évite toute protection :
 *  - contre les courts-circuits : fusibles, disjoncteurs ;
 *  - contre les surcharges : relais thermiques, disjoncteurs magnéto-thermiques.
 * Les contacts, contacteurs, boutons et bornes laissent passer ; un transformateur sépare ses deux côtés.
 */
export function adviseDoc(doc: Doc, defs: Record<string, SymbolDef>, lang: Lang): Issue[] {
  const out: Issue[] = []
  // état au repos (aucun organe manœuvré) : potentiels présents sur chaque borne, tensions appliquées
  let rest: ReturnType<typeof simulate> | null = null
  try { rest = simulate(doc, defs, {}, { pressed: new Set(), toggled: new Set() }, 0) } catch { /* schéma incomplet */ }
  const nm = (s: PlacedSymbol) => s.label || defs[s.defId]?.name[lang] || '?'
  const adj = new Map<string, Edge[]>()
  const link = (a: string, b: string, sc = false, ol = false, sym?: string, wire?: string) => {
    if (!adj.has(a)) adj.set(a, [])
    if (!adj.has(b)) adj.set(b, [])
    adj.get(a)!.push({ to: b, sc, ol, sym, wire })
    adj.get(b)!.push({ to: a, sc, ol, sym, wire })
  }
  for (const w of doc.wires) link(key(w.from.symId, w.from.portId), key(w.to.symId, w.to.portId), false, false, undefined, w.id)
  const origins = new Map<string, PlacedSymbol>() // borne chaude → symbole qui l'alimente (source ou transformateur)
  for (const s of doc.symbols) {
    const m = defs[s.defId]?.sim
    if (!m) continue
    const id = defs[s.defId].id
    if (m.k === 'source') {
      for (const [p, pot] of Object.entries(m.pot)) if (HOT.has(pot)) origins.set(key(s.id, p), s)
    } else if (m.k === 'transformer') {
      if (m.secondary[0]) origins.set(key(s.id, m.secondary[0]), s)
    } else if (m.k === 'switch') {
      const rcbo = /50_residual_current_circuit_breaker/.test(id) && /^Disjoncteur/i.test(defs[s.defId].name.fr) // disjoncteur différentiel : protège aussi contre les surintensités
      const sc = /10_fuses|11_circuit_breakers|12_magneto/.test(id) || rcbo
      const ol = /30_thermal_relays|11_circuit_breakers|12_magneto/.test(id) || rcbo
      for (const [a, b] of m.poles) link(key(s.id, a), key(s.id, b), sc, ol, s.id)
      for (const [com, nc, no] of m.changeover ?? []) { link(key(s.id, com), key(s.id, nc)); link(key(s.id, com), key(s.id, no)) }
    }
  }

  /** Premier symbole d'origine atteint depuis `start` sans traverser de protection `ban` ; null s'il n'y en a pas. */
  const reach = (starts: string[], ban: 'sc' | 'ol' | null): PlacedSymbol | null => {
    const seen = new Set(starts)
    const stack = [...starts]
    while (stack.length) {
      const n = stack.pop()!
      const o = origins.get(n)
      if (o) return o
      for (const e of adj.get(n) ?? []) {
        if (ban && e[ban]) continue
        if (!seen.has(e.to)) { seen.add(e.to); stack.push(e.to) }
      }
    }
    return null
  }
  const portsOf = (s: PlacedSymbol, ports: string[]) => ports.map((p) => key(s.id, p)).filter((k) => adj.has(k))

  // ── appareils « phase + neutre » (1P+N, 3P+N, porte-fusible P+N) montés sur des conducteurs de phase : le pôle neutre n'est pas protégé
  const PHASES = new Set(['L', 'L1', 'L2', 'L3'])
  for (const s of doc.symbols) {
    const def = defs[s.defId]
    const m = def?.sim
    if (m?.k !== 'switch' || !rest || !/10_fuses|11_circuit_breakers|12_magneto|20_disconnecting|50_residual_current_circuit_breaker/.test(def.id)) continue
    if (!/1 pole protege|\+ ?neutre|P\+N|\+ ?N\b/i.test(def.name.fr + ' ' + def.name.en)) continue
    const pots = m.poles.map(([a, b]) => rest!.potentialOf[key(s.id, a)] ?? rest!.potentialOf[key(s.id, b)] ?? null)
    const phases = [...new Set(pots.filter((p): p is string => !!p && PHASES.has(p)))]
    const phasePoles = pots.filter((p) => !!p && PHASES.has(p)).length
    const allowed = Math.max(1, m.poles.length - 1)
    if (phasePoles > allowed) out.push({
      level: 'error', symId: s.id,
      text: S(lang,
        `${nm(s)} est un appareil « phase + neutre » mais il est monté sur ${phasePoles} conducteurs de phase (${phases.join(' et ')}) : il n'est pas adapté. Choisissez un appareil bipolaire (tous les pôles protégés), ou reliez une des deux phases à la terre pour en faire un neutre.`,
        `${nm(s)} is a “phase + neutral” device but it sits on ${phasePoles} phase conductors (${phases.join(' and ')}): it is not suitable. Choose a double-pole device (all poles protected), or tie one of the two phases to earth to make it a neutral.`),
      why: S(lang,
        'Le pôle « neutre » n’a pas de déclencheur : l’une des phases n’est ni protégée contre les surcharges et courts-circuits, ni coupée correctement. Un défaut sur ce conducteur reste sans protection : échauffement, risque d’incendie, ou conducteur resté sous tension (400 V) après ouverture.',
        'The “neutral” pole has no trip unit: one of the phases is neither protected against overloads and short circuits nor properly disconnected. A fault on that conductor goes unprotected: overheating, fire risk, or a conductor left live (400 V) after opening.'),
    })
  }

  // ── moteurs : protection contre les courts-circuits et les surcharges, terre, inversion
  const controlGaps = new Map<string, PlacedSymbol[]>() // origine → récepteurs de commande non protégés
  for (const s of doc.symbols) {
    const m = defs[s.defId]?.sim
    if (m?.k === 'load' && m.role === 'motor') {
      const ps = portsOf(s, m.ports)
      if (reach(ps, null)) {
        if (reach(ps, 'sc')) out.push({
          level: 'error', symId: s.id,
          text: S(lang, `Moteur ${nm(s)} : aucune protection contre les courts-circuits en amont (fusible ou disjoncteur).`, `Motor ${nm(s)}: no short-circuit protection upstream (fuse or circuit breaker).`),
          why: S(lang, 'Un court-circuit dans le moteur ou le câble n’est coupé par rien : échauffement des conducteurs, risque d’incendie, contacts du contacteur soudés.', 'A short circuit in the motor or cable is cleared by nothing: overheated conductors, fire risk, welded contactor contacts.'),
        })
        if (reach(ps, 'ol')) out.push({
          level: 'warn', symId: s.id,
          text: S(lang, `Moteur ${nm(s)} : aucune protection contre les surcharges (relais thermique ou disjoncteur-moteur).`, `Motor ${nm(s)}: no overload protection (thermal relay or motor circuit breaker).`),
          why: S(lang, 'En cas de surcharge, de blocage ou de perte d’une phase, le moteur chauffe jusqu’à brûler ses enroulements.', 'On overload, a locked rotor or a lost phase the motor heats up until its windings burn out.'),
        })
      }
      const pe = defs[s.defId].ports.find((p) => /^PE$/i.test(p.label ?? ''))
      if (pe && !adj.has(key(s.id, pe.id))) out.push({
        level: 'warn', symId: s.id,
        text: S(lang, `Moteur ${nm(s)} : la borne de terre (PE) n’est pas reliée.`, `Motor ${nm(s)}: the earth terminal (PE) is not connected.`),
        why: S(lang, 'En cas de défaut d’isolement, la carcasse reste sous tension : risque d’électrisation et, sans courant de défaut vers la terre, aucune protection ne déclenche.', 'On an insulation fault the frame stays live: electric shock risk, and with no fault current to earth no protection trips.'),
      })
      // inversion de sens : deux contacteurs de puissance sur le même moteur sans verrouillage
      const power = new Set<string>()
      for (const p of ps) for (const e of adj.get(p) ?? []) {
        const sym = doc.symbols.find((x) => x.id === e.to.split(':')[0])
        const sm = sym && defs[sym.defId]?.sim
        if (sym && sm?.k === 'switch' && sm.ctl === 'coil' && /02_power_contacts/.test(defs[sym.defId].id) && sym.label) power.add(devKey(sym.label))
      }
      if (power.size >= 2) {
        const nc = new Set(doc.symbols.filter((x) => { const sm = defs[x.defId]?.sim; return sm?.k === 'switch' && sm.ctl === 'coil' && sm.nc && !/02_power_contacts/.test(defs[x.defId].id) && !!x.label }).map((x) => devKey(x.label)))
        const missing = [...power].filter((k) => !nc.has(k))
        if (missing.length) out.push({
          level: 'error', symId: s.id,
          text: S(lang, `Moteur ${nm(s)} alimenté par plusieurs contacteurs sans verrouillage électrique (contact NF de chacun dans la commande de l’autre).`, `Motor ${nm(s)} fed by several contactors without electrical interlock (an NC contact of each in the other's control).`),
          why: S(lang, 'Si les deux contacteurs se ferment ensemble, deux phases sont court-circuitées : fusion des contacts, déclenchement de la protection, risque d’arc.', 'If both contactors close together two phases are short-circuited: melted contacts, tripped protection, arc risk.'),
        })
      }
    }
  }

  // ── transformateurs : protection du primaire et du secondaire, calibres conseillés, mise à la terre
  const topo = transformerTopology(doc, defs)
  for (const s of doc.symbols) {
    const m = defs[s.defId]?.sim
    if (m?.k !== 'transformer') continue
    const info = transformerInfo(s, defs[s.defId])
    const prim = portsOf(s, m.primary)
    if (prim.length && reach(prim, null) && reach(prim, 'sc')) out.push({
      level: 'error', symId: s.id,
      text: S(lang, `Transformateur ${nm(s)} : primaire sans protection (fusible ou disjoncteur).`, `Transformer ${nm(s)}: unprotected primary (fuse or circuit breaker).`) + (info.prot1 ? S(lang, ` Calibre conseillé : ${info.prot1} A.`, ` Suggested rating: ${info.prot1} A.`) : ''),
      why: S(lang, 'Un court-circuit au primaire ou dans les enroulements n’est coupé que par la protection générale, trop forte : échauffement, risque d’incendie, destruction du transformateur.', 'A short circuit in the primary or windings is only cleared by the upstream protection, which is too large: overheating, fire risk, destroyed transformer.'),
    })
    describeInfo(info, lang).forEach((line) => out.push({ level: 'info', symId: s.id, text: `${nm(s)} : ${line}` }))
    if (!s.power) out.push({
      level: 'info', symId: s.id,
      text: S(lang, `Transformateur ${nm(s)} : renseignez sa puissance (VA) pour obtenir les courants et les protections conseillées.`, `Transformer ${nm(s)}: enter its power (VA) to get the currents and suggested protection.`),
    })
    if (m.secondary.length === 2 && !topo.earthed[s.id]) out.push({
      level: 'info', symId: s.id,
      text: S(lang, `Transformateur ${nm(s)} : secondaire isolé de la terre.`, `Transformer ${nm(s)}: secondary isolated from earth.`),
      why: S(lang, 'Un premier défaut d’isolement passe inaperçu ; un second défaut peut provoquer un démarrage ou une marche intempestive. Relier un conducteur à la terre (il devient le neutre) ou installer un contrôleur d’isolement (EN 60204-1).', 'A first insulation fault goes unnoticed; a second one can cause an unexpected start. Tie one conductor to earth (it becomes the neutral) or fit an insulation monitor (EN 60204-1).'),
    })
  }

  // ── circuits de commande (bobines, voyants…) : protection contre les courts-circuits
  for (const s of doc.symbols) {
    const m = defs[s.defId]?.sim
    if (!m || !((m.k === 'coil') || (m.k === 'load' && m.role !== 'motor'))) continue
    const ps = portsOf(s, m.ports)
    if (!reach(ps, null)) continue
    const o = reach(ps, 'sc')
    if (!o) continue
    const k = o.id
    if (!controlGaps.has(k)) controlGaps.set(k, [])
    controlGaps.get(k)!.push(s)
  }
  for (const [oid, list] of controlGaps) {
    const o = doc.symbols.find((x) => x.id === oid)!
    const names = [...new Set(list.map((x) => nm(x)))].slice(0, 4).join(', ') + (list.length > 4 ? '…' : '')
    const fromTrafo = defs[o.defId]?.sim?.k === 'transformer'
    const info = fromTrafo ? transformerInfo(o, defs[o.defId]) : undefined
    out.push({
      level: 'warn', symId: list[0].id,
      text: fromTrafo
        ? S(lang, `Secondaire du transformateur ${nm(o)} sans protection (${names}).`, `Secondary of transformer ${nm(o)} unprotected (${names}).`) + (info?.prot2 ? S(lang, ` Calibre conseillé : ${info.prot2} A.`, ` Suggested rating: ${info.prot2} A.`) : '')
        : S(lang, `Circuit de commande sans protection (${names}).`, `Control circuit unprotected (${names}).`),
      why: fromTrafo
        ? S(lang, 'Un court-circuit côté commande ne serait vu que par la protection du primaire, calibrée pour le transformateur : les conducteurs fins de la commande chauffent avant qu’elle ne déclenche.', 'A control-side short circuit would only be seen by the primary protection, sized for the transformer: thin control wiring overheats before it trips.')
        : S(lang, 'Un court-circuit dans la commande n’est coupé qu’en amont par une protection trop forte pour des conducteurs de faible section : échauffement, risque d’incendie. Ajoutez un fusible ou un disjoncteur dédié.', 'A control-circuit short circuit is only cleared upstream by a protection too large for small-section wiring: overheating, fire risk. Add a dedicated fuse or breaker.'),
    })
  }

  // ── tension du primaire d'un transformateur : indiquée, et adaptée au réseau (deux phases = 400 V, phase + neutre = 230 V)
  if (rest) {
    for (const s of doc.symbols) {
      if (defs[s.defId]?.sim?.k !== 'transformer') continue
      const applied = rest.volts[s.id]
      if (!applied || rest.badVoltage[s.id]) continue
      if (!s.voltsPrimary) out.push({
        level: 'warn', symId: s.id,
        text: S(lang, `Transformateur ${nm(s)} : tension primaire non renseignée (${applied} V appliqués, ${applied > 300 ? 'entre deux phases' : 'entre phase et neutre'}).`, `Transformer ${nm(s)}: primary voltage not set (${applied} V applied, ${applied > 300 ? 'between two phases' : 'phase to neutral'}).`),
        why: S(lang, 'Sans la tension assignée, le logiciel ne peut pas vérifier que le transformateur convient au réseau.', 'Without the rated voltage the software cannot check that the transformer suits the supply.'),
      })
    }
  }

  // ── tensions incompatibles au repos (primaire de transformateur, bobines, voyants)
  if (rest) {
    const r = rest
    for (const [id, v] of Object.entries(r.badVoltage)) {
      const s = doc.symbols.find((x) => x.id === id)
      if (!s) continue
      const isT = defs[s.defId]?.sim?.k === 'transformer'
      if (isT) {
        const twoPhases = v.applied > 300
        const ratio = v.applied / v.rated
        const sec = s.volts ? Math.round(s.volts * ratio) : undefined
        out.push({
          level: 'error', symId: id,
          text: twoPhases
            ? S(lang, `Transformateur ${nm(s)} : primaire ${v.rated} V branché sur deux phases (${v.applied} V). Choisissez un transformateur à primaire ${v.applied} V (ou à primaires multiples 230/400 V câblé en 400 V), ou branchez-le entre phase et neutre.`, `Transformer ${nm(s)}: ${v.rated} V primary connected across two phases (${v.applied} V). Choose a ${v.applied} V primary transformer (or a dual-primary 230/400 V wired for 400 V), or connect it phase to neutral.`)
            : S(lang, `Transformateur ${nm(s)} : primaire ${v.rated} V branché sur ${v.applied} V. Choisissez un transformateur dont le primaire correspond à la tension du réseau.`, `Transformer ${nm(s)}: ${v.rated} V primary connected to ${v.applied} V. Choose a transformer whose primary matches the supply voltage.`),
          why: v.applied > v.rated
            ? S(lang, `Surtension de ${Math.round((ratio - 1) * 100)} % : le circuit magnétique sature, le transformateur chauffe et peut être détruit en quelques minutes${sec ? ` ; le secondaire délivre ${sec} V au lieu de ${s.volts} V, ce qui grille les bobines et les voyants` : ''}.`, `${Math.round((ratio - 1) * 100)} % overvoltage: the core saturates, the transformer overheats and can be destroyed within minutes${sec ? `; the secondary delivers ${sec} V instead of ${s.volts} V, burning out coils and lamps` : ''}.`)
            : S(lang, `Sous-tension de ${Math.round((1 - ratio) * 100)} %${sec ? ` : le secondaire ne délivre que ${sec} V au lieu de ${s.volts} V` : ''}, les bobines ne collent pas franchement : contacts qui vibrent, chauffent et se soudent.`, `${Math.round((1 - ratio) * 100)} % undervoltage${sec ? `: the secondary only delivers ${sec} V instead of ${s.volts} V` : ''}, coils do not pull in cleanly: chattering, overheating, welding contacts.`),
        })
        continue
      }
      out.push({
        level: 'error', symId: id,
        text: S(lang, `${nm(s)} : ${v.applied} V appliqués, ${v.rated} V assignés${isT ? ' (primaire)' : ''}.`, `${nm(s)}: ${v.applied} V applied, ${v.rated} V rated${isT ? ' (primary)' : ''}.`),
        why: v.applied > v.rated
          ? S(lang, 'Surtension : bobine ou lampe grillée, transformateur saturé qui chauffe.', 'Overvoltage: burnt-out coil or lamp, saturated transformer overheating.')
          : S(lang, 'Sous-tension : la bobine ne colle pas franchement (contacts qui vibrent et chauffent), le récepteur ne fonctionne pas.', 'Undervoltage: the coil does not pull in cleanly (chattering, overheating contacts), the load does not work.'),
      })
    }
  }

  // ── caractéristiques assignées : calibres, réglages, sections de câbles, bilan de puissance
  const fmt = (x: number) => String(x).replace('.', lang === 'fr' ? ',' : '.')
  const byId = new Map(doc.symbols.map((x) => [x.id, x]))
  const dist = new Map<string, number>()
  {
    const queue = [...origins.keys()]
    queue.forEach((k) => dist.set(k, 0))
    for (let i = 0; i < queue.length; i++) {
      for (const e of adj.get(queue[i]) ?? []) if (!dist.has(e.to)) { dist.set(e.to, dist.get(queue[i])! + 1); queue.push(e.to) }
    }
  }
  /** appareils traversés en remontant vers les sources depuis `starts` */
  const upstream = (starts: string[]): PlacedSymbol[] => {
    const seen = new Set(starts)
    const stack = [...starts]
    const found = new Set<string>()
    while (stack.length) {
      const n = stack.pop()!
      for (const e of adj.get(n) ?? []) {
        if ((dist.get(e.to) ?? Infinity) >= (dist.get(n) ?? Infinity)) continue
        if (e.sym) found.add(e.sym)
        if (!seen.has(e.to)) { seen.add(e.to); stack.push(e.to) }
      }
    }
    return [...found].map((id) => byId.get(id)).filter((x): x is PlacedSymbol => !!x)
  }

  // moteurs : courant nominal et appareils en amont
  for (const s of doc.symbols) {
    const def = defs[s.defId]
    const m = def?.sim
    if (m?.k !== 'load' || m.role !== 'motor') continue
    const ps = portsOf(s, m.ports)
    const ups = upstream(ps)
    const mc = motorCurrent(s, def)
    if (!mc) {
      if (ups.length) out.push({ level: 'info', symId: s.id, text: S(lang, `Moteur ${nm(s)} : renseignez sa puissance (kW) ou son courant nominal pour contrôler les calibres et les réglages des protections.`, `Motor ${nm(s)}: enter its power (kW) or rated current to check protection ratings and settings.`) })
      continue
    }
    const In = mc.value
    for (const d of ups) {
      const k = kindOf(defs[d.defId])
      const r = d.rated
      if (!k || !r) continue
      if ((k === 'thermal' || k === 'motorBreaker' || k === 'breaker') && r.set) {
        if (r.set > In * 1.1) out.push({ level: 'error', symId: d.id, text: S(lang, `${nm(d)} : réglage thermique ${fmt(r.set)} A pour le moteur ${nm(s)} de ${fmt(In)} A : trop élevé, le moteur n'est plus protégé.`, `${nm(d)}: thermal setting ${fmt(r.set)} A for motor ${nm(s)} rated ${fmt(In)} A: too high, the motor is no longer protected.`), why: S(lang, 'Le relais ne déclenche qu’après une surcharge importante : les enroulements chauffent au-delà de leur limite et vieillissent vite ou brûlent.', 'The relay only trips after a large overload: windings overheat beyond their limit and age fast or burn out.') })
        else if (r.set < In * 0.95) out.push({ level: 'warn', symId: d.id, text: S(lang, `${nm(d)} : réglage thermique ${fmt(r.set)} A inférieur au courant nominal du moteur ${nm(s)} (${fmt(In)} A).`, `${nm(d)}: thermal setting ${fmt(r.set)} A below the rated current of motor ${nm(s)} (${fmt(In)} A).`), why: S(lang, 'Déclenchements intempestifs en marche normale : arrêts de production. Le réglage se fait sur le courant de la plaque signalétique.', 'Nuisance tripping in normal operation: production stops. The setting should match the nameplate current.') })
      }
      if ((k === 'thermal' || k === 'motorBreaker') && r.min && r.max && (In < r.min - 1e-9 || In > r.max + 1e-9)) out.push({ level: 'warn', symId: d.id, text: S(lang, `${nm(d)} : plage de réglage ${fmt(r.min)}–${fmt(r.max)} A ne couvre pas le courant du moteur ${nm(s)} (${fmt(In)} A).`, `${nm(d)}: setting range ${fmt(r.min)}–${fmt(r.max)} A does not cover motor ${nm(s)} current (${fmt(In)} A).`), why: S(lang, 'Le réglage correct est impossible : choisissez un appareil dont la plage contient le courant nominal, de préférence vers le milieu.', 'The correct setting is impossible: choose a device whose range contains the rated current, preferably near the middle.') })
      if ((k === 'fuse' || k === 'breaker') && r.in && r.in < In) out.push({ level: 'error', symId: d.id, text: S(lang, `${nm(d)} : calibre ${fmt(r.in)} A inférieur au courant nominal du moteur ${nm(s)} (${fmt(In)} A).`, `${nm(d)}: rating ${fmt(r.in)} A below motor ${nm(s)} rated current (${fmt(In)} A).`), why: S(lang, 'La protection déclenche en marche normale, et plus encore au démarrage (courant de 5 à 8 fois le courant nominal).', 'The protection trips in normal operation, and even more at start-up (5 to 8 times the rated current).') })
      if (k === 'breaker' && r.curve && /^[BC]$/i.test(r.curve.trim())) out.push({ level: 'warn', symId: d.id, text: S(lang, `${nm(d)} : courbe ${r.curve.toUpperCase()} pour le moteur ${nm(s)} : le courant de démarrage risque de la faire déclencher.`, `${nm(d)}: ${r.curve.toUpperCase()} curve for motor ${nm(s)}: the starting current may trip it.`), why: S(lang, 'Un moteur appelle 5 à 8 fois son courant nominal au démarrage : utilisez une courbe D, un fusible aM, ou un disjoncteur-moteur.', 'A motor draws 5 to 8 times its rated current at start-up: use a D curve, an aM fuse, or a motor circuit breaker.') })
      if (k === 'contactor' && r.in && r.in < In) out.push({ level: 'error', symId: d.id, text: S(lang, `${nm(d)} : courant assigné AC-3 ${fmt(r.in)} A inférieur au courant du moteur ${nm(s)} (${fmt(In)} A).`, `${nm(d)}: AC-3 rated current ${fmt(r.in)} A below motor ${nm(s)} current (${fmt(In)} A).`), why: S(lang, 'Contacteur sous-dimensionné : contacts qui s’usent vite, chauffent et finissent par se souder (le moteur ne s’arrête plus).', 'Undersized contactor: contacts wear fast, overheat and eventually weld (the motor no longer stops).') })
    }
  }

  // câbles : le calibre de la protection ne doit pas dépasser ce que supporte le conducteur (Ib ≤ In ≤ Iz)
  const warned = new Set<string>()
  for (const d of doc.symbols) {
    const def = defs[d.defId]
    const k = kindOf(def)
    const m = def?.sim
    if ((k !== 'fuse' && k !== 'breaker') || m?.k !== 'switch' || !d.rated?.in) continue
    for (const [a, b] of m.poles) {
      const ka = key(d.id, a), kb = key(d.id, b)
      const start = (dist.get(ka) ?? 0) >= (dist.get(kb) ?? 0) ? ka : kb // côté aval
      const seen = new Set([start])
      const stack = [start]
      while (stack.length) {
        const n = stack.pop()!
        for (const e of adj.get(n) ?? []) {
          if ((dist.get(e.to) ?? -1) <= (dist.get(n) ?? 0) || seen.has(e.to)) continue
          if (e.sc && e.sym !== d.id) continue // la protection suivante prend le relais
          seen.add(e.to)
          stack.push(e.to)
          const w = e.wire ? doc.wires.find((x) => x.id === e.wire) : undefined
          const sec = parseSection(w?.section)
          const max = sec ? maxProtection(sec) : undefined
          if (w && sec && max && d.rated.in > max && !warned.has(w.id + d.id)) {
            warned.add(w.id + d.id)
            out.push({
              level: 'error', symId: d.id,
              text: S(lang, `Conducteur de ${fmt(sec)} mm² protégé par ${nm(d)} de ${fmt(d.rated.in)} A (maximum usuel ${max} A pour cette section).`, `${fmt(sec)} mm² conductor protected by ${nm(d)} of ${fmt(d.rated.in)} A (usual maximum ${max} A for this cross-section).`),
              why: S(lang, 'Le conducteur peut chauffer au-delà de sa limite sans que la protection ne déclenche : isolant fondu, risque d’incendie. Augmentez la section ou réduisez le calibre.', 'The conductor can overheat beyond its limit without the protection tripping: melted insulation, fire risk. Increase the cross-section or reduce the rating.'),
            })
          }
        }
      }
    }
  }

  // suggestions applicables en un clic : réglages et calibres conseillés pour les appareils dont la caractéristique n'est pas renseignée
  const AC3 = [6, 9, 12, 18, 25, 32, 40, 50, 65, 80, 95]
  const suggested = new Set<string>()
  const suggest = (d: PlacedSymbol, rated: Ratings, text: string) => {
    const k = d.id + JSON.stringify(rated)
    if (suggested.has(k)) return
    suggested.add(k)
    out.push({ level: 'info', symId: d.id, text, fix: { symId: d.id, rated } })
  }
  const upTo = (x: number) => RATINGS.find((r) => r >= x) ?? RATINGS[RATINGS.length - 1]
  for (const s of doc.symbols) {
    const def = defs[s.defId]
    const m = def?.sim
    if (m?.k !== 'load' || m.role !== 'motor') continue
    const mc = motorCurrent(s, def)
    if (!mc) continue
    for (const d of upstream(portsOf(s, m.ports))) {
      const k = kindOf(defs[d.defId])
      const r = d.rated
      if ((k === 'thermal' || k === 'motorBreaker') && !r?.set) suggest(d, { set: mc.value }, S(lang, `${nm(d)} : réglage thermique conseillé ${fmt(mc.value)} A (courant nominal du moteur ${nm(s)}).`, `${nm(d)}: suggested thermal setting ${fmt(mc.value)} A (rated current of motor ${nm(s)}).`))
      if ((k === 'fuse' || k === 'breaker') && !r?.in) suggest(d, { in: upTo(mc.value), curve: k === 'fuse' ? 'aM' : 'D' }, S(lang, `${nm(d)} : calibre conseillé ${upTo(mc.value)} A, ${k === 'fuse' ? 'type aM' : 'courbe D'} (moteur ${nm(s)} de ${fmt(mc.value)} A).`, `${nm(d)}: suggested rating ${upTo(mc.value)} A, ${k === 'fuse' ? 'aM type' : 'D curve'} (motor ${nm(s)} of ${fmt(mc.value)} A).`))
      if (k === 'contactor' && !r?.in) { const a = AC3.find((v) => v >= mc.value) ?? AC3[AC3.length - 1]; suggest(d, { in: a }, S(lang, `${nm(d)} : courant assigné AC-3 conseillé ${a} A (moteur ${nm(s)} de ${fmt(mc.value)} A).`, `${nm(d)}: suggested AC-3 rating ${a} A (motor ${nm(s)} of ${fmt(mc.value)} A).`)) }
    }
  }
  for (const s of doc.symbols) {
    const m = defs[s.defId]?.sim
    if (m?.k !== 'transformer') continue
    const info = transformerInfo(s, defs[s.defId])
    for (const d of upstream(portsOf(s, m.primary))) {
      const k = kindOf(defs[d.defId])
      if (info.prot1 && (k === 'fuse' || k === 'breaker') && !d.rated?.in) suggest(d, { in: info.prot1, curve: k === 'fuse' ? 'aM' : 'D' }, S(lang, `${nm(d)} : calibre conseillé ${fmt(info.prot1)} A, ${k === 'fuse' ? 'type aM' : 'courbe D'} (primaire de ${nm(s)}).`, `${nm(d)}: suggested rating ${fmt(info.prot1)} A, ${k === 'fuse' ? 'aM type' : 'D curve'} (primary of ${nm(s)}).`))
    }
    const hot0 = key(s.id, m.secondary[0])
    const seen0 = new Set([hot0])
    const st = [hot0]
    while (st.length) {
      const n = st.pop()!
      for (const e of adj.get(n) ?? []) {
        if ((dist.get(e.to) ?? -1) <= (dist.get(n) ?? 0) || seen0.has(e.to)) continue
        seen0.add(e.to)
        const d = e.sym ? byId.get(e.sym) : undefined
        if (d && e.sc) {
          const k = kindOf(defs[d.defId])
          if (info.prot2 && (k === 'fuse' || k === 'breaker') && !d.rated?.in) suggest(d, { in: info.prot2, curve: k === 'fuse' ? 'gG' : 'C' }, S(lang, `${nm(d)} : calibre conseillé ${fmt(info.prot2)} A (secondaire de ${nm(s)}).`, `${nm(d)}: suggested rating ${fmt(info.prot2)} A (secondary of ${nm(s)}).`))
        } else st.push(e.to)
      }
    }
  }

  // transformateurs : calibres des protections et bilan de puissance
  for (const s of doc.symbols) {
    const m = defs[s.defId]?.sim
    if (m?.k !== 'transformer') continue
    const info = transformerInfo(s, defs[s.defId])
    for (const d of upstream(portsOf(s, m.primary))) {
      const k = kindOf(defs[d.defId])
      const r = d.rated
      if (!r || (k !== 'fuse' && k !== 'breaker')) continue
      if (info.in1 && r.in && r.in < info.in1) out.push({ level: 'error', symId: d.id, text: S(lang, `${nm(d)} : calibre ${fmt(r.in)} A inférieur au courant primaire de ${nm(s)} (${fmt(info.in1)} A).`, `${nm(d)}: rating ${fmt(r.in)} A below the primary current of ${nm(s)} (${fmt(info.in1)} A).`), why: S(lang, 'Elle déclenche en marche normale, et à chaque mise sous tension (courant d’enclenchement de 10 à 15 fois In).', 'It trips in normal operation, and at every power-up (inrush of 10 to 15 times In).') })
      if (info.prot1 && r.in && r.in > info.prot1 * 4) out.push({ level: 'warn', symId: d.id, text: S(lang, `${nm(d)} : calibre ${fmt(r.in)} A très supérieur au courant primaire de ${nm(s)} (${fmt(info.in1 ?? 0)} A, conseillé ${fmt(info.prot1)} A).`, `${nm(d)}: rating ${fmt(r.in)} A far above the primary current of ${nm(s)} (${fmt(info.in1 ?? 0)} A, suggested ${fmt(info.prot1)} A).`), why: S(lang, 'Une surcharge ou un court-circuit du transformateur ne fera pas déclencher cette protection : échauffement.', 'An overload or short circuit of the transformer will not trip this protection: overheating.') })
      if (r.curve && /^B$/i.test(r.curve.trim())) out.push({ level: 'warn', symId: d.id, text: S(lang, `${nm(d)} : courbe B devant le transformateur ${nm(s)} : le courant d’enclenchement risque de la faire déclencher (préférez D ou un fusible aM).`, `${nm(d)}: B curve in front of transformer ${nm(s)}: inrush may trip it (prefer D or an aM fuse).`) })
    }
    // protection du secondaire : premier appareil rencontré en descendant depuis la phase du secondaire
    const hot = key(s.id, m.secondary[0])
    const seen = new Set([hot])
    const stack = [hot]
    while (stack.length) {
      const n = stack.pop()!
      for (const e of adj.get(n) ?? []) {
        if ((dist.get(e.to) ?? -1) <= (dist.get(n) ?? 0) || seen.has(e.to)) continue
        seen.add(e.to)
        const d = e.sym ? byId.get(e.sym) : undefined
        if (d && e.sc && d.rated?.in && info.in2 && d.rated.in > info.in2 * 1.25 && !warned.has('s' + d.id)) {
          warned.add('s' + d.id)
          out.push({ level: 'warn', symId: d.id, text: S(lang, `${nm(d)} : calibre ${fmt(d.rated.in)} A supérieur au courant secondaire de ${nm(s)} (${fmt(info.in2)} A).`, `${nm(d)}: rating ${fmt(d.rated.in)} A above the secondary current of ${nm(s)} (${fmt(info.in2)} A).`), why: S(lang, 'Le transformateur peut être surchargé sans que la protection du secondaire ne déclenche.', 'The transformer can be overloaded without the secondary protection tripping.') })
        }
        if (!(d && e.sc)) stack.push(e.to)
      }
    }
    // puissance appelée par les récepteurs du secondaire
    if (s.power) {
      let total = 0
      let counted = 0
      for (const l of doc.symbols) {
        const lm = defs[l.defId]?.sim
        if (!l.rated?.watts || !lm || !(lm.k === 'coil' || (lm.k === 'load' && lm.role !== 'motor'))) continue
        const o = reach(portsOf(l, lm.ports), null)
        if (o?.id === s.id) { total += l.rated.watts; counted++ }
      }
      if (counted) {
        if (total > s.power) out.push({ level: 'error', symId: s.id, text: S(lang, `Transformateur ${nm(s)} (${fmt(s.power)} VA) surchargé : ${counted} récepteur${counted > 1 ? 's' : ''} absorbent ${fmt(total)} VA.`, `Transformer ${nm(s)} (${fmt(s.power)} VA) overloaded: ${counted} load${counted > 1 ? 's' : ''} draw ${fmt(total)} VA.`), why: S(lang, 'Le transformateur chauffe, sa tension de sortie s’effondre : les bobines ne collent plus. Prévoyez aussi l’appel des bobines à la fermeture, plusieurs fois supérieur au courant maintenu.', 'The transformer overheats and its output voltage collapses: coils no longer pull in. Also allow for coil inrush on closing, several times the holding current.') })
        else if (total > s.power * 0.8) out.push({ level: 'warn', symId: s.id, text: S(lang, `Transformateur ${nm(s)} chargé à ${Math.round((total / s.power) * 100)} % (${fmt(total)} VA sur ${fmt(s.power)} VA) : peu de marge.`, `Transformer ${nm(s)} loaded at ${Math.round((total / s.power) * 100)} % (${fmt(total)} VA of ${fmt(s.power)} VA): little margin.`), why: S(lang, 'L’appel de courant des bobines à la fermeture peut faire chuter la tension du secondaire et empêcher le contacteur de coller.', 'Coil inrush on closing can pull the secondary voltage down and prevent the contactor from pulling in.') })
      }
    }
  }

  return out
}
