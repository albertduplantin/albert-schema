// Vérification silencieuse : tsc + chaîne de tests de package.json (+ e2e avec --e2e).
// Affiche une ligne par étape ; en cas d'échec, uniquement les lignes utiles. Sortie 0 si tout passe.
// Usage : node scripts/dev/verify.mjs [--e2e] [--only=hydraulic]   (--only filtre les étapes par sous-chaîne)
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'

const args = process.argv.slice(2)
const only = args.find((a) => a.startsWith('--only='))?.slice(7)
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
const steps = [['tsc', 'npx tsc --noEmit -p .'], ...pkg.scripts.test.split('&&').map((c) => c.trim()).map((c) => [c.replace(/^(tsx|node) scripts\//, '').replace(/\.(mts|mjs)$/, ''), 'npx ' + c.replace(/^node /, 'node ')])]
if (args.includes('--e2e')) steps.push(['e2e', 'npm run test:e2e'])

// l'assertion libuv de Windows à la sortie (code 127 / 0xC0000409) n'est pas un échec de test
const FAIL = /(^|\s)(ÉCHEC|FAIL|not ok)\b|error TS\d+|Error:/
let bad = 0
for (const [name, cmd] of steps) {
  if (only && !name.includes(only) && name !== 'tsc') continue
  const t0 = Date.now()
  const r = spawnSync(cmd, { shell: true, encoding: 'utf8', maxBuffer: 64 << 20 })
  const out = (r.stdout ?? '') + (r.stderr ?? '')
  const lines = out.split(/\r?\n/)
  const failing = lines.filter((l) => FAIL.test(l))
  const crashed = r.status !== 0 && !failing.length && !/UV_HANDLE_CLOSING/.test(out)
  const nOk = lines.filter((l) => /^ok\b/.test(l)).length
  if (failing.length || crashed) {
    bad++
    console.log(`✗ ${name}`)
    for (const l of (failing.length ? failing : lines.filter(Boolean).slice(-12)).slice(0, 12)) console.log('   ' + l.slice(0, 240))
  } else console.log(`✓ ${name}${nOk ? ` (${nOk})` : ''} ${((Date.now() - t0) / 1000).toFixed(1)}s`)
}
console.log(bad ? `\n${bad} étape(s) en échec` : '\ntout passe')
process.exit(bad ? 1 : 0)
