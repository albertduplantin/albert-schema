import type { Doc, PlacedSymbol, Wire } from './types'
import { SYMBOL_MAP } from './symbols'
import { uid } from './geometry'

type Spec = [key: string, defId: string, x: number, y: number, label?: string, delay?: number, volts?: number]
type Link = [from: string, fromPort: string, to: string, toPort: string]

function build(base: Doc, specs: Spec[], links: Link[]): Doc {
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
export const motorStarter = (base: Doc): Doc =>
  build(base,
    [
      ['l1', 'sim-l1', 120, 30], ['l2', 'sim-l2', 140, 30], ['l3', 'sim-l3', 160, 30],
      ['q', Q('200_fuses_protective_gears/11_circuit_breakers/disjonct-m_3f'), 120, 100, 'Q1'],
      ['k', Q('310_relays_contactors_contacts/02_contacts_cross_referencing/02_power_contacts/com_puiss4'), 120, 200, 'KM1'],
      ['m', Q('391_consumers_actuators/10_engines/moteur_tri_2'), 120, 320, 'M1'],
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
      ['k', 't1', 'm', 't0'], ['k', 't3', 'm', 't2'], ['k', 't5', 'm', 't1'],
      ['lc', 'a', 's1', 't0'], ['s1', 't1', 's2', 't0'], ['s1', 't1', 'ka', 't0'],
      ['s2', 't1', 'c', 't0'], ['ka', 't1', 'c', 't0'], ['c', 't1', 'n', 'a'],
      ['h', 't0', 'c', 't0'], ['h', 't1', 'n', 'a'],
    ])

const FV = (p: string) => P('5020_velves/502010_control/50201060_5_2_way/' + p)
const CYL = P('5030_actuators/503010_cylinder_lin/50301011_double_acting/5030101100_double_effet')
const SRC = P('5010_compressed_air/501010_air_generation/50101000_compressed_air_source')
const SIL = P('5010_compressed_air/501016_funktion_components/50101610_flow/5010161060_silencer')

/** Partie pneumatique commune : source d'air, distributeur 5/2 (valve = identifiant du symbole), vérin A1 et deux silencieux d'échappement. */
const pneuPart = (valve: string, valveLabel: string, ports: { b: string; a: string; r1: string; p: string; r2: string }): [Spec[], Link[]] => [
  [
    ['a1', CYL, 180, 90, 'A1'],
    ['v', valve, 200, 230, valveLabel],
    ['sil1', SIL, 170, 330, ''],
    ['src', SRC, 250, 330, ''],
    ['sil2', SIL, 340, 330, ''],
  ],
  [
    ['v', ports.b, 'a1', 't0'], ['v', ports.a, 'a1', 't1'],
    ['v', ports.r1, 'sil1', 't0'], ['v', ports.p, 'src', 't0'], ['v', ports.r2, 'sil2', 't0'],
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
      ['k2', 't1', 'm', 't0'], ['k2', 't3', 'm', 't1'], ['k2', 't5', 'm', 't2'],
      ['lc', 'a', 's1', 't0'],
      ['s1', 't1', 's2', 't0'], ['s1', 't1', 'a1', 't0'], ['s2', 't1', 'i2', 't0'], ['a1', 't1', 'i2', 't0'], ['i2', 't1', 'c1', 't0'], ['c1', 't1', 'n1', 'a'],
      ['s1', 't1', 's3', 't0'], ['s1', 't1', 'a2', 't0'], ['s3', 't1', 'i1', 't0'], ['a2', 't1', 'i1', 't0'], ['i1', 't1', 'c2', 't0'], ['c2', 't1', 'n2', 'a'],
    ])

/**
 * Départ moteur dont la commande est alimentée en 24 V par un transformateur de commande T1 (230 V entre L1 et L2).
 * Le secondaire de T1 alimente S1 (arrêt) → S2 (marche, shuntée par KM1) → bobine KM1 24 V et voyant H1 24 V.
 */
export const motorStarterTransformer = (base: Doc): Doc =>
  build(base,
    [
      ['l1', 'sim-l1', 120, 30], ['l2', 'sim-l2', 140, 30], ['l3', 'sim-l3', 160, 30],
      ['q', Q('200_fuses_protective_gears/11_circuit_breakers/disjonct-m_3f'), 120, 100, 'Q1'],
      ['k', R('02_contacts_cross_referencing/02_power_contacts/com_puiss4'), 120, 200, 'KM1'],
      ['m', Q('391_consumers_actuators/10_engines/moteur_tri_2'), 120, 320, 'M1'],
      ['t', Q('330_transformers_power_supplies/10_transformers/transformator_1f_2'), 410, 40, 'T1', undefined, 24],
      ['s1', L('20_push_buttons/poussoir_nf'), 400, 130, 'S1'],
      ['s2', L('20_push_buttons/poussoir'), 400, 230, 'S2'],
      ['a1', R('02_contacts_cross_referencing/01_auxiliary_contacts/con_simple'), 470, 220, 'KM1'],
      ['c', R('01_coils/bobine3'), 390, 360, 'KM1', undefined, 24],
      ['h', L('11_optical_signaling/lampe2'), 550, 340, 'H1', undefined, 24],
    ],
    [
      ['l1', 'a', 'q', 't5'], ['l2', 'a', 'q', 't4'], ['l3', 'a', 'q', 't3'],
      ['q', 't1', 'k', 't0'], ['q', 't0', 'k', 't2'], ['q', 't2', 'k', 't4'],
      ['k', 't1', 'm', 't0'], ['k', 't3', 'm', 't2'], ['k', 't5', 'm', 't1'],
      ['l1', 'a', 't', 't0'], ['l2', 'a', 't', 't1'],
      ['t', 't2', 's1', 't0'], ['s1', 't1', 's2', 't0'], ['s1', 't1', 'a1', 't0'],
      ['s2', 't1', 'c', 't0'], ['a1', 't1', 'c', 't0'], ['h', 't0', 'c', 't0'],
      ['c', 't1', 't', 't3'], ['h', 't1', 't', 't3'],
    ])

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
