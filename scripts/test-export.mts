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
// ── sources réglables : tension et nature dans les propriétés
{
  const { simulate, voltageBetween } = await import(ROOT + '/src/sim/engine.ts')
  const { sourceCaption } = await import(ROOT + '/src/sim/potentials.ts')
  const Q = (x: string) => 'qet:10_electric/10_allpole/' + x
  const mk = (srcVolts: number | undefined, dc: boolean, coilVolts: number) => {
    const d = T.build(base, [['src', 'sim-src1', 400, 30], ['s', Q('380_signaling_operating/20_push_buttons/poussoir'), 400, 110, 'S2'], ['c', Q('310_relays_contactors_contacts/01_coils/bobine3'), 390, 210, 'KA1']], [['src', 'a', 's', 't0'], ['s', 't1', 'c', 't0'], ['c', 't1', 'src', 'b']])
    const src = d.symbols.find((x: any) => x.defId === 'sim-src1')
    if (srcVolts) src.volts = srcVolts
    if (dc) src.dc = true
    d.symbols.find((x: any) => x.label === 'KA1').volts = coilVolts
    return d
  }
  const run = (d: any) => simulate(d, SYMBOL_MAP, {}, { pressed: new Set([d.symbols.find((x: any) => x.label === 'S2').id]), toggled: new Set() }, 1_000_000)
  const coilOf = (d: any) => d.symbols.find((x: any) => x.label === 'KA1').id
  let d = mk(undefined, false, 230), r = run(d)
  check('bloc source par défaut : 230 V ~, bobine 230 V alimentée', r.energized.has(coilOf(d)) && r.volts[coilOf(d)] === 230 && !r.badVoltage[coilOf(d)])
  d = mk(24, false, 24); r = run(d)
  check('bloc source à 24 V ~ : bobine 24 V alimentée, 24 V mesurés, aucune alerte', r.energized.has(coilOf(d)) && r.volts[coilOf(d)] === 24 && !r.badVoltage[coilOf(d)], JSON.stringify(r.volts))
  d = mk(24, false, 230); r = run(d)
  check('bloc source à 24 V ~ : bobine 230 V signalée en sous-tension', !!r.badVoltage[coilOf(d)])
  d = mk(12, true, 12); r = run(d)
  check('bloc source en continu à 12 V : bobine 12 V alimentée, 12 V mesurés', r.energized.has(coilOf(d)) && r.volts[coilOf(d)] === 12 && !r.badVoltage[coilOf(d)], JSON.stringify(r.volts))
  d = mk(undefined, true, 24); r = run(d)
  check('bloc source continu sans tension saisie : 24 V par défaut', r.volts[coilOf(d)] === 24)
  check('légendes des blocs', [sourceCaption(mk(24, false, 24).symbols[0], SYMBOL_MAP['sim-src1']), sourceCaption(mk(12, true, 12).symbols[0], SYMBOL_MAP['sim-src1']), sourceCaption({ ...mk(undefined, false, 1).symbols[0], defId: 'sim-src3' }, SYMBOL_MAP['sim-src3'])].join('|') === '24 V AC|12 V DC|3 AC 400 V')
  const fake: any = { symbols: [] }
  check('tensions entre potentiels : 230, 400, 24, 690/√3, 0 vers le neutre-terre', [voltageBetween('L', 'N', fake, SYMBOL_MAP), voltageBetween('L1', 'L2', fake, SYMBOL_MAP), voltageBetween('L@24', 'N@24', fake, SYMBOL_MAP), voltageBetween('L1@690', 'N@690', fake, SYMBOL_MAP), voltageBetween('N@24', 'PE', fake, SYMBOL_MAP)].join(',') === '230,400,24,398.4,0')
  check('tensions de sources différentes : indéterminées', voltageBetween('L@24', 'N', fake, SYMBOL_MAP) === undefined)
}
// ── source monophasée isolée (sans terre) : banc d'essai
{
  const { simulate, voltageBetween } = await import(ROOT + '/src/sim/engine.ts')
  const Q = (x: string) => 'qet:10_electric/10_allpole/' + x
  const d = T.build(base, [['src', 'sim-src1i', 400, 30], ['s', Q('380_signaling_operating/20_push_buttons/poussoir'), 400, 110, 'S2'], ['c', Q('310_relays_contactors_contacts/01_coils/bobine3'), 390, 210, 'KA1']], [['src', 'a', 's', 't0'], ['s', 't1', 'c', 't0'], ['c', 't1', 'src', 'b']])
  const coil = d.symbols.find((x: any) => x.label === 'KA1').id
  const r = simulate(d, SYMBOL_MAP, {}, { pressed: new Set([d.symbols.find((x: any) => x.label === 'S2').id]), toggled: new Set() }, 1_000_000)
  check('source isolée : bobine 230 V alimentée, 230 V mesurés', r.energized.has(coil) && r.volts[coil] === 230 && !r.badVoltage[coil], JSON.stringify(r.volts))
  const fake: any = { symbols: [] }
  check('source isolée : LI–NI = 230 V, mais phase–terre et neutre–terre indéterminés', voltageBetween('LI', 'NI', fake, SYMBOL_MAP) === 230 && voltageBetween('LI', 'PE', fake, SYMBOL_MAP) === undefined && voltageBetween('NI', 'PE', fake, SYMBOL_MAP) === undefined)
  check('source de terre classique : neutre–terre toujours 0 V', voltageBetween('N', 'PE', fake, SYMBOL_MAP) === 0)
}
// ── Contrôle : corrections applicables en un clic
{
  const { checkDoc } = await import(ROOT + '/src/check.ts')
  const { applyFixToDoc } = await import(ROOT + '/src/advice.ts')
  const Q = (x: string) => 'qet:10_electric/10_allpole/' + x
  // tension de bobine inadaptée
  const d = T.build(base, [['src', 'sim-src1', 400, 30], ['c', Q('380_signaling_operating/11_optical_signaling/lampe2'), 400, 150, 'H2']], [['src', 'a', 'c', 't0'], ['c', 't1', 'src', 'b']])
  d.symbols.find((x: any) => x.defId === 'sim-src1').volts = 24
  d.symbols.find((x: any) => x.label === 'H2').volts = 230
  const bad = checkDoc(d, SYMBOL_MAP, 'fr').find((x: any) => /24 V appliqués/.test(x.text))
  check('Contrôle : tension inadaptée → correction « tension 24 V » proposée', bad?.fix?.patch?.volts === 24, JSON.stringify(bad?.fix))
  const fixed = applyFixToDoc(d, bad.fix, SYMBOL_MAP)
  check('Contrôle : la correction supprime l’erreur', !checkDoc(fixed, SYMBOL_MAP, 'fr').some((x: any) => /24 V appliqués/.test(x.text)) && fixed.symbols.find((x: any) => x.label === 'H2').volts === 24)
  // moteur sans terre
  const m = T.motorStarter(base)
  const mot = m.symbols.find((x: any) => x.label === 'M1')
  m.wires = m.wires.filter((w: any) => !((w.from.symId === mot.id && w.from.portId === 't3') || (w.to.symId === mot.id && w.to.portId === 't3')))
  const pe = checkDoc(m, SYMBOL_MAP, 'fr').find((x: any) => /borne de terre/.test(x.text))
  check('Contrôle : PE du moteur non reliée → correction « relier à la terre »', !!pe?.fix?.earth)
  const m2 = applyFixToDoc(m, pe.fix, SYMBOL_MAP)
  check('Contrôle : la borne PE est reliée et l’avertissement disparaît', !checkDoc(m2, SYMBOL_MAP, 'fr').some((x: any) => /borne de terre/.test(x.text)))
  // calibre trop faible pour le moteur
  const m3 = T.motorStarter(base)
  m3.symbols.find((x: any) => x.label === 'Q1').rated = { in: 4, curve: 'D' }
  const low = checkDoc(m3, SYMBOL_MAP, 'fr').find((x: any) => /inférieur au courant nominal du moteur/.test(x.text))
  check('Contrôle : calibre trop faible → correction vers un calibre suffisant', (low?.fix?.rated?.in ?? 0) >= 8, JSON.stringify(low?.fix))
  const m4 = applyFixToDoc(m3, low.fix, SYMBOL_MAP)
  check('Contrôle : après correction, plus d’erreur de calibre', !checkDoc(m4, SYMBOL_MAP, 'fr').some((x: any) => /inférieur au courant nominal du moteur/.test(x.text)))
}
// ── insertion d'un composant sur des fils superposés : tous sont coupés et reconnectés
{
  const { spliceSymbols } = await import(ROOT + '/src/splice.ts')
  const Q = (x: string) => 'qet:10_electric/10_allpole/' + x
  const L = Q('380_signaling_operating/11_optical_signaling/lampe2')
  const d = T.build(base, [['a', 'sim-l', 100, 30], ['l1', L, 100, 300, 'H1'], ['l2', L, 100, 300, 'H2'], ['f', Q('200_fuses_protective_gears/10_fuses/pojistka1p'), 100, 150, 'F1']],
    [['a', 'a', 'l1', 't0'], ['a', 'a', 'l2', 't0']])
  const fuse = d.symbols.find((x: any) => x.label === 'F1').id
  const out = spliceSymbols(d, [fuse])
  const onFuse = (port: string) => out.wires.filter((w: any) => (w.from.symId === fuse && w.from.portId === port) || (w.to.symId === fuse && w.to.portId === port)).length
  check('fils superposés : les deux fils sont coupés (4 fils au total)', out.wires.length === 4, String(out.wires.length))
  check('fils superposés : chaque borne du composant reçoit les deux fils', onFuse('t0') === 2 && onFuse('t1') === 2, `${onFuse('t0')},${onFuse('t1')}`)
  check('fils superposés : plus aucun fil direct source → lampe', !out.wires.some((w: any) => w.from.symId !== fuse && w.to.symId !== fuse))
}
// ── exercices guidés : la solution coche toutes les étapes, un schéma vide ou de départ non
{
  const { GUIDED } = await import(ROOT + '/src/guidedData.ts')
  const ids = new Set<string>()
  for (const ex of GUIDED) {
    check(`guidé « ${ex.id} » : identifiant unique, 2 langues, étapes et indices`, !ids.has(ex.id) && ex.steps.length >= 3 && ex.steps.every((st: any) => st.title.fr && st.title.en && st.hint.fr && st.hint.en) && ex.brief.every((b: any) => b.fr && b.en) && !!ex.title.en)
    ids.add(ex.id)
    const sol = ex.solution(base)
    const c = (doc: any, simMode = true) => ({ doc, defs: SYMBOL_MAP, lang: 'fr', simMode })
    const notDone = ex.steps.filter((st: any) => !st.done(c(sol)))
    check(`guidé « ${ex.id} » : le schéma de solution coche toutes les étapes`, notDone.length === 0, notDone.map((st: any) => st.id).join(','))
    const emptyDone = ex.steps.filter((st: any) => st.done(c(base, false)))
    check(`guidé « ${ex.id} » : une feuille vide ne coche aucune étape`, emptyDone.length === 0, emptyDone.map((st: any) => st.id).join(','))
    if (ex.start) {
      const st0 = ex.start(base)
      const startDone = ex.steps.filter((st: any) => st.done(c(st0, false)))
      check(`guidé « ${ex.id} » : le schéma de départ ne réussit pas tout`, startDone.length < ex.steps.length, startDone.map((x: any) => x.id).join(','))
    }
  }
}
// ── exercices guidés : des montages faux ne valident pas les étapes de structure
{
  const { GUIDED } = await import(ROOT + '/src/guidedData.ts')
  const ex = (id: string) => GUIDED.find((g: any) => g.id === id)
  const ctx = (doc: any, simMode = true) => ({ doc, defs: SYMBOL_MAP, lang: 'fr', simMode })
  const doneOf = (id: string, doc: any, stepId: string) => ex(id).steps.find((st: any) => st.id === stepId).done(ctx(doc))
  // hydraulique : retour du distributeur à la bâche coupé
  const h = ex('h-cyl').solution(base)
  const v = h.symbols.find((x: any) => /distributeur_4-2/.test(x.defId)), tank = h.symbols.find((x: any) => /bache_a_l_air_libre/.test(x.defId))
  const noReturn = { ...h, wires: h.wires.filter((w: any) => !((w.from.symId === v.id && w.from.portId === 't1' && w.to.symId === tank.id) || (w.to.symId === v.id && w.to.portId === 't1' && w.from.symId === tank.id))) }
  check('hydraulique : sans retour à la bâche, la boucle n’est pas validée', doneOf('h-cyl', h, 'loop') && !doneOf('h-cyl', noReturn, 'loop'))
  // hydraulique : P et T inversés sur la bâche (le refoulement de la pompe à la bâche) ne passe pas
  const pump = h.symbols.find((x: any) => /pompe_hydr_2/.test(x.defId))
  const swapped = { ...h, wires: h.wires.map((w: any) => (w.from.symId === pump.id && w.from.portId === 't1' ? { ...w, from: { ...w.from, portId: 't0' } } : w)) }
  check('hydraulique : aspiration branchée sur le refoulement de la pompe → refusé', !doneOf('h-cyl', swapped, 'loop'))
  // filtre : sans filtre dans la ligne, l'étape « série » est refusée
  const f = ex('h-filter').solution(base)
  const fil = f.symbols.find((x: any) => /81_filters/.test(x.defId))
  check('hydraulique : filtre et vanne en série sur l’aspiration validés, sans eux refusés', doneOf('h-filter', f, 'series') && !doneOf('h-filter', ex('h-cyl').solution(base), 'series'))
  void fil
  // pneumatique : repères différents entre vanne et bobine
  const pe = ex('p-electro').solution(base)
  const coil = pe.symbols.find((x: any) => /bobine3/.test(x.defId))
  coil.label = 'KM9'
  check('électro-pneumatique : bobine et vanne de repères différents → étape refusée', !doneOf('p-electro', pe, 'tag'))
  // pneumatique : deux interrupteurs en parallèle ne font pas un ET
  const pa = ex('p-and').solution(base)
  const sw = pa.symbols.filter((x: any) => /010_switch_1pos/.test(x.defId)), cl = pa.symbols.find((x: any) => /bobine3/.test(x.defId)), src = pa.symbols.find((x: any) => x.defId === 'sim-src1')
  const parallel = { ...pa, wires: [...pa.wires.filter((w: any) => !sw.some((s: any) => w.from.symId === s.id || w.to.symId === s.id) ), 
    ...sw.flatMap((s: any, k: number) => [{ id: 'pa' + k, from: { symId: src.id, portId: 'a' }, to: { symId: s.id, portId: 't0' }, label: '', color: '#000000', section: '' }, { id: 'pb' + k, from: { symId: s.id, portId: 't1' }, to: { symId: cl.id, portId: 't0' }, label: '', color: '#000000', section: '' }])] }
  check('pneumatique : S1 et S2 en parallèle ne valident pas la sécurité deux mains', doneOf('p-and', pa, 'run') && !doneOf('p-and', parallel, 'run'))
}
// ── exercice « lampe et interrupteur » : tous les montages équivalents sont acceptés, et les conseils disent ce qui manque
{
  const { GUIDED } = await import(ROOT + '/src/guidedData.ts')
  const ex = GUIDED.find((g: any) => g.id === 'e-lamp')
  const Q = (x: string) => 'qet:10_electric/10_allpole/' + x
  const ctx = (doc: any, simMode = true) => ({ doc, defs: SYMBOL_MAP, lang: 'fr', simMode })
  const status = (doc: any) => ex.steps.map((st: any) => !!st.done(ctx(doc)))
  const variants: [string, string, any[]][] = [
    ['source en repères L et N + bouton poussoir NO', '', [['l', 'sim-l', 100, 30], ['n', 'sim-n', 300, 30], ['b', Q('380_signaling_operating/20_push_buttons/poussoir'), 100, 110, 'S1'], ['h', Q('380_signaling_operating/11_optical_signaling/lampe2'), 100, 220, 'H1']]],
    ['bloc source + interrupteur', '', [['s', 'sim-src1', 100, 30], ['b', Q('380_signaling_operating/21_selector_switches/010_switch_1pos'), 100, 110, 'S1'], ['h', Q('380_signaling_operating/11_optical_signaling/lampe2'), 100, 220, 'H1']]],
    ['bloc source triphasé (fournit phase et neutre)', '', [['s', 'sim-src3', 100, 30], ['b', Q('380_signaling_operating/20_push_buttons/poussoir'), 100, 110, 'S1'], ['h', Q('380_signaling_operating/11_optical_signaling/lampe2'), 100, 220, 'H1']]],
  ]
  for (const [name, , specs] of variants) {
    const placed = T.build(base, specs, [])
    const st = status(placed)
    check(`lampe : ${name} → étape « poser » validée`, st[0] === true, JSON.stringify(st))
    check(`lampe : ${name} → rien de câblé, étape « câbler » non validée`, st[1] === false)
  }
  // câblage L → bouton → lampe → N avec repères L et N
  const wired = T.build(base, variants[0][2], [['l', 'a', 'b', 't0'], ['b', 't1', 'h', 't0'], ['h', 't1', 'n', 'a']])
  const sw = status(wired)
  check('lampe : repères L et N + bouton poussoir câblés → toutes les étapes validées', sw.every(Boolean), JSON.stringify(sw))
  // conseils
  const partial = T.build(base, [['b', Q('380_signaling_operating/20_push_buttons/poussoir'), 100, 110, 'S1']], [])
  const miss = ex.steps[0].missing(ctx(partial, false))
  check('lampe : les conseils listent la source et la lampe manquantes', miss.length === 2 && miss.some((m: string) => /source/.test(m)) && miss.some((m: string) => /lampe/.test(m)), JSON.stringify(miss))
  const unw = ex.steps[1].missing(ctx(placedOf(variants[1][2]), false))
  check('lampe : les conseils listent les bornes restées sans fil', unw.length >= 2 && unw.every((m: string) => /^Aucun fil/.test(m)), JSON.stringify(unw))
  function placedOf(specs: any[]) { return T.build(base, specs, []) }
}
// ── conseils des étapes de comportement : repères absents et vérifications qui échouent
{
  const { GUIDED } = await import(ROOT + '/src/guidedData.ts')
  const ex = GUIDED.find((g: any) => g.id === 'e-startstop')
  const run = ex.steps.find((st: any) => st.id === 'run')
  const c = (doc: any) => ({ doc, defs: SYMBOL_MAP, lang: 'fr', simMode: true })
  const good = ex.solution(base)
  check('conseils : un montage correct n’a aucun conseil', run.missing(c(good)).length === 0, JSON.stringify(run.missing(c(good))))
  const noLatch = ex.solution(base)
  const ka = noLatch.symbols.find((x: any) => /con_simple$/.test(x.defId))
  noLatch.wires = noLatch.wires.filter((w: any) => w.from.symId !== ka.id && w.to.symId !== ka.id)
  const m = run.missing(c(noLatch))
  check('conseils : sans auto-maintien, la vérification qui échoue est citée', m.length >= 1 && m.some((x: string) => /maintenue|reste|auto-maintien|S2 relâché/i.test(x)), JSON.stringify(m))
  const renamed = ex.solution(base)
  for (const x of renamed.symbols) if (x.label === 'KM1') x.label = 'K9'
  check('conseils : un repère absent est signalé', run.missing(c(renamed)).some((x: string) => /Repère absent : KM1/.test(x)), JSON.stringify(run.missing(c(renamed))))
}
// ── recherche par fonction
{
  const { matchesQuery } = await import(ROOT + '/src/searchTerms.ts')
  const { SYMBOLS } = await import(ROOT + '/src/symbols/index.ts')
  const found = (q: string) => SYMBOLS.filter((s: any) => !s.legacy && s.domain === 'electrical' && matchesQuery(s, q))
  check('recherche « protéger » : trouve des fusibles et disjoncteurs', found('protéger').some((s: any) => /fusible|fuse/i.test(s.name.fr + s.name.en)) && found('protéger').some((s: any) => /disjoncteur/i.test(s.name.fr)), String(found('protéger').length))
  check('recherche « temporiser » : trouve des éléments temporisés', found('temporiser').length > 0, '0')
  check('recherche « lampe » : toujours par nom', found('lampe').length > 0 && found('lampe').every((s: any) => /lamp/i.test(s.name.fr + s.name.en + (s.group?.fr ?? ''))), String(found('lampe').length))
  check('recherche à plusieurs mots : « bouton urgence »', found('bouton urgence').length > 0, '0')
}
console.log(fails ? `\n${fails} ÉCHEC(S)` : '\ntous les tests passent')
process.exit(fails ? 1 : 0)
