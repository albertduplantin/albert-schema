import type { Lang, PlacedSymbol, Ratings, SymbolDef } from './types'
import { RATINGS } from './transformer'
import { motorCurrent as motorCurrentImpl } from './sim/estimate'

/** Famille d'appareil, qui détermine les caractéristiques que l'on peut renseigner. */
export type Kind = 'fuse' | 'breaker' | 'motorBreaker' | 'thermal' | 'contactor' | 'motor' | 'consumer' | 'rcd' | 'disconnector' | 'throttle' | 'pressure' | 'hpump' | 'hmotor' | 'hcyl' | 'joystick'

export function kindOf(def: SymbolDef | undefined): Kind | null {
  if (!def) return null
  const fk = def.fluid?.k
  if (fk === 'relief' || fk === 'reducer') return 'pressure'
  if (fk === 'valve' && (def.fluid as { prop?: boolean }).prop) return 'joystick'
  if (def.domain === 'hydraulic' && fk === 'fpump') return 'hpump'
  if (def.domain === 'hydraulic' && fk === 'fmotor') return 'hmotor'
  if (def.domain === 'hydraulic' && fk === 'cyl') return 'hcyl'
  const m = def.sim
  const id = def.id
  if (m?.k === 'switch') {
    if (/10_fuses/.test(id)) return 'fuse'
    if (/30_thermal_relays/.test(id)) return 'thermal'
    if (/50_residual_current_circuit_breaker/.test(id)) return /^Interrupteur/i.test(def.name.fr) ? 'rcd' : 'breaker'
    if (/12_magneto|11_circuit_breakers/.test(id)) return /moteur|motor|GV/i.test(def.name.fr + ' ' + def.name.en) ? 'motorBreaker' : 'breaker'
    if (/02_power_contacts/.test(id)) return 'contactor'
    if (/20_disconnecting/.test(id)) return 'disconnector'
    return null
  }
  if (def.fluid?.k === 'fthrottle') return 'throttle'
  if (m?.k === 'load') return m.role === 'motor' ? 'motor' : 'consumer'
  if (m?.k === 'coil') return 'consumer'
  return null
}

export interface FieldDef {
  key: keyof Ratings
  label: { fr: string; en: string }
  /** valeurs proposées */
  list?: (number | string)[]
  /** champ texte (courbe, type) plutôt que numérique */
  text?: boolean
  step?: number
  /** explication affichée en infobulle */
  help: { fr: string; en: string }
}

const IN_LIST = RATINGS
const F = {
  open: { key: 'open', label: { fr: 'Ouverture (%)', en: 'Opening (%)' }, help: { fr: 'Réglage du limiteur de débit : 100 % = pas d’étranglement, 10 % = très étranglé. Plus l’ouverture est faible, plus le vérin traversé par ce débit est lent (la vitesse est proportionnelle à l’ouverture).', en: 'Flow limiter setting: 100 % = no restriction, 10 % = heavily throttled. The smaller the opening, the slower the cylinder fed through it (speed is proportional to the opening).' }, list: [10, 25, 50, 75, 100] } as FieldDef,
  calibre: { key: 'in', label: { fr: 'Calibre (A)', en: 'Rating (A)' }, help: { fr: 'Courant assigné In de la protection : le courant maximal qu’elle supporte en permanence. Il doit être au moins égal au courant d’emploi et ne pas dépasser le courant admissible du câble (Ib ≤ In ≤ Iz).', en: "Rated current In of the protection: the maximum current it carries continuously. It must be at least the operating current and not exceed the cable's current rating (Ib ≤ In ≤ Iz)." }, list: IN_LIST } as FieldDef,
  ac3: { key: 'in', label: { fr: 'Courant assigné AC-3 (A)', en: 'Rated current AC-3 (A)' }, help: { fr: 'Courant maximal que le contacteur peut établir et couper pour un moteur à cage en catégorie AC-3. Il doit être au moins égal au courant nominal du moteur, sinon les contacts s’usent et se soudent.', en: 'Maximum current the contactor can make and break for a squirrel-cage motor in utilisation category AC-3. It must be at least the motor rated current, otherwise the contacts wear and weld.' }, list: [6, 9, 12, 18, 25, 32, 40, 50, 65, 80, 95] } as FieldDef,
  curveB: { key: 'curve', label: { fr: 'Courbe de déclenchement', en: 'Trip curve' }, help: { fr: 'Seuil du déclencheur magnétique (CEI 60898-1) : B = 3 à 5 × In (câbles longs, charges résistives) ; C = 5 à 10 × In (usage général) ; D = 10 à 20 × In (moteurs, transformateurs, fort appel de courant) ; K = 8 à 14 × In ; Z = 2 à 3 × In (électronique).', en: 'Magnetic trip threshold (IEC 60898-1): B = 3–5 × In (long cables, resistive loads); C = 5–10 × In (general use); D = 10–20 × In (motors, transformers, high inrush); K = 8–14 × In; Z = 2–3 × In (electronics).' }, list: ['B', 'C', 'D', 'K', 'Z'], text: true } as FieldDef,
  fuseType: { key: 'curve', label: { fr: 'Type de fusible', en: 'Fuse type' }, help: { fr: 'gG : usage général, protège câbles contre surcharges et courts-circuits. aM : accompagnement moteur, protège seulement des courts-circuits (à associer à un relais thermique). gR : ultra-rapide pour semi-conducteurs.', en: 'gG: general purpose, protects cables against overloads and short circuits. aM: motor back-up, short-circuit only (pair it with a thermal relay). gR: ultra-fast for semiconductors.' }, list: ['gG', 'aM', 'gR'], text: true } as FieldDef,
  trip: { key: 'curve', label: { fr: 'Classe de déclenchement', en: 'Trip class' }, help: { fr: 'Rapidité de déclenchement sous 7,2 × le réglage : classe 10A (2 à 10 s), 10 (4 à 10 s), 20 (6 à 20 s), 30 (9 à 30 s). La classe 10 convient à la plupart des démarrages, la 20 aux démarrages longs (ventilateurs, pompes lourdes).', en: 'Trip speed at 7.2 × the setting: class 10A (2–10 s), 10 (4–10 s), 20 (6–20 s), 30 (9–30 s). Class 10 suits most starts, class 20 long starts (fans, heavy pumps).' }, list: ['10A', '10', '20', '30'], text: true } as FieldDef,
  idn: { key: 'idn', label: { fr: 'Sensibilité différentielle IΔn (mA)', en: 'Residual current rating IΔn (mA)' }, help: { fr: 'Courant de fuite à la terre qui fait déclencher l’appareil. 30 mA protège les personnes contre les chocs électriques ; 300 mA protège les installations contre l’incendie ; 10 mA pour les locaux à risque.', en: 'Earth leakage current that trips the device. 30 mA protects people against electric shock; 300 mA protects installations against fire; 10 mA for high-risk areas.' }, list: [10, 30, 100, 300, 500] } as FieldDef,
  icu: { key: 'icu', label: { fr: 'Pouvoir de coupure (kA)', en: 'Breaking capacity (kA)' }, help: { fr: 'Pouvoir de coupure ultime : plus fort courant de court-circuit que l’appareil peut interrompre sans dommage. Il doit être supérieur au courant de court-circuit présumé à l’endroit où il est installé.', en: 'Ultimate breaking capacity: the highest short-circuit current the device can interrupt without damage. It must exceed the prospective short-circuit current at its installation point.' }, list: [3, 4.5, 6, 10, 15, 25, 50], step: 0.5 } as FieldDef,
  set: { key: 'set', label: { fr: 'Réglage thermique (A)', en: 'Thermal setting (A)' }, help: { fr: 'Courant de réglage du déclencheur thermique (Ir). On le règle sur le courant nominal inscrit sur la plaque du moteur : trop haut, le moteur n’est plus protégé ; trop bas, l’appareil déclenche en marche normale.', en: 'Thermal trip setting (Ir). Set it to the rated current on the motor nameplate: too high and the motor is unprotected; too low and the device trips in normal operation.' }, step: 0.1 } as FieldDef,
  min: { key: 'min', label: { fr: 'Plage de réglage : minimum (A)', en: 'Setting range: minimum (A)' }, help: { fr: 'Limite basse de la plage de réglage de l’appareil. Le courant du moteur doit se trouver dans la plage, de préférence vers son milieu.', en: 'Lower limit of the device setting range. The motor current must lie within the range, preferably near its middle.' }, step: 0.1 } as FieldDef,
  max: { key: 'max', label: { fr: 'Plage de réglage : maximum (A)', en: 'Setting range: maximum (A)' }, help: { fr: 'Limite haute de la plage de réglage de l’appareil (ex. 0,63 à 1 A pour un disjoncteur-moteur GV).', en: 'Upper limit of the device setting range (e.g. 0.63 to 1 A for a GV motor circuit breaker).' }, step: 0.1 } as FieldDef,
  kw: { key: 'kw', label: { fr: 'Puissance utile (kW)', en: 'Rated power (kW)' }, help: { fr: 'Puissance mécanique utile sur l’arbre, inscrite sur la plaque signalétique. Sert à estimer le courant nominal si vous ne le saisissez pas.', en: 'Useful mechanical power on the shaft, from the nameplate. Used to estimate the rated current if you do not enter it.' }, list: [0.18, 0.37, 0.55, 0.75, 1.1, 1.5, 2.2, 3, 4, 5.5, 7.5, 11, 15, 18.5, 22], step: 0.01 } as FieldDef,
  ie: { key: 'ie', label: { fr: 'Courant nominal (A) — plaque', en: 'Rated current (A) — nameplate' }, help: { fr: 'Courant nominal à pleine charge, relevé sur la plaque (pour la tension de couplage utilisée). Il remplace l’estimation faite à partir de la puissance.', en: 'Full-load rated current from the nameplate (for the connection voltage used). It replaces the estimate made from the power.' }, step: 0.1 } as FieldDef,
  cos: { key: 'cos', label: { fr: 'cos φ', en: 'Power factor cos φ' }, help: { fr: 'Facteur de puissance du moteur à pleine charge, typiquement de 0,8 à 0,9. Il intervient dans le calcul du courant à partir de la puissance.', en: 'Motor power factor at full load, typically 0.8 to 0.9. It enters the calculation of current from power.' }, list: [0.7, 0.75, 0.8, 0.85, 0.9], step: 0.01 } as FieldDef,
  ratio: { key: 'ratio', label: { fr: 'Courant de démarrage Id / In', en: 'Starting current Id / In' }, help: { fr: 'Rapport entre le courant de démarrage et le courant nominal : 5 à 8 pour un moteur asynchrone en démarrage direct. Il justifie le choix d’une courbe D ou d’un fusible aM.', en: 'Ratio of starting current to rated current: 5 to 8 for an induction motor started direct-on-line. It justifies a D curve or an aM fuse.' }, list: [5, 6, 7, 8], step: 0.5 } as FieldDef,
  watts: { key: 'watts', label: { fr: 'Puissance absorbée (W ou VA)', en: 'Power consumption (W or VA)' }, help: { fr: 'Puissance absorbée par le récepteur (W ou VA) : bobine de contacteur (quelques VA), voyant (1 à 3 W)… Elle sert au courant mesuré et au bilan de charge du transformateur de commande.', en: 'Power drawn by the load (W or VA): contactor coil (a few VA), lamp (1–3 W)… It feeds the measured current and the control transformer load budget.' }, list: [1, 2, 3, 5, 10, 15, 25], step: 0.5 } as FieldDef,
}

const H = {
  joy: { key: 'joy', label: { fr: 'Joystick (−100 à +100 %)', en: 'Joystick (−100 to +100 %)' }, help: { fr: 'Position du levier du joystick : le signe choisit le sens (case de gauche ou de droite), la valeur absolue règle l’ouverture du tiroir donc le débit vers le récepteur, et donc sa vitesse. 0 = centre : tout est fermé.', en: 'Joystick lever position: the sign picks the direction (left or right cell), the absolute value sets the spool opening hence the flow to the actuator and its speed. 0 = centre: everything closed.' }, list: [-100, -75, -50, -25, 0, 25, 50, 75, 100], step: 5 } as FieldDef,
  tarage: { key: 'set', label: { fr: 'Tarage (bar)', en: 'Setting (bar)' }, help: { fr: 'Pression de réglage du ressort. Limiteur de pression : il s’ouvre vers le réservoir quand la pression à son entrée dépasse cette valeur (il protège la pompe et le circuit : réglez-le au-dessus de la pression de travail, jamais au-delà de ce que supportent les composants). Réducteur : la pression en aval ne dépasse pas cette valeur.', en: 'Spring setting pressure. Relief valve: it opens to tank when the inlet pressure exceeds this value (it protects the pump and circuit: set it above working pressure, never beyond component ratings). Reducing valve: downstream pressure never exceeds this value.' }, list: [10, 25, 50, 70, 100, 150, 200, 250, 315], step: 1 } as FieldDef,
  regul: { key: 'set', label: { fr: 'Pression de régulation (bar)', en: 'Compensator pressure (bar)' }, help: { fr: 'Pompe à cylindrée variable : la pompe réduit son débit pour ne pas dépasser cette pression (régulation de pression constante). Sans effet sur une pompe à cylindrée fixe.', en: 'Variable pump: it reduces its flow so as not to exceed this pressure (constant-pressure control). No effect on a fixed pump.' }, list: [50, 70, 100, 150, 200], step: 1 } as FieldDef,
  disp: { key: 'disp', label: { fr: 'Cylindrée (cm³/tr)', en: 'Displacement (cm³/rev)' }, help: { fr: 'Volume d’huile déplacé par tour. Pompe : débit (L/min) = cylindrée × vitesse / 1000. Moteur : vitesse = débit × 1000 / cylindrée ; son couple vaut ΔP × cylindrée / 62,8.', en: 'Oil volume moved per revolution. Pump: flow (L/min) = displacement × speed / 1000. Motor: speed = flow × 1000 / displacement; its torque is ΔP × displacement / 62.8.' }, list: [10, 18, 25, 32, 50, 80, 100, 160, 250], step: 1 } as FieldDef,
  rpm: { key: 'rpm', label: { fr: 'Vitesse d’entraînement (tr/min)', en: 'Drive speed (rpm)' }, help: { fr: 'Vitesse du moteur électrique qui entraîne la pompe (1500 tr/min pour un moteur à 4 pôles en 50 Hz). Elle fixe le débit de la pompe.', en: 'Speed of the electric motor driving the pump (1500 rpm for a 4-pole motor at 50 Hz). It sets the pump flow.' }, list: [750, 1000, 1500, 3000], step: 50 } as FieldDef,
  mload: { key: 'load', label: { fr: 'Charge (bar de pression motrice)', en: 'Load (driving pressure, bar)' }, help: { fr: 'Pression différentielle nécessaire pour faire tourner le moteur sous charge (image du couple résistant). Plus la charge est grande, plus la pression du circuit monte, jusqu’au tarage du limiteur de pression.', en: 'Differential pressure needed to turn the motor under load (image of the resisting torque). The higher the load, the higher the circuit pressure, up to the relief valve setting.' }, list: [0, 5, 25, 50, 75, 100], step: 1 } as FieldDef,
  bore: { key: 'bore', label: { fr: 'Alésage (mm)', en: 'Bore (mm)' }, help: { fr: 'Diamètre du piston. La force développée vaut pression × surface du piston ; la vitesse vaut débit / surface.', en: 'Piston diameter. Force = pressure × piston area; speed = flow / area.' }, list: [32, 40, 50, 63, 80, 100], step: 1 } as FieldDef,
  rod: { key: 'rod', label: { fr: 'Diamètre de tige (mm)', en: 'Rod diameter (mm)' }, help: { fr: 'La tige réduit la section côté tige : le vérin sort plus lentement qu’il ne rentre à débit égal, et l’effort en rentrée est plus faible. Un limiteur de débit placé à l’échappement multiplie la pression côté tige par le rapport des sections.', en: 'The rod reduces the annular area: the cylinder extends more slowly than it retracts at equal flow and pushes less on retraction. A meter-out flow valve multiplies the rod-side pressure by the area ratio.' }, list: [18, 22, 28, 30, 36, 45, 56], step: 1 } as FieldDef,
  stroke: { key: 'stroke', label: { fr: 'Course (mm)', en: 'Stroke (mm)' }, help: { fr: 'Déplacement de la tige. Elle fixe le temps de sortie ou de rentrée pour un débit donné.', en: 'Rod travel. It sets the extension or retraction time for a given flow.' }, list: [100, 200, 350, 500, 1000], step: 10 } as FieldDef,
  cload: { key: 'load', label: { fr: 'Charge sur la tige (daN)', en: 'Load on the rod (daN)' }, help: { fr: 'Effort que la tige doit vaincre. La pression nécessaire côté fond vaut effort / surface du piston (en daN et cm², le résultat est en bar). Elle s’ajoute à la pression d’échappement.', en: 'Force the rod must overcome. The cap-side pressure needed is force / piston area (in daN and cm² the result is in bar). It adds to the exhaust-side pressure.' }, list: [0, 100, 250, 500, 1000, 2000], step: 10 } as FieldDef,
}

export const FIELDS: Record<Kind, FieldDef[]> = {
  pressure: [H.tarage],
  hpump: [H.disp, H.rpm, H.regul],
  hmotor: [H.disp, H.mload],
  hcyl: [H.bore, H.rod, H.stroke, H.cload],
  joystick: [H.joy],
  fuse: [F.calibre, F.fuseType, F.icu],
  breaker: [F.calibre, F.curveB, F.icu],
  motorBreaker: [F.calibre, F.curveB, F.min, F.max, F.set, F.icu],
  thermal: [F.min, F.max, F.set, F.trip],
  contactor: [F.ac3],
  motor: [F.kw, F.ie, F.cos, F.ratio],
  consumer: [F.watts],
  rcd: [F.calibre, F.idn],
  disconnector: [F.calibre],
  throttle: [F.open],
}

/** Champs d'un appareil : ceux de sa famille, plus la sensibilité différentielle pour un disjoncteur différentiel. */
export function fieldsFor(def: SymbolDef | undefined): FieldDef[] {
  const k = kindOf(def)
  if (!k) return []
  const f = k === 'hpump' && def && !/variable/i.test(def.name.fr) && !(def.fluid as { variable?: boolean } | undefined)?.variable ? FIELDS[k].filter((x) => x.label.fr !== 'Pression de régulation (bar)') : FIELDS[k]
  return k === 'breaker' && def && /50_residual_current_circuit_breaker/.test(def.id) ? [...f, F.idn] : f
}

export const motorCurrent = motorCurrentImpl

/**
 * Calibre maximal usuel de la protection d'un conducteur en cuivre isolé PVC, par section (mm²) : la règle de base est
 * Ib ≤ In ≤ Iz. Valeurs courantes en installation (NF C 15-100) : 1,5 mm² → 16 A, 2,5 mm² → 20 A, 6 mm² → 32 A…
 * Repères de pré-étude : à confirmer avec le mode de pose, la température et le regroupement des câbles.
 */
export const CABLE_MAX_PROTECTION: [number, number][] = [[0.75, 6], [1, 10], [1.5, 16], [2.5, 20], [4, 25], [6, 32], [10, 50], [16, 63], [25, 80], [35, 100], [50, 125]]

export function maxProtection(section: number): number | undefined {
  if (!(section > 0)) return undefined
  let best: number | undefined
  for (const [s, a] of CABLE_MAX_PROTECTION) if (s <= section + 1e-9) best = a
  return best
}

export const parseSection = (v: string | undefined): number | undefined => {
  const n = parseFloat(String(v ?? '').replace(',', '.'))
  return n > 0 ? n : undefined
}

export const fieldLabel = (f: FieldDef, lang: Lang) => f.label[lang]
