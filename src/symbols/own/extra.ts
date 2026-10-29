import type { SymbolDef } from '../../types'
import { angle, blade, contacts, diamond, line, rect, text, type Head, type Pt, type PoleMark } from './kit'

/** Symboles propres à l'application qui n'existent pas dans la collection d'origine. */
// lame ouverte : sa pointe reste à l'intérieur de l'ampoule (x de 8 à 32)
const hinge: Pt = [20, 46], closed: Pt = [20, 14], open: Pt = [12, 16]
const ilsRot = angle([open[0] - hinge[0], open[1] - hinge[1]], [closed[0] - hinge[0], closed[1] - hinge[1]])
const ilsSvg = line([20, 0], closed) + line([20, 60], hinge) + blade(0, hinge, open)

/** Bouton ou commutateur à plusieurs contacts actionnés ensemble : un pôle par contact (NO ou NF), liés par la même commande. */
function multi(tail: string, ncs: boolean[], head: Head, ctl: 'momentary' | 'toggle', fr: string, en: string, posPoles?: number[]): SymbolDef {
  const x0 = head === 'turn' ? 30 : head === 'key' ? 20 : 10 // place pour la tête de commande à gauche du premier pôle
  const ports = ncs.flatMap((_, i) => [{ id: 't' + 2 * i, x: x0 + 20 * i, y: 0, dir: 'up' as const }, { id: 't' + (2 * i + 1), x: x0 + 20 * i, y: 60, dir: 'down' as const }])
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
    w: x0 - 10 + 20 * ncs.length,
    h: 60,
    ports,
    svg: c.svg,
    sim: { k: 'switch', poles, ctl, nc: ncs[0], ncPoles: ncs, blades: c.blades, ...(posPoles ? { pos3: true, posPoles } : {}) },
  } as SymbolDef
}

export const ILS_ID = 'qet:10_electric/10_allpole/390_sensors_instruments/41_limit_switches/ils_no'

/**
 * Capteur magnétique de vérin à 3 fils (électronique) : 1 (marron) = +24 V, 3 (bleu) = 0 V, 4 (noir) = sortie.
 * PNP : la sortie passe au +24 V quand l'aimant du piston est détecté (la charge est entre la sortie et 0 V).
 * NPN : la sortie passe au 0 V (la charge est entre +24 V et la sortie). Pour la simulation, c'est un contact entre l'alimentation concernée et la sortie.
 */
function magnetic3(tail: string, pnp: boolean): SymbolDef {
  return {
    id: `own:elec/390_sensors_instruments/03_sensors_magnetic/${tail}`,
    domain: 'electrical',
    cat: '10_electric_10_allpole/390_sensors_instruments',
    group: { fr: 'Fins de course', en: 'Limits' },
    score: 84,
    top: true,
    prefix: 'B',
    name: pnp
      ? { fr: 'Capteur magnétique de vérin, 3 fils PNP (NO)', en: 'Cylinder magnetic sensor, 3-wire PNP (NO)' }
      : { fr: 'Capteur magnétique de vérin, 3 fils NPN (NO)', en: 'Cylinder magnetic sensor, 3-wire NPN (NO)' },
    std: 'CEI 60617',
    w: 60,
    h: 60,
    ports: [
      { id: 't0', x: 10, y: 0, dir: 'up', label: '1' },
      { id: 't1', x: 10, y: 60, dir: 'down', label: '3' },
      { id: 't2', x: 60, y: 30, dir: 'right', label: '4' },
    ],
    svg:
      line([10, 0], [10, 10]) + line([10, 50], [10, 60]) + line([40, 30], [60, 30]) +
      rect(0, 10, 40, 40, 'fill="none"') +
      text(20, 22, pnp ? 'PNP' : 'NPN', 8, 'font-weight="700"') +
      diamond(20, 36, 9) + text(20, 39, 'M', 9, 'font-weight="700"'),
    sim: { k: 'switch', poles: [[pnp ? 't0' : 't1', 't2']], ctl: 'toggle', nc: false },
  } as SymbolDef
}

/** Copie d'un capteur de position dans la palette pneumatique (catégorie Capteurs), pour les schémas de vérins sans passer par l'électricité. */
const inPneumatic = (s: SymbolDef): SymbolDef => ({
  ...s,
  domain: 'pneumatic',
  cat: '50_pneumatic/5040_sensors',
  group: { fr: 'Détecteurs de position de vérin', en: 'Cylinder position sensors' },
} as SymbolDef)

/** Interrupteur à lame souple (ILS, capteur reed) : contact à lame dans une ampoule de verre, fermé par le champ de l'aimant du piston. */
export const extraSymbols: SymbolDef[] = [
  multi('poussoir_2no', [false, false], 'push', 'momentary', 'Bouton poussoir, 2 contacts à fermeture (2 NO)', 'Push button, 2 make contacts (2 NO)'),
  multi('poussoir_2nf', [true, true], 'push', 'momentary', 'Bouton poussoir, 2 contacts à ouverture (2 NF)', 'Push button, 2 break contacts (2 NC)'),
  multi('poussoir_no_nf', [false, true], 'push', 'momentary', 'Bouton poussoir, 1 contact à fermeture + 1 à ouverture (1 NO + 1 NF)', 'Push button, 1 make + 1 break contact (1 NO + 1 NC)'),
  multi('commutateur_2no', [false, false], 'turn', 'toggle', 'Commutateur à tête tournante, 2 contacts à fermeture (2 NO)', 'Rotary switch, 2 make contacts (2 NO)'),
  multi('commutateur_2nf', [true, true], 'turn', 'toggle', 'Commutateur à tête tournante, 2 contacts à ouverture (2 NF)', 'Rotary switch, 2 break contacts (2 NC)'),
  multi('commutateur_no_nf', [false, true], 'turn', 'toggle', 'Commutateur à tête tournante, 1 contact à fermeture + 1 à ouverture (1 NO + 1 NF)', 'Rotary switch, 1 make + 1 break contact (1 NO + 1 NC)'),
  multi('commutateur_3pos_2no', [false, false], 'key', 'toggle', 'Commutateur verrouillable à 3 positions (1-0-2), 2 NO (un par position), centre sans contact actionné', 'Lockable 3-position switch (1-0-2), 2 NO (one per position), centre actuates no contact', [1, 2]),
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
  magnetic3('capteur_magnetique_pnp', true),
  magnetic3('capteur_magnetique_npn', false),
]
// mêmes capteurs dans la palette pneumatique (Capteurs) : identifiants distincts, même dessin et même simulation
extraSymbols.push(...extraSymbols.filter((s) => /ils_no$|capteur_magnetique_(pnp|npn)$/.test(s.id)).map((s) => ({ ...inPneumatic(s), id: 'own:pneu/5040_sensors/' + s.id.split('/').pop() })))
