import type { Doc, PlacedSymbol, Ratings, Wire } from './types'
import { SYMBOL_MAP } from './symbols'
import { uid } from './geometry'

export type Spec = [key: string, defId: string, x: number, y: number, label?: string, delay?: number, volts?: number]
export type Link = [from: string, fromPort: string, to: string, toPort: string]

export function build(base: Doc, specs: Spec[], links: Link[]): Doc {
  const ids: Record<string, string> = {}
  const counters: Record<string, number> = {}
  const symbols: PlacedSymbol[] = specs.map(([key, defId, x, y, label, delay, volts]) => {
    const prefix = SYMBOL_MAP[defId].prefix
    ids[key] = uid()
    if (label === undefined) {
      counters[prefix] = (counters[prefix] ?? 0) + 1
      label = prefix ? prefix + counters[prefix] : ''
    }
    return { id: ids[key], defId, x, y, rot: 0, label, desc: '', ...(delay === undefined ? {} : { delay }), ...(volts === undefined ? {} : { volts }) }
  })
  const wires: Wire[] = links.map(([a, ap, b, bp]) => ({
    id: uid(), from: { symId: ids[a], portId: ap }, to: { symId: ids[b], portId: bp }, label: '', color: '#000000', section: '',
  }))
  return { ...base, symbols, wires }
}

const Q = (p: string) => 'qet:10_electric/10_allpole/' + p
const P = (p: string) => 'qet:50_pneumatic/' + p

/**
 * Départ moteur avec circuit de commande : marche/arrêt à auto-maintien.
 * Puissance : L1-L2-L3 → disjoncteur-moteur Q1 → contacteur KM1 → moteur M1.
 * Commande : L → arrêt S1 (NF) → marche S2 (NO, shuntée par le contact KM1) → bobine KM1 → N.
 */
const motorStarterRaw = (base: Doc): Doc =>
  build(base,
    [
      ['l1', 'sim-l1', 120, 30], ['l2', 'sim-l2', 140, 30], ['l3', 'sim-l3', 160, 30],
      ['q', Q('200_fuses_protective_gears/11_circuit_breakers/disjonct-m_3f'), 120, 100, 'Q1'],
      ['k', Q('310_relays_contactors_contacts/02_contacts_cross_referencing/02_power_contacts/com_puiss4'), 120, 200, 'KM1'],
      ['m', Q('391_consumers_actuators/10_engines/moteur_tri_2'), 120, 320, 'M1'],
      ['pem', Q('110_network_supplies/terre'), 200, 390, ''],
      ['lc', 'sim-l', 400, 30],
      ['s1', Q('380_signaling_operating/20_push_buttons/poussoir_nf'), 400, 100, 'S1'],
      ['s2', Q('380_signaling_operating/20_push_buttons/poussoir'), 400, 200, 'S2'],
      ['ka', Q('310_relays_contactors_contacts/02_contacts_cross_referencing/01_auxiliary_contacts/con_simple'), 470, 170, 'KM1'],
      ['c', Q('310_relays_contactors_contacts/01_coils/bobine3'), 390, 320, 'KM1'],
      ['h', Q('380_signaling_operating/11_optical_signaling/lampe2'), 550, 300, 'H1'],
      ['n', 'sim-n', 400, 420],
    ],
    [
      ['l1', 'a', 'q', 't5'], ['l2', 'a', 'q', 't4'], ['l3', 'a', 'q', 't3'],
      ['q', 't1', 'k', 't0'], ['q', 't0', 'k', 't2'], ['q', 't2', 'k', 't4'],
      ['k', 't1', 'm', 't0'], ['k', 't3', 'm', 't2'], ['k', 't5', 'm', 't1'], ['m', 't3', 'pem', 't0'],
      ['lc', 'a', 's1', 't0'], ['s1', 't1', 's2', 't0'], ['s1', 't1', 'ka', 't0'],
      ['s2', 't1', 'c', 't0'], ['ka', 't1', 'c', 't0'], ['c', 't1', 'n', 'a'],
      ['h', 't0', 'c', 't0'], ['h', 't1', 'n', 'a'],
    ])

const FV = (p: string) => P('5020_velves/502010_control/50201060_5_2_way/' + p)
const CYL = P('5030_actuators/503010_cylinder_lin/50301011_double_acting/5030101100_double_effet')
const SRC = P('5010_compressed_air/501010_air_generation/50101000_compressed_air_source')

/** Partie pneumatique commune : source d'air, distributeur 5/2 (valve = identifiant du symbole), vérin A1 (les échappements du distributeur portent leur silencieux). */
const pneuPart = (valve: string, valveLabel: string, ports: { b: string; a: string; r1: string; p: string; r2: string }): [Spec[], Link[]] => [
  [
    ['a1', CYL, 180, 90, 'A1'],
    ['v', valve, 200, 230, valveLabel],
    ['src', SRC, 250, 330, ''],
  ],
  [
    ['v', ports.b, 'a1', 't0'], ['v', ports.a, 'a1', 't1'],
    ['v', ports.p, 'src', 't0'],
  ],
]

/** Vérin double effet commandé par un distributeur 5/2 à commande manuelle : cliquer sur le distributeur en simulation. */
export const pneumaticCylinder = (base: Doc): Doc => {
  const [s, l] = pneuPart(FV('5020106030_man_mech/502010603010_5_2_way'), 'V1', { b: 't4', a: 't1', r1: 't2', p: 't3', r2: 't0' })
  return build(base, s, l)
}

/** Électro-pneumatique : S1 alimente la bobine YV1 de l'électrodistributeur ; le fin de course A1+ allume H1 vérin sorti. */
export const pneumaticElectric = (base: Doc): Doc => {
  const [s, l] = pneuPart(FV('5020106020_elec/502010602010_5_2_way_010'), 'YV1', { b: 't3', a: 't1', r1: 't0', p: 't4', r2: 't2' })
  return build(base,
    [
      ...s,
      ['l', 'sim-l', 480, 40], ['s1', Q('380_signaling_operating/21_selector_switches/010_switch_1pos'), 480, 110, 'S1'],
      ['y', Q('310_relays_contactors_contacts/01_coils/bobine3'), 470, 210, 'YV1'], ['n', 'sim-n', 480, 310],
      ['l2', 'sim-l', 600, 40], ['lm', Q('390_sensors_instruments/41_limit_switches/fin_de_course_came_2_no'), 600, 110, 'A1+'],
      ['h', Q('380_signaling_operating/11_optical_signaling/lampe2'), 600, 210, 'H1'], ['n2', 'sim-n', 600, 310],
    ],
    [
      ...l,
      ['l', 'a', 's1', 't0'], ['s1', 't1', 'y', 't0'], ['y', 't1', 'n', 'a'],
      ['l2', 'a', 'lm', 't0'], ['lm', 't1', 'h', 't0'], ['h', 't1', 'n2', 'a'],
    ])
}

/** Va-et-vient automatique A+ A- : électrodistributeur bistable (YV1 sort, YV2 rentre) piloté par les fins de course A1- et A1+. */
export const pneumaticAuto = (base: Doc): Doc => {
  const [s, l] = pneuPart(FV('5020106020_elec/502010602030_5_2_way_030'), 'YV1/YV2', { b: 't3', a: 't0', r1: 't4', p: 't2', r2: 't1' })
  const LS = Q('390_sensors_instruments/41_limit_switches/fin_de_course_came_2_no')
  return build(base,
    [
      ...s,
      ['l', 'sim-l', 480, 40], ['s2', Q('380_signaling_operating/20_push_buttons/poussoir'), 480, 100, 'S2'], ['m1', LS, 480, 180, 'A1-'],
      ['y1', Q('310_relays_contactors_contacts/01_coils/bobine3'), 470, 260, 'YV1'], ['n', 'sim-n', 480, 350],
      ['l2', 'sim-l', 620, 40], ['m2', LS, 620, 150, 'A1+'], ['y2', Q('310_relays_contactors_contacts/01_coils/bobine3'), 610, 260, 'YV2'], ['n2', 'sim-n', 620, 350],
    ],
    [
      ...l,
      ['l', 'a', 's2', 't0'], ['s2', 't1', 'm1', 't0'], ['m1', 't1', 'y1', 't0'], ['y1', 't1', 'n', 'a'],
      ['l2', 'a', 'm2', 't0'], ['m2', 't1', 'y2', 't0'], ['y2', 't1', 'n2', 'a'],
    ])
}

/**
 * Cycle A+ B+ A- B- commandé par un automate programmable (Grafcet), écrit comme dans les sujets d'examen : deux vérins repérés 1A et 2A,
 * deux distributeurs 5/2 bistables 1V1 et 2V1 dont les bobines sont 1YV14 / 1YV12 (A+ / A-) et 2YV14 / 2YV12 (B+ / B-),
 * détecteurs de position 1S1 1S2 (vérin A) et 2S1 2S2 (vérin B), bouton de départ de cycle S1. Les mnémoniques du programme sont les repères des organes.
 */
export const pneumaticPlc = (base: Doc): Doc => {
  const V52 = FV('5020106020_elec/502010602030_5_2_way_030')
  const LS = Q('390_sensors_instruments/41_limit_switches/ils_no') // détecteurs à lame souple (ILS) posés sur les vérins
  const COIL = Q('391_consumers_actuators/20_valves/electrovanne') // électrovannes du distributeur (symbole d'électroaimant)
  const PB = Q('380_signaling_operating/20_push_buttons/poussoir')
  const chain = (n: number, x: number, cyl: string): [Spec[], Link[]] => {
    const [s, l] = pneuPart(V52, `${n}V1`, { b: 't3', a: 't0', r1: 't4', p: 't2', r2: 't1' })
    // pneuPart pose un seul circuit : on le décale et on le renomme pour chaque vérin (le circuit pneumatique est dessiné deux fois).
    const k = (key: string) => `${key}${n}`
    return [
      s.filter((e) => e[0] !== 'src').map(([key, def, px, py, label]) => [k(key), def, px + x, py - 30, key === 'a1' ? cyl : label] as Spec),
      l.filter(([a, , b]) => a !== 'src' && b !== 'src').map(([a, ap, b, bp]) => [k(a), ap, k(b), bp] as Link),
    ]
  }
  const [s1, l1] = chain(1, 0, '1A')
  const [s2, l2] = chain(2, 280, '2A')
  const d = build(base,
    [...s1, ...s2, ['air', SRC, 330, 420, ''],
      ['es', 'sim-src1', 700, 40], ['b', PB, 640, 120, 'S1'],
      ['d11', LS, 720, 120, '1S1'], ['d12', LS, 800, 120, '1S2'], ['d21', LS, 880, 120, '2S1'], ['d22', LS, 960, 120, '2S2'],
      ['p', 'plc-8e8s-relay', 700, 330, 'API1'],
      ['k1', COIL, 700, 530, '1YV14'], ['k2', COIL, 800, 530, '1YV12'], ['k3', COIL, 900, 530, '2YV14'], ['k4', COIL, 1000, 530, '2YV12']],
    [...l1, ...l2,
      ['v1', 't2', 'air', 't0'], ['v2', 't2', 'air', 't0'],
      ['es', 'a', 'p', 'lp'], ['es', 'b', 'p', 'm'], ['es', 'a', 'p', 'com'],
      ['es', 'a', 'b', 't0'], ['b', 't1', 'p', 'i0'],
      ['es', 'a', 'd11', 't0'], ['d11', 't1', 'p', 'i1'], ['es', 'a', 'd12', 't0'], ['d12', 't1', 'p', 'i2'],
      ['es', 'a', 'd21', 't0'], ['d21', 't1', 'p', 'i3'], ['es', 'a', 'd22', 't0'], ['d22', 't1', 'p', 'i4'],
      ['p', 'q0', 'k1', 't1'], ['k1', 't0', 'es', 'b'], ['p', 'q1', 'k2', 't1'], ['k2', 't0', 'es', 'b'],
      ['p', 'q2', 'k3', 't1'], ['k3', 't0', 'es', 'b'], ['p', 'q3', 'k4', 't1'], ['k4', 't0', 'es', 'b']])
  for (const s of d.symbols) {
    if (s.defId === 'sim-src1') { s.dc = true; s.volts = 24 }
    if (s.defId === COIL) s.volts = 24
    const det: Record<string, { cyl: string; at: number }> = { '1S1': { cyl: '1A', at: 0 }, '1S2': { cyl: '1A', at: 1 }, '2S1': { cyl: '2A', at: 0 }, '2S2': { cyl: '2A', at: 1 } }
    if (det[s.label]) s.det = det[s.label]
    if (s.defId === 'plc-8e8s-relay') {
      s.plc = {
        names: { 'I0.0': 'S1', 'I0.1': '1S1', 'I0.2': '1S2', 'I0.3': '2S1', 'I0.4': '2S2', 'Q0.0': '1YV14', 'Q0.1': '1YV12', 'Q0.2': '2YV14', 'Q0.3': '2YV12' },
        steps: [
          { id: 0, init: true, actions: [], comment: 'attente' },
          { id: 1, actions: [{ kind: 'N', var: '1YV14' }], comment: 'A sort' },
          { id: 2, actions: [{ kind: 'N', var: '2YV14' }], comment: 'B sort' },
          { id: 3, actions: [{ kind: 'N', var: '1YV12' }], comment: 'A rentre' },
          { id: 4, actions: [{ kind: 'N', var: '2YV12' }], comment: 'B rentre' },
        ],
        transitions: [
          { from: [0], to: [1], cond: 'S1 ET 1S1 ET 2S1' }, { from: [1], to: [2], cond: '1S2' }, { from: [2], to: [3], cond: '2S2' }, { from: [3], to: [4], cond: '1S1' }, { from: [4], to: [0], cond: '2S1' },
        ],
        ladder: [],
      }
    }
  }
  return d
}

const L = (p: string) => Q('380_signaling_operating/' + p)
const R = (p: string) => Q('310_relays_contactors_contacts/' + p)

/** Temporisation à la montée : l'interrupteur S1 alimente le relais KT (5 s) ; son contact allume H1 après le délai. */
export const timerOnDelay = (base: Doc): Doc =>
  build(base,
    [
      ['l', 'sim-l', 400, 30],
      ['s1', L('21_selector_switches/010_switch_1pos'), 400, 100, 'S1'],
      ['kt', R('01_coils/bobine_tempo_travail'), 390, 200, 'KT', 5],
      ['n1', 'sim-n', 400, 300],
      ['l2', 'sim-l', 520, 30],
      ['kc', R('02_contacts_cross_referencing/01_auxiliary_contacts/con_simple'), 520, 100, 'KT'],
      ['h', L('11_optical_signaling/lampe2'), 520, 200, 'H1'],
      ['n2', 'sim-n', 520, 300],
    ],
    [
      ['l', 'a', 's1', 't1'], ['s1', 't0', 'kt', 't0'], ['kt', 't1', 'n1', 'a'],
      ['l2', 'a', 'kc', 't0'], ['kc', 't1', 'h', 't0'], ['h', 't1', 'n2', 'a'],
    ])

/**
 * Inverseur de sens de marche : KM1 (avant) et KM2 (arrière, deux phases croisées), verrouillés l'un par l'autre
 * (contact NF de l'autre contacteur en série avec chaque bobine).
 */
export const reversingStarter = (base: Doc): Doc =>
  build(base,
    [
      ['l1', 'sim-l1', 120, 30], ['l2', 'sim-l2', 140, 30], ['l3', 'sim-l3', 160, 30],
      ['q', Q('200_fuses_protective_gears/11_circuit_breakers/disjonct-m_3f'), 120, 100, 'Q1'],
      ['k1', R('02_contacts_cross_referencing/02_power_contacts/com_puiss4'), 120, 220, 'KM1'],
      ['k2', R('02_contacts_cross_referencing/02_power_contacts/com_puiss4'), 240, 220, 'KM2'],
      ['m', Q('391_consumers_actuators/10_engines/moteur_tri_2'), 120, 330, 'M1'],
      ['pem', Q('110_network_supplies/terre'), 200, 400, ''],
      ['lc', 'sim-l', 400, 30],
      ['s1', L('20_push_buttons/poussoir_nf'), 400, 100, 'S1'],
      ['s2', L('20_push_buttons/poussoir'), 400, 200, 'S2'],
      ['a1', R('02_contacts_cross_referencing/01_auxiliary_contacts/con_simple'), 470, 190, 'KM1'],
      ['i2', R('02_contacts_cross_referencing/01_auxiliary_contacts/con_simple_nf'), 410, 280, 'KM2'],
      ['c1', R('01_coils/bobine3'), 390, 350, 'KM1'],
      ['n1', 'sim-n', 400, 440],
      ['s3', L('20_push_buttons/poussoir'), 560, 200, 'S3'],
      ['a2', R('02_contacts_cross_referencing/01_auxiliary_contacts/con_simple'), 630, 190, 'KM2'],
      ['i1', R('02_contacts_cross_referencing/01_auxiliary_contacts/con_simple_nf'), 570, 280, 'KM1'],
      ['c2', R('01_coils/bobine3'), 550, 350, 'KM2'],
      ['n2', 'sim-n', 560, 440],
    ],
    [
      ['l1', 'a', 'q', 't5'], ['l2', 'a', 'q', 't4'], ['l3', 'a', 'q', 't3'],
      ['q', 't1', 'k1', 't0'], ['q', 't0', 'k1', 't2'], ['q', 't2', 'k1', 't4'],
      ['q', 't1', 'k2', 't0'], ['q', 't0', 'k2', 't2'], ['q', 't2', 'k2', 't4'],
      ['k1', 't1', 'm', 't0'], ['k1', 't3', 'm', 't2'], ['k1', 't5', 'm', 't1'],
      ['k2', 't1', 'm', 't0'], ['k2', 't3', 'm', 't1'], ['k2', 't5', 'm', 't2'], ['m', 't3', 'pem', 't0'],
      ['lc', 'a', 's1', 't0'],
      ['s1', 't1', 's2', 't0'], ['s1', 't1', 'a1', 't0'], ['s2', 't1', 'i2', 't0'], ['a1', 't1', 'i2', 't0'], ['i2', 't1', 'c1', 't0'], ['c1', 't1', 'n1', 'a'],
      ['s1', 't1', 's3', 't0'], ['s1', 't1', 'a2', 't0'], ['s3', 't1', 'i1', 't0'], ['a2', 't1', 'i1', 't0'], ['i1', 't1', 'c2', 't0'], ['c2', 't1', 'n2', 'a'],
    ])

/**
 * Départ moteur dont la commande est alimentée en 24 V par un transformateur de commande T1 (230 V entre L1 et L2).
 * Le secondaire de T1 alimente S1 (arrêt) → S2 (marche, shuntée par KM1) → bobine KM1 24 V et voyant H1 24 V.
 */
/** Caractéristiques cohérentes d'un moteur de 4 kW (≈ 8 A) : disjoncteur 10 A courbe D, contacteur 12 A AC-3. */
const withMotorRatings = (d: Doc): Doc => {
  for (const s of d.symbols) {
    if (s.label === 'M1') s.rated = { kw: 4 }
    if (s.label === 'Q1') s.rated = { in: 10, curve: 'D', icu: 10 }
    if (s.label === 'KM1' && s.defId.includes('com_puiss4')) s.rated = { in: 12 }
  }
  return d
}

/** Départ moteur direct avec commande marche / arrêt (voir motorStarterRaw pour le dessin). */
export const motorStarter = (base: Doc): Doc => withMotorRatings(motorStarterRaw(base))

export const motorStarterTransformer = (base: Doc): Doc => {
  const d = build(base,
    [
      ['l1', 'sim-l1', 120, 30], ['l2', 'sim-l2', 140, 30], ['l3', 'sim-l3', 160, 30],
      ['q', Q('200_fuses_protective_gears/11_circuit_breakers/disjonct-m_3f'), 120, 100, 'Q1'],
      ['k', R('02_contacts_cross_referencing/02_power_contacts/com_puiss4'), 120, 200, 'KM1'],
      ['m', Q('391_consumers_actuators/10_engines/moteur_tri_2'), 120, 320, 'M1'],
      ['pem', Q('110_network_supplies/terre'), 200, 390, ''],
      // transformateur de commande 400 V / 24 V, 100 VA : fusibles au primaire (2 pôles) et au secondaire (phase), secondaire relié à la terre
      ['f1', Q('200_fuses_protective_gears/10_fuses/pojistka2p'), 280, -10, 'F1'],
      ['t', Q('330_transformers_power_supplies/10_transformers/transformator_1f_2'), 410, 60, 'T1', undefined, 24],
      ['f2', Q('200_fuses_protective_gears/10_fuses/pojistka1p'), 400, 105, 'F2'],
      ['pe', Q('110_network_supplies/terre'), 450, 120, ''],
      ['s1', L('20_push_buttons/poussoir_nf'), 400, 170, 'S1'],
      ['s2', L('20_push_buttons/poussoir'), 400, 260, 'S2'],
      ['a1', R('02_contacts_cross_referencing/01_auxiliary_contacts/con_simple'), 470, 250, 'KM1'],
      ['c', R('01_coils/bobine3'), 390, 390, 'KM1', undefined, 24],
      ['h', L('11_optical_signaling/lampe2'), 550, 370, 'H1', undefined, 24],
    ],
    [
      ['l1', 'a', 'q', 't5'], ['l2', 'a', 'q', 't4'], ['l3', 'a', 'q', 't3'],
      ['q', 't1', 'k', 't0'], ['q', 't0', 'k', 't2'], ['q', 't2', 'k', 't4'],
      ['k', 't1', 'm', 't0'], ['k', 't3', 'm', 't2'], ['k', 't5', 'm', 't1'], ['m', 't3', 'pem', 't0'],
      ['l1', 'a', 'f1', 't0'], ['l2', 'a', 'f1', 't1'], ['f1', 't2', 't', 't0'], ['f1', 't3', 't', 't1'],
      ['t', 't2', 'f2', 't0'], ['f2', 't1', 's1', 't0'], ['t', 't3', 'pe', 't0'],
      ['s1', 't1', 's2', 't0'], ['s1', 't1', 'a1', 't0'],
      ['s2', 't1', 'c', 't0'], ['a1', 't1', 'c', 't0'], ['h', 't0', 'c', 't0'],
      ['c', 't1', 't', 't3'], ['h', 't1', 't', 't3'],
    ])
  for (const s of d.symbols) {
    if (s.label === 'F1') s.rot = 90
    if (s.label === 'T1') { s.voltsPrimary = 400; s.power = 100 }
    if (s.label === 'F1') s.rated = { in: 1, curve: 'aM', icu: 10 }
    if (s.label === 'F2') s.rated = { in: 4, curve: 'gG', icu: 10 }
    if (s.label === 'KM1' && s.defId.includes('bobine')) s.rated = { watts: 8 }
    if (s.label === 'H1') s.rated = { watts: 3 }
    if (s.label === 'M1') s.rated = { kw: 4 }
    if (s.label === 'Q1') s.rated = { in: 10, curve: 'D', icu: 10 }
    if (s.label === 'KM1' && s.defId.includes('com_puiss4')) s.rated = { in: 12 }
  }
  return d
}

const AUX = '02_contacts_cross_referencing/01_auxiliary_contacts/'
/** Colonne de commande marche/arrêt à auto-maintien (S1 NF, S2 NO, contact KM1, bobine KM1) — repère de départ pour les exemples ci-dessous. */
const startStopColumn = (): [Spec[], Link[]] => [
  [
    ['l', 'sim-l', 400, 30],
    ['s1', L('20_push_buttons/poussoir_nf'), 400, 100, 'S1'],
    ['s2', L('20_push_buttons/poussoir'), 400, 200, 'S2'],
    ['ka', R(AUX + 'con_simple'), 470, 170, 'KM1'],
    ['c', R('01_coils/bobine3'), 390, 320, 'KM1'],
    ['n', 'sim-n', 400, 420],
  ],
  [
    ['l', 'a', 's1', 't0'], ['s1', 't1', 's2', 't0'], ['s1', 't1', 'ka', 't0'],
    ['s2', 't1', 'c', 't0'], ['ka', 't1', 'c', 't0'], ['c', 't1', 'n', 'a'],
  ],
]

/** Signalisation : H1 (marche) par un contact NO de KM1, H2 (arrêt) par un contact NF de KM1. */
export const startLamps = (base: Doc): Doc => {
  const [s, l] = startStopColumn()
  return build(base,
    [
      ...s,
      ['l2', 'sim-l', 580, 30], ['k2', R(AUX + 'con_simple'), 580, 100, 'KM1'], ['h1', L('11_optical_signaling/lampe2'), 580, 200, 'H1'], ['n2', 'sim-n', 580, 300],
      ['l3', 'sim-l', 700, 30], ['k3', R(AUX + 'con_simple_nf'), 700, 100, 'KM1'], ['h2', L('11_optical_signaling/lampe2'), 700, 200, 'H2'], ['n3', 'sim-n', 700, 300],
    ],
    [
      ...l,
      ['l2', 'a', 'k2', 't0'], ['k2', 't1', 'h1', 't0'], ['h1', 't1', 'n2', 'a'],
      ['l3', 'a', 'k3', 't0'], ['k3', 't1', 'h2', 't0'], ['h2', 't1', 'n3', 'a'],
    ])
}

/** Démarrage en cascade : KM2 démarre 5 s après KM1 (temporisation KT à la montée). */
export const delayedCascade = (base: Doc): Doc => {
  const [s, l] = startStopColumn()
  return build(base,
    [
      ...s,
      ['l2', 'sim-l', 580, 30], ['k2', R(AUX + 'con_simple'), 580, 100, 'KM1'], ['kt', R('01_coils/bobine_tempo_travail'), 570, 200, 'KT', 5], ['n2', 'sim-n', 580, 300],
      ['l3', 'sim-l', 700, 30], ['k3', R(AUX + 'con_simple'), 700, 100, 'KT'], ['c2', R('01_coils/bobine3'), 690, 200, 'KM2'], ['n3', 'sim-n', 700, 300],
    ],
    [
      ...l,
      ['l2', 'a', 'k2', 't0'], ['k2', 't1', 'kt', 't0'], ['kt', 't1', 'n2', 'a'],
      ['l3', 'a', 'k3', 't0'], ['k3', 't1', 'c2', 't0'], ['c2', 't1', 'n3', 'a'],
    ])
}

/**
 * Relais auxiliaire en 24 V alternatif avec bornier X1 : S1 (arrêt NF) → S2 (marche NO, shuntée par le contact KA1) → bobine KA1 ;
 * un contact NF de KA1 alimente le voyant H1 (arrêt), un contact NO le voyant H2 (marche).
 */
export const relay24V = (base: Doc): Doc => {
  const TB = Q('130_terminals_terminal_strips/borne_continuite')
  const d = build(base,
    [
      ['l1', 'sim-l1', 120, 30], ['l2', 'sim-l2', 140, 30],
      ['f1', Q('200_fuses_protective_gears/10_fuses/pojistka2p'), 280, -10, 'F1'],
      ['t', Q('330_transformers_power_supplies/10_transformers/transformator_1f_2'), 410, 60, 'T1', undefined, 24],
      ['f2', Q('200_fuses_protective_gears/10_fuses/pojistka1p'), 400, 105, 'F2'],
      ['pe', Q('110_network_supplies/terre'), 450, 120, ''],
      // colonne de commande : arrêt, marche + auto-maintien, bobine
      ['s1', L('20_push_buttons/poussoir_nf'), 400, 170, 'S1'],
      ['x3', TB, 470, 230, 'X1.3'],
      ['s2', L('20_push_buttons/poussoir'), 400, 260, 'S2'],
      ['ka', R(AUX + 'con_simple'), 470, 270, 'KA1'],
      ['x2', TB, 400, 340, 'X1.2'],
      ['c', R('01_coils/bobine3'), 390, 390, 'KA1', undefined, 24],
      // voyant H1 par un contact NF de KA1, voyant H2 par un contact NO
      ['kn', R(AUX + 'con_simple_nf'), 570, 200, 'KA1'],
      ['x4', TB, 560, 260, 'X1.4'], ['h1', L('11_optical_signaling/lampe2'), 550, 300, 'H1', undefined, 24], ['x5', TB, 560, 360, 'X1.5'],
      ['ko', R(AUX + 'con_simple'), 650, 200, 'KA1'],
      ['x6', TB, 650, 260, 'X1.6'], ['h2', L('11_optical_signaling/lampe2'), 640, 300, 'H2', undefined, 24], ['x7', TB, 650, 360, 'X1.7'],
    ],
    [
      ['l1', 'a', 'f1', 't0'], ['l2', 'a', 'f1', 't1'], ['f1', 't2', 't', 't0'], ['f1', 't3', 't', 't1'],
      ['t', 't2', 'f2', 't0'], ['t', 't3', 'pe', 't0'],
      ['f2', 't1', 's1', 't0'],
      ['s1', 't1', 's2', 't0'], ['s1', 't1', 'x3', 't0'], ['x3', 't1', 'ka', 't0'],
      ['s2', 't1', 'x2', 't0'], ['ka', 't1', 'x2', 't0'], ['x2', 't1', 'c', 't0'], ['c', 't1', 't', 't3'],
      ['f2', 't1', 'kn', 't0'], ['kn', 't1', 'x4', 't0'], ['x4', 't1', 'h1', 't0'], ['h1', 't1', 'x5', 't0'], ['x5', 't1', 't', 't3'],
      ['f2', 't1', 'ko', 't0'], ['ko', 't1', 'x6', 't0'], ['x6', 't1', 'h2', 't0'], ['h2', 't1', 'x7', 't0'], ['x7', 't1', 't', 't3'],
    ])
  for (const s of d.symbols) {
    if (s.label === 'F1') { s.rot = 90; s.rated = { in: 1, curve: 'aM', icu: 10 } }
    if (s.label === 'T1') { s.voltsPrimary = 400; s.power = 100 }
    if (s.label === 'F2') s.rated = { in: 4, curve: 'gG', icu: 10 }
    if (s.label === 'KA1' && s.defId.includes('bobine')) s.rated = { watts: 8 }
    if (s.label === 'H1' || s.label === 'H2') s.rated = { watts: 3 }
  }
  return d
}

// ───────────────────────── banc hydraulique (travaux pratiques)
const HY = (t: string) => 'own:hyd/' + t
const HTANK = 'qet:30_hydraulic/21_tanks/bache_a_l_air_libre'
const HCYL = 'qet:30_hydraulic/51_cylinders/verin-asymetrique-doubl-effet' // fond (t0) à gauche, tige (t1) à droite

/** Règle des appareils réglables d'un exemple, par repère. */
const tune = (d: Doc, rated: Record<string, Ratings>): Doc => ({ ...d, symbols: d.symbols.map((s) => (rated[s.label] ? { ...s, rated: { ...(s.rated ?? {}), ...rated[s.label] } } : s)) })

/**
 * TP « limiteur de débit à l'admission » : groupe motopompe 18 cm³, limiteur de pression, distributeur 4/3 centre fermé, deux limiteurs de débit
 * unidirectionnels, moteur hydraulique 100 cm³ et trois manomètres. En simulation, maintenez le clic sur une électrovanne du distributeur.
 */
export const hydraulicMotor = (base: Doc): Doc => tune(build(base,
  [
    ['t1', HTANK, 330, 700], ['t2', HTANK, 560, 560],
    ['pump', HY('groupe_pompe_fixe'), 300, 610, 'GMP'], ['rv', HY('limiteur_pression'), 450, 500, 'LP'], ['g3', HY('manometre'), 220, 520, 'G3'],
    ['v', HY('d43_o'), 300, 360, '1V1'],
    ['la', HY('limiteur_debit_uni'), 150, 250, 'LA'], ['lb', HY('limiteur_debit_uni_inverse'), 470, 250, 'LB'],
    ['m', HY('moteur_hydraulique'), 330, 120, 'M2'], ['g1', HY('manometre'), 220, 120, 'G1'], ['g2', HY('manometre'), 440, 120, 'G2'],
  ],
  [
    ['pump', 'i', 't1', 't0'], ['pump', 'o', 'rv', 'p'], ['pump', 'o', 'v', 'p'], ['pump', 'o', 'g3', 'a'], ['rv', 't', 't2', 't0'], ['v', 't', 't2', 't0'],
    ['v', 'a', 'la', 'a'], ['la', 'b', 'm', 'a'], ['v', 'b', 'lb', 'a'], ['lb', 'b', 'm', 'b'], ['m', 'a', 'g1', 'a'], ['m', 'b', 'g2', 'a'],
  ]), { LP: { set: 100 }, LA: { open: 40 }, LB: { open: 40 }, M2: { disp: 100, torque: 5 }, GMP: { disp: 18, rpm: 1500 } })

/**
 * TP « limiteur de débit à l'échappement » : vérin 50/30 course 350, limiteurs unidirectionnels placés sur le retour de chaque chambre.
 * Observez l'effet multiplicateur de pression côté tige à la sortie.
 */
export const hydraulicCylinder = (base: Doc): Doc => tune(build(base,
  [
    ['t1', HTANK, 330, 700], ['t2', HTANK, 560, 560],
    ['pump', HY('groupe_pompe_fixe'), 300, 610, 'GMP'], ['rv', HY('limiteur_pression'), 450, 500, 'LP'], ['g3', HY('manometre'), 220, 520, 'G3'],
    ['v', HY('d43_o'), 300, 360, '1V1'],
    ['la', HY('limiteur_debit_uni'), 150, 250, 'LA'], ['lb', HY('limiteur_debit_uni'), 470, 250, 'LB'],
    ['c', HCYL, 300, 120, '1A'], ['g1', HY('manometre'), 220, 120, 'G1'], ['g2', HY('manometre'), 440, 120, 'G2'],
  ],
  [
    ['pump', 'i', 't1', 't0'], ['pump', 'o', 'rv', 'p'], ['pump', 'o', 'v', 'p'], ['pump', 'o', 'g3', 'a'], ['rv', 't', 't2', 't0'], ['v', 't', 't2', 't0'],
    // à l'échappement : la chambre est du côté 'a' (étranglé), le distributeur du côté 'b' (retour libre)
    ['c', 't0', 'la', 'a'], ['la', 'b', 'v', 'a'], ['c', 't1', 'lb', 'a'], ['lb', 'b', 'v', 'b'], ['c', 't0', 'g1', 'a'], ['c', 't1', 'g2', 'a'],
  ]), { LP: { set: 100 }, LA: { open: 30 }, LB: { open: 30 }, GMP: { disp: 18, rpm: 1500 }, '1A': { bore: 50, rod: 30, stroke: 350 } })

// ───────────────────────── travaux pratiques TP5 à TP9 du banc (cahier SHCOV2)
/** Alimentation commune : bâches, groupe motopompe, limiteur de pression principal et manomètre de pompe. */
const hydSupply = (pump: string): [Spec[], Link[]] => [
  [['t1', HTANK, 330, 700], ['t2', HTANK, 780, 560], ['pump', HY(pump), 300, 610, 'GMP'], ['rv', HY('limiteur_pression'), 450, 500, 'LP'], ['g3', HY('manometre'), 220, 520, 'G3']],
  [['pump', 'i', 't1', 't0'], ['pump', 'o', 'rv', 'p'], ['pump', 'o', 'g3', 'a'], ['rv', 't', 't2', 't0']],
]
/** Moteur hydraulique commandé par un 4/3 et deux limiteurs de débit à l'admission (x0 : décalage horizontal du circuit). */
const hydMotorLeg = (x0: number, supply: string): [Spec[], Link[]] => [
  [['vm', HY('d43_o'), x0 + 100, 360, '1V1'], ['la', HY('limiteur_debit_uni'), x0 + 30, 250, 'LA'], ['lb', HY('limiteur_debit_uni_inverse'), x0 + 270, 250, 'LB'],
    ['m', HY('moteur_hydraulique'), x0 + 130, 120, 'M2'], ['g1', HY('manometre'), x0 + 50, 120, 'G1'], ['g2', HY('manometre'), x0 + 250, 120, 'G2']],
  [[supply, 'o', 'vm', 'p'], ['vm', 't', 't2', 't0'], ['vm', 'a', 'la', 'a'], ['la', 'b', 'm', 'a'], ['vm', 'b', 'lb', 'a'], ['lb', 'b', 'm', 'b'], ['m', 'a', 'g1', 'a'], ['m', 'b', 'g2', 'a']],
]
const MOTOR_TP: Record<string, Ratings> = { M2: { disp: 50, torque: 5 }, GMP: { disp: 18, rpm: 1500 } }

/**
 * TP5 « limiteur de pression secondaire » : moteur (limiteurs de débit) et vérin en parallèle ; un limiteur de pression secondaire sur
 * chaque ligne du vérin (80 bar côté fond, 40 bar côté tige) sous le limiteur principal à 100 bar.
 */
export const hydraulicTP5 = (base: Doc): Doc => {
  const [s0, l0] = hydSupply('groupe_pompe_fixe'), [s1, l1] = hydMotorLeg(0, 'pump')
  return tune(build(base,
    [...s0, ...s1, ['vc', HY('d43_o'), 620, 360, '1V2'], ['c', HCYL, 640, 120, '1A'], ['g4', HY('manometre'), 570, 120, 'G4'], ['g5', HY('manometre'), 860, 120, 'G5'],
      ['ra', HY('limiteur_pression'), 540, 240, 'RA'], ['rb', HY('limiteur_pression'), 800, 240, 'RB']],
    [...l0, ...l1, ['pump', 'o', 'vc', 'p'], ['vc', 't', 't2', 't0'], ['vc', 'a', 'c', 't0'], ['vc', 'b', 'c', 't1'], ['c', 't0', 'g4', 'a'], ['c', 't1', 'g5', 'a'],
      ['c', 't0', 'ra', 'p'], ['ra', 't', 't2', 't0'], ['c', 't1', 'rb', 'p'], ['rb', 't', 't2', 't0']]),
  { ...MOTOR_TP, LP: { set: 100 }, RA: { set: 80 }, RB: { set: 40 }, LA: { open: 8 }, LB: { open: 12 }, '1A': { bore: 50, rod: 30, stroke: 350 } })
}

/** TP6 « réducteur de pression » : même banc, un réducteur réglé à 50 bar en amont du distributeur du vérin. */
export const hydraulicTP6 = (base: Doc): Doc => {
  const [s0, l0] = hydSupply('groupe_pompe_fixe'), [s1, l1] = hydMotorLeg(0, 'pump')
  return tune(build(base,
    [...s0, ...s1, ['rd', HY('reducteur_pression'), 540, 480, 'RP'], ['vc', HY('d43_o'), 620, 360, '1V2'], ['c', HCYL, 640, 120, '1A'], ['g4', HY('manometre'), 570, 120, 'G4'], ['g5', HY('manometre'), 860, 120, 'G5']],
    [...l0, ...l1, ['pump', 'o', 'rd', 'p'], ['rd', 'a', 'vc', 'p'], ['vc', 't', 't2', 't0'], ['vc', 'a', 'c', 't0'], ['vc', 'b', 'c', 't1'], ['c', 't0', 'g4', 'a'], ['c', 't1', 'g5', 'a']]),
  { ...MOTOR_TP, LP: { set: 100 }, RP: { set: 50 }, LA: { open: 8 }, LB: { open: 12 }, '1A': { bore: 50, rod: 30, stroke: 350 } })
}

/** TP7 « clapet anti-retour piloté » : deux clapets croisés (le pilotage de chacun vient de l'autre ligne) immobilisent le vérin. */
export const hydraulicTP7 = (base: Doc): Doc => {
  const [s0, l0] = hydSupply('groupe_pompe_fixe')
  return tune(build(base,
    [...s0, ['v', HY('d43_y'), 300, 360, '1V1'], ['ca', HY('clapet_pilote'), 230, 250, 'CA'], ['cb', HY('clapet_pilote'), 410, 250, 'CB'],
      ['c', HCYL, 300, 120, '1A'], ['g1', HY('manometre'), 220, 120, 'G1'], ['g2', HY('manometre'), 440, 120, 'G2']],
    [...l0, ['pump', 'o', 'v', 'p'], ['v', 't', 't2', 't0'], ['v', 'a', 'ca', 'a'], ['ca', 'b', 'c', 't0'], ['v', 'b', 'cb', 'a'], ['cb', 'b', 'c', 't1'],
      ['v', 'b', 'ca', 'x'], ['v', 'a', 'cb', 'x'], ['c', 't0', 'g1', 'a'], ['c', 't1', 'g2', 'a']]),
  { GMP: { disp: 18, rpm: 1500 }, LP: { set: 100 }, '1A': { bore: 50, rod: 30, stroke: 350 } })
}

/** TP8 « régulation de pression constante » : pompe à cylindrée variable (100 bar), limiteur de sécurité à 120 bar, moteur et limiteurs de débit. */
export const hydraulicTP8 = (base: Doc): Doc => {
  const [s0, l0] = hydSupply('groupe_pompe_variable'), [s1, l1] = hydMotorLeg(0, 'pump')
  return tune(build(base, [...s0, ...s1], [...l0, ...l1]), { ...MOTOR_TP, GMP: { disp: 18, rpm: 1500, set: 100 }, LP: { set: 120 }, LA: { open: 8 }, LB: { open: 12 } })
}

/** TP9 « Load Sensing » : la pompe garde 15 bar de plus que la plus forte pression des deux lignes du moteur, relevée par un sélecteur de circuit. */
export const hydraulicTP9 = (base: Doc): Doc => {
  const [s0, l0] = hydSupply('groupe_pompe_ls'), [s1, l1] = hydMotorLeg(0, 'pump')
  return tune(build(base, [...s0, ...s1, ['sel', HY('selecteur_circuit'), 150, 320, 'SC']],
    [...l0, ...l1, ['m', 'a', 'sel', 'a'], ['m', 'b', 'sel', 'b'], ['sel', 's', 'pump', 'x']]),
  { ...MOTOR_TP, LP: { set: 120 }, LA: { open: 19 }, LB: { open: 28 } }) // ΔP constant de 15 bar aux bornes des limiteurs : l'ouverture fixe le débit
}
