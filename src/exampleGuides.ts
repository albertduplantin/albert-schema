/** Fiche pédagogique d'un exemple intégré : à quoi il sert, ce qu'il apprend, ce qu'on peut simuler. Clé = clé de galleryMeta. */
export interface ExampleGuide {
  purpose: string
  learn: string[]
  simulate: string[]
}

export const EXAMPLE_GUIDES: Record<string, { fr: ExampleGuide; en: ExampleGuide }> = {
  tplMotor: {
    fr: {
      purpose: 'Le départ moteur le plus courant en électrotechnique : un contacteur commande un moteur triphasé à partir d’un bouton marche et d’un bouton arrêt, avec un disjoncteur-moteur qui protège.',
      learn: ['Séparer le circuit de puissance (400 V, le moteur) du circuit de commande (la bobine et les boutons).', 'L’auto-maintien : un contact du contacteur en parallèle du bouton marche garde la bobine alimentée après le relâchement.', 'Le rôle du disjoncteur-moteur : protection contre les courts-circuits et les surcharges.'],
      simulate: ['Appuyez sur S2 (marche) : KM1 colle, le moteur tourne ; relâchez, il reste en marche grâce à l’auto-maintien.', 'Appuyez sur S1 (arrêt, contact NF) : tout retombe.', 'Ouvrez le disjoncteur Q1 : plus rien ne démarre. Essayez un défaut (Alt + clic) pour voir la protection réagir.'],
    },
    en: {
      purpose: 'The most common motor starter in electrical engineering: a contactor drives a three-phase motor from a start and a stop button, with a motor breaker for protection.',
      learn: ['Separating the power circuit (400 V, the motor) from the control circuit (the coil and the buttons).', 'Latching: a contactor contact in parallel with the start button keeps the coil energised after release.', 'The role of the motor breaker: protection against short circuits and overloads.'],
      simulate: ['Press start: the contactor pulls in, the motor runs and the lamp lights; release, it keeps running.', 'Press stop: everything drops out.', 'Open the breaker: nothing starts. Try a fault (Alt + click) to see the protection react.'],
    },
  },
  tplLamps: {
    fr: {
      purpose: 'Un contacteur et ses deux voyants : un voyant de marche et un voyant d’arrêt commandés par les contacts auxiliaires du contacteur.',
      learn: ['Un contact normalement ouvert (NO) se ferme quand la bobine est alimentée, un contact normalement fermé (NF) s’ouvre.', 'Un contacteur peut renseigner l’opérateur grâce à ses contacts auxiliaires, sans toucher au circuit de puissance.'],
      simulate: ['Appuyez sur S2 (marche) : KM1 colle, H1 (marche, contact NO) s’allume et H2 (arrêt, contact NF) s’éteint.', 'Appuyez sur S1 : c’est l’inverse. Observez les pastilles vertes et les tirets blancs qui montrent le courant.'],
    },
    en: {
      purpose: 'A contactor and its two lamps: a run lamp and a stop lamp driven by the contactor’s auxiliary contacts.',
      learn: ['A normally open (NO) contact closes when the coil is energised, a normally closed (NC) contact opens.', 'A contactor can inform the operator through its auxiliary contacts without touching the power circuit.'],
      simulate: ['Energise the coil: the run lamp lights and the stop lamp goes out.', 'De-energise it: the opposite happens. Watch the green marks and white dashes showing current.'],
    },
  },
  tplTimer: {
    fr: {
      purpose: 'Une temporisation à la montée : la lampe ne s’allume que 5 secondes après la mise sous tension de la bobine temporisée.',
      learn: ['Le principe d’un relais temporisé : le contact change d’état après un délai réglable.', 'Utilisations : démarrage échelonné, éclairage d’escalier, sécurité de mise en route.'],
      simulate: ['Fermez l’interrupteur : rien pendant 5 s, puis la lampe s’allume (le chronogramme montre le délai).', 'Réglez le délai dans les propriétés de la bobine et utilisez la vitesse × 5 ou × 10 pour attendre moins.'],
    },
    en: {
      purpose: 'An on-delay timer: the lamp only comes on 5 seconds after the timed coil is energised.',
      learn: ['How a timer relay works: the contact changes state after an adjustable delay.', 'Uses: staggered starting, stair lighting, start-up safety.'],
      simulate: ['Close the switch: nothing for 5 s, then the lamp lights (the timing chart shows the delay).', 'Change the delay in the coil properties and use speed × 5 or × 10 to wait less.'],
    },
  },
  tplTrafo: {
    fr: {
      purpose: 'Un départ moteur dont la commande (bobine KM1 et voyant H1) est alimentée en 24 V par un transformateur de commande T1, à partir de 230 V.',
      learn: ['Pourquoi on commande en basse tension : sécurité des personnes sur les boutons et les câbles de commande.', 'Rapport de transformation, puissance du transformateur et protection du primaire et du secondaire.'],
      simulate: ['Appuyez sur S2 : la bobine KM1 (24 V) colle et le moteur tourne ; S1 l’arrête.', 'Mesurez la tension au primaire (230 V) et au secondaire (24 V) avec le voltmètre du menu Mesures.'],
    },
    en: {
      purpose: 'A motor starter whose control (coil KM1 and lamp H1) is fed at 24 V by a control transformer T1, from 230 V.',
      learn: ['Why control circuits use low voltage: safety for people on buttons and control wiring.', 'Transformation ratio, transformer rating and protection of the primary and secondary.'],
      simulate: ['Press S2: the 24 V coil KM1 pulls in and the motor runs; S1 stops it.', 'Measure the primary (230 V) and secondary (24 V) voltage with the voltmeter from the Measure menu.'],
    },
  },
  tplCascade: {
    fr: {
      purpose: 'Un démarrage en cascade : le second contacteur KM2 ne colle que 5 secondes après KM1, grâce à une temporisation à la montée.',
      learn: ['Enchaîner deux automatismes avec un relais temporisé.', 'Pourquoi échelonner les démarrages : limiter l’appel de courant et respecter un ordre de mise en route.'],
      simulate: ['Appuyez sur marche : KM1 colle tout de suite, KM2 attend 5 s (voyez le chronogramme).', 'Arrêtez, changez le délai du relais KT dans ses propriétés, puis recommencez.'],
    },
    en: {
      purpose: 'A cascade start: the second contactor KM2 only pulls in 5 seconds after KM1, thanks to an on-delay timer.',
      learn: ['Chaining two automatisms with a timer relay.', 'Why starts are staggered: limiting inrush current and respecting a start-up order.'],
      simulate: ['Press start: KM1 pulls in at once, KM2 waits 5 s.', 'Watch the timing chart, then stop and restart with a different delay.'],
    },
  },
  tplRelay24: {
    fr: {
      purpose: 'Un relais auxiliaire en 24 V alternatif câblé sur un bornier : le montage type d’un coffret d’automatisme.',
      learn: ['Le relais comme interface : une petite commande pilote plusieurs contacts NO et NF.', 'Le bornier X1 : repérage des bornes et raccordement vers l’extérieur du coffret.'],
      simulate: ['Appuyez sur S2 (marche) : KA1 colle, H2 s’allume par un contact NO et H1 s’éteint par un contact NF.', 'Appuyez sur S1 (arrêt) pour tout relâcher.'],
    },
    en: {
      purpose: 'An auxiliary relay at 24 V AC wired through a terminal block: the typical layout of an automation cabinet.',
      learn: ['The relay as an interface: one small command drives several NO and NC contacts.', 'Terminal block X1: terminal numbering and wiring to the outside of the cabinet.'],
      simulate: ['Press S2 (start): KA1 pulls in, H2 lights through a NO contact and H1 goes out through a NC contact.', 'Press S1 (stop) to release everything.'],
    },
  },
  tplReversing: {
    fr: {
      purpose: 'L’inversion du sens de rotation d’un moteur triphasé avec deux contacteurs : en permutant deux phases, le moteur tourne dans l’autre sens.',
      learn: ['Pourquoi il suffit d’inverser deux phases.', 'Le verrouillage électrique KM1/KM2 : un contact NF de chaque contacteur empêche l’autre de coller et évite le court-circuit entre phases.'],
      simulate: ['Appuyez sur « avant » : KM1 colle, le moteur tourne dans un sens (indiqué sur le schéma).', 'Sans arrêter, appuyez sur « arrière » : rien ne se passe, c’est le verrouillage ; arrêtez, puis essayez.'],
    },
    en: {
      purpose: 'Reversing a three-phase motor with two contactors: swapping two phases makes the motor turn the other way.',
      learn: ['Why swapping two phases is enough.', 'The KM1/KM2 interlock: an NC contact of each contactor stops the other from pulling in and prevents a phase-to-phase short circuit.'],
      simulate: ['Press “forward”: KM1 pulls in and the motor turns one way (shown on the diagram).', 'Without stopping press “reverse”: nothing happens, that is the interlock; stop first, then try.'],
    },
  },
  tplPneu: {
    fr: {
      purpose: 'Le circuit pneumatique le plus simple : un vérin double effet commandé à la main par un distributeur 5/2.',
      learn: ['Lire un schéma pneumatique : alimentation, distributeur, vérin, échappements.', 'Un 5/2 alimente tour à tour les deux chambres du vérin : sortie, puis rentrée.', 'Les numéros normalisés des orifices : 1 alimentation, 2 et 4 utilisations, 3 et 5 échappements.'],
      simulate: ['Maintenez le clic sur le distributeur : le vérin sort ; relâchez : le ressort le ramène et le vérin rentre.', 'Rouge = air sous pression, bleu = échappement : suivez le fluide dans les conduits.'],
    },
    en: {
      purpose: 'The simplest pneumatic circuit: a double-acting cylinder operated by hand through a 5/2 valve.',
      learn: ['Reading a pneumatic diagram: supply, valve, cylinder, exhausts.', 'A 5/2 feeds the two cylinder chambers in turn: extend, then retract.', 'Standard port numbers: 1 supply, 2 and 4 outputs, 3 and 5 exhausts.'],
      simulate: ['Hold the click on the valve: the cylinder extends; release: the spring returns it and the cylinder retracts.', 'Red = pressurised air, blue = exhaust: follow the fluid through the lines.'],
    },
  },
  tplPneuElec: {
    fr: {
      purpose: 'Une électrovanne 5/2 commandée par un interrupteur : le lien entre la commande électrique et la puissance pneumatique.',
      learn: ['Une bobine (YV1) actionne le distributeur du même repère : la commande est électrique, la puissance est pneumatique.', 'Un fin de course (A1+) renvoie l’information « vérin sorti » vers l’électrique : il allume un voyant.'],
      simulate: ['Fermez S1 : la bobine est alimentée, le vérin sort, et en bout de course le voyant H1 s’allume.', 'Ouvrez S1 : le ressort ramène le distributeur et le vérin rentre.'],
    },
    en: {
      purpose: 'A 5/2 solenoid valve operated by a switch: the link between electrical control and pneumatic power.',
      learn: ['A coil (YV1) operates the valve with the same tag: control is electrical, power is pneumatic.', 'A limit switch (A1+) sends “cylinder out” back to the electrical side: it lights a lamp.'],
      simulate: ['Close S1: the coil is energised, the cylinder extends and at the end of stroke lamp H1 lights.', 'Open S1: the spring returns the valve and the cylinder retracts.'],
    },
  },
  tplPneuAuto: {
    fr: {
      purpose: 'Un va-et-vient automatique A+ A− : le vérin sort puis rentre tout seul, tant qu’on maintient le départ de cycle.',
      learn: ['Un distributeur bistable garde sa position : il a besoin d’une impulsion par côté.', 'Les fins de course A1− et A1+ enchaînent les mouvements : c’est la logique d’un cycle automatique.'],
      simulate: ['Maintenez le bouton S2 : le vérin sort, atteint A1+, ce qui commande le retour (YV2), puis A1− relance la sortie (YV1).', 'Relâchez S2 : le cycle s’arrête en fin de course.'],
    },
    en: {
      purpose: 'An automatic A+ A− back-and-forth: the cylinder extends then retracts by itself as long as the cycle start is held.',
      learn: ['A bistable valve keeps its position: it needs one pulse per side.', 'Limit switches A1− and A1+ chain the movements: the logic of an automatic cycle.'],
      simulate: ['Hold the start button: the cylinder extends, reaches A1+ which commands the return, then starts again.', 'Release the button: the cycle stops at the end of stroke.'],
    },
  },
  tplPneuPlc: {
    fr: {
      purpose: 'Le cycle classique A+ B+ A− B− de deux vérins, piloté par un automate programmé en Grafcet : la base de l’automatisation séquentielle.',
      learn: ['Décrire un cycle en Grafcet : étapes, transitions (les détecteurs a0 a1 b0 b1) et actions (les bobines).', 'Relier un automate à des électrodistributeurs bistables et à des capteurs de position.', 'Lire un chronogramme pour vérifier l’ordre des mouvements.'],
      simulate: ['Appuyez sur S1 (départ de cycle) : A+ B+ A− B− s’enchaîne ; l’étape active du Grafcet est mise en évidence.', 'Ouvrez le programme de l’automate (double-clic) et modifiez une transition pour voir le cycle changer.'],
    },
    en: {
      purpose: 'The classic A+ B+ A− B− cycle of two cylinders driven by a PLC programmed in Grafcet: the basis of sequential automation.',
      learn: ['Describing a cycle in Grafcet: steps, transitions (sensors a0 a1 b0 b1) and actions (the coils).', 'Connecting a PLC to bistable solenoid valves and position sensors.', 'Reading a timing chart to check the order of movements.'],
      simulate: ['Start the simulation: the A+ B+ A− B− cycle runs; the active Grafcet step is highlighted.', 'Open the PLC program (double-click) and change a transition to see the cycle change.'],
    },
  },
  tplHydMotor: {
    fr: {
      purpose: 'Régler la vitesse d’un moteur hydraulique avec des limiteurs de débit placés à l’admission : c’est le TP de base du banc hydraulique.',
      learn: ['Le chemin de l’huile : pompe, limiteur de pression, distributeur 4/3, limiteurs de débit, moteur, retour à la bâche.', 'Un limiteur de débit règle la vitesse ; l’excédent du débit de la pompe s’échappe par le limiteur de pression.', 'Le sens de rotation dépend du côté du distributeur alimenté.'],
      simulate: ['Maintenez le clic sur l’un des deux électroaimants du distributeur : le moteur tourne dans un sens, puis dans l’autre.', 'Réglez l’ouverture des limiteurs avec − et + : la vitesse (tr/min) change.', 'Faites varier la charge du moteur (− et + sous le moteur) et lisez les pressions ; posez un tachymètre ou un manomètre depuis le menu Mesures.'],
    },
    en: {
      purpose: 'Setting the speed of a hydraulic motor with flow valves on the inlet: the basic lab of the hydraulic bench.',
      learn: ['The oil path: pump, relief valve, 4/3 valve, flow valves, motor, return to tank.', 'A flow valve sets the speed; the pump’s surplus flow escapes through the relief valve.', 'The direction of rotation depends on which side of the valve is energised.'],
      simulate: ['Hold the click on either solenoid of the valve: the motor turns one way, then the other.', 'Adjust the valve opening with − and +: the speed (rpm) changes.', 'Vary the motor load (− and + under the motor) and read the pressures; add a tachometer or pressure gauge from the Measure menu.'],
    },
  },
  tplHydCyl: {
    fr: {
      purpose: 'Régler la vitesse d’un vérin hydraulique avec des limiteurs de débit placés à l’échappement (sur le retour de chaque chambre).',
      learn: ['Pourquoi l’étranglement à l’échappement retient la charge et stabilise le mouvement.', 'L’effet multiplicateur de pression : côté tige, la pression est plus élevée que celle du limiteur de pression à la sortie du vérin.', 'Surface du piston et de la tige : le même débit donne deux vitesses différentes.'],
      simulate: ['Maintenez un électroaimant : le vérin sort ou rentre ; comparez les deux vitesses.', 'Réglez les limiteurs et observez les manomètres G1 et G2 : le côté étranglé monte en pression.', 'Augmentez la charge (daN) du vérin jusqu’à ce que le limiteur de pression s’ouvre et que la tige cale.'],
    },
    en: {
      purpose: 'Setting the speed of a hydraulic cylinder with flow valves on the exhaust side (on the return of each chamber).',
      learn: ['Why meter-out throttling holds the load and steadies the movement.', 'Pressure intensification: on the rod side the pressure is higher than the relief setting during extension.', 'Piston and rod areas: the same flow gives two different speeds.'],
      simulate: ['Hold a solenoid: the cylinder extends or retracts; compare the two speeds.', 'Adjust the valves and watch gauges G1 and G2: the throttled side rises in pressure.', 'Increase the cylinder load (daN) until the relief valve opens and the rod stalls.'],
    },
  },
  tplHydTP5: {
    fr: {
      purpose: 'Limiter l’effort d’un vérin sans toucher à la pression du reste du circuit : un limiteur de pression secondaire sur chaque ligne du vérin (80 bar côté fond, 40 bar côté tige), sous le limiteur principal à 100 bar.',
      learn: ['Pression principale et pressions secondaires : chacune protège sa branche.', 'Quand le vérin est en butée, la pression retombe au tarage secondaire : la consommation de puissance est faible mais l’effort est limité.', 'Pourquoi un moteur et un vérin en parallèle se gênent : le débit prend le chemin le plus facile.'],
      simulate: ['Maintenez 1V2 (vérin) jusqu’en butée : lisez G5 (≈ 40 bar) ou G4 (≈ 80 bar) selon le côté.', 'Maintenez 1V1 : le moteur tourne à ≈ 300 tr/min (croisé) ou ≈ 200 tr/min (parallèle).', 'Maintenez les deux, vérin en butée : le moteur ralentit, car la pression de pompe tombe à celle du secondaire.'],
    },
    en: {
      purpose: 'Limiting a cylinder’s force without touching the rest of the circuit: a secondary relief valve on each cylinder line (80 bar cap side, 40 bar rod side) under the 100 bar main relief.',
      learn: ['Main and secondary pressures: each protects its own branch.', 'When the cylinder is at its stop, pressure falls to the secondary setting: power use is low but force is limited.', 'Why a motor and a cylinder in parallel hinder each other: the flow takes the easiest path.'],
      simulate: ['Hold 1V2 (cylinder) until it stalls: read G5 (≈ 40 bar) or G4 (≈ 80 bar) depending on the side.', 'Hold 1V1: the motor runs at ≈ 300 rpm (crossed) or ≈ 200 rpm (parallel).', 'Hold both with the cylinder stalled: the motor slows down because pump pressure drops to the secondary setting.'],
    },
  },
  tplHydTP6: {
    fr: {
      purpose: 'Alimenter un vérin à pression réduite avec un réducteur de pression réglé à 50 bar, pendant que le moteur garde la pression du circuit (100 bar).',
      learn: ['Un réducteur de pression est ouvert au repos et se referme quand la pression aval atteint son tarage (sa flèche se décale).', 'Avantage sur le montage du TP5 : le moteur garde sa vitesse quand le vérin est en butée.', 'Inconvénient : vérin en butée, c’est le limiteur de la pompe qui s’ouvre : puissance maximale.'],
      simulate: ['Maintenez 1V2 jusqu’en butée : G4 ou G5 reste à 50 bar ; regardez la flèche de RP se décaler.', 'Maintenez 1V1 en même temps : le moteur garde sa vitesse.', 'Changez le tarage de RP avec − et + et relisez les pressions.'],
    },
    en: {
      purpose: 'Feeding a cylinder at reduced pressure with a reducing valve set to 50 bar, while the motor keeps the circuit pressure (100 bar).',
      learn: ['A pressure reducing valve is open at rest and closes when downstream pressure reaches its setting (its arrow shifts).', 'Advantage over the lab 5 layout: the motor keeps its speed when the cylinder is at its stop.', 'Drawback: with the cylinder at its stop the pump relief valve opens: maximum power.'],
      simulate: ['Hold 1V2 until the stop: G4 or G5 stays at 50 bar; watch the RP arrow shift.', 'Hold 1V1 at the same time: the motor keeps its speed.', 'Change the RP setting with − and + and read the pressures again.'],
    },
  },
  tplHydTP7: {
    fr: {
      purpose: 'Immobiliser un vérin chargé avec deux clapets anti-retour pilotés croisés : chacun est débloqué par la pression de l’autre ligne.',
      learn: ['Un clapet piloté laisse passer l’huile dans un sens, bloque l’autre, sauf si une pression de pilotage le débloque.', 'Au centre du distributeur (A et B vers la bâche), le vérin reste bloqué.', 'Sécurité : de la pression peut rester piégée même à l’arrêt ; il faut purger avant de démonter.'],
      simulate: ['Distributeur au centre : le vérin ne bouge pas, les manomètres sont à 0.', 'Maintenez un électroaimant : l’huile arrive d’un côté et débloque le clapet de l’autre côté, le vérin se déplace.', 'En butée, la pression monte au tarage du limiteur principal.'],
    },
    en: {
      purpose: 'Holding a loaded cylinder with two cross-piloted check valves: each one is released by the pressure of the other line.',
      learn: ['A pilot-operated check valve lets oil through one way and blocks the other, unless pilot pressure releases it.', 'With the valve centred (A and B to tank) the cylinder stays locked.', 'Safety: pressure can stay trapped even when stopped; purge before dismantling.'],
      simulate: ['Valve centred: the cylinder does not move, gauges read 0.', 'Hold a solenoid: oil arrives on one side and releases the check valve on the other, the cylinder moves.', 'At the stop, pressure rises to the main relief setting.'],
    },
  },
  tplHydTP8: {
    fr: {
      purpose: 'Économiser l’énergie avec une pompe à cylindrée variable régulée en pression : la pompe ne fournit que le débit réellement consommé, à 100 bar.',
      learn: ['Régulation de pression constante : le régulateur réduit la cylindrée quand la pression atteint 100 bar.', 'Différence avec la pompe fixe du TP1 : plus de surplus de débit qui part à la bâche, donc moins de chaleur.', 'Le limiteur de sécurité à 120 bar ne s’ouvre qu’en cas de défaut de la régulation.'],
      simulate: ['Au repos : la pompe affiche ≈ 100 bar et un débit presque nul.', 'Maintenez un électroaimant : le débit de pompe s’ajuste au moteur (≈ 15 L/min à 300 tr/min, ≈ 10 L/min à 200 tr/min), la pression reste ≈ 100 bar.', 'Ouvrez trop un limiteur de débit : la pompe ne peut plus tenir sa pression.'],
    },
    en: {
      purpose: 'Saving energy with a pressure-compensated variable-displacement pump: the pump only delivers the flow actually consumed, at 100 bar.',
      learn: ['Constant-pressure regulation: the compensator cuts displacement when pressure reaches 100 bar.', 'Difference from the fixed pump of lab 1: no surplus flow dumped to tank, so less heat.', 'The 120 bar safety relief only opens if the regulation fails.'],
      simulate: ['At rest: the pump shows ≈ 100 bar and almost no flow.', 'Hold a solenoid: pump flow adjusts to the motor (≈ 15 L/min at 300 rpm, ≈ 10 L/min at 200 rpm), pressure stays ≈ 100 bar.', 'Open a flow valve too much: the pump can no longer hold its pressure.'],
    },
  },
  tplHydTP9: {
    fr: {
      purpose: 'Adapter à la fois le débit et la pression de la pompe au récepteur grâce au Load Sensing : la pompe garde 15 bar de plus que la plus forte pression des deux lignes du moteur.',
      learn: ['Un sélecteur de circuit relève la plus haute des deux pressions et la renvoie à la pompe (signal LS).', 'Avec un seul récepteur la vitesse reste constante même si la charge varie, car la chute de pression des limiteurs reste de 15 bar.', 'C’est le meilleur bilan de puissance : on ne fournit que le débit consommé, à la pression de charge + 15 bar.'],
      simulate: ['Maintenez un électroaimant et faites varier la charge du moteur : la pression de pompe suit (charge + 15 bar), la vitesse ne bouge presque pas.', 'Comparez avec le TP8 (pression constante) : lisez G3 dans les deux exemples.', 'Ouvrez le menu Mesures et posez un manomètre sur le signal LS.'],
    },
    en: {
      purpose: 'Matching both pump flow and pressure to the load with Load Sensing: the pump stays 15 bar above the higher of the two motor line pressures.',
      learn: ['A shuttle valve picks the higher pressure and sends it back to the pump (LS signal).', 'With a single load the speed stays constant even as the load changes, because the pressure drop across the valves stays at 15 bar.', 'The best power balance: only the consumed flow is supplied, at load pressure + 15 bar.'],
      simulate: ['Hold a solenoid and vary the motor load: pump pressure follows (load + 15 bar), speed barely changes.', 'Compare with lab 8 (constant pressure): read G3 in both examples.', 'Open the Measure menu and place a pressure gauge on the LS signal.'],
    },
  },
}
