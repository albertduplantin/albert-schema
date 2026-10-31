# Albert Schema Studio : notes de travail

Éditeur et simulateur de schémas électriques / pneumatiques / hydrauliques (Vite + React + TS), FR/EN. Production : https://schema.albertduplantin.win (l’ancienne adresse https://albert-schema.vercel.app reste active, sans redirection : le stockage du navigateur est propre à chaque adresse) (déploiement automatique à chaque push sur `main`).

## Boucle de travail (sobre en jetons)
- **Vérifier** : `node scripts/dev/verify.mjs` (tsc + tous les tests, une ligne par étape, détail seulement en cas d'échec). `--e2e` ajoute le navigateur, `--only=hydraulic` limite à une étape. Ne pas lancer `npm test` brut : sa sortie est très longue.
- **Livrer** : `node scripts/dev/ship.mjs "message" [--lib] [--no-e2e]` = vérification + commit (avec la mention Co-Authored-By) + push + contrôle du déploiement. `--lib` régénère la bibliothèque de symboles avant (obligatoire dès qu'on touche `src/symbols/`).
- **Éditer** : `node scripts/dev/edit.mjs patch.txt` applique des blocs `@@ fichier / <<<< ancien / ==== / nouveau / >>>>` sans échappement et en gardant les fins de ligne CRLF (beaucoup de fichiers sont en CRLF : l'outil Edit y échoue souvent sur plusieurs lignes). Écrire le patch avec l'outil Write.
- **Voir un symbole** : `node scripts/dev/shot.mjs "own:hyd/filtre" sortie.png` puis lire l'image (orifices en rouge). Un coup d'œil évite plusieurs allers-retours avec l'utilisateur.
- Ne pas relire un fichier entier : Grep d'abord, puis Read avec `offset` / `limit`.
- Scripts temporaires et captures : dossier scratchpad de la session, jamais à la racine du dépôt (`git add -A` les commiterait ; ship.mjs signale les fichiers non suivis).

## Référencement
- `public/<page>/index.html` (schema-electrique, schema-pneumatique, schema-hydraulique, exercices-guides, exemples, en) et `public/sitemap.xml` sont **générés et commités** par `npx tsx scripts/build-seo.mts` : à relancer quand on ajoute ou renomme un exemple de la galerie (`src/galleryMeta.ts`). Les exemples y pointent vers `/?exemple=<clé>` (lu dans `App.tsx`).

- Les pages ont des captures `public/img/exemple-*.webp` (faites avec puppeteer sur `/?exemple=<clé>`, panneaux fermés) ; `public/v.js` (mesure d’audience) est inclus dans index.html et dans chaque page générée.

- Une page par exemple : `public/exemples/<slug>/` (slugs dans `scripts/seo-slugs.json`, texte tiré de `src/exampleGuides.ts`), captures `public/img/ex-<slug>.webp` à refaire à la main si le schéma change. Les boutons ⓘ des exemples sont dans `src/templateHelp.ts`.

## Pièges connus
- `public/library-core.json` et `library-extended.json` sont **commités et générés** (`npx tsx scripts/build-library.mts`) : oublier de les régénérer = le navigateur affiche l'ancien symbole.
- Grille = 10 : les orifices des symboles doivent tomber sur des multiples de 10 (test dans test-hydraulic).
- Un heredoc bash avec apostrophes ou antislashs déforme le texte (regex, `\n`) : passer par l'outil Write.
- La fin de `npm test` sous Windows affiche « Assertion failed: !(handle->flags & UV_HANDLE_CLOSING) » avec le code 127 : sans conséquence, verify.mjs l'ignore.
- Les textes dessinés dans les symboles dynamiques (`src/symbols/fluidDraw.ts`, fonction `tx`) portent `data-tag` pour être déplaçables ; ils lisent `--ls` (échelle des repères, boutons A− / A+).

## Où est quoi
- Simulation qualitative `src/sim/fluid.ts`, hydraulique quantitative `src/sim/hyd.ts` (modèle documenté dans `docs/hydraulique.md`), moteur général `src/sim/engine.ts`.
- Symboles dessinés par nous : `src/symbols/own/*` (hydraulique : `hydValves.ts`, `hydParts.ts`, recettes de dessin dans `own/fluid.ts`) ; dessin dynamique des distributeurs et vérins : `src/symbols/fluidDraw.ts`. Symboles importés de QElectroTech (CC-BY 3.0) : `data/library-raw.json`.
- Repères normalisés (1V1, 1A1, électroaimants 1Y1 / 1YV14, lettres d'orifices) : `src/fluidNames.ts`.
- Canevas et interactions : `src/Canvas.tsx` ; application, menus, barre d'outils : `src/App.tsx` ; textes : `src/i18n.ts` (toute clé existe en FR et en EN).
- Exemples de la galerie : `src/templates.ts`, `src/galleryMeta.ts`. Tests : `scripts/test-*.mts`, navigateur : `scripts/e2e.mjs` (serveur Vite sur le port 5199).
