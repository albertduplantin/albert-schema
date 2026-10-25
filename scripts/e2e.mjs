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

  // ── annotation sur plusieurs lignes
  await menu(1); await click(/^T Texte/, '.toolbar .menu-list button'); await sleep(300)
  const pos = await page.evaluate(() => { const r = document.querySelector('[data-note]').getBoundingClientRect(); return [r.x + 10, r.y + 6] })
  await page.mouse.click(pos[0], pos[1], { count: 2 }); await sleep(300)
  await page.keyboard.type('Ligne 1'); await page.keyboard.press('Enter'); await page.keyboard.type('Ligne 2')
  await page.keyboard.down('Control'); await page.keyboard.press('Enter'); await page.keyboard.up('Control'); await sleep(300)
  d = await doc()
  check('annotation : Entrée passe à la ligne', d.notes?.some((n) => n.text === 'Ligne 1\nLigne 2'), JSON.stringify(d.notes))

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
  const s1 = await p3.evaluate(() => { const d = JSON.parse(localStorage.getItem('albertschema.doc')); const g = document.querySelector(`[data-sym="${d.symbols.find((x) => x.label === 'dcy').id}"]`); const q = [...g.querySelectorAll('path,rect,line')].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 3 && r.height > 3).sort((a, b) => b.width * b.height - a.width * a.height)[0]; return { x: q.x + q.width / 2, y: q.y + q.height / 2 } })
  await p3.mouse.move(s1.x, s1.y); await p3.mouse.down(); await sleep(250); await p3.mouse.up()
  await sleep(600)
  check('exemple automate : chambres du vérin colorées en rouge (pression) pendant le cycle', await p3.evaluate(() => !!document.querySelector('svg.canvas rect[fill^="rgba(229"]')))
  check('exemple automate : voyant RUN de l’automate', await p3.evaluate(() => [...document.querySelectorAll('svg.canvas text')].some((t) => t.textContent === 'RUN')))
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
