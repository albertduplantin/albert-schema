import type { SymbolDef } from '../../types'
import { pole, rect } from './kit'

/** Symboles propres à l'application qui n'existent pas dans la collection d'origine. */
const ilsPole = pole(0, [20, 0], [20, 60])

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
      ilsPole.svg + rect(12, 8, 16, 44, 'rx="8" fill="none"'),
    sim: { k: 'switch', poles: [['t0', 't1']], ctl: 'toggle', nc: false, blades: [{ rot: ilsPole.rot, closed: false }] },
  } as SymbolDef,
]
