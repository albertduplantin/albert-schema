import type { Doc, Lang, PlacedSymbol, SymbolDef } from './types'
import { devKey, simulate } from './sim/engine'
import { describeInfo, transformerInfo, transformerTopology } from './transformer'

export interface Issue {
  level: 'error' | 'warn' | 'info'
  text: string
  /** conséquence d'un oubli ou d'une erreur */
  why?: string
  symId?: string
}

const S = (lang: Lang, fr: string, en: string) => (lang === 'fr' ? fr : en)
const key = (symId: string, portId: string) => `${symId}:${portId}`
const HOT = new Set(['L', 'L1', 'L2', 'L3', '+'])

interface Edge { to: string; sc: boolean; ol: boolean }

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
  const link = (a: string, b: string, sc = false, ol = false) => {
    if (!adj.has(a)) adj.set(a, [])
    if (!adj.has(b)) adj.set(b, [])
    adj.get(a)!.push({ to: b, sc, ol })
    adj.get(b)!.push({ to: a, sc, ol })
  }
  for (const w of doc.wires) link(key(w.from.symId, w.from.portId), key(w.to.symId, w.to.portId))
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
      const sc = /10_fuses|11_circuit_breakers|12_magneto/.test(id)
      const ol = /30_thermal_relays|11_circuit_breakers|12_magneto/.test(id)
      for (const [a, b] of m.poles) link(key(s.id, a), key(s.id, b), sc, ol)
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
    if (m?.k !== 'switch' || !rest || !/10_fuses|11_circuit_breakers|12_magneto|20_disconnecting/.test(def.id)) continue
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

  return out
}
