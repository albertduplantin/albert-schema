// Temps de calcul sur un gros schéma (plusieurs centaines de symboles) : npm run bench
import { readFileSync } from 'node:fs'
const ROOT = '..'
const { SYMBOL_MAP, SYMBOLS } = await import(ROOT + '/src/symbols/index.ts')
const lib = (await import('./lib-full.mjs')).loadFull()
for (const s of lib.symbols) { SYMBOLS.push(s); SYMBOL_MAP[s.id] = s }
const T = await import(ROOT + '/src/templates.ts')
const { simulate } = await import(ROOT + '/src/sim/engine.ts')
const { routeAll } = await import(ROOT + '/src/routing.ts')
const { checkDoc } = await import(ROOT + '/src/check.ts')
const base: any = { version: 1, paper: 'A3', title: {}, symbols: [], wires: [] }
const n = Number(process.argv[2] ?? 30)
const one = T.motorStarterTransformer(base)
const symbols: any[] = [], wires: any[] = []
for (let k = 0; k < n; k++) {
  const d = JSON.parse(JSON.stringify(one))
  const map = new Map<string, string>()
  for (const s of d.symbols) { const id = `${s.id}_${k}`; map.set(s.id, id); symbols.push({ ...s, id, x: s.x + (k % 6) * 700, y: s.y + Math.floor(k / 6) * 500, label: s.label ? `${s.label}_${k}` : '' }) }
  for (const w of d.wires) wires.push({ ...w, id: `${w.id}_${k}`, from: { ...w.from, symId: map.get(w.from.symId) }, to: { ...w.to, symId: map.get(w.to.symId) } })
}
const doc: any = { ...base, paper: 'A1', symbols, wires }
const time = (name: string, fn: () => void) => { const t = performance.now(); fn(); console.log(`${name.padEnd(28)} ${(performance.now() - t).toFixed(0).padStart(6)} ms`) }
console.log(`${symbols.length} symboles, ${wires.length} fils`)
time('simulate (1 calcul)', () => simulate(doc, SYMBOL_MAP, {}, { pressed: new Set(), toggled: new Set() }, 0))
time('routeAll', () => routeAll(doc.wires, doc.symbols))
time('checkDoc (Contrôle)', () => checkDoc(doc, SYMBOL_MAP, 'fr'))
