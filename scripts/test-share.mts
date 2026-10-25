// Lien de partage : aller-retour d'un schéma complet : npm test
import { encodeDoc, decodeDoc } from '../src/share.ts'
const { SYMBOL_MAP, SYMBOLS } = await import('../src/symbols/index.ts')
const { readFileSync } = await import('node:fs')
const lib = (await import('./lib-full.mjs')).loadFull()
for (const s of lib.symbols) { SYMBOLS.push(s); SYMBOL_MAP[s.id] = s }
const T = await import('../src/templates.ts')
const base: any = { version: 1, paper: 'A3', title: { title: 'é ç ✓' }, symbols: [], wires: [] }
let fails = 0
const check = (n: string, ok: boolean) => { if (!ok) fails++; console.log((ok ? 'ok   ' : 'ÉCHEC') + ' ' + n) }
for (const [n, f] of [['inverseur', T.reversingStarter], ['cascade', T.delayedCascade]] as const) {
  const d = f(base)
  const frag = await encodeDoc(d)
  check(`partage : « ${n} » aller-retour identique`, JSON.stringify(await decodeDoc(frag)) === JSON.stringify(d))
  check(`partage : « ${n} » lien compact (${frag.length} car.)`, frag.length < 4000 && /^[\w-]+$/.test(frag))
}
let bad = false
try { await decodeDoc('AAAA') } catch { bad = true }
check('partage : fragment invalide refusé', bad)
console.log(fails ? `\n${fails} ÉCHEC(S)` : '\ntous les tests de partage passent')
process.exit(fails ? 1 : 0)
