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
