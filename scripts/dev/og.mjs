// Image de partage (réseaux sociaux, moteurs de recherche) : public/og.png, 1200 × 630, d'après la bibliothèque de symboles.
// Usage : node scripts/dev/og.mjs   (après npx tsx scripts/build-library.mts)
import fs from 'node:fs'
import puppeteer from 'puppeteer-core'

const lib = JSON.parse(fs.readFileSync('public/library-core.json', 'utf8'))
const pick = (re) => (lib.symbols ?? lib).find((s) => re.test(s.id))
const parts = [/own:hyd\/groupe_pompe_fixe/, /own:hyd\/limiteur_pression/, /own:hyd\/moteur_hydraulique/, /own:hyd\/filtre_clapet/].map(pick).filter(Boolean)
const svg = (s, k) => `<svg width="${(s.w + 20) * k}" height="${(s.h + 20) * k}" viewBox="-10 -10 ${s.w + 20} ${s.h + 20}" fill="none" stroke="#0d2a4a" stroke-width="1.5" style="--bg:#fff">${s.svg}</svg>`
const html = `<body style="margin:0;width:1200px;height:630px;background:linear-gradient(135deg,#eef4fb,#d9e6f5);font-family:'Segoe UI',Arial,sans-serif;position:relative;overflow:hidden">
<div style="position:absolute;inset:0;background-image:radial-gradient(#9db4cf 1.2px,transparent 1.2px);background-size:30px 30px;opacity:.55"></div>
<div style="position:absolute;left:70px;top:70px;width:1060px">
  <div style="color:#0b6bcb;font-weight:700;letter-spacing:.12em;font-size:26px">ALBERT SCHEMA STUDIO</div>
  <div style="color:#0d2a4a;font-weight:800;font-size:64px;line-height:1.08;margin-top:14px">Schémas électriques,<br>pneumatiques et hydrauliques</div>
  <div style="color:#35506f;font-size:30px;margin-top:20px">Éditeur et simulateur gratuit, dans le navigateur</div>
</div>
<div style="position:absolute;left:60px;right:60px;bottom:50px;display:flex;justify-content:space-between;align-items:flex-end;background:#ffffffcc;border:2px solid #b9cde3;border-radius:14px;padding:6px 20px">
  ${parts.map((s) => svg(s, 1.7)).join('')}
</div></body>`
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => fs.existsSync(p))
const b = await puppeteer.launch({ executablePath: exe, headless: true })
const p = await b.newPage()
await p.setViewport({ width: 1200, height: 630 })
await p.setContent(html)
await p.screenshot({ path: 'public/og.png' })
await b.close()
console.log('public/og.png', fs.statSync('public/og.png').size, 'octets')
