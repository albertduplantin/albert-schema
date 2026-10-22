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
Contacts inverseurs et temporisations (à la montée, à la retombée, les deux) sont simulés avec une horloge réelle.
Limites : pas de régime transitoire électrique ni de courants ; automates et variateurs non simulés. Tests du moteur : `npm test`.

## Déploiement

Application statique (Vite) + une fonction serverless (`api/usage.js`). En-têtes de sécurité (CSP…) dans `vercel.json`.

## Tracé des conducteurs

Tirez un fil depuis une borne, ou cliquez la borne puis cliquez dans le vide pour poser des **coudes** (le tracé reste orthogonal et
passe par chaque point), et terminez sur la borne d'arrivée. Retour arrière retire le dernier coude, Échap annule. Sur un fil
sélectionné, les poignées ■ (coudes) se déplacent, un double-clic en retire une, et la poignée ● au milieu d'un segment crée un
coude. Le bouton « Tracé automatique » revient au routage par défaut. Les coudes suivent les symboles qu'on déplace.

## Transformateurs, tensions et numérotation des bornes

- **Transformateurs** (16 symboles à enroulements séparés) : quand deux bornes du primaire sont à des potentiels différents,
  le secondaire devient une source pour le circuit aval (fils colorés à part). Sa tension se règle dans « Tension du secondaire (V) ».
- **Tension nominale** d'une bobine, d'un voyant ou d'un moteur : si la tension appliquée s'écarte de plus de 15 %, le récepteur
  est entouré en rouge et une alerte s'affiche. Le panneau de simulation indique la tension aux bornes de chaque récepteur.
- **Numérotation des bornes** : affichée d'office, selon EN 50005, et **unique au sein d'un appareil** (les symboles de même repère,
  ex. KM1) : contacts de puissance 1-2, 3-4, 5-6 puis 7-8… ; auxiliaires 13-14, 21-22, 33-34… (un rang par contact) ; bobine A1-A2.
  Section « Bornes » des propriétés : modifier la première borne fait suivre les autres (13 → 53 donne 54) ; un numéro déjà pris est
  incrémenté automatiquement, et ce que vous saisissez est prioritaire sur la numérotation automatique.

## Retours des utilisateurs

Le bouton **Retour** de la barre d'outils ouvre un formulaire (bug, amélioration, question) : résumé, description, e-mail facultatif,
schéma joint **seulement si la case est cochée** (conservé 90 jours), informations techniques (version, navigateur, taille d'écran).
Un lien propose aussi d'ouvrir un ticket GitHub pré-rempli. Fonction serveur : `api/feedback.js` (champs validés, champ piège anti-robots,
5 envois par heure et par adresse, 300 par jour au total).

**Lire les retours** : page `/admin` (mot de passe = variable d'environnement `ADMIN_TOKEN` du projet Vercel, 16 caractères minimum ;
sans elle, la page et l'API répondent 404). Filtres par nature, statut et texte, statuts Nouveau / Lu / Traité / Indésirable, notes internes,
téléchargement du schéma joint, suppression, export CSV (formules neutralisées). Les essais de connexion sont limités (10 échecs par quart
d'heure et par adresse). Pour changer le mot de passe : modifier `ADMIN_TOKEN` dans Vercel (Settings → Environment Variables) puis redéployer.
Les données brutes restent consultables dans la console Upstash (*Data Browser*, clé `albertschema:feedback`).
