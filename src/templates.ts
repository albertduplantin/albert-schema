import type { Doc, PlacedSymbol, Wire } from './types'
import { SYMBOL_MAP } from './symbols'
import { uid } from './geometry'

type Spec = [key: string, defId: string, x: number, y: number, label?: string, delay?: number]
type Link = [from: string, fromPort: string, to: string, toPort: string]

function build(base: Doc, specs: Spec[], links: Link[]): Doc {
  const ids: Record<string, string> = {}
  const counters: Record<string, number> = {}
  const symbols: PlacedSymbol[] = specs.map(([key, defId, x, y, label, delay]) => {
    const prefix = SYMBOL_MAP[defId].prefix
    ids[key] = uid()
    if (label === undefined) {
      counters[prefix] = (counters[prefix] ?? 0) + 1
      label = prefix ? prefix + counters[prefix] : ''
    }
    return delay === undefined ? { id: ids[key], defId, x, y, rot: 0, label, desc: '' } : { id: ids[key], defId, x, y, rot: 0, label, desc: '', delay }
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

/** Vérin double effet piloté par un distributeur 4/2. */
export const pneumaticCylinder = (base: Doc): Doc =>
  build(base,
    [
      ['a', P('5030_actuators/503010_cylinder_lin/50301011_double_acting/5030101100_double_effet'), 300, 140],
      ['v', P('5020_velves/502010_control/50201040_4_2_way/5020104030_man_mech/502010403000_4_2_way'), 290, 260],
      ['s', P('5010_compressed_air/501010_air_generation/50101000_compressed_air_source'), 320, 360],
      ['e', P('5010_compressed_air/501016_funktion_components/50101610_flow/5010161060_silencer'), 400, 360],
    ],
    [
      ['a', 't0', 'v', 't0'], ['a', 't1', 'v', 't3'], ['s', 't0', 'v', 't1'], ['e', 't0', 'v', 't2'],
    ])

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
