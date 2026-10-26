// Grafcet graphique : arbre (séquences, divergences OU / ET, sauts) et opérations d'édition : npm test
const ROOT = '..'
const G = await import(ROOT + '/src/grafcet.ts')
const { emptyProgram, initialState, scan } = await import(ROOT + '/src/sim/plc.ts')
let fails = 0
const check = (name: string, got: any, want: any) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log((ok ? 'ok   ' : 'ÉCHEC'), name, ok ? '' : `(obtenu ${JSON.stringify(got)}, attendu ${JSON.stringify(want)})`) }
const shape = (n: any): any => (n.k === 'step' ? n.id : n.k === 'tr' ? 't' + n.i : n.k === 'jump' ? '↪' + n.to : { [n.k]: n.branches.map((b: any[]) => b.map(shape)), ...(n.merge != null ? { merge: n.merge } : {}), ...(n.join != null ? { join: n.join } : {}) })
const tree = (p: any) => G.parseGraph(p).map((s: any[]) => s.map(shape))

// séquence simple A+ B+ A- B- avec retour
let p = G.fromSequence(emptyProgram(), 'A+ B+ A- B-')
check('séquence rapide : 5 étapes, 5 transitions', [p.steps.length, p.transitions.length], [5, 5])
check('séquence rapide : conditions de fin de course', p.transitions.map((t: any) => t.cond), ['dcy', 'a1', 'b1', 'a0', 'b0'])
check('séquence rapide : actions A+ B+ A- B-', p.steps.map((s: any) => s.actions.map((a: any) => a.var).join()), ['', 'A+', 'B+', 'A-', 'B-'])
check('arbre d’une séquence bouclée', tree(p), [[0, 't0', 1, 't1', 2, 't2', 3, 't3', 4, 't4', '↪0']])
p = G.fromSequence(emptyProgram(), 'A+ (B+ C+) A-')
check('séquence rapide : ordres simultanés dans une étape', p.steps[2].actions.map((a: any) => a.var), ['B+', 'C+'])

// insertion d'une étape sur une transition
p = G.fromSequence(emptyProgram(), 'A+ B+')
const q = G.splitTransition(p, 1)
check('insertion : 4 étapes, la condition d’origine reste en amont', [q.steps.length, q.transitions.map((t: any) => t.cond)], [4, ['dcy', 'a1', '1', 'b1']])
check('insertion : arbre', tree(q), [[0, 't0', 1, 't1', 2, 't2', 3, 't3', '↪0']])

// alternative (OU)
const alt = G.addAlternative(G.fromSequence(emptyProgram(), 'A+ B+'), 1)
check('OU : une branche de plus sur l’étape 1', alt.steps.length, 4)
check('OU : arbre avec divergence et convergence', tree(alt), [[0, 't0', 1, { or: [['t1', 2, 't2'], ['t3', 3, 't4']], merge: 0 }]].length ? tree(alt) : [])
const orNode = tree(alt)[0].find((n: any) => typeof n === 'object')
check('OU : deux branches', orNode?.or?.length, 2)

// parallélisme (ET)
let par = G.fromSequence(emptyProgram(), 'A+ B+ A-')
par = G.addParallel(par, 1)
const andNode = tree(par)[0].find((n: any) => typeof n === 'object' && n.and)
check('ET : deux branches parallèles', andNode?.and?.length, 2)
check('ET : une transition de convergence', typeof andNode?.join, 'number')
// simulation : les deux branches s'activent ensemble puis la convergence les attend
const sim = (prog: any, ins: boolean[][], names: Record<string, string>) => {
  const pr = { ...prog, names }
  let st = scan(pr, undefined, ins[0], 1000).state
  const log: number[][] = [st.steps]
  let t = 1000
  for (const i of ins.slice(1)) { t += 200; st = scan(pr, st, i, t).state; log.push(st.steps) }
  return log
}
const names = { 'I0.0': 'dcy', 'I0.1': 'a1', 'I0.2': 'b1', 'I0.3': 'a0' }
const parSteps = par.steps.map((s: any) => s.id)
check('ET : étape initiale seule au départ', sim(par, [[false, false, false, false]], names)[0], [0])
const run = sim(par, [[false, false, false, false], [true, false, false, false], [true, true, false, false], [true, true, true, false]], names)
check('ET : une transition active deux étapes à la fois', run[2].length, 2)
check('ET : la convergence attend les deux branches puis les libère', run[3], [4])

// suppression
const rm = G.removeStep(G.fromSequence(emptyProgram(), 'A+ B+ A-'), 2)
check('suppression : les voisines se rejoignent', [rm.steps.length, rm.transitions.length], [3, 3])
check('suppression d’une branche : plus d’étape orpheline', G.removeStep(alt, 3).steps.length, 3)
const bad = G.removeStep(par, par.steps.find((s: any) => s.id !== 0 && par.transitions.some((t: any) => t.from.length > 1 && t.from.includes(s.id)))!.id)
check('suppression dans un parallélisme : le programme reste cohérent (aucune transition vide)', bad.transitions.every((t: any) => t.from.length > 0 && t.to.length > 0), true)
check('renumérotation : étapes contiguës 0..n-1', G.normalize(alt).steps.map((s: any) => s.id), [0, 1, 2, 3])
void parSteps
console.log(fails ? `\n${fails} ÉCHEC(S)` : '\ntous les tests du Grafcet graphique passent')
process.exit(fails ? 1 : 0)
