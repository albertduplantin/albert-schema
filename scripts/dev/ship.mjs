// Vérifier, commiter, pousser et contrôler le déploiement, en sortie réduite.
// Usage : node scripts/dev/ship.mjs "message du commit" [--no-e2e] [--lib]
//   --lib : régénère public/library-*.json avant (à utiliser quand src/symbols a changé)
import { spawnSync } from 'node:child_process'

const args = process.argv.slice(2)
const msg = args.find((a) => !a.startsWith('--'))
if (!msg) { console.error('message de commit manquant'); process.exit(2) }
const run = (cmd, quiet = true) => { const r = spawnSync(cmd, { shell: true, encoding: 'utf8' }); if (!quiet || r.status) process.stdout.write((r.stdout ?? '') + (r.stderr ?? '')); return r }

if (args.includes('--lib')) { const r = run('npx tsx scripts/build-library.mts'); if (r.status) process.exit(1); console.log('✓ bibliothèque régénérée') }
const v = spawnSync(`node scripts/dev/verify.mjs ${args.includes('--no-e2e') ? '' : '--e2e'}`, { shell: true, encoding: 'utf8' })
process.stdout.write(v.stdout)
if (v.status) { console.log('→ rien de commité'); process.exit(1) }

const body = `${msg}\n\nCo-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`
run('git add -A')
const added = run('git diff --cached --name-status --diff-filter=A').stdout.trim()
const c = spawnSync('git', ['commit', '-qm', body], { encoding: 'utf8' })
if (c.status) { console.log((c.stdout + c.stderr).trim() || 'rien à commiter'); process.exit(1) }
if (added) console.log('+ nouveaux fichiers commités :\n  ' + added.split('\n').join('\n  '))
if (run('git push -q').status) process.exit(1)
const d = run('npm run check:deploy')
console.log((d.stdout + d.stderr).trim().split('\n').pop())
