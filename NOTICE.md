# Crédits et licences

## Symboles

L'application embarque deux bibliothèques :

- **le noyau** (`public/library-core.json`, ≈ 260 symboles) : symboles **dessinés par l'application** d'après les formes normalisées
  (CEI 60617, ISO 1219) ; leur tracé est généré par programme (`src/symbols/own/`). Ils ne reprennent pas les dessins de la collection
  ci-dessous : seuls les identifiants et les positions des bornes sont conservés, pour que les anciens schémas restent lisibles ;
- **la bibliothèque étendue** (`public/library-extended.json`, chargée à la demande), qui contient le reste de la collection :
  ses symboles sont issus de la collection d'éléments
**QElectroTech** (© The QElectroTech team), https://qelectrotech.org —
dépôt : https://github.com/qelectrotech/qelectrotech-elements.

Les symboles de la bibliothèque étendue sont distribués sous licence **Creative Commons Attribution 3.0**
(http://creativecommons.org/licenses/by/3.0/). Les conditions complètes figurent dans
[public/QET-ELEMENTS.LICENSE](public/QET-ELEMENTS.LICENSE).

Modifications (indiquées comme l'exige la licence) :
- les dessins ont été convertis du format `.elmt` (XML) vers des chemins SVG par
  [scripts/import-qet.mjs](scripts/import-qet.mjs) ; les étiquettes de bornes de petite taille ont été
  retirées et les épaisseurs de trait harmonisées ;
- des modèles de simulation (comportement électrique, pneumatique, hydraulique) et des repères de bornes ont été ajoutés ;
- les noms de certains symboles ont été réécrits (par exemple les distributeurs pneumatiques) ;
- les distributeurs et les vérins pneumatiques et hydrauliques sont **redessinés par l'application** (cases coulissantes, piston, chambres colorées) :
  leur dessin à l'écran n'est plus celui de la collection, seules leurs positions d'orifices sont conservées ;
- les symboles du noyau (électriques, pneumatiques, hydrauliques) sont redessinés par l'application ; seuls ceux de la bibliothèque étendue ont gardé le dessin de la collection ;
- des doublons ont été masqués de la palette (ils restent chargeables dans les anciens fichiers).

Le texte de licence de la collection précise aussi qu'il n'est pas permis d'utiliser ces fichiers comme données d'apprentissage pour
des modèles d'apprentissage automatique : ce projet ne le fait pas. QElectroTech est un nom de projet : il n'est pas utilisé ici pour
suggérer un partenariat ou une approbation.

Pour régénérer la bibliothèque :

    git clone --depth 1 https://github.com/qelectrotech/qelectrotech-elements.git
    node scripts/import-qet.mjs ./qelectrotech-elements data/library-raw.json api/_ids.json
    npx tsx scripts/build-library.mts      # produit public/library-core.json et public/library-extended.json


## Polices

Public Sans, Saira Condensed et IBM Plex Mono (dossier `public/fonts`) sont distribuées sous licence SIL Open Font License 1.1.
Conservez leur fichier de licence si vous redistribuez ces polices.

## Bibliothèques logicielles

L'application utilise notamment React et Vite (licence MIT). Leurs avis de licence doivent accompagner toute distribution du code ou du bundle.
