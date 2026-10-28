import type { PortDef, SymbolDef } from '../../types'

/**
 * Distributeurs hydrauliques courants (ISO 1219-1), tous simulables : 4/3 avec les cinq centres usuels, 4/2, 3/2 et 2/2 à commande
 * électrique ou manuelle. Orifices A et B en haut, P et T en bas (A au-dessus de P, B au-dessus de T).
 */
type Links = [string, string][]
interface Spec {
  tail: string
  fr: string
  en: string
  group: [string, string]
  ways: 2 | 3 | 4
  rest: Links
  act: Links
  actB?: Links
  a: 'elec' | 'man'
  b: 'elec' | 'spring' | 'none' | 'man'
  three?: boolean
  prop?: boolean
  manual?: 'momentary' | 'toggle'
  score: number
  top?: boolean
}

// cases usuelles d'un 4 voies
const PAR: Links = [['p', 'a'], ['b', 't']] // P→A, B→T
const CRO: Links = [['p', 'b'], ['a', 't']] // P→B, A→T

const CENTRES: { key: string; fr: string; en: string; links: Links; letter: string }[] = [
  { key: 'o', fr: 'centre fermé', en: 'closed centre', links: [], letter: 'O' },
  { key: 'h', fr: 'centre ouvert (P, A, B vers T)', en: 'open centre (P, A, B to T)', links: [['p', 't'], ['a', 't'], ['b', 't']], letter: 'H' },
  { key: 'y', fr: 'centre A et B vers T', en: 'A and B to T centre', links: [['a', 't'], ['b', 't']], letter: 'Y' },
  { key: 'm', fr: 'centre tandem (P vers T)', en: 'tandem centre (P to T)', links: [['p', 't']], letter: 'M' },
  { key: 'p', fr: 'centre P, A et B reliés (régénératif)', en: 'P, A and B connected (regenerative)', links: [['p', 'a'], ['p', 'b']], letter: 'P' },
]

const specs: Spec[] = [
  // 4/3, commande électrique des deux côtés, centrage par ressorts : gauche = croisé, droite = parallèle
  ...CENTRES.map((c, i): Spec => ({
    tail: `d43_${c.key}`, fr: `Distributeur 4/3 ${c.fr}, 2 électroaimants, ressorts`, en: `4/3 directional valve, ${c.en}, 2 solenoids, spring centred`,
    group: [`4/3 — ${c.fr.split(' (')[0]}`, `4/3 — ${c.en.split(' (')[0]}`], ways: 4, three: true, rest: c.links, act: CRO, actB: PAR, a: 'elec', b: 'elec', score: 96 - i * 3, top: i < 3,
  })),
  // 4/3 à levier (distributeur sectionnel KVM 10) et proportionnel commandé par joystick (PVG 32)
  { tail: 'd43_levier_o', fr: 'Distributeur 4/3 à levier, centre fermé, ressorts (type KVM 10)', en: '4/3 lever valve, closed centre, spring centred (KVM 10 type)', group: ['4/3 — à levier', '4/3 — lever'], ways: 4, three: true, rest: [], act: CRO, actB: PAR, a: 'man', b: 'man', score: 84 },
  { tail: 'd43_levier_m', fr: 'Distributeur 4/3 à levier, centre tandem, ressorts', en: '4/3 lever valve, tandem centre, spring centred', group: ['4/3 — à levier', '4/3 — lever'], ways: 4, three: true, rest: [['p', 't']], act: CRO, actB: PAR, a: 'man', b: 'man', score: 74 },
  { tail: 'd43_prop', fr: 'Distributeur proportionnel 4/3, centre fermé, commandé par joystick (type PVG 32)', en: 'Proportional 4/3 valve, closed centre, joystick controlled (PVG 32 type)', group: ['4/3 — proportionnel', '4/3 — proportional'], ways: 4, three: true, prop: true, rest: [], act: CRO, actB: PAR, a: 'elec', b: 'elec', score: 82 },
  // 4/2
  { tail: 'd42_ressort', fr: 'Distributeur 4/2, électroaimant et ressort', en: '4/2 directional valve, solenoid and spring return', group: ['4/2', '4/2'], ways: 4, rest: PAR, act: CRO, a: 'elec', b: 'spring', score: 94, top: true },
  { tail: 'd42_bistable', fr: 'Distributeur 4/2 bistable, 2 électroaimants (à crans)', en: '4/2 bistable directional valve, 2 solenoids (detent)', group: ['4/2', '4/2'], ways: 4, rest: PAR, act: CRO, a: 'elec', b: 'elec', score: 80 },
  { tail: 'd42_levier', fr: 'Distributeur 4/2 à levier, rappel par ressort', en: '4/2 lever valve, spring return', group: ['4/2', '4/2'], ways: 4, rest: PAR, act: CRO, a: 'man', b: 'spring', manual: 'momentary', score: 78 },
  { tail: 'd42_levier_crans', fr: 'Distributeur 4/2 à levier, à crans', en: '4/2 lever valve, detent', group: ['4/2', '4/2'], ways: 4, rest: PAR, act: CRO, a: 'man', b: 'none', manual: 'toggle', score: 70 },
  { tail: 'd42_croise', fr: 'Distributeur 4/2, croisé au repos, électroaimant et ressort', en: '4/2 directional valve, crossed at rest, solenoid and spring', group: ['4/2', '4/2'], ways: 4, rest: CRO, act: PAR, a: 'elec', b: 'spring', score: 60 },
  // 3/2
  { tail: 'd32_nf', fr: 'Distributeur 3/2 normalement fermé, électroaimant et ressort', en: '3/2 directional valve, normally closed, solenoid and spring', group: ['3/2', '3/2'], ways: 3, rest: [['a', 't']], act: [['p', 'a']], a: 'elec', b: 'spring', score: 88, top: true },
  { tail: 'd32_no', fr: 'Distributeur 3/2 normalement ouvert, électroaimant et ressort', en: '3/2 directional valve, normally open, solenoid and spring', group: ['3/2', '3/2'], ways: 3, rest: [['p', 'a']], act: [['a', 't']], a: 'elec', b: 'spring', score: 70 },
  { tail: 'd32_bistable', fr: 'Distributeur 3/2 bistable, 2 électroaimants', en: '3/2 bistable directional valve, 2 solenoids', group: ['3/2', '3/2'], ways: 3, rest: [['a', 't']], act: [['p', 'a']], a: 'elec', b: 'elec', score: 55 },
  { tail: 'd32_levier', fr: 'Distributeur 3/2 à levier, rappel par ressort', en: '3/2 lever valve, spring return', group: ['3/2', '3/2'], ways: 3, rest: [['a', 't']], act: [['p', 'a']], a: 'man', b: 'spring', manual: 'momentary', score: 60 },
  // 2/2
  { tail: 'd22_nf', fr: 'Distributeur 2/2 normalement fermé, électroaimant et ressort', en: '2/2 directional valve, normally closed, solenoid and spring', group: ['2/2', '2/2'], ways: 2, rest: [], act: [['p', 'a']], a: 'elec', b: 'spring', score: 82, top: true },
  { tail: 'd22_no', fr: 'Distributeur 2/2 normalement ouvert, électroaimant et ressort', en: '2/2 directional valve, normally open, solenoid and spring', group: ['2/2', '2/2'], ways: 2, rest: [['p', 'a']], act: [], a: 'elec', b: 'spring', score: 62 },
  { tail: 'd22_levier', fr: 'Robinet 2/2 à levier (vanne d’arrêt)', en: '2/2 lever valve (shut-off)', group: ['2/2', '2/2'], ways: 2, rest: [], act: [['p', 'a']], a: 'man', b: 'none', manual: 'toggle', score: 66 },
]

const X = (k: number) => 40 + k * 10 // A et P en x = 40, B et T en x = 50

function build(s: Spec): SymbolDef {
  const H = 40
  const ports: PortDef[] = [{ id: 'a', x: X(0), y: 0, dir: 'up' }]
  if (s.ways === 4) ports.push({ id: 'b', x: X(1), y: 0, dir: 'up' })
  ports.push({ id: 'p', x: X(0), y: H, dir: 'down' })
  if (s.ways >= 3) ports.push({ id: 't', x: X(1), y: H, dir: 'down' })
  const fluid = { k: 'valve' as const, rest: s.rest, act: s.act, a: s.a, b: s.b, three: s.three, actB: s.actB, manual: s.manual, prop: s.prop }
  return {
    id: `own:hyd/${s.tail}`, domain: 'hydraulic', prefix: 'V', name: { fr: s.fr, en: s.en }, std: 'ISO 1219-1',
    w: s.three ? 140 : 100, h: H, svg: '', ports, cat: '30_hydraulic/31_control_valves', group: { fr: s.group[0], en: s.group[1] },
    score: s.score, top: !!s.top, fluid,
  } as SymbolDef
}

export const hydValves: SymbolDef[] = specs.map(build)
