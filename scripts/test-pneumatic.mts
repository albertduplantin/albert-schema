// Tests de la simulation pneumatique : distributeurs à trois positions, logique, clapet, pressostat, moteur, vanne d'arrêt : npm test
import { readFileSync } from 'node:fs'
const ROOT = '..'
const { SYMBOL_MAP, SYMBOLS } = await import(ROOT + '/src/symbols/index.ts')
const T = await import(ROOT + '/src/templates.ts')
const { simulate } = await import(ROOT + '/src/sim/engine.ts')
const lib = JSON.parse(readFileSync(new URL('../public/qet-library.json', import.meta.url), 'utf8'))
for (const s of lib.symbols) { SYMBOLS.push(s); SYMBOL_MAP[s.id] = s }
const base: any = { version: 1, paper: 'A3', title: {}, symbols: [], wires: [] }
let fails = 0
const check = (name: string, got: any, want: any) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log((ok ? 'ok   ' : 'ÉCHEC'), name, ok ? '' : `(obtenu ${JSON.stringify(got)}, attendu ${JSON.stringify(want)})`) }

const E = (x: string) => 'qet:10_electric/10_allpole/' + x
const SW = E('380_signaling_operating/21_selector_switches/010_switch_1pos')
const LAMP = E('380_signaling_operating/11_optical_signaling/lampe2')
const COIL = E('310_relays_contactors_contacts/01_coils/bobine3')
const byEnd = (end: string) => lib.symbols.find((s: any) => s.id.endsWith(end))
const first = (pred: (s: any) => boolean) => lib.symbols.find((s: any) => s.domain === 'pneumatic' && pred(s))
const SRC = first((s) => s.fluid?.k === 'fsource' && s.fluid.ports.length === 1)
const SINK = first((s) => s.fluid?.k === 'fsink')
const GAUGE = first((s) => s.fluid?.k === 'fgauge' && s.ports.length === 1 && /501017/.test(s.id))
const CYL = first((s) => s.fluid?.k === 'cyl' && s.fluid.rod && /503010_cylinder_lin/.test(s.id))
const rig = (doc: any) => {
  let mem: any = {}, now = 1_000_000
  const run = (pressed: string[] = [], toggled: string[] = [], dt = 0) => { now += dt; const r = simulate(doc, SYMBOL_MAP, mem, { pressed: new Set(pressed), toggled: new Set(toggled), cut: new Set() }, now); mem = r.state; return r }
  return { run, idOf: (label: string) => doc.symbols.find((s: any) => s.label === label)?.id }
}
const specFor = (key: string, def: any, x: number, y: number, label?: string): any => (label === undefined ? [key, def.id, x, y] : [key, def.id, x, y, label])
/** distributeur manuel 3/2 normalement fermé : orifices P, A, R */
const valve32 = first((s) => s.fluid?.k === 'valve' && s.fluid.a === 'man' && s.fluid.b === 'spring' && !s.fluid.three && s.fluid.act.length === 1 && s.fluid.rest.length === 1 && s.ports.length === 3)
const v32 = { def: valve32, P: valve32.fluid.act[0][0], A: valve32.fluid.act[0][1], R: valve32.fluid.rest[0][1] }
const SK = SINK.ports[0].id

// ── trois positions : fermée, échappement, pression
for (const [suffix, centre] of [['502010702010_5_3_way', 'fermée'], ['502010702011_5_3_way', 'échappement'], ['502010702012_5_3_way', 'pression']] as const) {
  const vd = byEnd(suffix)
  const f = vd.fluid
  const P = f.act[0][0], B = f.act[0][1], A = f.actB[0][1], R2 = f.act[1][1], R1 = f.actB[1][1]
  check(`5/3 (${centre}) : le modèle est à trois positions`, [f.three, f.rest.length], [true, centre === 'fermée' ? 0 : 2])
  const d = T.build(base, [specFor('src', SRC, 100, 30), specFor('v', vd, 100, 150, 'YV1/YV2'), specFor('c', CYL, 100, 300), specFor('s1', SINK, 40, 220), specFor('s2', SINK, 200, 220),
    ['es', 'sim-src1', 400, 30], ['sa', SW, 400, 100, 'S1'], ['sb', SW, 480, 100, 'S2'], ['ka', COIL, 400, 200, 'YV1'], ['kb', COIL, 480, 200, 'YV2']],
  [['src', SRC.fluid.ports[0], 'v', P], ['v', A, 'c', CYL.fluid.cap], ['v', B, 'c', CYL.fluid.rod], ['v', R1, 's1', SK], ['v', R2, 's2', SK],
    ['es', 'a', 'sa', 't0'], ['sa', 't1', 'ka', 't0'], ['ka', 't1', 'es', 'b'], ['es', 'a', 'sb', 't0'], ['sb', 't1', 'kb', 't0'], ['kb', 't1', 'es', 'b']])
  const g = rig(d)
  const [Sa, Sb, C, V] = [g.idOf('S1'), g.idOf('S2'), d.symbols.find((s: any) => s.defId === CYL.id).id, d.symbols.find((s: any) => s.defId === vd.id).id]
  let r = g.run([], [], 0); r = g.run([], [], 3000)
  check(`5/3 (${centre}) : orifices A et B au repos`, [r.potentialOf[`${V}:${A}`], r.potentialOf[`${V}:${B}`]], centre === 'fermée' ? [null, null] : centre === 'échappement' ? ['R', 'R'] : ['P', 'P'])
  check(`5/3 (${centre}) : au repos le vérin ne bouge pas`, r.cylPos[C], 0)
  r = g.run([], [Sb], 100); r = g.run([], [Sb], 3000)
  const out = r.cylPos[C]
  r = g.run([], [], 100); r = g.run([], [], 3000)
  const held = r.cylPos[C] // retour au centre : le vérin reste où il est
  r = g.run([], [Sa], 100); r = g.run([], [Sa], 3000)
  const back = r.cylPos[C]
  check(`5/3 (${centre}) : une bobine sort le vérin, le centre le laisse en place, l’autre le rentre`, [out, held, back], [1, 1, 0])
  r = g.run([], [Sa, Sb], 100); r = g.run([], [Sa, Sb], 100)
  check(`5/3 (${centre}) : deux bobines ensemble = position centrale`, [r.valveA[V], r.valveB[V]], [false, false])
}

// ── sélecteur (OU) et soupape à deux pressions (ET)
for (const [suffix, op, wantOne, wantBoth] of [['5010162011_selecteur', 'OU', 'P', 'P'], ['5010162012_soupape_double', 'ET', 'R', 'P']] as const) {
  const ld = byEnd(suffix)
  const d = T.build(base, [specFor('src', SRC, 100, 30), specFor('v1', v32.def, 60, 100, 'V1'), specFor('v2', v32.def, 160, 100, 'V2'), specFor('l', ld, 100, 200), specFor('g', GAUGE, 100, 280),
    specFor('r1', SINK, 40, 160), specFor('r2', SINK, 200, 160)],
  [['src', SRC.fluid.ports[0], 'v1', v32.P], ['src', SRC.fluid.ports[0], 'v2', v32.P], ['v1', v32.A, 'l', ld.fluid.ins[0]], ['v2', v32.A, 'l', ld.fluid.ins[1]], ['l', ld.fluid.out, 'g', GAUGE.ports[0].id],
    ['v1', v32.R, 'r1', SK], ['v2', v32.R, 'r2', SK]])
  const g = rig(d)
  const [V1, V2, G] = [g.idOf('V1'), g.idOf('V2'), d.symbols.find((s: any) => s.defId === GAUGE.id).id]
  const at = (pressed: string[]) => { g.run(pressed, [], 50); return g.run(pressed, [], 50).potentialOf[`${G}:${GAUGE.ports[0].id}`] }
  check(`logique ${op} : aucune entrée sous pression`, at([]), 'R')
  check(`logique ${op} : une seule entrée sous pression`, at([V1]), wantOne)
  check(`logique ${op} : l’autre entrée seule`, at([V2]), wantOne)
  check(`logique ${op} : les deux entrées`, at([V1, V2]), wantBoth)
}

// ── clapet anti-retour
{
  const cd = byEnd('5010161010_clapet')
  const mk = (rev: boolean) => {
    const d = T.build(base, [specFor('src', SRC, 100, 30), specFor('k', cd, 100, 120), specFor('g', GAUGE, 100, 220)],
      rev ? [['src', SRC.fluid.ports[0], 'k', cd.fluid.to], ['k', cd.fluid.from, 'g', GAUGE.ports[0].id]] : [['src', SRC.fluid.ports[0], 'k', cd.fluid.from], ['k', cd.fluid.to, 'g', GAUGE.ports[0].id]])
    const g = rig(d)
    const G = d.symbols.find((s: any) => s.defId === GAUGE.id).id
    g.run(); return g.run([], [], 50).potentialOf[`${G}:${GAUGE.ports[0].id}`]
  }
  check('clapet anti-retour : sens passant', mk(false), 'P')
  check('clapet anti-retour : sens bloqué', mk(true), null)
}

// ── pressostat : le contact électrique de même repère suit la pression
{
  const pd = first((s) => s.fluid?.k === 'fpress')
  const d = T.build(base, [specFor('src', SRC, 100, 30), specFor('v', v32.def, 100, 100, 'V1'), specFor('p', pd, 100, 200, 'B1'), specFor('r', SINK, 40, 160),
    ['es', 'sim-src1', 400, 30], ['b', SW, 400, 100, 'B1'], ['h', LAMP, 400, 220, 'H1']],
  [['src', SRC.fluid.ports[0], 'v', v32.P], ['v', v32.A, 'p', pd.fluid.port], ['v', v32.R, 'r', SK], ['es', 'a', 'b', 't0'], ['b', 't1', 'h', 't0'], ['h', 't1', 'es', 'b']])
  const g = rig(d)
  g.run(); g.run([], [], 50)
  check('pressostat : sans pression, le contact est ouvert et la lampe éteinte', g.run([], [], 50).energized.has(g.idOf('H1')), false)
  g.run([g.idOf('V1')], [], 50)
  check('pressostat : sous pression, le contact se ferme et la lampe s’allume', g.run([g.idOf('V1')], [], 50).energized.has(g.idOf('H1')), true)
  g.run([], [], 50)
  check('pressostat : pression relâchée, la lampe s’éteint', g.run([], [], 50).energized.has(g.idOf('H1')), false)
}

// ── moteur pneumatique et vanne d'arrêt
{
  const md = first((s) => s.fluid?.k === 'fmotor' && !s.fluid.b)
  const sd = byEnd('50101550_vanne_arret')
  const d = T.build(base, [specFor('src', SRC, 100, 30), specFor('s', sd, 100, 100, 'V1'), specFor('m', md, 100, 200)],
    [['src', SRC.fluid.ports[0], 's', sd.ports[0].id], ['s', sd.ports[1].id, 'm', md.fluid.a]])
  const g = rig(d)
  const M = d.symbols.find((s: any) => s.defId === md.id).id
  g.run()
  check('vanne d’arrêt ouverte : le moteur pneumatique tourne', g.run([], [], 50).fluidMotor[M] !== 0, true)
  g.run([], [g.idOf('V1')], 50)
  check('vanne d’arrêt fermée : le moteur s’arrête', g.run([], [g.idOf('V1')], 50).fluidMotor[M], 0)
}
console.log(fails ? `\n${fails} ÉCHEC(S)` : '\ntous les tests pneumatiques passent')
process.exit(fails ? 1 : 0)
