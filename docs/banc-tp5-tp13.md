# Cahier du banc SHCOV2 : TP5 à TP13 (lecture du corrigé)

Source : « correction.pdf » (88 pages, scan). TP1 à TP4 sont déjà des exemples de l'application (moteur, vérin, limiteurs de débit). Valeurs et conclusions relevées ci-dessous.

| TP | Sujet | Montage | Réglages du corrigé | Conclusion à retrouver en simulation |
|---|---|---|---|---|
| 5 | Limiteur de pression secondaire | Moteur (limiteurs de débit A et B) et vérin en parallèle ; un limiteur de pression secondaire sur chaque ligne du vérin ; distributeur « BY-PASS » sur la pompe | principal 100 bar ; secondaire ligne B 40 bar ; ligne A 80 bar ; moteur 300 tr/min (B) et 200 tr/min (A) | Vérin en butée : la pression monte au tarage secondaire, la puissance consommée reste faible. Moteur et vérin ensemble : le vérin prend tout le débit (chemin le plus facile) ; en butée, la pression de pompe n'est plus que celle du secondaire, donc le ΔP des limiteurs de débit du moteur baisse et le moteur ralentit |
| 6 | Réducteur de pression | Même banc, un réducteur de pression en amont du distributeur du vérin | principal 100 bar ; réducteur 50 bar | La réduction se referme quand le vérin atteint la pression réglée : le moteur garde sa vitesse. Défaut : vérin en butée, c'est le limiteur de la pompe qui s'ouvre, puissance maximale |
| 7 | Clapet anti-retour piloté | Vérin, deux clapets pilotés croisés (le pilotage de chacun vient de l'autre ligne), distributeur 4/3 | limiteur 100 bar | Même à l'arrêt il reste de la pression piégée (clapets) : consigne de purge avant démontage. Avec un moteur hydraulique, inutile (fuites internes) : il faut un frein |
| 8 | Régulation de pression constante | Pompe à cylindrée variable, régulateur de pression ; moteur et limiteurs de débit | limiteur 120 bar ; régulation constante 100 bar ; moteur 300 / 200 tr/min | La pompe ajuste son débit à celui consommé. Si le limiteur de débit est trop ouvert, la pression chute (plus de débit excédentaire) |
| 9 | Load Sensing | Pompe variable à régulateur Load Sensing, sélecteur de circuit prenant la plus forte pression des deux lignes du moteur | LS + 15 bar | Pression de pompe = pression de charge + 15 bar ; débit = débit consommé ; vitesse constante même si la charge varie (un seul récepteur) ; meilleur bilan de puissance |
| 10 | Pompe fixe + PVG32 | Groupe de distributeurs proportionnels à leviers (vérin et moteur), pompe à cylindrée fixe | limiteur PVG32 120 bar ; Load Sensing A 80 bar, B 40 bar ; butées de tiroir : sortie 10 s, rentrée 20 s, moteur 200 et 300 tr/min | Pression de pompe = pression de charge + 10 bar environ ; on peut dépasser 50 bar sur le moteur avec LS B à 50 bar car chaque voie est limitée indépendamment |
| 11 | Pompe variable + PVG32 | Idem avec pompe variable (Load Sensing) | mêmes butées | La pression de pompe suit la charge. Vérin en butée, manette maintenue : la pression monte jusqu'au LS A ou B et accélère le moteur, car son distributeur n'a pas de balance de pression |
| 12 | Pompe fixe + KVM10 | Distributeur à 4 cases KVM10, pompe fixe, moteur et vérin | limiteur du KVM10 120 bar | Essais 1 et 2 comme TP11 (commentaires laissés vides dans le corrigé) |
| 13 | Accumulateur | Accumulateur 2 L (pression de gonflage 40 bar) avec bloc de sécurité (limiteur, vanne de remplissage, vanne de mise à vide, manomètre), distributeurs vérin et moteur | limiteur 80 puis 130 bar | Plus la pression du circuit est élevée, plus le volume d'huile stocké est grand, donc plus de rentrées / sorties du vérin. Gonflage vérifié : l'aiguille du manomètre chute lentement puis brusquement à la pression de gonflage de l'azote |

## Fait : exemples TP5 à TP9
Cinq exemples de la galerie reprennent les montages, avec les réglages du corrigé, et leurs valeurs sont vérifiées par `scripts/test-hydraulic.mts` (moteur 300 / 200 tr/min ; secondaires 80 et 40 bar ; réducteur 50 bar ; clapets croisés ; pompe régulée à 100 bar, débit = consommation ; Load Sensing + 15 bar). Pas de distributeur BY-PASS dans ces exemples : sans récepteur commandé, la pompe débite par le limiteur principal. Le moteur de ces exemples a une cylindrée de 50 cm³ (300 tr/min = 15 L/min avec une pompe de 27 L/min).

## Ce que l'application sait déjà faire
- TP5, TP6, TP7, TP8, TP9 : tous les appareils existent (limiteur et réducteur de pression, limiteurs de débit, clapets pilotés, pompe variable régulée, pompe Load Sensing, sélecteur de circuit, distributeurs 4/3 et 4/2). Il manque les exemples câblés avec leurs consignes et les valeurs attendues.
- Chiffres du modèle : le Load Sensing garde maintenant **+ 15 bar** (valeur du corrigé, elle était à 14).

## Ce qui manque
- **TP10 à TP12 (PVG32, KVM10)** : le distributeur proportionnel existe, mais pas la limitation de pression par voie (LS A, LS B), la butée de tiroir qui règle une vitesse ou un temps de course, ni le bloc de distributeurs en un seul symbole. La balance de pression (compensation) des voies n'est pas modélisée : c'est justement ce que le corrigé fait observer (moteur qui accélère quand le vérin est en butée).
- **TP13** : accumulateur (pré-charge 40 bar, volume 2 L), bloc de sécurité d'accumulateur, vannes de remplissage et de mise à vide, et le comptage du nombre de translations. Le calcul demande un état qui évolue dans le temps (gaz à la loi de Boyle) : il sort du régime établi du solveur actuel.
- **TP5** : distributeur « BY-PASS » à poser entre pompe et circuit (réalisable avec les distributeurs 4/2 existants).
- Les tableaux d'essais (N, P, Q à relever) pourraient devenir un mode « relevé de mesures ».

## Ordre proposé
1. Exemples TP5 à TP9 (aucun nouvel appareil), chacun avec sa procédure de réglage et ses valeurs de contrôle dans les tests.
2. PVG32 / KVM10 : LS par voie, butées de tiroir, compensation de pression.
3. Accumulateur et bloc de sécurité (modèle d'état dans le temps).
