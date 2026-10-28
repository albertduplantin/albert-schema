import type { Key } from './i18n'

export interface BuiltinMeta {
  /** clé du titre dans i18n, aussi identifiant de l'exemple intégré */
  key: Key
  level: 1 | 2 | 3
  about: { fr: string; en: string }
}

/** Exemples intégrés à l'application (leur dessin est dans templates.ts). L'administrateur peut les masquer. */
export const BUILTIN_META: BuiltinMeta[] = [
  { key: 'tplMotor', level: 1, about: { fr: 'Disjoncteur-moteur, contacteur, moteur, marche/arrêt à auto-maintien et voyant.', en: 'Motor breaker, contactor, motor, latched start/stop and lamp.' } },
  { key: 'tplLamps', level: 1, about: { fr: 'Voyants de marche (contact NO) et d’arrêt (contact NF) d’un même contacteur.', en: 'Run lamp (NO contact) and stop lamp (NC contact) from the same contactor.' } },
  { key: 'tplTimer', level: 1, about: { fr: 'Une lampe s’allume 5 s après la mise sous tension de la bobine temporisée.', en: 'A lamp comes on 5 s after the timed coil is energised.' } },
  { key: 'tplTrafo', level: 2, about: { fr: 'Commande en 24 V alternatif par un transformateur monophasé.', en: 'Control circuit at 24 V AC through a single-phase transformer.' } },
  { key: 'tplCascade', level: 2, about: { fr: 'KM2 démarre 5 s après KM1 grâce à une temporisation à la montée.', en: 'KM2 starts 5 s after KM1 thanks to an on-delay timer.' } },
  { key: 'tplRelay24', level: 2, about: { fr: 'Relais auxiliaire KA1 en 24 V alternatif avec bornier X1 : marche/arrêt, voyants par contacts NO et NF.', en: 'Auxiliary relay KA1 at 24 V AC with terminal block X1: start/stop, lamps through NO and NC contacts.' } },
  { key: 'tplReversing', level: 3, about: { fr: 'Deux sens de marche, deux phases permutées, verrouillage électrique KM1/KM2.', en: 'Two directions, two swapped phases, KM1/KM2 electrical interlock.' } },
  { key: 'tplPneu', level: 1, about: { fr: 'Vérin double effet et distributeur 5/2 manuel : maintenez le distributeur appuyé en simulation.', en: 'Double-acting cylinder and manual 5/2 valve: hold the valve pressed in simulation.' } },
  { key: 'tplPneuElec', level: 2, about: { fr: 'Électrodistributeur 5/2 commandé par un bouton ; le fin de course A1+ allume un voyant.', en: 'Solenoid 5/2 valve driven by a switch; the A1+ limit switch lights a lamp.' } },
  { key: 'tplPneuPlc', level: 3, about: { fr: 'Cycle A+ B+ A- B- : deux vérins 1A et 2A, distributeurs bistables 1V1 / 2V1 (bobines 1YV14, 1YV12, 2YV14, 2YV12), détecteurs a0 a1 b0 b1 et automate programmé en Grafcet.', en: 'A+ B+ A- B- cycle: two cylinders 1A and 2A, bistable valves 1V1 / 2V1 (coils 1YV14, 1YV12, 2YV14, 2YV12), position sensors a0 a1 b0 b1 and a PLC programmed in Grafcet.' } },
  { key: 'tplHydMotor', level: 2, about: { fr: 'Banc hydraulique : groupe motopompe 18 cm³ à 1500 tr/min, limiteur de pression à 100 bar, distributeur 4/3 centre fermé, limiteurs de débit unidirectionnels et moteur hydraulique 100 cm³. Maintenez le clic sur une électrovanne du distributeur, réglez l’ouverture des limiteurs et la charge du moteur, lisez pressions et vitesse.', en: 'Hydraulic bench: 18 cm³ motor-pump unit at 1500 rpm, relief valve at 100 bar, closed-centre 4/3 valve, one-way flow valves and a 100 cm³ hydraulic motor. Hold the click on a valve solenoid, set the flow valve opening and the motor load, read pressures and speed.' } },
  { key: 'tplHydCyl', level: 3, about: { fr: 'Banc hydraulique : vérin 50/30 course 350 avec limiteurs de débit à l’échappement. Observez l’effet multiplicateur de pression côté tige à la sortie et la vitesse du vérin selon l’ouverture des limiteurs.', en: 'Hydraulic bench: 50/30 cylinder, 350 stroke, with meter-out flow valves. Observe the pressure intensification on the rod side during extension and the cylinder speed as a function of the valve opening.' } },
  { key: 'tplPneuAuto', level: 3, about: { fr: 'Va-et-vient automatique A+ A- : distributeur bistable et deux fins de course.', en: 'Automatic A+ A- cycle: bistable valve and two limit switches.' } },
]
