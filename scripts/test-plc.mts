// Tests de l'automate simulé (Grafcet, Ladder, expressions) : npm test
const ROOT = '..'
import { readFileSync } from 'node:fs'
const { SYMBOL_MAP, SYMBOLS } = await import('../src/symbols/index.ts')
const T = await import('../src/templates.ts')
const { simulate } = await import('../src/sim/engine.ts')
const lib = JSON.parse(readFileSync(new URL('../public/qet-library.json', import.meta.url), 'utf8'))
for (const s of lib.symbols) { SYMBOLS.push(s); SYMBOL_MAP[s.id] = s }
const base: any = { version: 1, paper: 'A3', title: {}, symbols: [], wires: [] }
const { scan, parseExpr, checkExpr, emptyProgram, varValue } = await import(ROOT + '/src/sim/plc.ts')
let fails = 0
const check = (name: string, got: any, want: any) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log((ok ? 'ok   ' : 'ÉCHEC'), name, ok ? '' : `(obtenu ${JSON.stringify(got)}, attendu ${JSON.stringify(want)})`) }

check('expression : priorité ET avant OU', JSON.stringify(parseExpr('I0.0 ET I0.1 OU I0.2')).includes('"k":"or"'), true)
check('expression : erreurs détectées', [checkExpr('I0.0 ET'), checkExpr('(I0.0'), checkExpr('I0.0 ET NON I0.1')].map((x) => x !== null), [true, true, false])

/** Cycle A+ B+ A- B- : deux vérins A et B, capteurs a0 a1 b0 b1 */
const prog = (): any => ({
  names: { 'I0.0': 'dcy', 'I0.1': 'a0', 'I0.2': 'a1', 'I0.3': 'b0', 'I0.4': 'b1', 'Q0.0': 'A+', 'Q0.1': 'A-', 'Q0.2': 'B+', 'Q0.3': 'B-' },
  steps: [
    { id: 0, init: true, actions: [] },
    { id: 1, actions: [{ kind: 'N', var: 'A+' }] },
    { id: 2, actions: [{ kind: 'N', var: 'B+' }] },
    { id: 3, actions: [{ kind: 'N', var: 'A-' }] },
    { id: 4, actions: [{ kind: 'N', var: 'B-' }] },
  ],
  transitions: [
    { from: [0], to: [1], cond: 'dcy ET a0 ET b0' }, { from: [1], to: [2], cond: 'a1' }, { from: [2], to: [3], cond: 'b1' }, { from: [3], to: [4], cond: 'a0' }, { from: [4], to: [0], cond: 'b0' },
  ],
  ladder: [],
})
{
  const p = prog()
  let st: any
  const run = (i: Record<string, boolean>, now: number) => {
    const inp = Array(8).fill(false)
    for (const [k, v] of Object.entries(i)) inp[Number(k.slice(-1))] = v
    // plusieurs scans jusqu'à stabilité (comme le simulateur)
    for (let n = 0; n < 10; n++) { const r = scan(p, st, inp, now); const same = JSON.stringify(r.state) === JSON.stringify(st); st = r.state; if (same) break }
    return st
  }
  run({ 'I0.1': true, 'I0.3': true }, 0)
  check('Grafcet : démarre à l’étape initiale, sorties à 0', [st.steps, st.out.some(Boolean)], [[0], false])
  run({ 'I0.1': true, 'I0.3': true, 'I0.0': true }, 100)
  check('Grafcet : départ de cycle → étape 1, A+ actif', [st.steps, st.out.slice(0, 4)], [[1], [true, false, false, false]])
  run({ 'I0.2': true, 'I0.3': true }, 200)
  check('Grafcet : a1 atteint → étape 2, B+ actif, A+ retombe', [st.steps, st.out.slice(0, 4)], [[2], [false, false, true, false]])
  run({ 'I0.2': true, 'I0.4': true }, 300)
  run({ 'I0.1': true, 'I0.4': true }, 400)
  check('Grafcet : A- puis B- ', st.steps, [4])
  run({ 'I0.1': true, 'I0.3': true }, 500)
  check('Grafcet : retour à l’étape 0 en fin de cycle', st.steps, [0])
}
// Grafcet : temporisation et actions S / R
{
  const p: any = { names: {}, steps: [{ id: 0, init: true, actions: [{ kind: 'R', var: 'Q0.0' }] }, { id: 1, actions: [{ kind: 'S', var: 'Q0.0' }] }, { id: 2, actions: [] }],
    transitions: [{ from: [0], to: [1], cond: 'I0.0' }, { from: [1], to: [2], cond: 'T(2s)' }, { from: [2], to: [0], cond: '1' }], ladder: [] }
  let st: any = scan(p, undefined, Array(8).fill(false), 0).state
  const go = (i0: boolean, now: number) => { for (let n = 0; n < 5; n++) { const r = scan(p, st, [i0, ...Array(7).fill(false)], now); st = r.state; if (!r.pending.length && n > 1) break } return st }
  go(true, 100)
  check('S : la sortie mise à 1 reste après l’étape', [st.steps, st.out[0]], [[1], true])
  go(false, 1000); check('transition temporisée : pas encore au bout de 0,9 s', st.steps, [1])
  go(false, 2200)
  check('transition temporisée : 2 s écoulées → étape 2 puis 0 (R remet Q0.0 à 0)', [st.steps, st.out[0]], [[0], false])
}
// Ladder : contacts, branche parallèle, auto-maintien, temporisation
{
  const p: any = { names: { 'I0.0': 'marche', 'I0.1': 'arret', 'Q0.0': 'moteur' }, steps: [], transitions: [], ladder: [
    { branches: [[{ var: 'marche' }], [{ var: 'moteur' }]].map((b) => b).concat([]), coil: { kind: '=', var: 'M0' } },
    { branches: [[{ var: 'M0' }, { var: 'arret', neg: true }]], coil: { kind: '=', var: 'moteur' } },
    { branches: [[{ var: 'moteur' }]], coil: { kind: 'TON', var: 'T1', preset: 1500 } },
    { branches: [[{ var: 'T1' }]], coil: { kind: '=', var: 'Q0.1' } },
  ] }
  let st: any
  const go = (i: boolean[], now: number) => { for (let n = 0; n < 6; n++) { const r = scan(p, st, i, now); st = r.state } return st }
  go([false, false], 0); check('Ladder : au repos sortie 0', st.out[0], false)
  go([true, false], 100); go([false, false], 200); check('Ladder : auto-maintien par la sortie elle-même', st.out[0], true)
  go([false, false], 1000); check('Ladder : temporisation pas écoulée', st.out[1], false)
  go([false, false], 1700); check('Ladder : temporisation écoulée → Q0.1', st.out[1], true)
  go([false, true], 1800); check('Ladder : arrêt coupe le moteur et la temporisation', [st.out[0], st.out[1]], [false, false])
  check('valeur d’une variable par son nom', varValue(p, st, 'marche'), false)
}

// ── automate dans un schéma : alimentation, entrée par bouton, sortie relais vers un voyant
{
  const E = (x: string) => 'qet:10_electric/10_allpole/' + x
  const PB = E('380_signaling_operating/20_push_buttons/poussoir'), LAMP = E('380_signaling_operating/11_optical_signaling/lampe2')
  const prog: any = { names: { 'I0.0': 'dcy' }, steps: [], transitions: [], ladder: [{ branches: [[{ var: 'dcy' }]], coil: { kind: '=', var: 'Q0.0' } }] }
  const build = (wirePower = true) => {
    const d = T.build(base, [['es', 'sim-src1', 20, 20], ['p', 'plc-8e8s-relay', 100, 150, 'A1'], ['b', PB, 300, 60, 'S1'], ['h', LAMP, 400, 300, 'H1']],
      [...(wirePower ? [['es', 'a', 'p', 'lp'], ['es', 'b', 'p', 'm']] : []), ['es', 'a', 'b', 't0'], ['b', 't1', 'p', 'i0'], ['es', 'a', 'p', 'com'], ['p', 'q0', 'h', 't0'], ['h', 't1', 'es', 'b']])
    d.symbols.find((x: any) => x.defId === 'sim-src1').dc = true
    d.symbols.find((x: any) => x.defId === 'sim-src1').volts = 24
    d.symbols.find((x: any) => x.label === 'A1').plc = prog
    return d
  }
  for (const [name, wire] of [['alimenté', true], ['non alimenté', false]] as const) {
    const d = build(wire)
    let mem: any = {}, now = 1000
    const run = (pressed: string[]) => { now += 50; const r = simulate(d, SYMBOL_MAP, mem, { pressed: new Set(pressed), toggled: new Set(), cut: new Set() }, now); mem = r.state; return r }
    const [S1, H1] = [d.symbols.find((x: any) => x.label === 'S1').id, d.symbols.find((x: any) => x.label === 'H1').id]
    run([]); let r = run([])
    const off = r.energized.has(H1)
    run([S1]); r = run([S1])
    check(`automate ${name} : bouton appuyé → voyant`, [off, r.energized.has(H1)], wire ? [false, true] : [false, false])
    if (wire) { r = run([]); check('automate : bouton relâché → voyant éteint', r.energized.has(H1), false) }
  }
}

// ── exemple complet : cycle A+ B+ A- B- piloté par l'automate (Grafcet), électrovannes 1V1+/2V1+, détecteurs sur les vérins
{
  const d = T.pneumaticPlc(base)
  let mem: any = {}, now = 1000
  const run = (pressed: string[], dt: number) => { now += dt; const r = simulate(d, SYMBOL_MAP, mem, { pressed: new Set(pressed), toggled: new Set(), cut: new Set() }, now); mem = r.state; return r }
  const id = (l: string) => d.symbols.find((x: any) => x.label === l).id
  const [A, B, S1, P] = [id('1A1'), id('2A1'), id('S1'), id('API1')]
  let r = run([], 0); r = run([], 100)
  check('exemple automate : au repos, vérins rentrés et automate à l’étape 0', [r.cylPos[A], r.cylPos[B], r.plc[P]?.steps], [0, 0, [0]])
  run([S1], 50); r = run([S1], 50); run([], 50)
  const trace: string[] = []
  let a = 0, b = 0
  for (let t = 0; t < 120; t++) {
    r = run([], 100)
    const sa = r.cylPos[A] >= 0.99 ? 'A+' : r.cylPos[A] <= 0.01 ? 'A-' : '', sb = r.cylPos[B] >= 0.99 ? 'B+' : r.cylPos[B] <= 0.01 ? 'B-' : ''
    const seen = [sa === 'A+' && a === 0 ? (a = 1, 'A+') : sa === 'A-' && a === 1 ? (a = 0, 'A-') : '', sb === 'B+' && b === 0 ? (b = 1, 'B+') : sb === 'B-' && b === 1 ? (b = 0, 'B-') : ''].filter(Boolean)
    trace.push(...seen)
  }
  check('exemple automate : séquence A+ B+ A- B-', trace, ['A+', 'B+', 'A-', 'B-'])
  check('exemple automate : retour à l’étape 0, vérins rentrés', [r.plc[P]?.steps, r.cylPos[A], r.cylPos[B]], [[0], 0, 0])
}

// ── opérations d'édition (éditeur graphique)
{
  const E = await import(ROOT + '/src/plcEdit.ts')
  const p0: any = { names: {}, steps: [], transitions: [], ladder: [] }
  let { prog: p } = E.insertStep(p0, 0)
  check('édition : première étape créée, initiale', [p.steps.length, p.steps[0].init, p.transitions.length], [1, true, 0])
  p = E.insertStep(p, 1).prog; p = E.insertStep(p, 2).prog
  check('édition : étapes ajoutées à la suite, reliées par des transitions', [p.steps.map((s: any) => s.id), p.transitions.map((t: any) => `${t.from}>${t.to}`)], [[0, 1, 2], ['0>1', '1>2']])
  p = E.setTransition(p, 0, { cond: 'a1' })
  p = E.insertStep(p, 1).prog
  check('édition : insertion au milieu coupe la transition en deux (la condition reste en amont)', [p.steps.map((s: any) => s.id), p.transitions.map((t: any) => `${t.from}>${t.to}:${t.cond}`)], [[0, 1, 2, 3], ['0>1:a1', '1>2:1', '2>3:1']])
  p = E.setTransition(p, 2, { cond: 'X1 ET b1' })
  p = E.addAction(p, 3, { kind: 'N', var: 'Q0.0' })
  const moved = E.moveStep(p, 3, 1)
  check('édition : déplacer une étape emporte ses actions et rebranche la séquence', [moved.steps.map((s: any) => s.actions.length), moved.transitions.map((t: any) => `${t.from}>${t.to}`)], [[0, 1, 0, 0], ['0>1', '1>2', '2>3']])
  const del = E.deleteStep(p, 1)
  check('édition : supprimer une étape rebranche voisines et renumérote', [del.steps.map((s: any) => s.id), del.transitions.map((t: any) => `${t.from}>${t.to}`), del.transitions[0].cond], [[0, 1, 2], ['0>1', '1>2'], 'a1'])
  check('édition : condition enrichie par glisser-déposer d’une variable', [E.appendCond('1', 'a1'), E.appendCond('a1', 'b1', true), E.appendCond('a OU b', 'c')], ['a1', 'a1 ET NON b1', '(a OU b) ET c'])
  const lint = E.lint({ ...p0, steps: [{ id: 0, actions: [{ kind: 'N', var: 'inconnu' }] }], transitions: [] }, new Set(), 'fr')
  check('contrôle : étape initiale absente, sortie manquante, variable inconnue', [lint.length >= 3, lint.some((l: string) => /inconnue/.test(l))], [true, true])
  const rg = E.insertContact(E.newRung(), 0, 1, { var: 'b' })
  const rg2 = E.insertContact(rg, 1, 0, { var: 'c' })
  check('édition Ladder : contacts en série et branche parallèle', [rg.branches[0].length, rg2.branches.length, E.removeContact(rg2, 1, 0).branches.length], [2, 2, 1])
}
void emptyProgram
console.log(fails ? `\n${fails} ÉCHEC(S)` : '\ntous les tests d’automate passent')
process.exit(fails ? 1 : 0)
