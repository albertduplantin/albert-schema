# AlbertSchema

Éditeur web gratuit de schémas électriques, pneumatiques et hydrauliques (FR/EN).
Aucun serveur : tout est stocké localement (localStorage + fichiers `.albert.json`).

    npm install
    npm run dev      # développement
    npm run build    # build statique dans dist/ (hébergeable gratuitement)

## Symboles

Bibliothèque issue de la collection QElectroTech (CC-BY 3.0) — voir [NOTICE.md](NOTICE.md).

## Classement adaptatif des symboles

- **Personnel** (`src/usage.ts`) : chaque symbole posé remonte dans la palette ; stocké dans le navigateur.
- **Commun** (`api/usage.js`, `src/globalUsage.ts`) : statistiques anonymes de tous les utilisateurs, **uniquement avec leur accord**
  (aucun schéma ni donnée personnelle, seulement des identifiants de symboles). Sans base configurée, l'appli fonctionne
  normalement avec le classement personnel et le classement éditorial (`scripts/popularity.mjs`).

Mise en place du classement commun : dans Vercel, *Storage → Upstash Redis* (Marketplace), connecter la base au projet.
Les variables `KV_REST_API_URL` et `KV_REST_API_TOKEN` (ou `UPSTASH_REDIS_REST_URL/TOKEN`) sont alors injectées ; redéployer.

Après toute régénération de la bibliothèque : `node scripts/import-qet.mjs <qelectrotech-elements> public/qet-library.json api/_ids.json`.

## Simulation

Le bouton **Simuler** passe en mode simulation (logique de relais) : les sources (`L1`, `L2`, `L3`, `N`, `L`, `+24 V`, `0 V`)
imposent un potentiel, un récepteur s'allume quand ses bornes sont à des potentiels différents, un contact prend l'état de la
bobine de même repère. Boutons-poussoirs, interrupteurs, arrêts d'urgence et disjoncteurs se manœuvrent à la souris ; les
courts-circuits sont signalés. Le modèle de chaque symbole est déterminé par `scripts/sim-classify.mjs` (229 symboles).
Limites : pas de régime transitoire, de courants ni de temporisations ; contacts inverseurs, automates et variateurs non simulés.

## Déploiement

Application statique (Vite) + une fonction serverless (`api/usage.js`). En-têtes de sécurité (CSP…) dans `vercel.json`.
