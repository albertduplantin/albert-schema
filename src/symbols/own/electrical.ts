import type { SymbolDef } from '../../types'
import { BG, DASH, box, circle, contacts, diamond, earth, f, line, path, poly, rect, text, type Head, type Own, type PoleMark, type PortInfo, type Pt } from './kit'

type Recipe = (def: SymbolDef, ports: PortInfo[]) => Omit<Own, 'std'> | null

const T = (fr: string, en: string) => ({ fr, en })

/** Contact(s) à lame : toutes les paires de bornes du modèle de simulation deviennent des pôles animés. */
const sw = (mark: PoleMark, head: Head, name: { fr: string; en: string }): Recipe => (def, ports) => {
  const m = def.sim
  if (m?.k !== 'switch') return null
  const c = contacts(ports, m.poles, mark, head)
  return c ? { svg: c.svg, blades: c.blades, name } : null
}

/** Fusible : rectangle traversé d'un trait, un par pôle. */
const fuse = (name: { fr: string; en: string }): Recipe => (def, ports) => {
  const m = def.sim
  if (m?.k !== 'switch') return null
  const by = new Map(ports.map((p) => [p.id, p]))
  let svg = ''
  const mids: Pt[] = []
  for (const [a, b] of m.poles) {
    const p = by.get(a), q = by.get(b)
    if (!p || !q) return null
    const [t, u] = p.y < q.y ? [p, q] : [q, p]
    const L = u.y - t.y
    const hh = Math.max(14, L * 0.5)
    const y0 = t.y + (L - hh) / 2
    svg += line([t.x, t.y], [t.x, y0]) + line([u.x, u.y], [u.x, y0 + hh]) + rect(t.x - 4, y0, 8, hh, BG) + line([t.x, y0], [t.x, y0 + hh])
    mids.push([t.x, y0 + hh / 2])
  }
  void mids
  return { svg, name }
}

/** Bobine de relais ou de contacteur : rectangle sur l'axe des bornes. */
const coil = (kind: 'plain' | 'timer' | 'ac', name: { fr: string; en: string }): Recipe => (def, ports) => {
  const [a, b] = ports.filter((p) => p.dir === 'up' || p.dir === 'down').sort((p, q) => p.y - q.y)
  if (!a || !b) return null
  const cx = a.x, cy = (a.y + b.y) / 2
  const w = 28, h = 16
  let svg = line([a.x, a.y], [cx, cy - h / 2]) + line([b.x, b.y], [cx, cy + h / 2]) + rect(cx - w / 2, cy - h / 2, w, h, BG)
  if (kind === 'timer') svg += path(`M${f(cx - 7)} ${f(cy + 3)}A7 7 0 0 1 ${f(cx + 7)} ${f(cy + 3)}`, 'fill="none"') + line([cx, cy + 3], [cx, cy - 3])
  if (kind === 'ac') svg += path(`M${f(cx - 7)} ${f(cy)}q3.5 -6 7 0t7 0`, 'fill="none"')
  return { svg, name }
}

/** Récepteur lumineux ou sonore, électrovanne : symboles simples centrés sur l'axe des bornes. */
const lamp: Recipe = (_def, ports) => {
  const [a, b] = ports.filter((p) => p.dir === 'up' || p.dir === 'down').sort((p, q) => p.y - q.y)
  if (!a || !b) return null
  const cx = a.x, cy = (a.y + b.y) / 2, r = 8
  const k = r * 0.7071
  return { svg: line([a.x, a.y], [cx, cy - r]) + line([b.x, b.y], [cx, cy + r]) + circle(cx, cy, r, BG) + line([cx - k, cy - k], [cx + k, cy + k]) + line([cx - k, cy + k], [cx + k, cy - k]), name: T('Lampe, voyant', 'Lamp, indicator light') }
}
const beacon: Recipe = (_def, ports) => {
  const [a, b] = ports.filter((p) => p.dir === 'up' || p.dir === 'down').sort((p, q) => p.y - q.y)
  if (!a || !b) return null
  const cx = a.x, cy = (a.y + b.y) / 2, r = 7
  let svg = line([a.x, a.y], [cx, cy - r]) + line([b.x, b.y], [cx, cy + r]) + circle(cx, cy, r, BG) + circle(cx, cy, 2.5, 'fill="currentColor"')
  for (let i = 0; i < 8; i++) { const t = (i * Math.PI) / 4 + Math.PI / 8; svg += line([cx + Math.cos(t) * (r + 2), cy + Math.sin(t) * (r + 2)], [cx + Math.cos(t) * (r + 5), cy + Math.sin(t) * (r + 5)]) }
  return { svg, name: T('Gyrophare', 'Rotating beacon') }
}
const solenoid: Recipe = (_def, ports) => {
  const [a, b] = ports.filter((p) => p.dir === 'up' || p.dir === 'down').sort((p, q) => p.y - q.y)
  if (!a || !b) return null
  const cx = a.x, cy = (a.y + b.y) / 2
  return { svg: line([a.x, a.y], [cx, cy - 8]) + line([b.x, b.y], [cx, cy + 8]) + rect(cx - 12, cy - 8, 24, 16, BG) + line([cx - 12, cy + 8], [cx + 12, cy - 8]), name: T('Électroaimant d’électrovanne', 'Valve solenoid') }
}

/** Moteur : cercle avec lettre et nature du courant ; une tige par borne jusqu'au cercle. */
const motor = (letter: string, kind: string, name: { fr: string; en: string }): Recipe => (def, ports) => {
  const sp = def.sim?.k === 'load' ? def.sim.spin : undefined
  const xs = ports.filter((p) => p.dir === 'up' || p.dir === 'down').map((p) => p.x)
  const cx = sp?.cx ?? (xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : def.w / 2)
  const cy = sp?.cy ?? def.h / 2 + 4
  const r = sp?.r ?? Math.min(def.w, def.h) / 2 - 8
  let svg = circle(cx, cy, r, BG)
  for (const p of ports) {
    if (p.dir === 'up' || p.dir === 'down') {
      const dx = p.x - cx
      if (Math.abs(dx) >= r * 0.98) {
        // borne en dehors du cercle : coude jusqu'au bord, à 45°
        const sx = dx < 0 ? -1 : 1, sy = p.dir === 'up' ? -1 : 1
        const e: Pt = [cx + sx * r * 0.7071, cy + sy * r * 0.7071]
        svg += path(poly([p.x, p.y], [p.x, e[1]], e), 'fill="none"')
        continue
      }
      const y = cy + (p.dir === 'up' ? -1 : 1) * Math.sqrt(r * r - dx * dx)
      svg += line([p.x, p.y], [p.x, y])
    } else {
      const dy = p.y - cy
      if (Math.abs(dy) >= r) continue
      const x = cx + (p.dir === 'left' ? -1 : 1) * Math.sqrt(r * r - dy * dy)
      svg += line([p.x, p.y], [x, p.y])
    }
  }
  svg += text(cx, cy - 1, letter, Math.max(9, r * 0.55), 'font-weight="700"') + text(cx, cy + r * 0.45, kind, Math.max(7, r * 0.32))
  return { svg, spin: { cx, cy, r }, name }
}

/** Transformateur à deux enroulements : deux cercles qui se chevauchent, bornes aux quatre coins. */
const transformer: Recipe = (def, ports) => {
  const tops = ports.filter((p) => p.dir === 'up').sort((a, b) => a.x - b.x), bots = ports.filter((p) => p.dir === 'down').sort((a, b) => a.x - b.x)
  if (tops.length !== 2 || bots.length !== 2) return null
  const cx = (tops[0].x + tops[1].x) / 2, r = Math.max(7, Math.min(9, def.h / 3.2))
  const cyT = def.h / 2 - r * 0.45, cyB = def.h / 2 + r * 0.45
  let svg = circle(cx, cyT, r, BG) + circle(cx, cyB, r, BG)
  for (const p of tops) svg += path(`M${f(p.x)} ${f(p.y)}V${f(cyT)}H${f(cx + (p.x < cx ? -r : r))}`, 'fill="none"')
  for (const p of bots) svg += path(`M${f(p.x)} ${f(p.y)}V${f(cyB)}H${f(cx + (p.x < cx ? -r : r))}`, 'fill="none"')
  return { svg, name: T('Transformateur monophasé', 'Single-phase transformer') }
}

/** Bornes : cercle sur le conducteur. */
const terminals = (name: { fr: string; en: string }): Recipe => (def, ports) => {
  const m = def.sim
  if (m?.k !== 'switch') return null
  const by = new Map(ports.map((p) => [p.id, p]))
  let svg = ''
  for (const [a, b] of m.poles) {
    const p = by.get(a), q = by.get(b)
    if (!p || !q) return null
    const cy = (p.y + q.y) / 2
    svg += line([p.x, p.y], [p.x, cy - 3.5]) + line([q.x, q.y], [q.x, cy + 3.5]) + circle(p.x, cy, 3.5, BG)
  }
  return { svg, name }
}
const earthBar: Recipe = (_def, ports) => {
  const [a, b] = ports.filter((p) => p.dir === 'up' || p.dir === 'down').sort((p, q) => p.y - q.y)
  if (!a || !b) return null
  const cy = (a.y + b.y) / 2
  return { svg: line([a.x, a.y], [b.x, b.y]) + line([a.x - 7, cy], [a.x + 7, cy], 'stroke-width="2.5"') + text(a.x + 14, cy + 3, 'PE', 7), name: T('Barrette de terre', 'Earth bar') }
}
const earthSymbol: Recipe = (_def, ports) => {
  const p = ports[0]
  return p ? { svg: earth(p.x, p.y), name: T('Terre', 'Earth') } : null
}

/** Appareils complexes : boîtier fonctionnel avec titre. */
const device = (title: string, name: { fr: string; en: string }, sub?: string, glyph?: string): Recipe => (def, ports) => ({ svg: box(def.w, def.h, ports, { title, sub, glyph }), name })
const sensor = (letter: string, name: { fr: string; en: string }): Recipe => (def, ports) => ({ svg: box(def.w, def.h, ports, { glyph: `<g transform="translate({cx} {cy})">${diamond(0, 0, 11)}${text(0, 3, letter, 9, 'font-weight="700"')}</g>` }), name })
const supply = (_kind: 'acdc' | 'dcdc', name: { fr: string; en: string }): Recipe => (def, ports) => ({
  svg: box(def.w, def.h, ports, { glyph: `<g transform="translate({cx} {cy})">${line([-14, 10], [14, -10])}${path('M-12 -7q2.5 -4 5 0t5 0', 'fill="none"')}${text(8, 9, '=', 11)}</g>` }),
  name,
})

const RECIPES: Record<string, Recipe> = {
  // relais et contacteurs
  bobine3: coil('plain', T('Bobine de relais ou de contacteur', 'Relay or contactor coil')),
  bobine_tempo_travail: coil('timer', T('Bobine temporisée à l’enclenchement', 'On-delay coil')),
  comm_courant_alter: coil('ac', T('Relais à courant alternatif', 'AC relay')),
  con_simple: sw('none', 'none', T('Contact auxiliaire à fermeture (NO)', 'Auxiliary make contact (NO)')),
  con_simple_nf: sw('nc', 'none', T('Contact auxiliaire à ouverture (NF)', 'Auxiliary break contact (NC)')),
  com_puiss4: sw('none', 'none', T('Contacts de puissance, 3 pôles', 'Power contacts, 3 poles')),
  com_puiss_3P_inv: sw('none', 'none', T('Contacteur inverseur, 3 pôles (modèle 1)', 'Reversing contactor, 3 poles (type 1)')),
  com_puiss_3P_inv2: sw('none', 'none', T('Contacteur inverseur, 3 pôles (modèle 2)', 'Reversing contactor, 3 poles (type 2)')),
  // commande
  poussoir: sw('none', 'push', T('Bouton poussoir à fermeture (NO)', 'Push button, make (NO)')),
  poussoir_nf: sw('nc', 'push', T('Bouton poussoir à ouverture (NF)', 'Push button, break (NC)')),
  '010_switch_1pos': sw('none', 'lever', T('Interrupteur', 'Switch')),
  fin_de_course_came_2_no: sw('none', 'cam', T('Fin de course à galet (NO)', 'Roller limit switch (NO)')),
  fin_course_nc: sw('nc', 'cam', T('Fin de course à galet (NF)', 'Roller limit switch (NC)')),
  'arret-urgence_no': sw('nc', 'mushroom', T('Arrêt d’urgence à coup de poing (NF)', 'Emergency stop, push-pull (NC)')),
  arret_urgence_tourner_deverouiller: sw('nc', 'rotate', T('Arrêt d’urgence à déverrouillage par rotation (NF)', 'Emergency stop, twist release (NC)')),
  // protection
  'disjonct-m_3f': sw('breaker', 'lever', T('Disjoncteur tripolaire', 'Three-pole circuit breaker')),
  'disjonct-m_3fn': sw('breaker', 'lever', T('Disjoncteur tripolaire + neutre', 'Three-pole + neutral circuit breaker')),
  'disjoncteur_magneto-thermique': sw('breaker', 'lever', T('Disjoncteur-moteur magnéto-thermique tripolaire', 'Three-pole thermal-magnetic circuit breaker')),
  'dis_mag_term_2f-2': sw('breaker', 'lever', T('Disjoncteur-moteur magnéto-thermique bipolaire', 'Two-pole thermal-magnetic circuit breaker')),
  ddr2: sw('breaker', 'lever', T('Disjoncteur différentiel bipolaire', 'Two-pole residual current breaker')),
  inter_sectionneur_tri: sw('disconnector', 'lever', T('Interrupteur-sectionneur tripolaire', 'Three-pole switch disconnector')),
  pojistka1p: fuse(T('Fusible, 1 pôle', 'Fuse, 1 pole')),
  pojistka2p: fuse(T('Fusible, 2 pôles', 'Fuse, 2 poles')),
  pojistka3p: fuse(T('Fusible, 3 pôles', 'Fuse, 3 poles')),
  // signalisation et récepteurs
  lampe2: lamp,
  gyrophare: beacon,
  electrovanne: solenoid,
  moteur_tri_2: motor('M', '3~', T('Moteur triphasé', 'Three-phase motor')),
  'jednofaz.motor': motor('M', '3~', T('Moteur asynchrone triphasé', 'Three-phase induction motor')),
  moteur_serie_tri: motor('M', '3~', T('Moteur à cage, triphasé', 'Three-phase squirrel-cage motor')),
  induction_motor_6_terminals: motor('M', '3~', T('Moteur triphasé à 6 bornes (étoile ou triangle)', 'Three-phase motor, 6 terminals (star or delta)')),
  transformator_1f_2: transformer,
  // raccordement
  borne_continuite: terminals(T('Borne', 'Terminal')),
  bornier5x: terminals(T('Bornier à 5 bornes (3P+N+PE)', '5-terminal block (3P+N+PE)')),
  barette_de_terre: earthBar,
  terre: earthSymbol,
  'wire-connector-2-port': device('', T('Connecteur à ressort, 2 voies', 'Spring connector, 2-way')),
  // appareils
  power_supply_acdc_3_pole: supply('acdc', T('Alimentation triphasée AC/DC', 'Three-phase AC/DC power supply')),
  '2080_ps120_240vac': supply('acdc', T('Alimentation AC/DC', 'AC/DC power supply')),
  ac1_ac1: device('AC / AC', T('Convertisseur alternatif monophasé', 'Single-phase AC converter')),
  servomoteur_ddc_fdc: device('SERVO', T('Servomoteur (commande tout ou rien, 2 fins de course)', 'Servomotor (on/off, two limit switches)')),
  codeur: device('CODEUR', T('Codeur incrémental', 'Incremental encoder'), 'A B Z'),
  broche_17: device('17 BROCHES', T('Connecteur circulaire à 17 broches', '17-pin circular connector')),
  carte_voyant: device('VOYANTS', T('Carte de voyants', 'Indicator card')),
  ecran_ihm_tactile_1: device('IHM', T('Terminal tactile (IHM)', 'Touch panel (HMI)'), 'tactile'),
  cart_univ_entr: device('ENTRÉES', T('Carte d’entrées universelles', 'Universal input card'), '8 voies'),
  capteur_inductif2_3: sensor('i', T('Capteur de proximité inductif, 3 fils', 'Inductive proximity sensor, 3-wire')),
  capteur_optique_no: sensor('o', T('Capteur optique', 'Optical sensor')),
  capteur_capacitif_3: sensor('c', T('Capteur de proximité capacitif, 3 fils', 'Capacitive proximity sensor, 3-wire')),
  capteur_magnetique_1: sensor('m', T('Capteur magnétique, 3 fils', 'Magnetic sensor, 3-wire')),
  capteur_pression: device('P', T('Capteur de pression', 'Pressure sensor'), 'bar'),
  sonde_temperature: device('θ', T('Sonde de température', 'Temperature probe')),
}

/** Dessin propre d'un symbole électrique de la bibliothèque, ou null s'il n'a pas (encore) de recette. */
export function ownElectrical(def: SymbolDef): Omit<Own, 'std'> | null {
  const tail = def.id.split('/').pop()!.replace(/\.elmt$/, '')
  const r = RECIPES[tail]
  if (!r) return null
  return r(def, def.ports as PortInfo[])
}

void poly
void DASH
