import type { SymbolDef } from '../../types'
import { angle, blade, line, rect, type Pt } from './kit'

/** Symboles propres à l'application qui n'existent pas dans la collection d'origine. */
// lame ouverte : sa pointe reste à l'intérieur de l'ampoule (x de 8 à 32)
const hinge: Pt = [20, 46], closed: Pt = [20, 14], open: Pt = [12, 16]
const ilsRot = angle([open[0] - hinge[0], open[1] - hinge[1]], [closed[0] - hinge[0], closed[1] - hinge[1]])
const ilsSvg = line([20, 0], closed) + line([20, 60], hinge) + blade(0, hinge, open)

export const ILS_ID = 'qet:10_electric/10_allpole/390_sensors_instruments/41_limit_switches/ils_no'

/** Interrupteur à lame souple (ILS, capteur reed) : contact à lame dans une ampoule de verre, fermé par le champ de l'aimant du piston. */
export const extraSymbols: SymbolDef[] = [
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
