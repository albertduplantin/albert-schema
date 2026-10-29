import type { SymbolDef } from '../../types'
import { angle, blade, contacts, line, rect, type Head, type Pt, type PoleMark } from './kit'

/** Symboles propres à l'application qui n'existent pas dans la collection d'origine. */
// lame ouverte : sa pointe reste à l'intérieur de l'ampoule (x de 8 à 32)
const hinge: Pt = [20, 46], closed: Pt = [20, 14], open: Pt = [12, 16]
const ilsRot = angle([open[0] - hinge[0], open[1] - hinge[1]], [closed[0] - hinge[0], closed[1] - hinge[1]])
const ilsSvg = line([20, 0], closed) + line([20, 60], hinge) + blade(0, hinge, open)

/** Bouton ou commutateur à plusieurs contacts actionnés ensemble : un pôle par contact (NO ou NF), liés par la même commande. */
function multi(tail: string, ncs: boolean[], head: Head, ctl: 'momentary' | 'toggle', fr: string, en: string): SymbolDef {
  const ports = ncs.flatMap((_, i) => [{ id: 't' + 2 * i, x: 10 + 20 * i, y: 0, dir: 'up' as const }, { id: 't' + (2 * i + 1), x: 10 + 20 * i, y: 60, dir: 'down' as const }])
  const poles = ncs.map((_, i) => ['t' + 2 * i, 't' + (2 * i + 1)] as [string, string])
  const c = contacts(ports, poles, ncs.map((n): PoleMark => (n ? 'nc' : 'none')), head)!
  const push = ctl === 'momentary'
  return {
    id: `own:elec/${push ? '20_push_buttons' : '21_selector_switches'}/${tail}`,
    domain: 'electrical',
    cat: '10_electric_10_allpole/380_signaling_operating',
    group: push ? { fr: 'Boutons-poussoirs', en: 'Push-buttons' } : { fr: 'Commutateurs sélecteurs', en: 'Selector switches' },
    score: 90,
    top: true,
    prefix: 'S',
    name: { fr, en },
    std: 'CEI 60617',
    w: 20 * ncs.length,
    h: 60,
    ports,
    svg: c.svg,
    sim: { k: 'switch', poles, ctl, nc: ncs[0], ncPoles: ncs, blades: c.blades },
  } as SymbolDef
}

export const ILS_ID = 'qet:10_electric/10_allpole/390_sensors_instruments/41_limit_switches/ils_no'

/** Interrupteur à lame souple (ILS, capteur reed) : contact à lame dans une ampoule de verre, fermé par le champ de l'aimant du piston. */
export const extraSymbols: SymbolDef[] = [
  multi('poussoir_2no', [false, false], 'push', 'momentary', 'Bouton poussoir, 2 contacts à fermeture (2 NO)', 'Push button, 2 make contacts (2 NO)'),
  multi('poussoir_2nf', [true, true], 'push', 'momentary', 'Bouton poussoir, 2 contacts à ouverture (2 NF)', 'Push button, 2 break contacts (2 NC)'),
  multi('poussoir_no_nf', [false, true], 'push', 'momentary', 'Bouton poussoir, 1 contact à fermeture + 1 à ouverture (1 NO + 1 NF)', 'Push button, 1 make + 1 break contact (1 NO + 1 NC)'),
  multi('commutateur_2no', [false, false], 'rotate', 'toggle', 'Commutateur à tête tournante, 2 contacts à fermeture (2 NO)', 'Rotary switch, 2 make contacts (2 NO)'),
  multi('commutateur_2nf', [true, true], 'rotate', 'toggle', 'Commutateur à tête tournante, 2 contacts à ouverture (2 NF)', 'Rotary switch, 2 break contacts (2 NC)'),
  multi('commutateur_no_nf', [false, true], 'rotate', 'toggle', 'Commutateur à tête tournante, 1 contact à fermeture + 1 à ouverture (1 NO + 1 NF)', 'Rotary switch, 1 make + 1 break contact (1 NO + 1 NC)'),
  {
    id: ILS_ID,
    domain: 'electrical',
    cat: '10_electric_10_allpole/390_sensors_instruments',
    group: { fr: 'Fins de course', en: 'Limits' },
    score: 85,
    top: true,
    prefix: 'B',
    name: { fr: 'Capteur reed / ILS (NO)', en: 'Reed sensor (NO)' },
    std: 'CEI 60617',
    w: 20,
    h: 60,
    ports: [{ id: 't0', x: 20, y: 0, dir: 'up' }, { id: 't1', x: 20, y: 60, dir: 'down' }],
    svg:
      ilsSvg + rect(8, 8, 24, 44, 'rx="10" fill="none"'),
    sim: { k: 'switch', poles: [['t0', 't1']], ctl: 'toggle', nc: false, blades: [{ rot: ilsRot, closed: false }] },
  } as SymbolDef,
]
