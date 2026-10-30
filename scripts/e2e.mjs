// Tests de bout en bout dans un vrai navigateur : npm run test:e2e
// Prérequis : Chrome ou Chromium installé (variable CHROME_PATH pour un chemin particulier).
import puppeteer from 'puppeteer-core'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'

const PORT = 5199
const URL = `http://localhost:${PORT}/`
const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean)
const chrome = CANDIDATES.find((p) => existsSync(p))
if (!chrome) { console.error('Chrome introuvable : définissez CHROME_PATH'); process.exit(2) }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let fails = 0
const check = (name, ok, info = '') => { if (!ok) fails++; console.log(ok ? 'ok   ' : 'ÉCHEC', name, ok ? '' : info) }

const server = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vite', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', shell: process.platform === 'win32' })
const stop = () => { try { process.platform === 'win32' ? spawn('taskkill', ['/pid', String(server.pid), '/T', '/F']) : server.kill() } catch { /* déjà arrêté */ } }
process.on('exit', stop)

async function waitServer() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(URL); if (r.ok) return } catch { /* pas encore prêt */ }
    await sleep(500)
  }
  throw new Error('le serveur de développement ne répond pas')
}

try {
  await waitServer()
  const browser = await puppeteer.launch({ executablePath: chrome, headless: 'new' })
  // les exports (PDF, SVG…) testés ici ne doivent pas atterrir dans le dossier Téléchargements de l'utilisateur
  await (await browser.target().createCDPSession()).send('Browser.setDownloadBehavior', { behavior: 'deny' })
  const page = await browser.newPage()
  await page.setViewport({ width: 1500, height: 900 })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  const click = (re, sel = 'button') => page.evaluate((src, s) => { const r = new RegExp(src); const el = [...document.querySelectorAll(s)].find((x) => r.test(x.textContent)); el?.click(); return !!el }, re.source, sel)
  const menu = async (n) => { const s = await page.$$('.toolbar details.menu summary'); await s[n].click() }
  const doc = () => page.evaluate(() => JSON.parse(localStorage.getItem('albertschema.doc') || '{}'))

  // ── démarrage : visite guidée, puis exemple
  await page.goto(URL, { waitUntil: 'networkidle0' })
  check('visite guidée proposée au premier lancement', await page.evaluate(() => !!document.querySelector('.tour')))
  await click(/Passer/, '.tour button')
  check('bandeau d’outils sur une seule ligne (44 px)', (await page.evaluate(() => document.querySelector('.toolbar').getBoundingClientRect().height)) <= 48)
  await click(/Relais en 24 V/)
  await sleep(500)
  check('exemple « relais 24 V » chargé', (await doc()).symbols?.length > 10)

  // ── bibliothèque redimensionnable à la souris
  const w0 = await page.evaluate(() => document.querySelector('aside.palette').getBoundingClientRect().width)
  const rz = await page.evaluate(() => { const r = document.querySelector('.palette .resizer').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + 200 } })
  await page.mouse.move(rz.x, rz.y); await page.mouse.down(); await page.mouse.move(rz.x + 160, rz.y, { steps: 6 }); await page.mouse.up()
  await sleep(200)
  const w1 = await page.evaluate(() => document.querySelector('aside.palette').getBoundingClientRect().width)
  check('bibliothèque : élargie à la souris', w1 > w0 + 100, `${w0} → ${w1}`)
  await page.evaluate(() => document.querySelector('.palette .resizer').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
  await sleep(150)
  check('bibliothèque : double-clic sur la poignée = taille d’origine', Math.abs((await page.evaluate(() => document.querySelector('aside.palette').getBoundingClientRect().width)) - w0) < 3)
  // ── revue des symboles : O garde, M masque, la liste se mémorise
  await page.evaluate(() => [...document.querySelectorAll('aside.palette label.share')].find((l) => /revue/i.test(l.textContent))?.querySelector('input')?.click())
  await sleep(200)
  await page.evaluate(() => document.querySelectorAll('.symbtn')[0]?.click()); await sleep(100)
  await page.keyboard.press('o'); await sleep(150)
  await page.keyboard.press('m'); await sleep(150)
  await page.keyboard.press('s'); await sleep(150)
  await page.keyboard.press('r'); await sleep(150)
  const rev = await page.evaluate(() => JSON.parse(localStorage.getItem('albertschema.review') || '{}'))
  check('revue : O garde, M masque, S supprime, R marque à revoir', rev.keep?.length === 1 && rev.hide?.length === 1 && rev.del?.length === 1 && rev.redo?.length === 1 && rev.keep[0] !== rev.hide[0], JSON.stringify(rev))
  check('revue : le symbole masqué reste visible (grisé) en mode revue', await page.evaluate(() => !!document.querySelector('.symbtn.revhide') && !!document.querySelector('.symbtn.revkeep')))
  for (const i of [0, 1, 2, 3]) { await page.evaluate((k) => document.querySelectorAll('.symbtn')[k]?.click(), i); await sleep(80); await page.keyboard.press('Backspace'); await sleep(80) }
  await page.evaluate(() => [...document.querySelectorAll('aside.palette label.share')].find((l) => /revue/i.test(l.textContent))?.querySelector('input')?.click())
  await sleep(150)
  // ── formes : cadre en pointillés, redimensionnement, annulation
  await menu(1); await click(/Cadre en pointillés/, '.toolbar .menu-list button')
  await page.mouse.move(790, 345); await page.mouse.down(); await page.mouse.move(890, 480, { steps: 5 }); await page.mouse.up(); await sleep(300)
  let d = await doc()
  check('cadre en pointillés créé', d.shapes?.length === 1 && d.shapes[0].stroke === 'dashed', JSON.stringify(d.shapes))
  await page.keyboard.down('Control'); await page.keyboard.press('z'); await page.keyboard.up('Control'); await sleep(300)
  check('annulation du cadre', ((await doc()).shapes ?? []).length === 0)

  // ── outil de mesure : deux clics affichent une distance en mm
  await menu(1); await click(/Mesurer une distance/, '.toolbar .menu-list button')
  await page.mouse.click(600, 400); await page.mouse.move(700, 400, { steps: 3 }); await page.mouse.click(700, 400); await sleep(200)
  check('mesure : distance affichée en mm', await page.evaluate(() => [...document.querySelectorAll('svg.canvas text')].some((t) => /\d+\.\d mm/.test(t.textContent))))
  await page.keyboard.press('Escape'); await sleep(100)
  check('mesure : Échap retire la mesure', await page.evaluate(() => ![...document.querySelectorAll('svg.canvas text')].some((t) => /\d+\.\d mm/.test(t.textContent))))

  // ── clic droit sur une forme : épaisseur et couleur
  await menu(1); await click(/Ellipse/, '.toolbar .menu-list button')
  await page.mouse.move(1000, 560); await page.mouse.down(); await page.mouse.move(1100, 620, { steps: 4 }); await page.mouse.up(); await sleep(250)
  const edge = await page.evaluate(() => { const r = document.querySelector('.canvas g[color] ellipse').getBoundingClientRect(); return [r.x + r.width / 2, r.y] })
  await page.keyboard.press('Escape')
  await page.mouse.click(edge[0], edge[1], { button: 'right' }); await sleep(300)
  await page.evaluate(() => { document.querySelectorAll('.ctx .chip')[4]?.click(); document.querySelectorAll('.ctx .ctx-colors .swatch')[1]?.click() })
  await sleep(200)
  d = await doc()
  check('clic droit : épaisseur 3,5 et couleur rouge appliquées', d.shapes?.[0]?.width === 3.5 && d.shapes[0].color === '#c80000', JSON.stringify(d.shapes?.[0]))
  await page.keyboard.press('Escape')

  // ── clic droit sur un composant : fiche « à quoi ça sert »
  const symPos = await page.evaluate(() => { const r = document.querySelector('.canvas [data-sym]').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2] })
  await page.mouse.click(symPos[0], symPos[1], { button: 'right' }); await sleep(300)
  await page.evaluate(() => [...document.querySelectorAll('.ctx button')].find((b) => /À quoi ça sert/.test(b.textContent))?.click())
  await sleep(300)
  check('clic droit : fiche « à quoi ça sert » ouverte', await page.evaluate(() => /À quoi ça sert/.test(document.querySelector('.dialog .explain')?.textContent ?? '')))
  await page.keyboard.press('Escape'); await page.evaluate(() => document.querySelector('.modal')?.click()); await sleep(200)

  // ── désignation d'un composant sur plusieurs lignes
  await page.mouse.click(symPos[0], symPos[1]); await sleep(150)
  await page.keyboard.press('Enter'); await sleep(300)
  const ta = await page.$('.propspop textarea')
  if (ta) { await ta.click({ clickCount: 3 }); await page.keyboard.type('Ligne A'); await page.keyboard.press('Enter'); await page.keyboard.type('Ligne B'); await sleep(250) }
  check('désignation : plusieurs lignes affichées', await page.evaluate(() => [...document.querySelectorAll('svg.canvas text')].some((t) => t.querySelectorAll('tspan').length === 2 && /Ligne A/.test(t.textContent) && /Ligne B/.test(t.textContent))))
  await page.keyboard.press('Escape'); await sleep(100)
  // ── annotation sur plusieurs lignes
  await menu(1); await click(/^T Texte/, '.toolbar .menu-list button'); await sleep(300)
  const pos = await page.evaluate(() => { const r = document.querySelector('[data-note]').getBoundingClientRect(); return [r.x + 10, r.y + 6] })
  await page.mouse.click(pos[0], pos[1], { count: 2 }); await sleep(300)
  await page.keyboard.type('Ligne 1'); await page.keyboard.press('Enter'); await page.keyboard.type('Ligne 2')
  await page.keyboard.down('Control'); await page.keyboard.press('Enter'); await page.keyboard.up('Control'); await sleep(300)
  d = await doc()
  check('annotation : Entrée passe à la ligne', d.notes?.some((n) => n.text === 'Ligne 1\nLigne 2'), JSON.stringify(d.notes))

  // ── bouton d'explication (ⓘ) : créé, texte affiché à côté au clic, fermé par Échap
  await menu(1); await click(/^ⓘ Bouton d’explication/, '.toolbar .menu-list button'); await sleep(300)
  d = await doc()
  check('bouton d’explication : créé comme annotation « help »', d.notes?.some((n) => n.help && n.title === 'Explication'), JSON.stringify(d.notes))
  const hp = await page.evaluate(() => { const r = document.querySelector('.help-btn').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2] })
  await page.mouse.click(hp[0], hp[1]); await sleep(300)
  check('bouton d’explication : le clic affiche le texte à côté', await page.evaluate(() => /Explication/.test(document.querySelector('.help-pop')?.textContent ?? '')))
  await page.keyboard.press('Escape'); await sleep(200)
  check('bouton d’explication : Échap ferme la fenêtre', await page.evaluate(() => !document.querySelector('.help-pop')))

  // ── nomenclature et export DXF présents dans le menu Fichier
  await menu(0)
  const items = await page.evaluate(() => [...document.querySelectorAll('.toolbar .menu-list')[0].querySelectorAll('button')].map((x) => x.textContent.trim()))
  check('menu Fichier : DXF, versions, nomenclature', ['DXF (AutoCAD, EPLAN…)', 'Versions…', 'Nomenclature'].every((x) => items.includes(x)), items.join(' | '))
  // ── PDF direct : un vrai fichier PDF est généré
  await page.evaluate(() => { window.__blobs = []; const o = URL.createObjectURL.bind(URL); URL.createObjectURL = (b) => { window.__blobs.push(b); return o(b) } })
  await click(/Télécharger en PDF \(cette feuille\)/, '.toolbar .menu-list button')
  await sleep(2500)
  const pdfHead = await page.evaluate(async () => { const b = (window.__blobs || []).find((x) => x.type === 'application/pdf'); return b ? { size: b.size, head: await b.slice(0, 8).text(), tail: await b.slice(b.size - 6).text() } : null })
  check('PDF direct : fichier valide (%PDF… %%EOF)', !!pdfHead && pdfHead.head.startsWith('%PDF-1.4') && pdfHead.tail.includes('%%EOF') && pdfHead.size > 5000, JSON.stringify(pdfHead))
  await page.keyboard.press('Escape')

  // ── simulation : marche, voyants
  await click(/Simuler/); await sleep(400)
  check('simulation démarrée', await page.evaluate(() => !!document.querySelector('.toolbar .simbtn.on')))
  // ── exemple automate : cycle A+ B+ A- B- (chambres colorées, pas d'erreur)
  const p3 = await browser.newPage()
  await p3.setViewport({ width: 1500, height: 950 })
  p3.on('pageerror', (e) => errors.push(String(e)))
  await p3.evaluateOnNewDocument(() => { try { localStorage.clear(); localStorage.setItem('albertschema.tour', '1') } catch {} })
  await p3.goto(URL, { waitUntil: 'networkidle0' })
  await sleep(500)
  await p3.evaluate(() => [...document.querySelectorAll('button')].find((x) => /A\+ B\+ A- B-/.test(x.textContent))?.click())
  await sleep(800)
  await p3.evaluate(() => [...document.querySelectorAll('button')].find((x) => /Simuler/.test(x.textContent))?.click())
  await sleep(500)
  // clic maintenu sur l'électrovanne de gauche (A) du premier distributeur : elle s'active à la main
  const sol = await p3.evaluate(() => { const r = [...document.querySelectorAll('svg.canvas [data-sol="a"]')][0]?.getBoundingClientRect(); return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null })
  const yellow = () => p3.evaluate(() => [...document.querySelectorAll('svg.canvas [data-sol]')].some((e) => e.getAttribute('fill') === '#ffd54f'))
  check('exemple automate : au repos aucune électrovanne n’est active', !(await yellow()))
  if (sol) { await p3.mouse.move(sol.x, sol.y); await p3.mouse.down(); await sleep(400) }
  check('exemple automate : clic maintenu sur une électrovanne → elle s’active', !!sol && (await yellow()))
  await p3.mouse.up(); await sleep(300)
  const s1 = await p3.evaluate(() => { const d = JSON.parse(localStorage.getItem('albertschema.doc')); const g = document.querySelector(`[data-sym="${d.symbols.find((x) => x.label === 'S1').id}"]`); const q = [...g.querySelectorAll('path,rect,line')].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 3 && r.height > 3).sort((a, b) => b.width * b.height - a.width * a.height)[0]; return { x: q.x + q.width / 2, y: q.y + q.height / 2 } })
  await p3.mouse.move(s1.x, s1.y); await p3.mouse.down(); await sleep(250); await p3.mouse.up()
  await sleep(600)
  check('exemple automate : chambres du vérin colorées en rouge (pression) pendant le cycle', await p3.evaluate(() => !!document.querySelector('svg.canvas rect[fill^="rgba(229"]')))
  check('exemple automate : voyant RUN de l’automate', await p3.evaluate(() => [...document.querySelectorAll('svg.canvas text')].some((t) => t.textContent === 'RUN')))
  // vue machine : la partie opérative 2D suit les vérins du schéma
  await p3.evaluate(() => [...document.querySelectorAll('.toolbar button')].find((b) => /Machine/.test(b.textContent))?.click())
  await sleep(2500)
  check('vue machine : la machine animée s’affiche avec des pièces', await p3.evaluate(() => !!document.querySelector('.machview svg') && document.querySelectorAll('.machview svg rect[rx="3"]').length > 0))
  await p3.screenshot({ path: process.env.TEMP + '/mv.png' })
  await p3.evaluate(() => document.querySelector('.machview .x')?.click())
  // ── éditeur de programme : ouverture, glisser-déposer, ancrage et agrandissement de la fenêtre
  const plcAt = await p3.evaluate(() => { const d = JSON.parse(localStorage.getItem('albertschema.doc')); const g = document.querySelector(`[data-sym="${d.symbols.find((x) => x.label === 'API1').id}"]`); const q = [...g.querySelectorAll('path,rect')].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 20).sort((a, b) => b.width * b.height - a.width * a.height)[0]; return { x: q.x + q.width / 2, y: q.y + q.height / 2 } })
  await p3.click('.toolbar .simbtn.on').catch(() => {})
  await sleep(300)
  await p3.mouse.click(plcAt.x, plcAt.y)
  await sleep(300)
  await p3.evaluate(() => [...document.querySelectorAll('button')].find((x) => /Programmer l/.test(x.textContent))?.click())
  await sleep(500)
  check('éditeur de programme : fenêtre ouverte avec le Grafcet', await p3.evaluate(() => !!document.querySelector('.plcwin .gf')))
  const dnd = async (fromSel, toSel) => {
    await p3.evaluate((fs) => { window.__dt = new DataTransfer(); document.querySelector(fs).dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: window.__dt })) }, fromSel)
    await sleep(80)
    await p3.evaluate((ts) => document.querySelector(ts).dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: window.__dt })), toSel)
    await sleep(80)
    await p3.evaluate((ts) => document.querySelector(ts).dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: window.__dt })), toSel)
    await sleep(80)
    await p3.evaluate((fs) => document.querySelector(fs).dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: window.__dt })), fromSel)
    await sleep(200)
  }
  const nSteps = () => p3.evaluate(() => document.querySelectorAll('.plcwin .gf-step').length)
  const n0 = await nSteps()
  await dnd('.pe-tools .tool', '.gf-slot:nth-of-type(1)')
  check('éditeur de programme : glisser l’élément « Étape » sur un ＋ ajoute une étape', (await nSteps()) === n0 + 1, `${n0} → ${await nSteps()}`)
  await dnd('.vchip.out', '.gf-block .gf-step')
  check('éditeur de programme : glisser une sortie sur une étape ajoute une action', await p3.evaluate(() => document.querySelectorAll('.plcwin .gf-act').length > 4))
  // Grafcet graphique : alternative (OU) sur une étape, parallélisme (ET) sur une transition, choisis dans la palette puis posés d'un clic
  const pickTool = (re) => p3.evaluate((src) => [...document.querySelectorAll('.pe-tools .tool')].find((b) => new RegExp(src).test(b.textContent))?.click(), re)
  await pickTool('Alternative'); await sleep(150)
  await p3.evaluate(() => document.querySelectorAll('.plcwin .gfg-step')[2]?.click()); await sleep(300)
  check('Grafcet : une alternative (OU) ajoute une divergence', await p3.evaluate(() => !!document.querySelector('.plcwin .gfg-blk.or')))
  await pickTool('Parallèle'); await sleep(150)
  await p3.evaluate(() => document.querySelectorAll('.plcwin .gfg-trw')[0]?.click()); await sleep(300)
  check('Grafcet : un parallélisme (ET) ajoute une divergence en trait double', await p3.evaluate(() => !!document.querySelector('.plcwin .gfg-blk.and')))
  await p3.screenshot({ path: process.env.TEMP + '/gf.png' })
  const stageH = () => p3.evaluate(() => document.querySelector('svg.canvas').getBoundingClientRect().height)
  const h1 = await stageH()
  await p3.evaluate(() => document.querySelector('.plcwin-btns button[aria-label="Ancrer à droite"]').click())
  await sleep(300)
  const h2 = await stageH()
  check('éditeur de programme : ancrée à droite, la feuille reprend toute sa hauteur', h2 > h1, `${h1} → ${h2}`)
  await p3.evaluate(() => document.querySelector('.plcwin-btns button[aria-label="Agrandir"]').click())
  await sleep(300)
  check('éditeur de programme : agrandie, la fenêtre couvre toute la zone de travail', await p3.evaluate(() => { const r = document.querySelector('.plcwin').getBoundingClientRect(), s = document.querySelector('main.stage').getBoundingClientRect(); return r.width >= s.width - 2 && r.height >= s.height - 2 }))
  await p3.evaluate(() => document.querySelector('.plcwin-btns button[aria-label="Agrandir"]').click())
  await sleep(200)
  // menu Fichier au-dessus de la fenêtre ; glisser le bandeau détache la fenêtre
  await p3.evaluate(() => document.querySelector('.toolbar details.menu summary').click())
  await sleep(200)
  check('éditeur de programme : le menu Fichier s’affiche au-dessus de la fenêtre', await p3.evaluate(() => { const m = document.querySelector('.toolbar details.menu[open] .menu-list'); if (!m) return false; const r = m.getBoundingClientRect(); const top = document.elementFromPoint(r.x + 20, r.y + 20); return !!top && m.contains(top) }))
  await p3.evaluate(() => document.querySelector('.toolbar details.menu').removeAttribute('open'))
  const hb = await p3.evaluate(() => { const r = document.querySelector('.plcwin > header .plcwin-title').getBoundingClientRect(); return { x: r.x + 10, y: r.y + 8 } })
  await p3.mouse.move(hb.x, hb.y); await p3.mouse.down(); await p3.mouse.move(hb.x + 120, hb.y - 120, { steps: 8 }); await p3.mouse.up()
  await sleep(250)
  check('éditeur de programme : glisser le bandeau détache la fenêtre (flottante)', await p3.evaluate(() => document.querySelector('.plcwin').className.includes('dock-float')))
  await p3.evaluate(() => document.querySelector('.plcwin-btns button[aria-label="Réduire"]').click())
  await sleep(200)
  check('éditeur de programme : réduite en barre de titre', await p3.evaluate(() => document.querySelector('.plcwin').getBoundingClientRect().height < 60))
  // banc hydraulique : moteur, pressions en bar et vitesse en tr/min pendant qu'on maintient une électrovanne
  const p4 = await browser.newPage()
  await p4.setViewport({ width: 1500, height: 950 })
  p4.on('pageerror', (e) => errors.push(String(e)))
  await p4.evaluateOnNewDocument(() => { try { localStorage.clear(); localStorage.setItem('albertschema.tour', '1') } catch {} })
  await p4.goto(URL, { waitUntil: 'networkidle0' })
  await sleep(500)
  await p4.evaluate(() => [...document.querySelectorAll('button')].find((x) => /moteur et limiteurs de débit/.test(x.textContent))?.click())
  await sleep(600)
  check('exemple : la fiche (à quoi ça sert, ce qu’on apprend, à simuler) s’ouvre avec l’exemple', await p4.evaluate(() => /À quoi ça sert/i.test(document.querySelector('.exguide')?.textContent ?? '') && /À simuler/i.test(document.querySelector('.exguide')?.textContent ?? '')))
  await p4.evaluate(() => document.querySelector('.exguide-x')?.click())
  await sleep(900)
  await p4.evaluate(() => [...document.querySelectorAll('button')].find((x) => /Simuler/.test(x.textContent))?.click())
  await sleep(600)
  // réglage d'un limiteur de débit sans quitter la simulation : le bouton + augmente l'ouverture
  const before = await p4.evaluate(() => [...document.querySelectorAll('svg.canvas text')].map((e) => e.textContent).filter((t) => /^\d+ %$/.test(t)))
  const plus = await p4.evaluate(() => { const r = document.querySelector('svg.canvas [data-adj$="|open|5"]')?.getBoundingClientRect(); return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null })
  if (plus) { await p4.mouse.move(plus.x, plus.y); await p4.mouse.down(); await p4.mouse.up(); await sleep(400) }
  const after = await p4.evaluate(() => [...document.querySelectorAll('svg.canvas text')].map((e) => e.textContent).filter((t) => /^\d+ %$/.test(t)))
  check('limiteur de débit : le bouton + de la simulation augmente l’ouverture', !!plus && JSON.stringify(before) !== JSON.stringify(after), JSON.stringify([before, after]))
  // charge du moteur : le bouton + de la simulation augmente le couple résistant
  const ch0 = await p4.evaluate(() => [...document.querySelectorAll('svg.canvas text')].map((e) => e.textContent).filter((t) => /N·m$/.test(t) && /charge/.test(t)))
  const plusC = await p4.evaluate(() => { const r = document.querySelector('svg.canvas [data-adj$="|torque|5"]')?.getBoundingClientRect(); return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null })
  if (plusC) { await p4.mouse.move(plusC.x, plusC.y); await p4.mouse.down(); await p4.mouse.up(); await sleep(400) }
  const ch1 = await p4.evaluate(() => [...document.querySelectorAll('svg.canvas text')].map((e) => e.textContent).filter((t) => /N·m$/.test(t) && /charge/.test(t)))
  check('moteur : le bouton + augmente la charge (couple résistant)', !!plusC && JSON.stringify(ch0) !== JSON.stringify(ch1), JSON.stringify([ch0, ch1]))
  const hs = await p4.evaluate(() => { const r = document.querySelector('svg.canvas [data-sol="a"]')?.getBoundingClientRect(); return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null })
  if (hs) { await p4.mouse.move(hs.x, hs.y); await p4.mouse.down(); await sleep(1500) }
  check('banc hydraulique : pressions en bar et vitesse du moteur affichées', await p4.evaluate(() => { const t = [...document.querySelectorAll('svg.canvas text')].map((e) => e.textContent); return t.some((x) => /\d+ bar/.test(x)) && t.some((x) => /tr\/min/.test(x)) }))
  check('circulation d’huile : des traits animés sur les conducteurs', await p4.evaluate(() => document.querySelectorAll('svg.canvas polyline[stroke-dasharray="0.5 6"]').length > 2))
  await p4.screenshot({ path: process.env.TEMP + '/hyd.png' })
  await p4.mouse.up()
  // sauvegarde en ligne : la fenêtre s'ouvre depuis le menu Fichier
  await p4.evaluate(() => [...document.querySelectorAll('.menu-list button')].find((x) => /Sauvegarde en ligne/.test(x.textContent))?.click())
  await sleep(500)
  check('sauvegarde en ligne : la fenêtre propose de créer une sauvegarde et de reprendre avec un code', await p4.evaluate(() => { const t = document.querySelector('.cloud')?.textContent ?? ''; return /Créer ma sauvegarde en ligne/.test(t) && /Reprendre avec un code/.test(t) }))
  await p4.evaluate(() => [...document.querySelectorAll('.cloud button')].find((x) => /Fermer/.test(x.textContent))?.click())
  // textes dessinés dans les symboles : déplaçables à la souris hors simulation
  await p4.click('.simbtn'); await sleep(400)
  const tg = await p4.evaluate(() => { const e = document.querySelector('svg.canvas [data-tag="sa"]'); const r = e?.getBoundingClientRect(); return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2, t: e.textContent } : null })
  if (tg) { await p4.mouse.move(tg.x, tg.y); await p4.mouse.down(); await p4.mouse.move(tg.x + 25, tg.y + 14, { steps: 4 }); await p4.mouse.up(); await sleep(300) }
  check('texte de symbole : le repère d’électroaimant se déplace à la souris', !!tg && await p4.evaluate(() => [...document.querySelectorAll('svg.canvas [data-tag="sa"]')].some((e) => e.hasAttribute('transform'))))
  await p4.close()
  await p3.keyboard.press('Escape')
  await p3.close()
  // ── lien d'exercice : ?exo=… ouvre directement l'exercice
  const p2 = await browser.newPage()
  await p2.setViewport({ width: 1500, height: 900 })
  await p2.evaluateOnNewDocument(() => { try { localStorage.clear(); localStorage.setItem('albertschema.tour', '1') } catch {} })
  await p2.goto(URL + '?exo=d-latch&classe=TEST-1', { waitUntil: 'networkidle0' })
  await sleep(500)
  check('lien d’exercice : le dépannage s’ouvre avec son schéma en panne', await p2.evaluate(() => /Dépannage/.test(document.querySelector('.guided')?.textContent ?? '') && !location.search), await p2.evaluate(() => document.querySelector('.guided')?.textContent?.slice(0, 80)))
  check('lien d’exercice : le code de classe est mémorisé', await p2.evaluate(() => JSON.parse(localStorage.getItem('albertschema.class') || '{}').code === 'TEST-1'))
  await p2.close()
  check('aucune erreur de console', errors.length === 0, errors.join(' | '))
  await browser.close()
} catch (e) {
  fails++
  console.error('ÉCHEC', e)
}
stop()
console.log(fails ? `\n${fails} ÉCHEC(S)` : '\ntous les tests e2e passent')
process.exit(fails ? 1 : 0)
