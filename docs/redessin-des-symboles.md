# Redessin des symboles : liste de travail

Objectif : disposer d'une bibliothèque de symboles **dessinée par l'application** (d'après les formes normalisées, sans copier les tracés
de la collection QElectroTech), pour que le logiciel n'en dépende plus. Les symboles QElectroTech restent disponibles comme
« bibliothèque étendue », chargée à part, avec sa mention de licence CC-BY.

## Principe technique
- Chaque symbole redessiné garde **les mêmes identifiants et positions de bornes** que l'ancien : les schémas existants, les exemples et les
  exercices continuent de fonctionner sans retouche.
- Un identifiant d'origine (`qet:…`) pointe vers le symbole redessiné ; à l'enregistrement, les fichiers prennent le nouvel identifiant (`std:…`).
- Le dessin est généré par programme (comme les distributeurs et vérins fluides), ce qui permet les animations et les variantes.

## Lot 1 — symboles électriques utilisés par les exemples et les exercices (22)
| Famille | Symboles |
|---|---|
| Relais, contacteurs | bobine ; bobine temporisée (travail) ; contact auxiliaire NO ; contact auxiliaire NF ; contact de puissance (3 pôles) |
| Commande | bouton poussoir NO ; bouton poussoir NF ; interrupteur (1 position) ; fin de course à came NO |
| Signalisation | lampe |
| Protection | disjoncteur-moteur tripolaire ; fusible 1 pôle ; fusible 2 pôles |
| Récepteurs | moteur triphasé ; moteur triphasé à 6 bornes (étoile / triangle) |
| Alimentation | transformateur monophasé à deux enroulements |
| Raccordement | borne de continuité ; terre |
| Déjà à nous | sources de simulation (L, N, L1-L3, sources réglables), automate, limiteurs de débit, distributeurs et vérins fluides |

## Lot 2 — les « plus utilisés » de la palette électrique (≈ 30 de plus)
Contacteur inverseur 1 et 2 ; relais à courant alternatif ; disjoncteur tripolaire + neutre ; disjoncteur magnéto-thermique 1P et 2P ;
interrupteur sectionneur triphasé ; disjoncteur différentiel ; arrêt d'urgence (coup de poing NF) et à tourner-déverrouiller ;
voyant lumineux (variantes) ; gyrophare ; avertisseur sonore ; alimentation AC/DC mono et triphasée ; moteur à courant continu ;
moteur monophasé ; servomoteur ; électrovanne (côté électrique) ; relais thermique ; sélecteurs 2 et 3 positions ;
fin de course NF ; capteurs inductif, capacitif, optique, magnétique, de pression, de température ; codeur incrémental ;
bornier (bornes simples, de terre, 3P+N+PE) ; connecteur ; HMI tactile ; carte d'entrées / sorties.

## Lot 3 — composants pneumatiques et hydrauliques encore issus de la collection (≈ 25)
Pneumatique : source d'air comprimé ; silencieux ; soupape à deux pressions ; sélecteur de circuit ; clapet anti-retour (et piloté) ;
manomètre ; filtre, séparateur d'eau, lubrificateur, régulateur de pression, unité de maintenance ; réservoir ; pressostat ;
moteur pneumatique ; vanne d'arrêt.
Hydraulique : bâche ; pompe (fixe, variable) ; moteur hydraulique ; filtre ; accumulateur ; vanne manuelle ; clapet ; pressostat.

## Lot 4 — le reste de la collection (≈ 1 100 symboles)
Pas redessiné. Il reste dans la **bibliothèque étendue QElectroTech**, désactivable. Le logiciel vendu peut alors n'embarquer que
les lots 1 à 3 (≈ 80 symboles) et ne plus avoir à mentionner QElectroTech.

## Ordre proposé
1. Lot 1, puis tests : les exemples et exercices à l'identique.
2. Lot 3 (pneumatique et hydraulique : même technique que pour les distributeurs et vérins).
3. Lot 2.
4. Séparation de la bibliothèque étendue (fichier à part, mention automatique quand elle est utilisée).
