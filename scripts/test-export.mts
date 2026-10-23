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

// ── exercices : un schéma correct valide l'exercice, un schéma sans verrouillage non
{
  const { EXERCISES, runExercise } = await import(ROOT + '/src/exercises.ts')
  const Q = (x: string) => 'qet:10_electric/10_allpole/' + x
  const PB = Q('380_signaling_operating/20_push_buttons/poussoir'), PBN = Q('380_signaling_operating/20_push_buttons/poussoir_nf')
  const K = Q('310_relays_contactors_contacts/02_contacts_cross_referencing/01_auxiliary_contacts/con_simple')
  const C = Q('310_relays_contactors_contacts/01_coils/bobine3')
  const ex = (id: string) => EXERCISES.find((e: any) => e.id === id)
  const lamps = runExercise(ex('lamps'), T.startLamps(base), SYMBOL_MAP, 'fr')
  check('exercice « voyants » : validé par le modèle intégré', lamps.ok, JSON.stringify(lamps.steps.filter((x: any) => !x.ok)))
  const two = T.build(base, [
    ['l', 'sim-l', 400, 30], ['s1', PBN, 400, 90, 'S1'], ['s4', PBN, 400, 170, 'S4'], ['s2', PB, 400, 260, 'S2'], ['s3', PB, 480, 260, 'S3'], ['ka', K, 560, 260, 'KM1'],
    ['c', C, 440, 380, 'KM1'], ['n', 'sim-n', 460, 460],
  ], [
    ['l', 'a', 's1', 't0'], ['s1', 't1', 's4', 't0'], ['s4', 't1', 's2', 't0'], ['s4', 't1', 's3', 't0'], ['s4', 't1', 'ka', 't0'],
    ['s2', 't1', 'c', 't0'], ['s3', 't1', 'c', 't0'], ['ka', 't1', 'c', 't0'], ['c', 't1', 'n', 'a'],
  ])
  const r2 = runExercise(ex('two-posts'), two, SYMBOL_MAP, 'fr')
  check('exercice « deux postes » : validé par un schéma correct', r2.ok, JSON.stringify(r2.steps.filter((x: any) => !x.ok)))
  const seq = T.build(base, [
    ['l', 'sim-l', 400, 30], ['s1', PBN, 400, 90, 'S1'],
    ['s2', PB, 400, 190, 'S2'], ['a1', K, 480, 190, 'KM1'], ['c1', C, 420, 300, 'KM1'], ['n1', 'sim-n', 440, 380],
    ['en', K, 600, 150, 'KM1'], ['s3', PB, 600, 240, 'S3'], ['a2', K, 680, 240, 'KM2'], ['c2', C, 620, 340, 'KM2'], ['n2', 'sim-n', 640, 420],
  ], [
    ['l', 'a', 's1', 't0'], ['s1', 't1', 's2', 't0'], ['s1', 't1', 'a1', 't0'], ['s2', 't1', 'c1', 't0'], ['a1', 't1', 'c1', 't0'], ['c1', 't1', 'n1', 'a'],
    ['s1', 't1', 'en', 't0'], ['en', 't1', 's3', 't0'], ['en', 't1', 'a2', 't0'], ['s3', 't1', 'c2', 't0'], ['a2', 't1', 'c2', 't0'], ['c2', 't1', 'n2', 'a'],
  ])
  const r3 = runExercise(ex('sequence'), seq, SYMBOL_MAP, 'fr')
  check('exercice « séquentiel » : validé par un schéma correct', r3.ok, JSON.stringify(r3.steps.filter((x: any) => !x.ok)))
  const bad = runExercise(ex('sequence'), T.delayedCascade(base), SYMBOL_MAP, 'fr')
  check('exercice « séquentiel » : refusé pour un montage sans verrouillage', !bad.ok)
}
// ── formes pivotées : le bord opposé à la poignée reste en place à l'écran
{
  const { resizeRotated, rotatePt, shapeBox } = await import(ROOT + '/src/shapes.tsx')
  const o: any = { id: 'r', kind: 'rect', x: 100, y: 100, w: 100, h: 50, stroke: 'solid', width: 1.6, color: '#000000', rot: 30 }
  const b = shapeBox(o)
  const c0 = { x: (b.x1 + b.x2) / 2, y: (b.y1 + b.y2) / 2 }
  const westBefore = rotatePt({ x: b.x1, y: c0.y }, 30, c0)
  // on tire la poignée est : le pointeur se trouve 60 unités plus loin le long de l'axe tourné
  const handle = rotatePt({ x: b.x2, y: c0.y }, 30, c0)
  const target = { x: handle.x + 60 * Math.cos(Math.PI / 6), y: handle.y + 60 * Math.sin(Math.PI / 6) }
  const n = resizeRotated(o, 'e', target)
  const nb = shapeBox(n)
  const c1 = { x: (nb.x1 + nb.x2) / 2, y: (nb.y1 + nb.y2) / 2 }
  const westAfter = rotatePt({ x: nb.x1, y: c1.y }, 30, c1)
  check('forme pivotée : largeur 160 et bord ouest immobile', Math.abs(n.w - 160) < 0.01 && Math.abs(westAfter.x - westBefore.x) < 0.01 && Math.abs(westAfter.y - westBefore.y) < 0.01, JSON.stringify({ w: n.w, westBefore, westAfter }))
}
// ── renvois de feuille : deux renvois de même repère relient deux feuilles pour la simulation
{
  const { mergedDoc, switchPage } = await import(ROOT + '/src/pages.ts')
  const { simulate } = await import(ROOT + '/src/sim/engine.ts')
  const Q = (x: string) => 'qet:10_electric/10_allpole/' + x
  // feuille 1 : L → S2 (marche) → renvoi « A » ; feuille 2 : renvoi « A » → bobine KM1 → N
  const p1 = T.build(base, [['l', 'sim-l', 100, 30], ['s2', Q('380_signaling_operating/20_push_buttons/poussoir'), 100, 100, 'S2'], ['r1', 'sim-ref', 100, 200, 'A']], [['l', 'a', 's2', 't0'], ['s2', 't1', 'r1', 'a']])
  const p2 = T.build(base, [['r2', 'sim-ref', 100, 30, 'A'], ['c', Q('310_relays_contactors_contacts/01_coils/bobine3'), 90, 100, 'KM1'], ['n', 'sim-n', 100, 200]], [['r2', 'a', 'c', 't0'], ['c', 't1', 'n', 'a']])
  const withPages: any = { ...p1, pages: [{ name: '1', symbols: p1.symbols, wires: p1.wires }, { name: '2', symbols: p2.symbols, wires: p2.wires }], page: 0 }
  const all = mergedDoc(withPages)
  const idOf = (l: string, part = '') => all.symbols.find((s: any) => s.label === l && s.defId.includes(part)).id
  const st = (press: string[]) => simulate(all, SYMBOL_MAP, {}, { pressed: new Set(press), toggled: new Set() }, 1_000_000)
  check('renvoi de feuille : S2 relâché, la bobine de la feuille 2 est coupée', !st([]).energized.has(idOf('KM1', 'bobine')))
  check('renvoi de feuille : S2 appuyé sur la feuille 1, la bobine de la feuille 2 est alimentée', st([idOf('S2')]).energized.has(idOf('KM1', 'bobine')))
  check('renvoi de feuille : un repère différent ne relie rien', !(() => { const w2: any = { ...withPages, pages: [withPages.pages[0], { ...withPages.pages[1], symbols: p2.symbols.map((s: any) => (s.defId === 'sim-ref' ? { ...s, label: 'B' } : s)) }] }; const a2 = mergedDoc(w2); return simulate(a2, SYMBOL_MAP, {}, { pressed: new Set([idOf('S2')]), toggled: new Set() }, 1_000_000).energized.has(idOf('KM1', 'bobine')) })())
  void switchPage
}
// ── source 24 V alternatif phase + neutre
{
  const { simulate } = await import(ROOT + '/src/sim/engine.ts')
  const { adviseDoc } = await import(ROOT + '/src/advice.ts')
  const Q = (x: string) => 'qet:10_electric/10_allpole/' + x
  const mk = (volts: number) => {
    const d = T.build(base, [['src', 'sim-24vac', 400, 30], ['s', Q('380_signaling_operating/20_push_buttons/poussoir'), 400, 100, 'S2'], ['c', Q('310_relays_contactors_contacts/01_coils/bobine3'), 390, 200, 'KA1']], [['src', 'a', 's', 't0'], ['s', 't1', 'c', 't0'], ['c', 't1', 'src', 'b']])
    d.symbols.find((x: any) => x.label === 'KA1').volts = volts
    return d
  }
  const run = (d: any, press: boolean) => simulate(d, SYMBOL_MAP, {}, { pressed: new Set(press ? [d.symbols.find((x: any) => x.label === 'S2').id] : []), toggled: new Set() }, 1_000_000)
  const d24 = mk(24), coil = d24.symbols.find((x: any) => x.label === 'KA1').id
  check('source 24 V ~ : bobine 24 V alimentée à l’appui, sans tension anormale', run(d24, true).energized.has(coil) && !run(d24, true).badVoltage[coil] && run(d24, true).volts[coil] === 24)
  check('source 24 V ~ : repos, bobine coupée', !run(d24, false).energized.has(coil))
  const d230 = mk(230), r230 = run(d230, true)
  check('source 24 V ~ : bobine 230 V signalée en sous-tension', !!r230.badVoltage[d230.symbols.find((x: any) => x.label === 'KA1').id])
  check('source 24 V ~ : Contrôle sans erreur sur le montage correct', adviseDoc(d24, SYMBOL_MAP, 'fr').filter((x: any) => x.level === 'error').length === 0, JSON.stringify(adviseDoc(d24, SYMBOL_MAP, 'fr').filter((x: any) => x.level === 'error').map((x: any) => x.text)))
}
console.log(fails ? `\n${fails} ÉCHEC(S)` : '\ntous les tests passent')
process.exit(fails ? 1 : 0)
