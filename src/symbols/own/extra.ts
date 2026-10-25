import type { SymbolDef } from '../../types'
import { BG, DASH, circle, line, path, pole, rect, text } from './kit'

/** Symboles propres à l'application qui n'existent pas dans la collection d'origine. */
const ilsPole = pole(0, [20, 0], [20, 60])

export const ILS_ID = 'qet:10_electric/10_allpole/390_sensors_instruments/41_limit_switches/ils_no'

/** Interrupteur à lame souple (ILS) : lame dans une ampoule de verre, fermée par le champ d'un aimant (piston de vérin). */
export const extraSymbols: SymbolDef[] = [
  {
    id: ILS_ID,
    domain: 'electrical',
    cat: '10_electric_10_allpole/390_sensors_instruments',
    group: { fr: 'Fins de course', en: 'Limits' },
    score: 85,
    top: true,
    prefix: 'B',
    name: { fr: 'Détecteur à lame souple ILS (NO)', en: 'Reed switch, magnetic detector (NO)' },
    std: 'CEI 60617',
    w: 20,
    h: 60,
    ports: [{ id: 't0', x: 20, y: 0, dir: 'up' }, { id: 't1', x: 20, y: 60, dir: 'down' }],
    svg:
      rect(11, 8, 18, 44, `rx="9" fill="none" ${DASH}`) +
      ilsPole.svg +
      rect(-9, 24, 10, 12, BG) + path('M-9 24H-4V36H-9Z', 'fill="currentColor"') + text(-4, 21, 'N S', 5) +
      line([1, 30], [11, 30], DASH) +
      circle(20, 30, 0.01, 'fill="none" stroke="none"'),
    sim: { k: 'switch', poles: [['t0', 't1']], ctl: 'toggle', nc: false, blades: [{ rot: ilsPole.rot, closed: false }] },
  } as SymbolDef,
]
