# Hydraulique quantitative : modèle et hypothèses

Le simulateur calcule, en régime établi, la **pression (bar)** à chaque orifice et le **débit (L/min)** dans chaque appareil des circuits
hydrauliques (`src/sim/hyd.ts`). Les couleurs (rouge = pression, bleu = retour au réservoir) et les mesures affichées sous les appareils
(manomètres, vitesse des moteurs, vitesse des vérins, débit des pompes et limiteurs) en sont issues.

## Principe
Les conduites, reliées entre elles par les cases actives des distributeurs, forment des **nœuds**. Chaque appareil est un élément qui relie des
nœuds par une loi débit / pression. Les pressions des nœuds sont obtenues par balayages successifs : à chaque nœud, la somme des débits est
annulée par dichotomie (toutes les lois sont croissantes avec la pression du nœud). Le réservoir est à 0 bar.

| Appareil | Loi |
|---|---|
| Groupe motopompe (cylindrée fixe) | Q = cylindrée × vitesse / 1000, moins une fuite de 0,07 % par bar (18 cm³, 1500 tr/min → 27 L/min) |
| Pompe à cylindrée variable | Le débit s'annule autour de la pression de régulation (réglage « Pression de régulation ») |
| Pompe Load Sensing | Pression maintenue à (pression du signal LS + 15 bar), sans dépasser la pression maximale |
| Limiteur de pression | Q = 8 L/min par bar au-delà du tarage |
| Réducteur de pression | Q = 10 L/min par bar, jusqu'à ce que la pression aval atteigne le tarage |
| Limiteur de débit | Q = 14 × ouverture × √ΔP (retour libre par clapet si unidirectionnel) ; régulateur compensé : débit indépendant de ΔP |
| Clapet, clapet piloté, sélecteur | Passage libre au-delà de 0,5 bar (le pilotage au-delà de 8 bar débloque le clapet) |
| Moteur hydraulique | Q = 2 L/min par bar au-delà de la charge ; vitesse = Q × 1000 / cylindrée |
| Vérin double effet | Deux chambres de sections différentes ; vitesse = débit / surface ; arrêt en fin de course (la pression monte alors au tarage) |
| Distributeur proportionnel | Passages de section proportionnelle à la position du joystick |

## Limites connues
- Régime établi : pas de compressibilité, d'inertie ni de pics de pression.
- Les distributeurs classiques commutent instantanément et sans perte de charge.
- Les accumulateurs, le débit de fuite (drain) des moteurs et la régulation en couple ne sont pas modélisés.
- Les valeurs par défaut (cylindrée, vitesse d'entraînement, charge, alésage…) se règlent dans les propriétés de chaque appareil.

## Charge et grandeurs calculées
- **Moteur** : la charge est un couple résistant (N·m). Pression nécessaire = 2 bar (frottement) + couple × 20π / cylindrée. Le couple affiché sur l'arbre
  vaut (min(ΔP, pression nécessaire) − 2) × cylindrée / 20π ; la puissance mécanique vaut 2π × vitesse × couple / 60.
- **Vérin** : la charge est un effort résistant (daN). Pression nécessaire côté fond = 2 bar + effort / section du fond. L'effort affiché vaut
  pression du fond × section du fond − pression de la tige × section annulaire (bar × cm² = daN). Au-delà de ce que le limiteur de pression permet, la tige cale.
- **Pompe** : puissance hydraulique = pression × débit / 600 (kW). **Limiteur de pression ouvert** : puissance perdue en chaleur = ΔP × débit / 600.
- Pendant la simulation, les boutons − et + au-dessous du moteur ou du vérin font varier la charge (5 N·m ou 50 daN par clic).
