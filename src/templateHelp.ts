import { uid } from './geometry'
import type { Lang, Note } from './types'

interface Help { x: number; y: number; title: { fr: string; en: string }; text: { fr: string; en: string } }

/** Boutons d'explication (ⓘ) posés sur certains exemples de la galerie : le texte s'affiche à côté du bouton au clic. */
const HELPS: Record<string, Help[]> = {
  tplHydTP5: [
    {
      x: 360, y: 590,
      title: { fr: 'Le groupe hydraulique', en: 'The power unit' },
      text: {
        fr: 'Le moteur entraîne la pompe GMP, qui aspire l’huile dans la bâche et l’envoie dans le circuit. Le limiteur de pression LP, réglé à 100 bar (manomètre G3), fixe la pression maximale : au-delà, l’huile retourne à la bâche.',
        en: 'The motor drives pump GMP, which draws oil from the tank and sends it into the circuit. Relief valve LP, set to 100 bar (gauge G3), sets the maximum pressure: above it, the oil returns to the tank.',
      },
    },
    {
      x: 10, y: 60,
      title: { fr: 'Le moteur hydraulique M2', en: 'Hydraulic motor M2' },
      text: {
        fr: 'Le distributeur 4/3 1V1 commande le sens de rotation : 1Y1 dans un sens, 1Y2 dans l’autre. Les limiteurs de débit LA (8 %) et LB (12 %) règlent la vitesse. G1 et G2 donnent la pression sur chaque orifice du moteur.',
        en: 'The 4/3 valve 1V1 sets the direction of rotation: 1Y1 one way, 1Y2 the other. Flow controls LA (8%) and LB (12%) set the speed. G1 and G2 show the pressure at each motor port.',
      },
    },
    {
      x: 700, y: 40,
      title: { fr: 'Le vérin 1A', en: 'Cylinder 1A' },
      text: {
        fr: 'Le distributeur 4/3 1V2 commande le sens de déplacement du vérin : 1Y3 pour un sens, 1Y4 pour l’autre. G4 et G5 donnent la pression dans les deux chambres.',
        en: 'The 4/3 valve 1V2 sets the direction of the cylinder: 1Y3 one way, 1Y4 the other. G4 and G5 show the pressure in the two chambers.',
      },
    },
    {
      x: 880, y: 250,
      title: { fr: 'Les limiteurs RA et RB', en: 'Relief valves RA and RB' },
      text: {
        fr: 'Chaque chambre du vérin est protégée par son propre limiteur de pression, relié à la bâche : RA à 80 bar côté fond, RB à 40 bar côté tige. Si la pression d’une chambre dépasse son réglage, l’huile s’échappe vers la bâche. Ces limiteurs sont réglés sous le limiteur principal LP (100 bar).',
        en: 'Each cylinder chamber is protected by its own relief valve connected to the tank: RA at 80 bar on the piston side, RB at 40 bar on the rod side. If a chamber pressure goes above its setting, the oil escapes to the tank. They are set below the main relief valve LP (100 bar).',
      },
    },
  ],
}

const h = (x: number, y: number, tfr: string, ten: string, ffr: string, fen: string): Help => ({ x, y, title: { fr: tfr, en: ten }, text: { fr: ffr, en: fen } })

// explications posées sur le schéma des autres exemples : une par organe ou par groupe d'organes ; la fiche générale de l'exemple reste dans le panneau ⓘ de la barre d'outils
Object.assign(HELPS, {
  tplMotor: [
    h(95, 90, 'Le circuit de puissance', 'The power circuit',
      'Le disjoncteur-moteur protège le moteur contre les surcharges et les courts-circuits. Le contacteur KM1 ferme ses trois pôles pour alimenter le moteur triphasé : c’est lui qui commute le courant, la commande ne manipule que la bobine.',
      'The motor breaker protects the motor against overloads and short circuits. Contactor KM1 closes its three poles to supply the three-phase motor: it switches the power current, the control circuit only drives the coil.'),
    h(365, 195, 'Marche, arrêt et auto-maintien', 'Start, stop and latching',
      'S1 (arrêt) est un contact fermé au repos, S2 (marche) un contact ouvert au repos. Quand KM1 colle, son contact auxiliaire en parallèle de S2 garde la bobine alimentée : on peut relâcher S2, le moteur continue. Appuyer sur S1 coupe tout.',
      'S1 (stop) is closed at rest, S2 (start) is open at rest. When KM1 pulls in, its auxiliary contact in parallel with S2 keeps the coil supplied: release S2 and the motor keeps running. Pressing S1 drops everything.'),
  ],
  tplLamps: [
    h(365, 195, 'La commande de KM1', 'The KM1 control',
      'S2 (marche) alimente la bobine de KM1, qui s’auto-maintient. S1 (arrêt) coupe l’alimentation. Les contacts auxiliaires de KM1 informent ensuite les voyants sans toucher à la bobine.',
      'S2 (start) energises the KM1 coil, which latches itself. S1 (stop) cuts the supply. KM1 auxiliary contacts then feed the lamps without touching the coil.'),
    h(555, 85, 'Voyant de marche', 'Run lamp',
      'Un contact normalement ouvert de KM1 commande le voyant H1 : il se ferme quand la bobine est alimentée, donc H1 s’allume seulement quand KM1 est collé.',
      'A normally open KM1 contact drives lamp H1: it closes when the coil is energised, so H1 only lights while KM1 is pulled in.'),
    h(675, 85, 'Voyant d’arrêt', 'Stop lamp',
      'Un contact normalement fermé de KM1 commande le voyant H2 : il est fermé au repos, donc H2 est allumé quand KM1 est retombé, et s’éteint dès que la bobine est alimentée.',
      'A normally closed KM1 contact drives lamp H2: it is closed at rest, so H2 is lit while KM1 is released and goes out as soon as the coil is energised.'),
  ],
  tplTimer: [
    h(365, 195, 'La bobine temporisée', 'The timer coil',
      'Le commutateur alimente la bobine d’un relais temporisé à la montée : ses contacts ne changent d’état qu’au bout de la durée réglée (5 s), pas tout de suite.',
      'The switch supplies an on-delay timer coil: its contacts only change state after the set time (5 s), not immediately.'),
    h(495, 95, 'Contact temporisé et lampe', 'Timed contact and lamp',
      'Le contact associé se ferme 5 s après la mise sous tension de la bobine, et seulement alors la lampe s’allume. Si on coupe la bobine avant la fin, le contact ne s’est jamais fermé.',
      'The associated contact closes 5 s after the coil is energised, and only then does the lamp light. If you cut the coil before the end, the contact never closes.'),
  ],
  tplTrafo: [
    h(380, 55, 'Le transformateur de commande', 'The control transformer',
      'Il abaisse la tension du réseau à 24 V alternatif pour le circuit de commande, qui est ainsi isolé du réseau et moins dangereux pour l’opérateur. Un fusible protège le primaire, un autre le secondaire.',
      'It steps the mains voltage down to 24 V AC for the control circuit, which is therefore isolated from the mains and safer for the operator. One fuse protects the primary, another the secondary.'),
    h(365, 165, 'La commande en 24 V', 'The 24 V control',
      'Les boutons, la bobine du contacteur et le voyant fonctionnent en 24 V : le montage de marche et d’arrêt avec auto-maintien est le même, seule la tension change.',
      'The buttons, the contactor coil and the lamp run on 24 V: the start/stop latching circuit is the same, only the voltage changes.'),
  ],
  tplCascade: [
    h(365, 195, 'Démarrage du premier moteur', 'Starting the first motor',
      'S2 (marche) alimente la bobine de KM1 et l’auto-maintient. Un autre contact de KM1 sert de départ à la deuxième colonne.',
      'S2 (start) energises the KM1 coil and latches it. Another KM1 contact feeds the second column.'),
    h(545, 195, 'La temporisation', 'The delay',
      'Quand KM1 colle, son contact alimente une bobine temporisée à la montée : elle attend 5 s avant de fermer son propre contact.',
      'When KM1 pulls in, its contact supplies an on-delay timer coil: it waits 5 s before closing its own contact.'),
    h(665, 195, 'Le deuxième contacteur', 'The second contactor',
      'Le contact temporisé alimente la bobine de KM2 : le deuxième moteur démarre 5 s après le premier, ce qui évite deux appels de courant simultanés.',
      'The timed contact supplies the KM2 coil: the second motor starts 5 s after the first, avoiding two simultaneous inrush currents.'),
  ],
  tplRelay24: [
    h(380, 55, 'Alimentation en 24 V', '24 V supply',
      'Le transformateur de commande alimente tout le montage en 24 V alternatif, protégé par un fusible au primaire et un au secondaire.',
      'The control transformer supplies the whole circuit with 24 V AC, protected by a fuse on the primary and one on the secondary.'),
    h(430, 220, 'Le bornier X1', 'Terminal block X1',
      'Les bornes de continuité repèrent chaque raccordement vers l’extérieur du coffret : les boutons et les voyants sont câblés sur le bornier, pas directement sur les appareils.',
      'The continuity terminals mark each connection to the outside of the cabinet: buttons and lamps are wired to the terminal block, not directly to the devices.'),
    h(525, 190, 'Contacts NO et NF du relais', 'Relay NO and NC contacts',
      'Quand KA1 colle, son contact normalement ouvert allume H2 et son contact normalement fermé éteint H1 : un seul petit relais pilote plusieurs circuits.',
      'When KA1 pulls in, its normally open contact lights H2 and its normally closed contact turns H1 off: one small relay drives several circuits.'),
  ],
  tplReversing: [
    h(95, 215, 'Deux contacteurs, deux phases permutées', 'Two contactors, two swapped phases',
      'KM1 relie les phases dans l’ordre, KM2 en permute deux : le champ tournant du moteur change de sens, donc le moteur tourne dans l’autre sens.',
      'KM1 connects the phases in order, KM2 swaps two of them: the motor rotating field reverses, so the motor turns the other way.'),
    h(385, 270, 'Le verrouillage électrique', 'The electrical interlock',
      'Le contact normalement fermé de chaque contacteur est placé en série avec la bobine de l’autre : tant que l’un est collé, l’autre ne peut pas coller. Sans cela, deux contacteurs fermés en même temps provoqueraient un court-circuit entre phases.',
      'Each contactor normally closed contact is in series with the other coil: while one is pulled in, the other cannot pull in. Without it, both closing together would short-circuit the phases.'),
  ],
  tplPneu: [
    h(150, 85, 'Le vérin double effet', 'The double-acting cylinder',
      'L’air sous pression pousse le piston dans les deux sens : une chambre se remplit pendant que l’autre s’échappe. La tige sort ou rentre selon la chambre alimentée.',
      'Compressed air pushes the piston both ways: one chamber fills while the other exhausts. The rod extends or retracts depending on the chamber supplied.'),
    h(170, 225, 'Le distributeur 5/2 manuel', 'The manual 5/2 valve',
      'Il oriente l’air vers l’une ou l’autre chambre. En simulation, maintenez le clic sur le distributeur pour le manœuvrer.',
      'It sends the air to one chamber or the other. In simulation, hold the click on the valve to operate it.'),
  ],
  tplPneuElec: [
    h(170, 225, 'L’électrodistributeur', 'The solenoid valve',
      'Le distributeur est commandé par une bobine : quand elle est alimentée par le circuit de commande, le tiroir change de position et le vérin sort. Le repère de l’électroaimant est le même sur le distributeur et sur le schéma électrique.',
      'The valve is operated by a coil: when the control circuit supplies it, the spool shifts and the cylinder extends. The solenoid tag is the same on the valve and on the electrical diagram.'),
    h(575, 100, 'La fin de course', 'The limit switch',
      'Le détecteur de position est actionné par la tige du vérin en bout de course : il ferme son contact et allume le voyant, ce qui informe l’opérateur que la position est atteinte.',
      'The position sensor is actuated by the cylinder rod at the end of its stroke: it closes its contact and lights the lamp, telling the operator the position is reached.'),
  ],
  tplPneuAuto: [
    h(170, 225, 'Le distributeur bistable', 'The bistable valve',
      'Il a deux bobines, YV1 et YV2, et garde sa position quand on les coupe : une impulsion suffit pour changer d’état, il n’a pas besoin d’être alimenté en permanence.',
      'It has two coils, YV1 and YV2, and keeps its position when they are cut: a pulse is enough to change state, it does not need to be energised all the time.'),
    h(445, 170, 'Les fins de course A1+ et A1−', 'Limit switches A1+ and A1−',
      'Quand la tige atteint l’extrémité, le détecteur donne l’ordre suivant : A1+ déclenche le retour, A1− relance la sortie. C’est ce qui enchaîne les mouvements sans intervention.',
      'When the rod reaches the end, the sensor gives the next order: A1+ triggers the return, A1− restarts the extension. That is what chains the movements without intervention.'),
  ],
  tplPneuPlc: [
    h(150, 55, 'Les deux vérins', 'The two cylinders',
      'Chaque vérin a son électrodistributeur bistable. Le cycle A+ B+ A− B− signifie : A sort, B sort, A rentre, B rentre, chaque mouvement attendant que le précédent soit terminé.',
      'Each cylinder has its own bistable solenoid valve. The A+ B+ A− B− cycle means: A extends, B extends, A retracts, B retracts, each movement waiting for the previous one to finish.'),
    h(600, 100, 'Les détecteurs de position', 'The position sensors',
      'Quatre détecteurs a0, a1, b0, b1 indiquent si chaque vérin est rentré ou sorti. Ils sont câblés sur les entrées de l’automate et servent de conditions pour passer à l’étape suivante.',
      'Four sensors a0, a1, b0, b1 tell whether each cylinder is retracted or extended. They are wired to the controller inputs and act as conditions to move to the next step.'),
    h(650, 330, 'L’automate programmable', 'The programmable controller',
      'Il lit les détecteurs, déroule le Grafcet et commande les électrodistributeurs par ses sorties. Double-cliquez dessus pour ouvrir son programme.',
      'It reads the sensors, runs the Grafcet and drives the solenoid valves through its outputs. Double-click it to open its program.'),
  ],
  tplHydMotor: [
    h(100, 245, 'Les limiteurs de débit', 'The flow controls',
      'Placés à l’admission du moteur, ils règlent le débit d’huile et donc sa vitesse : avec − et + sous chaque limiteur, vous changez l’ouverture et lisez le nouveau régime.',
      'Placed at the motor inlet, they set the oil flow and therefore its speed: with − and + under each valve you change the opening and read the new speed.'),
    h(270, 355, 'Le distributeur 4/3', 'The 4/3 valve',
      'Centre fermé : le moteur est à l’arrêt. Maintenez un électroaimant pour l’alimenter par un côté (un sens de rotation), l’autre pour l’inverser.',
      'Closed centre: the motor is stopped. Hold one solenoid to supply it from one side (one direction of rotation), the other to reverse it.'),
    h(420, 495, 'Le limiteur de pression', 'The relief valve',
      'Il fixe la pression maximale du circuit : le débit de la pompe que le moteur n’utilise pas s’échappe par lui vers la bâche, avec une perte de puissance en chaleur.',
      'It sets the maximum circuit pressure: the pump flow the motor does not use escapes through it to the tank, as lost power turned into heat.'),
  ],
  tplHydCyl: [
    h(100, 245, 'Les limiteurs de débit à l’échappement', 'The meter-out flow controls',
      'Placés sur le retour de chaque chambre, ils freinent l’huile qui s’échappe : le vérin avance contre une pression qui retient la charge, ce qui stabilise le mouvement.',
      'Placed on the return of each chamber, they restrict the oil leaving: the cylinder moves against a pressure that holds the load, which stabilises the motion.'),
    h(270, 115, 'Le vérin et ses manomètres', 'The cylinder and its gauges',
      'G1 et G2 donnent la pression de chaque chambre. Côté tige, l’étranglement fait monter la pression plus haut que celle du limiteur : c’est l’effet multiplicateur.',
      'G1 and G2 show the pressure in each chamber. On the rod side, the restriction raises the pressure above the relief setting: this is the pressure intensification effect.'),
  ],
  tplHydTP6: [
    h(510, 470, 'Le réducteur de pression', 'The pressure reducing valve',
      'Ouvert au repos, il se referme quand la pression en aval atteint son tarage (50 bar) : le vérin reste à 50 bar pendant que le moteur garde les 100 bar du circuit.',
      'Open at rest, it closes when the downstream pressure reaches its setting (50 bar): the cylinder stays at 50 bar while the motor keeps the 100 bar of the circuit.'),
    h(100, 110, 'Le moteur', 'The motor',
      'Contrairement au TP5, le moteur garde sa vitesse quand le vérin est en butée, car la pression du circuit n’est pas ramenée à celle du vérin.',
      'Unlike TP5, the motor keeps its speed when the cylinder is at its end stop, because the circuit pressure is not pulled down to the cylinder’s.'),
    h(610, 110, 'Le vérin', 'The cylinder',
      'Maintenez le distributeur jusqu’en butée : G4 ou G5 reste à 50 bar. Inconvénient du montage : en butée, tout le débit de la pompe passe par le limiteur principal à 100 bar, donc la puissance perdue est maximale.',
      'Hold the valve until the end stop: G4 or G5 stays at 50 bar. Drawback of this circuit: at the end stop, all the pump flow goes through the main relief at 100 bar, so lost power is at its maximum.'),
  ],
  tplHydTP7: [
    h(205, 245, 'Les clapets anti-retour pilotés', 'The pilot-operated check valves',
      'Chaque clapet laisse passer l’huile dans un sens et la bloque dans l’autre, sauf si la pression de l’autre ligne le débloque. Ils sont croisés : la pression qui pousse d’un côté ouvre le clapet de retour de l’autre côté.',
      'Each valve lets oil through one way and blocks the other, unless the pressure of the other line unlocks it. They are cross-connected: the pressure pushing on one side opens the return valve on the other side.'),
    h(270, 355, 'Distributeur au centre : vérin bloqué', 'Valve centred: cylinder locked',
      'Quand le distributeur est au centre, A et B sont reliés à la bâche mais les clapets retiennent l’huile dans les chambres : le vérin chargé ne bouge pas. Attention : de la pression peut rester piégée, purgez avant de démonter.',
      'With the valve centred, A and B go to the tank but the check valves hold the oil in the chambers: the loaded cylinder does not move. Careful: pressure can stay trapped, bleed it before dismantling.'),
  ],
  tplHydTP8: [
    h(280, 605, 'La pompe à cylindrée variable', 'The variable-displacement pump',
      'Un régulateur réduit la cylindrée quand la pression atteint 100 bar : la pompe ne fournit que le débit réellement consommé, donc il n’y a plus de surplus qui part à la bâche en chaleur.',
      'A regulator reduces the displacement when the pressure reaches 100 bar: the pump only delivers the flow actually used, so no surplus is lost to the tank as heat.'),
    h(420, 495, 'Le limiteur de sécurité', 'The safety relief valve',
      'Réglé plus haut (120 bar), il ne s’ouvre qu’en cas de défaut de la régulation : il protège le circuit mais ne travaille pas en fonctionnement normal.',
      'Set higher (120 bar), it only opens if the regulation fails: it protects the circuit but does not work in normal operation.'),
    h(100, 110, 'Le moteur', 'The motor',
      'Maintenez un électroaimant : le débit de la pompe s’ajuste à la vitesse du moteur et la pression reste proche de 100 bar. Comparez avec le TP1 : mêmes réglages, mais ici la puissance perdue est faible.',
      'Hold a solenoid: the pump flow adjusts to the motor speed and the pressure stays near 100 bar. Compare with TP1: same settings, but here the lost power is small.'),
  ],
  tplHydTP9: [
    h(280, 605, 'La pompe Load Sensing', 'The Load Sensing pump',
      'Elle reçoit la pression la plus haute des lignes du moteur (signal LS) et garde 15 bar de plus : elle adapte à la fois le débit et la pression à la charge.',
      'It receives the highest pressure of the motor lines (LS signal) and keeps 15 bar above it: it adapts both flow and pressure to the load.'),
    h(120, 315, 'Le sélecteur de circuit', 'The shuttle valve',
      'Il relève la plus haute des deux pressions du moteur et l’envoie à la pompe. Sans lui, la pompe ne saurait pas quelle est la pression de la charge.',
      'It picks the higher of the two motor pressures and sends it to the pump. Without it, the pump would not know the load pressure.'),
    h(100, 110, 'Le moteur', 'The motor',
      'Faites varier la charge : la pression de pompe suit (charge + 15 bar) mais la vitesse reste presque constante, car la chute de pression dans les limiteurs de débit est toujours de 15 bar.',
      'Vary the load: the pump pressure follows (load + 15 bar) but the speed stays almost constant, because the pressure drop across the flow controls is always 15 bar.'),
  ],
} as Record<string, Help[]>)

/** Boutons d'explication de l'exemple `key`, dans la langue demandée (aucun si l'exemple n'en a pas). */
export const templateHelps = (key: string | undefined, lang: Lang): Note[] =>
  (key ? HELPS[key] ?? [] : []).map((h) => ({ id: uid(), x: h.x, y: h.y, text: h.text[lang], title: h.title[lang], size: 12, help: true }))
