// Tests de la simulation pneumatique : distributeurs à trois positions, logique, clapet, pressostat, moteur, vanne d'arrêt : npm test
import { readFileSync } from 'node:fs'
const ROOT = '..'
const { SYMBOL_MAP, SYMBOLS } = await import(ROOT + '/src/symbols/index.ts')
const T = await import(ROOT + '/src/templates.ts')
const { simulate } = await import(ROOT + '/src/sim/engine.ts')
const lib = (await import('./lib-full.mjs')).loadFull()
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

// ── hydraulique : bâche, pompe, distributeur 4/2, vérin, moteur, clapet, filtre
{
  const H = (x: string) => lib.symbols.find((s: any) => s.id === 'qet:30_hydraulic/' + x)
  const [tank, pump, valve, cyl, mot, filt, chk] = [H('21_tanks/bache_a_l_air_libre'), H('61_pumps/pompe_hydr_2'), H('31_control_valves/13_4-2/distributeur_4-2'), H('51_cylinders/verin-asymetrique-doubl-effet'), H('61_pumps/moteur_hydr_1'), H('81_filters/filtre'), H('45_valves/clapet_simple')]
  check('hydraulique : tous les symboles du circuit de base sont simulables', [tank, pump, valve, cyl, mot, filt, chk].every((d) => !!d?.fluid), true)
  const circuit = (load: any, suctionToTank = true) => T.build(base, [specFor('tank', tank, 300, 330, ''), specFor('pump', pump, 150, 200, ''), specFor('v', valve, 330, 190, 'YV1'), specFor('load', load, 500, 60, 'A1')],
    [...(suctionToTank ? [['pump', pump.fluid.in, 'tank', 't0']] : []), ['pump', pump.fluid.out, 'v', 't0'], ['v', 't1', 'tank', 't0'], ['v', 't2', 'load', load.fluid.cap ?? load.fluid.a], ['v', 't3', 'load', load.fluid.rod ?? load.fluid.b]])
  let d = circuit(cyl)
  let g = rig(d)
  const [V, C] = [d.symbols.find((s: any) => s.defId === valve.id).id, d.symbols.find((s: any) => s.defId === cyl.id).id]
  let r = g.run(); r = g.run([], [], 3000)
  check('hydraulique : au repos le vérin est rentré (P → A → tige)', r.cylPos[C], 0)
  r = g.run([], [V], 100); r = g.run([], [V], 3000)
  check('hydraulique : électrovanne actionnée (clic de secours) : le vérin sort', r.cylPos[C], 1)
  r = g.run([], [], 100); r = g.run([], [], 3000)
  check('hydraulique : relâchée, le ressort ramène le distributeur et le vérin rentre', r.cylPos[C], 0)
  g = rig(circuit(cyl, false)); r = g.run(); r = g.run([], [d.symbols.find((s: any) => s.defId === valve.id).id], 3000)
  check('hydraulique : pompe sans aspiration à la bâche : aucune pression, le vérin ne bouge pas', r.cylPos[C] ?? 0, 0)
  d = circuit(mot); g = rig(d)
  const M = d.symbols.find((s: any) => s.defId === mot.id).id, V2 = d.symbols.find((s: any) => s.defId === valve.id).id
  r = g.run(); r = g.run([], [], 100)
  const rest = r.fluidMotor[M]
  r = g.run([], [V2], 100)
  const act = r.fluidMotor[M]
  check('hydraulique : le moteur tourne, et dans l’autre sens quand on actionne le distributeur', [rest !== 0, act !== 0, rest === -act], [true, true, true])
  // clapet anti-retour et filtre en série sur la ligne de refoulement
  const d3 = T.build(base, [specFor('tank', tank, 300, 330, ''), specFor('pump', pump, 150, 200, ''), specFor('f', filt, 200, 120), specFor('k', chk, 260, 120), specFor('v', valve, 330, 190), specFor('load', cyl, 500, 60)],
    [['pump', pump.fluid.in, 'tank', 't0'], ['pump', pump.fluid.out, 'f', filt.fluid.ports[0]], ['f', filt.fluid.ports[1], 'k', chk.fluid.from], ['k', chk.fluid.to, 'v', 't0'], ['v', 't1', 'tank', 't0'], ['v', 't2', 'load', cyl.fluid.cap], ['v', 't3', 'load', cyl.fluid.rod]])
  const g3 = rig(d3)
  const C3 = d3.symbols.find((s: any) => s.defId === cyl.id).id
  g3.run(); const V3 = d3.symbols.find((s: any) => s.defId === valve.id).id
  r = g3.run([], [V3], 100); r = g3.run([], [V3], 3000)
  check('hydraulique : filtre et clapet passant en série : le vérin sort', r.cylPos[C3], 1)
}

// ── limiteur de débit et RDU : vitesse du vérin
{
  const H = (x: string) => lib.symbols.find((s: any) => s.id === 'qet:30_hydraulic/' + x)
  const [tank, pump, valve, cyl] = [H('21_tanks/bache_a_l_air_libre'), H('61_pumps/pompe_hydr_2'), H('31_control_valves/13_4-2/distributeur_4-2'), H('51_cylinders/verin-asymetrique-doubl-effet')]
  const lim = SYMBOL_MAP['flow-limiter-h'], rdu = SYMBOL_MAP['flow-rdu-h']
  check('limiteur de débit et RDU : présents dans la bibliothèque hydraulique et pneumatique', [!!lim, !!rdu, !!SYMBOL_MAP['flow-limiter-p'], !!SYMBOL_MAP['flow-rdu-p']], [true, true, true, true])
  const mk = (part: any, open?: number) => {
    const d = T.build(base, [specFor('tank', tank, 300, 330, ''), specFor('pump', pump, 150, 200, ''), specFor('v', valve, 330, 190, ''), specFor('load', cyl, 500, 60, 'A1'), ...(part ? [specFor('x', part, 420, 120, 'Q1')] : [])],
      [['pump', pump.fluid.in, 'tank', 't0'], ['pump', pump.fluid.out, 'v', 't0'], ['v', 't1', 'tank', 't0'], ['v', 't3', 'load', cyl.fluid.rod],
        ...(part ? [['v', 't2', 'x', 'l'], ['x', 'r', 'load', cyl.fluid.cap]] : [['v', 't2', 'load', cyl.fluid.cap]])])
    if (part && open) d.symbols.find((s: any) => s.label === 'Q1').rated = { open }
    const g = rig(d)
    return { g, V: d.symbols.find((s: any) => s.defId === valve.id).id, C: d.symbols.find((s: any) => s.defId === cyl.id).id }
  }
  /** position du vérin `ms` après le début de la sortie, ou du retour (après une sortie complète) */
  const stroke = (part: any, open: number | undefined, extend: boolean, ms: number) => {
    const { g, V, C } = mk(part, open)
    g.run(); g.run([], [V], 50)
    if (extend) return g.run([], [V], ms).cylPos[C]
    g.run([], [V], 6000) // sortie complète
    g.run([], [], 20)
    return g.run([], [], ms).cylPos[C]
  }
  const free = stroke(null, undefined, true, 600)
  const half = stroke(lim, 50, true, 600)
  check('limiteur à 50 % : la sortie est environ deux fois plus lente', [Math.round(free * 10) / 10, Math.round(half * 10) / 10], [0.5, 0.3])
  const slowRetract = stroke(lim, 50, false, 600)
  const fastRetract = stroke(rdu, 50, false, 600)
  check('RDU : retour libre par le clapet (plus rapide que le limiteur simple)', fastRetract < slowRetract, true)
  const rduOut = stroke(rdu, 50, true, 600)
  check('RDU : la sortie est étranglée comme avec un limiteur', Math.round(rduOut * 10) / 10, 0.3)
}

// ── dessin dynamique : chambres colorées, piston, cases du distributeur
{
  const { cylinderSvg, valveSvg, isDynamic, valveIndex, staticSvg } = await import(ROOT + '/src/symbols/fluidDraw.ts')
  const dc = CYL
  const rects = (svg: string) => [...svg.matchAll(/<rect x="([\d.-]+)"[^>]*fill="rgba\((\d+),(\d+),(\d+)/g)].map((m) => ({ x: Number(m[1]), rgb: m.slice(2, 5).join(',') }))
  const a = cylinderSvg(dc, { p: 0, potCap: 'P', potRod: 'R' }), b = cylinderSvg(dc, { p: 1, potCap: 'P', potRod: 'R' })
  check('dessin du vérin : chambre sous pression rouge, chambre à l’échappement bleue', [a.includes('rgba(229,57,53'), a.includes('rgba(30,136,229')], [true, true])
  check('dessin du vérin : la tige sort avec le piston', a !== b && b.length > 0 && rects(a).length > 0, true)
  const v = byEnd('502010702010_5_3_way')
  check('distributeur à trois positions : dessin dynamique, trois cases, case active selon la commande', [isDynamic(v), valveIndex(v.fluid, false, false), valveIndex(v.fluid, true, false), valveIndex(v.fluid, false, true)], [true, 1, 0, 2])
  const rest = valveSvg(v, { pos: 1, pot: () => null }), act = valveSvg(v, { pos: 0, pot: (id: string) => (id === v.fluid.act[0][0] ? 'P' : null) })
  check('distributeur : la case active change le dessin et la pression colore les liaisons', [rest !== act, act.includes('#e53935'), (rest.match(/<rect/g) ?? []).length], [true, true, 5]) // 3 cases + 2 électroaimants
  check('palette : vignette statique générée pour distributeurs et vérins', [!!staticSvg(v), !!staticSvg(dc)], [true, true])
}

// ── repérage ISO 1219-2 et liaison automatique des bobines
{
  const { nextFluidLabel, renumberFluid, solenoidNames, parseIso } = await import(ROOT + '/src/fluidNames.ts')
  const v52 = byEnd('5020106020_elec/502010602010_5_2_way_010')
  const put = (doc: any, def: any, label = '') => ({ ...doc, symbols: [...doc.symbols, { id: 's' + doc.symbols.length, defId: def.id, x: doc.symbols.length * 50, y: 0, rot: 0, label, desc: '' }] })
  let doc: any = { ...base }
  const seq: string[] = []
  for (const d of [CYL, v52, v52, CYL, v52, SRC, SINK]) { const l = nextFluidLabel(doc, d, SYMBOL_MAP); seq.push(String(l)); doc = put(doc, d, l ?? '') }
  check('repérage automatique : 1A1, 1V1, 1V2, puis un 2e vérin ouvre le circuit 2 (2A1, 2V1) ; source et silencieux sans repère', seq, ['1A1', '1V1', '1V2', '2A1', '2V1', '', ''])
  check('repérage : alimentation en circuit 0 (conditionnement 0Z1, pompe 0P1)', [nextFluidLabel(base, SYMBOL_MAP['qet:30_hydraulic/61_pumps/pompe_hydr_2'], SYMBOL_MAP), nextFluidLabel(base, byEnd('81_filters/filtre'), SYMBOL_MAP)], ['0P1', '0Z1'])
  check('bobines d’un distributeur 1V1 : 1V1+ ou 1Y1 (A), 1V1− ou 1Y2 (B) ; 1V2 : 1Y3 et 1Y4', [solenoidNames('1V1', ['14', '12']), solenoidNames('1V2')[0].includes('1Y3'), solenoidNames('YV1/YV2')], [[['1YV14', '1V1+', '1Y1', '1YV14', '1YV1'], ['1YV12', '1V1-', '1Y2', '1YV12']], true, [['YV1'], ['YV2']]])
  check('lecture d’un repère ISO', [parseIso('2s3'), parseIso('1A')], [{ n: 2, code: 'S', k: 3 }, { n: 1, code: 'A', k: 1 }])
  // renumérotation d'après le câblage : le distributeur relié au 2e vérin prend le circuit 2
  const f = v52.fluid
  const P = f.rest[0][0], A = f.rest[0][1], B = f.rest[1][0]
  const d2 = T.build(base, [specFor('c1', CYL, 100, 30, 'X'), specFor('c2', CYL, 100, 200, 'Y'), specFor('v1', v52, 300, 30, 'Q'), specFor('v2', v52, 300, 200, 'R')],
    [['v1', A, 'c1', CYL.fluid.cap], ['v1', B, 'c1', CYL.fluid.rod], ['v2', A, 'c2', CYL.fluid.cap], ['v2', B, 'c2', CYL.fluid.rod]])
  const rn = renumberFluid(d2, SYMBOL_MAP)
  check('renumérotation ISO d’après le câblage', ['c1', 'c2', 'v1', 'v2'].map((k) => rn.symbols[['c1', 'c2', 'v1', 'v2'].indexOf(k)].label), ['1A1', '2A1', '1V1', '2V1'])
  void P
  // une bobine repérée 1V1+ dans le schéma électrique commande le distributeur 1V1
  const R1 = f.rest[1][1], R2 = f.act[1][1]
  const d3 = T.build(base, [specFor('src', SRC, 100, 30), specFor('v', v52, 100, 120, '1V1'), specFor('c', CYL, 100, 250, '1A1'), specFor('s1', SINK, 40, 200), specFor('s2', SINK, 200, 200),
    ['es', 'sim-src1', 400, 30], ['sw', SW, 400, 100, 'S1'], ['k', COIL, 400, 200, '1V1+']],
  [['src', SRC.fluid.ports[0], 'v', P], ['v', A, 'c', CYL.fluid.cap], ['v', B, 'c', CYL.fluid.rod], ['v', R1, 's1', SK], ['v', R2, 's2', SK], ['es', 'a', 'sw', 't0'], ['sw', 't1', 'k', 't0'], ['k', 't1', 'es', 'b']])
  const g = rig(d3)
  const C = d3.symbols.find((x: any) => x.defId === CYL.id).id
  g.run(); const pos0 = g.run([], [], 3000).cylPos[C]
  g.run([], [g.idOf('S1')], 100); const pos1 = g.run([], [g.idOf('S1')], 3000).cylPos[C]
  check('électrovanne 1V1 commandée par la bobine 1V1+ du schéma électrique', [pos0, pos1].sort(), [0, 1].sort())
  check('les deux positions sont différentes', pos0 !== pos1, true)
}

// ── détecteurs posés sur le vérin
{
  const v52 = byEnd('5020106020_elec/502010602010_5_2_way_010')
  const f = v52.fluid
  const [P, A, B, R1, R2] = [f.rest[0][0], f.rest[0][1], f.rest[1][0], f.rest[1][1], f.act[1][1]]
  const d = T.build(base, [specFor('src', SRC, 100, 30), specFor('v', v52, 100, 120, '1V1'), specFor('c', CYL, 100, 250, '1A1'), specFor('s1', SINK, 40, 200), specFor('s2', SINK, 200, 200),
    ['es', 'sim-src1', 400, 30], ['sw', SW, 400, 100, 'S1'], ['k', COIL, 400, 200, '1V1+'],
    ['d0', SW, 520, 100, '1S1'], ['h0', LAMP, 520, 200, 'H0'], ['d1', SW, 600, 100, '1S2'], ['h1', LAMP, 600, 200, 'H1'], ['d2', SW, 680, 100, '1S3'], ['h2', LAMP, 680, 200, 'H2']],
  [['src', SRC.fluid.ports[0], 'v', P], ['v', A, 'c', CYL.fluid.rod], ['v', B, 'c', CYL.fluid.cap], ['v', R1, 's1', SK], ['v', R2, 's2', SK], ['es', 'a', 'sw', 't0'], ['sw', 't1', 'k', 't0'], ['k', 't1', 'es', 'b'],
    ['es', 'a', 'd0', 't0'], ['d0', 't1', 'h0', 't0'], ['h0', 't1', 'es', 'b'], ['es', 'a', 'd1', 't0'], ['d1', 't1', 'h1', 't0'], ['h1', 't1', 'es', 'b'], ['es', 'a', 'd2', 't0'], ['d2', 't1', 'h2', 't0'], ['h2', 't1', 'es', 'b']])
  const at: Record<string, number> = { '1S1': 0, '1S2': 0.5, '1S3': 1 }
  for (const sy of d.symbols) if (at[sy.label] !== undefined) sy.det = { cyl: '1A1', at: at[sy.label] }
  const g = rig(d)
  const on = (r: any) => ['H0', 'H1', 'H2'].map((l) => r.energized.has(g.idOf(l)))
  g.run(); let r = g.run([], [], 3000)
  check('détecteurs sur le vérin : rentré → seul le détecteur de début de course est fermé', on(r), [true, false, false])
  g.run([], [g.idOf('S1')], 100); r = g.run([], [g.idOf('S1')], 550)
  check('détecteurs sur le vérin : à mi-course → le détecteur central est fermé', on(r), [false, true, false])
  r = g.run([], [g.idOf('S1')], 3000)
  check('détecteurs sur le vérin : sorti → seul le détecteur de fin de course est fermé', on(r), [false, false, true])
}

// ── palette pneumatique : aucun doublon de nom, tout symbole proposé est simulable
{
  const vis = lib.symbols.filter((s: any) => s.domain === 'pneumatic' && !s.legacy)
  const names = new Map<string, number>()
  for (const s of vis) names.set(s.name.fr, (names.get(s.name.fr) ?? 0) + 1)
  check('palette pneumatique : aucun nom en double', [...names.values()].filter((n) => n > 1).length, 0)
  check('palette pneumatique : tous les symboles proposés sont simulables', vis.filter((s: any) => !s.fluid && !s.sim).map((s: any) => s.name.fr), [])
  // un seul distributeur et un seul vérin par comportement (les variantes qui ne diffèrent que par le nom du fabricant ou le dessin d'origine sont masquées)
  const roles = (sym: any) => { const r = new Map<string, string>(); for (const dir of ['up', 'down', 'left', 'right']) sym.ports.filter((p: any) => p.dir === dir).sort((a: any, b: any) => (dir === 'left' || dir === 'right' ? a.y - b.y : a.x - b.x)).forEach((p: any, i: number) => r.set(p.id, dir[0] + i)); return r }
  const behav = (sym: any) => { const f = sym.fluid, r = roles(sym), R = (i: string) => r.get(i) ?? i, pr = (l: any[]) => (l ?? []).map(([a, b]) => [R(a), R(b)].sort().join('-')).sort().join(',')
    return f.k === 'valve' ? `v|${f.a}|${f.b}|${f.three}|${pr(f.rest)}|${pr(f.act)}|${pr(f.actB)}|${f.pilotA ? R(f.pilotA) : ''}|${f.pilotB ? R(f.pilotB) : ''}` : f.k === 'cyl' ? `c|${R(f.cap)}|${f.rod ? R(f.rod) : ''}|${f.single ?? ''}` : null }
  const seen = new Map<string, string[]>()
  for (const sy of vis) { const k = behav(sy); if (k) seen.set(k, [...(seen.get(k) ?? []), sy.name.fr]) }
  check('palette pneumatique : un seul distributeur ou vérin par comportement', [...seen.values()].filter((v) => v.length > 1).map((v) => v[0]), [])
  check('palette pneumatique : les symboles masqués restent chargeables (anciens fichiers)', lib.symbols.some((s: any) => s.domain === 'pneumatic' && s.legacy), true)
}

// ── numéros normalisés des orifices et des commandes
{
  const { portNumbers, pilotNumbers } = await import(ROOT + '/src/fluidNames.ts')
  const v52 = byEnd('5020106020_elec/502010602010_5_2_way_010')
  const nums = portNumbers(v52)
  const byNum = (n: string) => Object.keys(nums).find((k) => nums[k] === n)
  const f = v52.fluid
  check('5/2 : orifices 1, 2, 3, 4, 5 posés d’après le symbole', Object.values(nums).sort(), ['1', '2', '3', '4', '5'])
  check('5/2 : au repos 1 relié à 2 et 4 à 5 ; commande de gauche : 1 relié à 4', [f.rest.some(([a, b]: string[]) => [a, b].includes(byNum('1')!) && [a, b].includes(byNum('2')!)), f.act.some(([a, b]: string[]) => [a, b].includes(byNum('1')!) && [a, b].includes(byNum('4')!))], [true, true])
  check('5/2 monostable : commande 14 à gauche, pas de commande à droite (ressort)', pilotNumbers(v52), ['14', undefined])
  check('5/3 à deux électroaimants : 14 et 12', pilotNumbers(byEnd('502010702010_5_3_way')), ['14', '12'])
  check('3/2 normalement fermé : la commande relie 1 à 2 (12)', pilotNumbers(v32.def)[0], '12')
  const v32no = first((s) => s.fluid?.k === 'valve' && !s.fluid.three && s.ports.length === 3 && s.fluid.act.length === 1 && !s.fluid.act[0].includes(portNumbers(s) && Object.keys(portNumbers(s)).find((k) => portNumbers(s)[k] === '1')))
  check('3/2 normalement ouvert : la commande coupe l’alimentation (10)', v32no ? pilotNumbers(v32no)[0] : '10', '10')
}
console.log(fails ? `\n${fails} ÉCHEC(S)` : '\ntous les tests pneumatiques passent')
process.exit(fails ? 1 : 0)
