import type { PortDef, SymbolDef } from '../../types'

/**
 * Appareils hydrauliques du banc d'essai : limiteur et réducteur de pression, limiteurs et régulateur de débit, clapets, sélecteur,
 * groupes motopompes, moteur, manomètre, débitmètre. Leur dessin est généré par `own/fluid.ts` d'après leur modèle.
 */
const P = (id: string, x: number, y: number, dir: PortDef['dir']): PortDef => ({ id, x, y, dir })

interface Spec {
  tail: string
  fr: string
  en: string
  group: [string, string]
  cat: string
  w: number
  h: number
  prefix: string
  ports: PortDef[]
  fluid: NonNullable<SymbolDef['fluid']>
  score: number
  top?: boolean
}

const VALVES = '30_hydraulic/45_valves'
const PUMPS = '30_hydraulic/61_pumps'
const PRESS: [string, string] = ['Pression', 'Pressure']
const FLOW: [string, string] = ['Débit', 'Flow']
const CHECK: [string, string] = ['Clapets et sélecteurs', 'Check valves and shuttle']
const MEAS: [string, string] = ['Mesure', 'Measurement']
const GROUP: [string, string] = ['Groupes et moteurs', 'Power packs and motors']

const specs: Spec[] = [
  { tail: 'limiteur_pression', fr: 'Limiteur de pression', en: 'Pressure relief valve', group: PRESS, cat: VALVES, w: 62, h: 50, prefix: 'V', ports: [P('p', 0, 30, 'left'), P('t', 62, 30, 'right')], fluid: { k: 'relief', p: 'p', t: 't' }, score: 95, top: true },
  { tail: 'reducteur_pression', fr: 'Réducteur de pression', en: 'Pressure reducing valve', group: PRESS, cat: VALVES, w: 62, h: 50, prefix: 'V', ports: [P('p', 0, 30, 'left'), P('a', 62, 30, 'right')], fluid: { k: 'reducer', p: 'p', a: 'a' }, score: 80, top: true },
  { tail: 'limiteur_debit', fr: 'Limiteur de débit réglable', en: 'Adjustable flow restrictor', group: FLOW, cat: VALVES, w: 50, h: 40, prefix: 'V', ports: [P('a', 0, 20, 'left'), P('b', 50, 20, 'right')], fluid: { k: 'fthrottle', a: 'a', b: 'b' }, score: 85 },
  { tail: 'limiteur_debit_uni', fr: 'Limiteur de débit unidirectionnel (à l’admission)', en: 'One-way flow control valve (meter-in)', group: FLOW, cat: VALVES, w: 50, h: 40, prefix: 'V', ports: [P('a', 0, 20, 'left'), P('b', 50, 20, 'right')], fluid: { k: 'fthrottle', a: 'a', b: 'b', oneWay: true }, score: 92, top: true },
  { tail: 'limiteur_debit_uni_inverse', fr: 'Limiteur de débit unidirectionnel renversé (à l’échappement)', en: 'Reversed one-way flow control valve (meter-out)', group: FLOW, cat: VALVES, w: 50, h: 40, prefix: 'V', ports: [P('a', 50, 20, 'right'), P('b', 0, 20, 'left')], fluid: { k: 'fthrottle', a: 'a', b: 'b', oneWay: true }, score: 90 },
  { tail: 'regulateur_debit', fr: 'Régulateur de débit compensé en pression, unidirectionnel', en: 'Pressure-compensated flow regulator, one-way', group: FLOW, cat: VALVES, w: 50, h: 40, prefix: 'V', ports: [P('a', 0, 20, 'left'), P('b', 50, 20, 'right')], fluid: { k: 'fthrottle', a: 'a', b: 'b', oneWay: true, comp: true }, score: 78 },
  { tail: 'clapet_pilote', fr: 'Clapet anti-retour piloté', en: 'Pilot-operated check valve', group: CHECK, cat: VALVES, w: 50, h: 40, prefix: 'V', ports: [P('a', 0, 25, 'left'), P('b', 50, 25, 'right'), P('x', 25, 0, 'up')], fluid: { k: 'check', from: 'a', to: 'b', pilot: 'x' }, score: 80 },
  { tail: 'selecteur_circuit', fr: 'Sélecteur de circuit', en: 'Shuttle valve', group: CHECK, cat: VALVES, w: 60, h: 40, prefix: 'V', ports: [P('s', 30, 0, 'up'), P('a', 0, 20, 'left'), P('b', 60, 20, 'right')], fluid: { k: 'logic', op: 'or', ins: ['a', 'b'], out: 's' }, score: 62 },
  { tail: 'manometre', fr: 'Manomètre', en: 'Pressure gauge', group: MEAS, cat: VALVES, w: 20, h: 30, prefix: 'P', ports: [P('a', 10, 30, 'down')], fluid: { k: 'fgauge', ports: ['a'] }, score: 94, top: true },
  { tail: 'debitmetre', fr: 'Débitmètre', en: 'Flow meter', group: MEAS, cat: VALVES, w: 40, h: 40, prefix: 'Q', ports: [P('a', 0, 20, 'left'), P('b', 40, 20, 'right')], fluid: { k: 'fflow', a: 'a', b: 'b' }, score: 70 },
  { tail: 'groupe_pompe_fixe', fr: 'Groupe motopompe à cylindrée fixe', en: 'Fixed-displacement motor-pump unit', group: GROUP, cat: PUMPS, w: 74, h: 64, prefix: 'M', ports: [P('o', 52, 0, 'up'), P('i', 52, 64, 'down')], fluid: { k: 'fpump', out: 'o', in: 'i' }, score: 96, top: true },
  { tail: 'groupe_pompe_variable', fr: 'Groupe motopompe à cylindrée variable, régulée en pression', en: 'Pressure-compensated variable-displacement motor-pump unit', group: GROUP, cat: PUMPS, w: 74, h: 64, prefix: 'M', ports: [P('o', 52, 0, 'up'), P('i', 52, 64, 'down')], fluid: { k: 'fpump', out: 'o', in: 'i', variable: true }, score: 80 },
  { tail: 'groupe_pompe_ls', fr: 'Groupe motopompe à cylindrée variable, Load Sensing', en: 'Load Sensing variable-displacement motor-pump unit', group: GROUP, cat: PUMPS, w: 80, h: 64, prefix: 'M', ports: [P('o', 52, 0, 'up'), P('i', 52, 64, 'down'), P('x', 80, 32, 'right')], fluid: { k: 'fpump', out: 'o', in: 'i', variable: true, ls: 'x' }, score: 70 },
  { tail: 'bouchon', fr: 'Bouchon (orifice obturé)', en: 'Plug (blanked port)', group: MEAS, cat: VALVES, w: 20, h: 30, prefix: 'X', ports: [P('a', 10, 30, 'down')], fluid: { k: 'fgauge', ports: ['a'] }, score: 50 },
  { tail: 'moteur_hydraulique', fr: 'Moteur hydraulique, deux sens de rotation', en: 'Hydraulic motor, both directions', group: GROUP, cat: PUMPS, w: 60, h: 50, prefix: 'M', ports: [P('a', 0, 25, 'left'), P('b', 60, 25, 'right')], fluid: { k: 'fmotor', a: 'a', b: 'b' }, score: 92, top: true },
]

export const hydParts: SymbolDef[] = specs.map((s): SymbolDef => ({
  id: `own:hyd/${s.tail}`, domain: 'hydraulic', prefix: s.prefix, name: { fr: s.fr, en: s.en }, std: 'ISO 1219-1', w: s.w, h: s.h, svg: '',
  ports: s.ports, cat: s.cat, group: { fr: s.group[0], en: s.group[1] }, score: s.score, top: !!s.top, fluid: s.fluid,
}))
