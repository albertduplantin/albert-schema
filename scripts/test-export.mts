// Tests des exports (DXF, liste de bornier) : npm test
import { readFileSync } from 'node:fs'
const ROOT = '..'
const { SYMBOL_MAP, SYMBOLS } = await import(ROOT + '/src/symbols/index.ts')
const lib = JSON.parse(readFileSync(new URL('../public/qet-library.json', import.meta.url), 'utf8'))
for (const s of lib.symbols) { SYMBOLS.push(s); SYMBOL_MAP[s.id] = s }
const T = await import(ROOT + '/src/templates.ts')
const { dxfOf, pathPolylines, svgStrokes } = await import(ROOT + '/src/dxf.ts')
const { toMonochrome } = await import(ROOT + '/src/exporters.ts')
const { terminalRows } = await import(ROOT + '/src/strips.ts')
const base: any = { version: 1, paper: 'A3', title: { title: 'Essai', author: '', company: '', date: '', revision: '', sheet: '' }, symbols: [], wires: [] }
let fails = 0
const check = (name: string, ok: boolean, info = '') => { if (!ok) fails++; console.log(ok ? 'ok   ' : 'ÉCHEC', name, ok ? '' : info) }

const sq = pathPolylines('M0 0H10V10H0Z')
check('chemin : carré fermé de 5 points', sq.length === 1 && sq[0].closed && sq[0].pts.length === 5, JSON.stringify(sq))
const arc = pathPolylines('M0 0A10 10 0 0 1 20 0')
check('chemin : arc échantillonné, passe par le sommet (10, ±10)', arc[0].pts.length > 6 && arc[0].pts.some((p: number[]) => Math.abs(Math.abs(p[1]) - 10) < 0.5), JSON.stringify(arc[0].pts.slice(0, 3)))
const st = svgStrokes('<g transform="translate(10 20)"><path d="M0 0L5 0"/><ellipse cx="0" cy="0" rx="2" ry="2"/></g>', [1, 0, 0, 1, 100, 0])
check('SVG : translation cumulée (110, 20) et cercle échantillonné', st.length === 2 && st[0].pts[0][0] === 110 && st[0].pts[0][1] === 20 && st[1].closed, JSON.stringify(st[0]))

for (const [n, fn] of [['relais 24 V', T.relay24V], ['départ moteur', T.motorStarter], ['inverseur', T.reversingStarter], ['pneumatique', T.pneumaticCylinder]] as const) {
  const d = (fn as any)(base)
  d.shapes = [{ id: 's', kind: 'rect', x: 50, y: 50, w: 100, h: 80, stroke: 'solid', width: 1.6, color: '#000000', label: 'Coffret' }]
  const out: string = dxfOf(d)
  const lines = out.split('\n')
  const n_ent = lines.filter((l, i) => i % 2 === 0 && l === '0').length
  const entities = lines.filter((l, i) => i % 2 === 1 && /^(LINE|TEXT)$/.test(l) && lines[i - 1] === '0').length
  check(`DXF ${n} : structure valide et entités`, out.startsWith('0\nSECTION') && out.trimEnd().endsWith('EOF') && entities > 50 && !out.includes('NaN') && n_ent > 0, `${entities} entités`)
}

const r = terminalRows(T.relay24V(base), 'fr')
check('bornier : 6 bornes X1.2 … X1.7, triées', r.map((x: any) => x.terminal).join(',') === 'X1.2,X1.3,X1.4,X1.5,X1.6,X1.7', r.map((x: any) => x.terminal).join(','))
check('bornier : X1.4 reçoit un fil depuis KA1 et repart vers H1', r.find((x: any) => x.terminal === 'X1.4')?.inWires.some((w: string) => /KA1/.test(w)) && r.find((x: any) => x.terminal === 'X1.4')?.outWires.some((w: string) => /H1/.test(w)), JSON.stringify(r.find((x: any) => x.terminal === 'X1.4')))
check('noir et blanc : couleurs → noir, blanc et currentColor conservés', toMonochrome('<path stroke="#c80000" fill="#fff"/><path stroke="currentColor" fill="#0050c8"/>') === '<path stroke="#000000" fill="#fff"/><path stroke="currentColor" fill="#000000"/>', toMonochrome('<path stroke="#c80000" fill="#fff"/>'))
console.log(fails ? `\n${fails} ÉCHEC(S)` : '\ntous les tests passent')
process.exit(fails ? 1 : 0)
