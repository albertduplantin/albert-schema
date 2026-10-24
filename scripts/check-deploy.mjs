// Vérifie que la version en ligne est bien le dernier commit : node scripts/check-deploy.mjs [url] [minutes]
// Le site contient l'identifiant du commit déployé (voir vite.config.ts) ; on le cherche dans ses fichiers JavaScript.
import { execSync } from 'node:child_process'

const url = (process.argv[2] ?? 'https://albert-schema.vercel.app').replace(/\/$/, '')
const minutes = Number(process.argv[3] ?? 6)
const sha = execSync('git rev-parse --short=7 HEAD').toString().trim()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function deployedHas(sha) {
  const html = await (await fetch(url + '/?t=' + Date.now(), { cache: 'no-store' })).text()
  const scripts = [...html.matchAll(/(?:src|href)="(\.?\/?assets\/[^"]+\.js)"/g)].map((m) => m[1].replace(/^\.?\//, ''))
  for (const s of scripts) {
    const js = await (await fetch(`${url}/${s}`)).text()
    if (js.includes(sha)) return true
    // le code découpé en plusieurs fichiers : on suit aussi les importations directes
    for (const m of js.matchAll(/["'](?:\.\/)?([\w.-]+\.js)["']/g)) {
      try { if ((await (await fetch(`${url}/assets/${m[1]}`)).text()).includes(sha)) return true } catch { /* fichier absent */ }
    }
  }
  return false
}

const end = Date.now() + minutes * 60_000
for (;;) {
  try {
    if (await deployedHas(sha)) { console.log(`✓ ${url} sert le commit ${sha}`); process.exit(0) }
  } catch (e) { console.log('(site injoignable :', e.message + ')') }
  if (Date.now() > end) { console.error(`✗ ${url} ne sert pas encore le commit ${sha} après ${minutes} min`); process.exit(1) }
  console.log(`… commit ${sha} pas encore en ligne, nouvel essai dans 20 s`)
  await sleep(20_000)
}
