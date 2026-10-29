// Planche de symboles de la bibliothèque en PNG (orifices en rouge), pour juger un dessin d'un coup d'œil.
// Usage : node scripts/dev/shot.mjs "<regex sur l'id>" sortie.png [zoom]      ex. node scripts/dev/shot.mjs "own:hyd/(filtre|moteur)" %TEMP%/s.png
// Pense à régénérer la bibliothèque avant : npx tsx scripts/build-library.mts
import fs from 'node:fs'
import puppeteer from 'puppeteer-core'

const [re, out, zoom = '2.4'] = process.argv.slice(2)
if (!re || !out) { console.error('usage : shot.mjs "<regex id>" sortie.png [zoom]'); process.exit(2) }
const k = Number(zoom)
const lib = JSON.parse(fs.readFileSync('public/library-' + (process.env.LIB ?? 'core') + '.json', 'utf8'))
const syms = (lib.symbols ?? lib).filter((s) => new RegExp(re).test(s.id))
if (!syms.length) { console.error('aucun symbole'); process.exit(1) }
let h = '<body style="background:#fff;color:#000;margin:6px">'
for (const s of syms) h += `<svg width="${(s.w + 20) * k}" height="${(s.h + 20) * k}" viewBox="-10 -10 ${s.w + 20} ${s.h + 20}" fill="none" stroke="#000" stroke-width="1.2" style="--bg:#fff;border:1px solid #ccc;margin:2px"><title>${s.id}</title>${s.svg}${s.ports.map((p) => `<circle cx="${p.x}" cy="${p.y}" r="1.6" fill="red" stroke="none"/>`).join('')}</svg>`
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => fs.existsSync(p))
const b = await puppeteer.launch({ executablePath: exe, headless: true })
const p = await b.newPage()
await p.setViewport({ width: 1300, height: 200 })
await p.setContent(h)
await p.screenshot({ path: out, fullPage: true })
await b.close()
console.log(`${syms.length} symbole(s) → ${out}`)
