// Pages de présentation statiques (référencement) et plan du site : npx tsx scripts/build-seo.mts
// L'éditeur est une application à une seule adresse : sans ces pages, les moteurs de recherche n'ont qu'un contenu à indexer.
// Chaque page est du HTML simple (aucun script), avec son titre, sa description, son adresse canonique et des liens vers l'éditeur.
// Les fichiers générés (public/<page>/index.html, public/sitemap.xml) sont commités : relancer ce script quand les exemples changent.
import fs from 'node:fs'
import path from 'node:path'
import { BUILTIN_META } from '../src/galleryMeta.ts'
import { tr } from '../src/i18n.ts'

const SITE = 'https://schema.albertduplantin.win'
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

interface Page {
  slug: string
  lang: 'fr' | 'en'
  title: string
  description: string
  h1: string
  /** corps HTML (sections) */
  body: string
}

const GROUPS: { fr: string; domain: 'electrical' | 'pneumatic' | 'hydraulic'; keys: string[] }[] = [
  { fr: 'Électricité', domain: 'electrical', keys: ['tplMotor', 'tplLamps', 'tplTimer', 'tplTrafo', 'tplCascade', 'tplRelay24', 'tplReversing'] },
  { fr: 'Pneumatique et électropneumatique', domain: 'pneumatic', keys: ['tplPneu', 'tplPneuElec', 'tplPneuAuto', 'tplPneuPlc'] },
  { fr: 'Hydraulique', domain: 'hydraulic', keys: ['tplHydMotor', 'tplHydCyl', 'tplHydTP5', 'tplHydTP6', 'tplHydTP7', 'tplHydTP8', 'tplHydTP9'] },
]
const meta = (key: string) => BUILTIN_META.find((m) => m.key === key)!
const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(3 - n)
const exampleLink = (key: string) => `${SITE}/?exemple=${key}`
const exampleItems = (keys: string[]) =>
  `<ul class="ex">${keys.map((k) => `<li><a href="/?exemple=${k}"><strong>${esc(tr('fr', k as never))}</strong></a> <span class="lvl">${stars(meta(k).level)}</span><br>${esc(meta(k).about.fr)}</li>`).join('')}</ul>`

/** Capture d'écran de l'éditeur (public/img, régénérée à la main) : légende lisible aussi par les moteurs de recherche. */
const fig = (file: string, key: string, alt: string, caption: string) =>
  `<figure><a href="/?exemple=${key}"><img src="/img/${file}.webp" width="870" height="520" alt="${esc(alt)}" loading="lazy"></a><figcaption>${esc(caption)}</figcaption></figure>`

const CTA = '<p class="cta"><a href="/">Ouvrir l’éditeur : gratuit, sans compte</a></p>'

const PAGES: Page[] = [
  {
    slug: 'schema-electrique',
    lang: 'fr',
    title: 'Schémas électriques en ligne avec simulation',
    description: 'Dessinez un schéma électrique (CEI 60617) dans le navigateur et simulez-le : contacteurs, relais, temporisations, automates. Gratuit, sans compte.',
    h1: 'Logiciel de schémas électriques en ligne, avec simulation',
    body: `
<p>Albert Schema Studio est un éditeur de schémas électriques qui fonctionne dans le navigateur, sans installation ni compte. Vous posez les symboles, tracez les conducteurs, puis <strong>simulez le circuit</strong> : le courant circule en couleur, les contacteurs collent, les voyants s’allument.</p>
${fig('exemple-electrique', 'tplRelay24', 'Schéma électrique d’un relais en 24 V alternatif avec bornier, en simulation : conducteurs colorés selon la tension', 'Relais en 24 V alternatif avec bornier, pendant la simulation.')}
<h2>Ce que vous pouvez dessiner et simuler</h2>
<ul>
<li>Circuits de commande et de puissance : disjoncteur-moteur, contacteur, relais, bouton-poussoir, auto-maintien, voyants.</li>
<li>Démarrage de moteurs, inversion du sens de marche avec verrouillage électrique, temporisations à la montée et à la retombée.</li>
<li>Boutons-poussoirs et commutateurs à plusieurs contacts (2 NO, 2 NF, 1 NO + 1 NF), commutateurs à 3 positions.</li>
<li>Automates programmables : programmation Grafcet et Ladder, avec entrées et sorties câblées sur le schéma.</li>
<li>Défauts à injecter : contact collé, court-circuit, fil coupé, déclenchement d’une protection.</li>
</ul>
<h2>Symboles et sorties</h2>
<p>Plus de 1 600 symboles normalisés (CEI 60617), un repérage automatique des bornes et des conducteurs, des cartouches à compléter, la nomenclature et la liste de câblage. Export en <strong>SVG, PNG, PDF et DXF</strong>.</p>
<h2>Exemples à ouvrir directement</h2>
${exampleItems(GROUPS[0].keys)}
${CTA}`,
  },
  {
    slug: 'schema-pneumatique',
    lang: 'fr',
    title: 'Simulateur pneumatique et électropneumatique',
    description: 'Dessinez et simulez un circuit pneumatique ou électropneumatique : vérins, distributeurs 5/2, fins de course, cycle A+ B+ A- B- avec automate.',
    h1: 'Simulateur de schémas pneumatiques et électropneumatiques',
    body: `
<p>Albert Schema Studio permet de dessiner un circuit pneumatique, de le câbler avec sa commande électrique et de le <strong>voir fonctionner</strong> : l’air sous pression en rouge, l’échappement en bleu, les tiroirs des distributeurs qui glissent, les chambres des vérins qui se remplissent.</p>
${fig('exemple-pneumatique', 'tplPneuAuto', 'Schéma électropneumatique d’un va-et-vient automatique A+ A- : vérin, distributeur 5/2 et circuit de commande en simulation', 'Va-et-vient automatique A+ A- : l’air sous pression en rouge, l’échappement en bleu.')}
<h2>Fonctions de simulation</h2>
<ul>
<li>Vérins simple et double effet, distributeurs 3/2 et 5/2, monostables et bistables, commande manuelle, électrique ou pneumatique.</li>
<li>Électrodistributeurs : l’électrovanne suit la bobine du même repère (YV1, YV1/YV2). Un clic en simulation actionne la commande manuelle de secours ; Ctrl + clic verrouille une électrovanne pour en actionner une autre en même temps.</li>
<li>Fins de course et détecteurs de position posés sur le vérin : capteurs à lame souple (ILS) et capteurs magnétiques 3 fils PNP ou NPN, avec leur position réglable le long de la course.</li>
<li>Cycles automatiques A+ A- et A+ B+ A- B- avec fins de course, ou pilotés par un automate programmable (Grafcet).</li>
<li>Repères normalisés : 1A, 1V1, 1S1, 1Y1 ; numéros d’orifices.</li>
</ul>
<h2>Exemples à ouvrir directement</h2>
${exampleItems(GROUPS[1].keys)}
${CTA}`,
  },
  {
    slug: 'schema-hydraulique',
    lang: 'fr',
    title: 'Simulateur hydraulique : pression, débit, vitesse',
    description: 'Dessinez un circuit hydraulique et lisez les pressions (bar), débits (L/min), vitesses et efforts : pompe, limiteurs, distributeurs 4/3, vérin, moteur.',
    h1: 'Simulateur de schémas hydrauliques avec valeurs chiffrées',
    body: `
<p>Albert Schema Studio simule les circuits hydrauliques avec des <strong>valeurs chiffrées</strong> : pression en bar, débit en L/min, vitesse des moteurs en tr/min, vitesse et effort des vérins, couple. Le modèle est documenté et se règle composant par composant.</p>
${fig('exemple-hydraulique', 'tplHydTP5', 'Schéma hydraulique d’un banc : pompe, limiteur de pression, distributeurs 4/3, moteur et vérin avec manomètres en bar', 'TP5 : limiteurs de pression secondaires. Les boutons ⓘ ouvrent l’explication du professeur.')}
<h2>Composants simulés</h2>
<ul>
<li>Groupe motopompe à cylindrée fixe ou variable, pompe à pression constante, pompe Load Sensing.</li>
<li>Limiteurs de pression, réducteurs de pression, limiteurs de débit unidirectionnels, clapets anti-retour pilotés.</li>
<li>Distributeurs 4/3 (centre fermé, centre tandem…), vérins à tige, moteurs hydrauliques.</li>
<li>Manomètres : la pression lue est celle du circuit à cet endroit.</li>
</ul>
<h2>Une série de travaux pratiques prête à ouvrir</h2>
<p>Les exemples reprennent un banc hydraulique : limiteur de débit à l’admission ou à l’échappement, limiteurs de pression secondaires, réducteur de pression, clapets anti-retour pilotés, pompe à pression constante, Load Sensing. Chacun peut être modifié et simulé.</p>
${exampleItems(GROUPS[2].keys)}
${CTA}`,
  },
  {
    slug: 'exercices-guides',
    lang: 'fr',
    title: 'Exercices guidés de schémas et mode classe',
    description: 'Exercices guidés pas à pas avec correction automatique, mode classe pour l’enseignant : électrotechnique, automatisme, pneumatique, hydraulique.',
    h1: 'Exercices guidés et mode classe pour l’enseignement',
    body: `
<p>Albert Schema Studio propose des <strong>exercices guidés</strong> : l’énoncé s’affiche à côté du schéma, l’élève pose les composants, les câble et simule, et l’application vérifie chaque étape.</p>
<h2>Pour l’enseignant</h2>
<ul>
<li>Un <strong>mode classe</strong> : l’élève rejoint la classe avec un lien, l’enseignant suit la progression avec le code de classe, sans compte.</li>
<li>Des exercices à publier soi-même depuis l’administration, avec niveau, durée et consignes.</li>
<li>Des exemples de la galerie pour projeter un circuit en cours : départ moteur, inversion de sens de marche, cycles pneumatiques, banc hydraulique.</li>
<li>Des boutons d’explication ⓘ à poser sur le schéma : un clic affiche le texte du professeur à côté du bouton.</li>
</ul>
<h2>Pour l’élève</h2>
<p>Pas de compte à créer : les schémas restent dans le navigateur, avec une sauvegarde en ligne facultative par code de reprise. Fonctionne hors connexion une fois chargé.</p>
${CTA}`,
  },
  {
    slug: 'exemples',
    lang: 'fr',
    title: 'Exemples de schémas à ouvrir et simuler',
    description: 'Tous les exemples d’Albert Schema Studio : départ moteur, inverseur, électropneumatique, cycles avec automate, banc hydraulique. Ouvrez-les en un clic.',
    h1: 'Exemples de schémas à ouvrir et simuler',
    body: `
<p>Chaque exemple s’ouvre dans l’éditeur en un clic. Vous pouvez le simuler, le modifier et l’enregistrer. Les étoiles indiquent le niveau de difficulté.</p>
${GROUPS.map((g) => `<h2>${esc(g.fr)}</h2>${exampleItems(g.keys)}`).join('\n')}
${CTA}`,
  },
  {
    slug: 'en',
    lang: 'en',
    title: 'Electrical, pneumatic, hydraulic circuit simulator',
    description: 'Draw and simulate electrical, pneumatic and hydraulic circuits in your browser: 1,600+ symbols, quantitative hydraulics, guided exercises, SVG/PDF export.',
    h1: 'Electrical, pneumatic and hydraulic schematic editor and simulator',
    body: `
<p>Albert Schema Studio runs in your browser: no installation, no account. Place standard symbols, wire them, then <strong>simulate the circuit</strong>.</p>
<ul>
<li>More than 1,600 symbols (IEC 60617 for electrical, ISO 1219 for fluid power).</li>
<li>Electrical control and power circuits: contactors, relays, timers, motor starters, programmable controllers (Grafcet and Ladder).</li>
<li>Pneumatic and electro-pneumatic circuits: cylinders, 5/2 valves, limit switches and magnetic sensors, automatic A+ B+ A- B- cycles.</li>
<li>Quantitative hydraulics: pressure (bar), flow (L/min), motor speed (rpm), cylinder force, relief and flow-control valves, Load Sensing.</li>
<li>Guided exercises and a class mode for teachers.</li>
<li>Export to SVG, PNG, PDF and DXF, bill of materials and wiring list. Works offline.</li>
</ul>
<figure><a href="/?exemple=tplHydTP5"><img src="/img/exemple-hydraulique.webp" width="870" height="520" alt="Hydraulic circuit with pump, relief valves, 4/3 valves, motor and cylinder, pressures shown in bar" loading="lazy"></a><figcaption>Hydraulic example: pressures in bar, flows in L/min.</figcaption></figure>
<p class="cta"><a href="/">Open the editor: free, no account</a></p>
<p>The application interface is available in English: use the FR / EN switch in the top right corner.</p>
<h2>Examples</h2>
<ul class="ex">${GROUPS.flatMap((g) => g.keys).map((k) => `<li><a href="/?exemple=${k}">${esc(tr('en', k as never))}</a> <span class="lvl">${stars(meta(k).level)}</span><br>${esc(meta(k).about.en)}</li>`).join('')}</ul>`,
  },
]

const NAV: [string, string][] = [
  ['/schema-electrique/', 'Schémas électriques'],
  ['/schema-pneumatique/', 'Pneumatique'],
  ['/schema-hydraulique/', 'Hydraulique'],
  ['/exercices-guides/', 'Exercices guidés'],
  ['/exemples/', 'Exemples'],
  ['/en/', 'English'],
]

const url = (p: Page) => `${SITE}/${p.slug}/`
const html = (p: Page) => `<!doctype html>
<html lang="${p.lang}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(p.title)} | Albert Schema Studio</title>
<meta name="description" content="${esc(p.description)}">
<meta name="robots" content="index, follow, max-image-preview:large">
<link rel="canonical" href="${url(p)}">
${p.slug === 'en' ? `<link rel="alternate" hreflang="en" href="${url(p)}">\n<link rel="alternate" hreflang="fr" href="${SITE}/">\n<link rel="alternate" hreflang="x-default" href="${SITE}/">` : ''}
<meta name="theme-color" content="#0b6bcb">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Albert Schema Studio">
<meta property="og:url" content="${url(p)}">
<meta property="og:title" content="${esc(p.title)}">
<meta property="og:description" content="${esc(p.description)}">
<meta property="og:locale" content="${p.lang === 'fr' ? 'fr_FR' : 'en_US'}">
<meta property="og:image" content="${SITE}/og.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<script type="application/ld+json">${JSON.stringify({
  '@context': 'https://schema.org',
  '@graph': [
    { '@type': 'WebPage', '@id': url(p), url: url(p), name: p.title, description: p.description, inLanguage: p.lang, isPartOf: { '@type': 'WebSite', name: 'Albert Schema Studio', url: SITE + '/' } },
    { '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Albert Schema Studio', item: SITE + '/' }, { '@type': 'ListItem', position: 2, name: p.h1, item: url(p) }] },
  ],
})}</script>
<style>
body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;line-height:1.6;color:#151916;margin:0;background:#f6f7f3}
header,main,footer{max-width:46rem;margin:0 auto;padding:0 1rem}
header{padding-top:1rem;padding-bottom:.5rem;display:flex;flex-wrap:wrap;gap:.4rem 1rem;align-items:center;border-bottom:1px solid #d3d7d0}
header a.brand{font-weight:700;text-decoration:none;color:#151916;margin-right:auto}
header a,footer a{color:#1b5fa6}
h1{font-size:1.7rem;line-height:1.25;margin:1.5rem 0 1rem}
h2{font-size:1.2rem;margin:1.8rem 0 .5rem}
ul.ex{padding-left:1.1rem}ul.ex li{margin:.6rem 0}
.lvl{color:#7a7a7a;font-size:.85rem}
figure{margin:1.2rem 0}figure img{max-width:100%;height:auto;border:1px solid #d3d7d0;border-radius:6px;display:block}figcaption{font-size:.85rem;color:#4d554e;margin-top:.3rem}
.cta a{display:inline-block;background:#1b5fa6;color:#fff;text-decoration:none;padding:.7rem 1.2rem;border-radius:6px;font-weight:600}
footer{padding-top:1rem;padding-bottom:2rem;margin-top:2rem;border-top:1px solid #d3d7d0;font-size:.9rem;color:#4d554e}
</style>
</head>
<body>
<header><a class="brand" href="/">Albert Schema Studio</a>${NAV.map(([h, t]) => `<a href="${h}">${t}</a>`).join('')}</header>
<main>
<h1>${esc(p.h1)}</h1>
${p.body.trim()}
</main>
<footer>${p.lang === 'fr' ? 'Albert Schema Studio : éditeur et simulateur de schémas électriques, pneumatiques et hydrauliques. Symboles basés sur la collection QElectroTech (CC-BY 3.0) et dessinés par l’application.' : 'Albert Schema Studio: editor and simulator for electrical, pneumatic and hydraulic schematics. Symbols based on the QElectroTech collection (CC-BY 3.0) and drawn by the application.'}</footer>
<script src="/v.js" defer></script>
</body>
</html>
`

for (const p of PAGES) {
  const dir = path.join('public', p.slug)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'index.html'), html(p))
}

const today = new Date().toISOString().slice(0, 10)
const urls = [{ loc: SITE + '/', priority: '1.0', freq: 'weekly' }, ...PAGES.map((p) => ({ loc: url(p), priority: p.slug === 'en' ? '0.7' : '0.8', freq: 'monthly' }))]
fs.writeFileSync(
  'public/sitemap.xml',
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url>\n    <loc>${u.loc}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>${u.freq}</changefreq>\n    <priority>${u.priority}</priority>\n  </url>`).join('\n')}\n</urlset>\n`,
)
console.log(`${PAGES.length} pages et un plan du site de ${urls.length} adresses écrits dans public/`)
