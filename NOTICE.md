# Crédits et licences

## Symboles

Les symboles de la bibliothèque (`public/qet-library.json`) sont issus de la collection d'éléments
**QElectroTech** (© The QElectroTech team), https://qelectrotech.org —
dépôt : https://github.com/qelectrotech/qelectrotech-elements.

Ils sont distribués sous licence **Creative Commons Attribution 3.0**
(http://creativecommons.org/licenses/by/3.0/). Les conditions complètes figurent dans
[public/QET-ELEMENTS.LICENSE](public/QET-ELEMENTS.LICENSE).

Modifications : les dessins ont été convertis du format `.elmt` (XML) vers des chemins SVG par
[scripts/import-qet.mjs](scripts/import-qet.mjs) ; les étiquettes de bornes de petite taille ont été
retirées et les épaisseurs de trait harmonisées. Les dessins eux-mêmes ne sont pas retouchés.

Pour régénérer la bibliothèque :

    git clone --depth 1 https://github.com/qelectrotech/qelectrotech-elements.git
    node scripts/import-qet.mjs ./qelectrotech-elements public/qet-library.json
