import type { Doc, PlacedSymbol, Wire } from './types'
import { SYMBOL_MAP } from './symbols'
import { uid } from './geometry'

type Spec = [key: string, defId: string, x: number, y: number, label?: string]
type Link = [from: string, fromPort: string, to: string, toPort: string]

function build(base: Doc, specs: Spec[], links: Link[]): Doc {
  const ids: Record<string, string> = {}
  const counters: Record<string, number> = {}
  const symbols: PlacedSymbol[] = specs.map(([key, defId, x, y, label]) => {
    const prefix = SYMBOL_MAP[defId].prefix
    ids[key] = uid()
    if (label === undefined) {
      counters[prefix] = (counters[prefix] ?? 0) + 1
      label = prefix ? prefix + counters[prefix] : ''
    }
    return { id: ids[key], defId, x, y, rot: 0, label, desc: '' }
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
      ['q', Q('200_fuses_protective_gears/12_magneto_thermal_circuit_breakers/fa4202_disjoncteur_moteur_3p'), 100, 100, 'Q1'],
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
      ['l1', 'a', 'q', 't0'], ['l2', 'a', 'q', 't1'], ['l3', 'a', 'q', 't2'],
      ['q', 't5', 'k', 't0'], ['q', 't4', 'k', 't2'], ['q', 't3', 'k', 't4'],
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
