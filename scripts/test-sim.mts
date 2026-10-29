// Tests du moteur de simulation : npm test
import { readFileSync } from 'node:fs'
const ROOT = '..'
const { SYMBOL_MAP, SYMBOLS } = await import(ROOT + '/src/symbols/index.ts')
const T = await import(ROOT + '/src/templates.ts')
const { simulate } = await import(ROOT + '/src/sim/engine.ts')
const { effectiveTerms } = await import(ROOT + '/src/terminals.ts')
const lib = (await import('./lib-full.mjs')).loadFull()
for (const s of lib.symbols) { SYMBOLS.push(s); SYMBOL_MAP[s.id] = s }
const base: any = { version: 1, paper: 'A3', title: {}, symbols: [], wires: [] }
let fails = 0
const check = (name: string, got: any, want: any) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log((ok ? 'ok   ' : 'ÉCHEC'), name, ok ? '' : `(obtenu ${JSON.stringify(got)}, attendu ${JSON.stringify(want)})`) }
function rig(doc: any) {
  let mem: any = {}, now = 1_000_000
  const idOf = (label: string, part = '') => doc.symbols.find((s: any) => s.label === label && s.defId.includes(part))?.id
  const run = (pressed: string[] = [], toggled: string[] = [], dt = 0) => {
    now += dt
    const r = simulate(doc, SYMBOL_MAP, mem, { pressed: new Set(pressed), toggled: new Set(toggled) }, now)
    mem = r.state
    return r
  }
  const on = (r: any, label: string, part = '') => r.energized.has(idOf(label, part))
  return { idOf, run, on }
}

// ── 1. inverseur de sens
{
  const d = T.reversingStarter(base), g = rig(d)
  const S1 = g.idOf('S1'), S2 = g.idOf('S2'), S3 = g.idOf('S3')
  const c1 = (r: any) => g.on(r, 'KM1', 'bobine'), c2 = (r: any) => g.on(r, 'KM2', 'bobine'), m = (r: any) => g.on(r, 'M1')
  let r = g.run(); check('inverseur : repos', [c1(r), c2(r), m(r)], [false, false, false])
  r = g.run([S2]); check('inverseur : marche avant', [c1(r), c2(r), m(r), r.shorts.length], [true, false, true, 0])
  r = g.run(); check('inverseur : auto-maintien avant', [c1(r), c2(r)], [true, false])
  r = g.run([S3]); check('inverseur : S3 pendant KM1 → verrouillé', [c1(r), c2(r), r.shorts.length], [true, false, 0])
  r = g.run([S1]); r = g.run(); check('inverseur : arrêt', [c1(r), c2(r), m(r)], [false, false, false])
  r = g.run([S3]); r = g.run(); check('inverseur : marche arrière', [c1(r), c2(r), m(r), r.shorts.length], [false, true, true, 0])
  r = g.run([S2]); check('inverseur : S2 pendant KM2 → verrouillé', [c1(r), c2(r), r.shorts.length], [false, true, 0])
}
// ── 2. temporisation à la montée (5 s)
{
  const d = T.timerOnDelay(base), g = rig(d)
  const S1 = g.idOf('S1')
  const kt = (r: any) => g.on(r, 'KT', 'bobine'), h = (r: any) => g.on(r, 'H1')
  let r = g.run(); check('tempo : repos', [kt(r), h(r), r.pendingMs], [false, false, null])
  r = g.run([], [S1], 0); check('tempo : S1 fermé → bobine ON, voyant OFF, échéance proche', [kt(r), h(r), r.pendingMs !== null && r.pendingMs <= 5100], [true, false, true])
  r = g.run([], [S1], 2000); check('tempo : +2 s → voyant encore éteint', [kt(r), h(r)], [true, false])
  r = g.run([], [S1], 3100); check('tempo : +5,1 s → voyant allumé', [kt(r), h(r), r.pendingMs], [true, true, null])
  r = g.run([], [], 100); check('tempo : S1 rouvert → retombée immédiate', [kt(r), h(r)], [false, false])
}
// ── 3. contact inverseur (commun / NF / NO), manœuvré par bascule
{
  const co = Object.values(SYMBOL_MAP).find((s: any) => s.id.endsWith('act_a_semi_cond_no_nf')) as any
  const lamp = SYMBOL_MAP['qet:10_electric/10_allpole/380_signaling_operating/11_optical_signaling/lampe2']
  const [com, nc, no] = co.sim.changeover[0]
  const doc: any = { ...base, symbols: [
    { id: 'L', defId: 'sim-l', x: 0, y: 0, rot: 0, label: '', desc: '' }, { id: 'N', defId: 'sim-n', x: 0, y: 0, rot: 0, label: '', desc: '' },
    { id: 'C', defId: co.id, x: 0, y: 0, rot: 0, label: 'S9', desc: '' },
    { id: 'H1', defId: lamp.id, x: 0, y: 0, rot: 0, label: 'H1', desc: '' }, { id: 'H2', defId: lamp.id, x: 0, y: 0, rot: 0, label: 'H2', desc: '' } ],
    wires: [ w('L', 'a', 'C', com), w('C', nc, 'H1', 't0'), w('C', no, 'H2', 't0'), w('H1', 't1', 'N', 'a'), w('H2', 't1', 'N', 'a') ] }
  function w(a: string, ap: string, b: string, bp: string) { return { id: a + b + bp, from: { symId: a, portId: ap }, to: { symId: b, portId: bp }, label: '', color: '', section: '' } }
  const g = rig(doc)
  let r = g.run(); check('inverseur NO/NF : au repos H1 (NF) allumée', [r.energized.has('H1'), r.energized.has('H2')], [true, false])
  r = g.run([], ['C']); check('inverseur NO/NF : actionné H2 (NO) allumée', [r.energized.has('H1'), r.energized.has('H2')], [false, true])
}
// ── 4. court-circuit
{
  const d = T.motorStarter(base), g = rig(d)
  const l1 = d.symbols.find((s: any) => s.defId === 'sim-l1'), l2 = d.symbols.find((s: any) => s.defId === 'sim-l2')
  d.wires.push({ id: 'x', from: { symId: l1.id, portId: 'a' }, to: { symId: l2.id, portId: 'a' }, label: '', color: '', section: '' })
  const r = g.run(); check('court-circuit L1-L2 détecté', r.shorts.map((s: any) => s.potentials.sort()), [['L1', 'L2']])
}
// ── 5. circulation du courant : seuls les fils parcourus sont animés, dans le bon sens
{
  const d = T.motorStarter(base), g = rig(d)
  const wireBetween = (aLabel: string, aDef: string, bLabel: string, bDef: string) =>
    d.wires.find((w: any) => {
      const a = d.symbols.find((s: any) => s.id === w.from.symId), b = d.symbols.find((s: any) => s.id === w.to.symId)
      return a.label === aLabel && a.defId.includes(aDef) && b.label === bLabel && b.defId.includes(bDef)
    })
  const S2 = g.idOf('S2')
  let r = g.run()
  check('courant : au repos, aucun fil parcouru', Object.keys(r.current).length, 0)
  r = g.run([S2])
  const feed = wireBetween('', 'sim-l', 'S1', 'poussoir_nf'), back = wireBetween('KM1', 'bobine', '', 'sim-n'), toStop = wireBetween('S1', 'poussoir_nf', 'S2', 'poussoir')
  check('courant : fil source L → S1 parcouru de la source vers la charge', r.current[feed.id], 1)
  check('courant : fil bobine → N parcouru de la charge vers le retour', r.current[back.id], 1)
  check('courant : S2 appuyé, fil S1 → S2 parcouru', r.current[toStop.id], 1)
  r = g.run()
  check('courant : S2 relâché, branche S2 sans courant (auto-maintien par KM1)', [r.current[toStop.id], r.current[feed.id]], [undefined, 1])
  const l1 = wireBetween('', 'sim-l1', 'Q1', 'disjonct')
  check('courant : phase L1 vers le disjoncteur parcourue (moteur en marche)', r.current[l1.id], 1)
}
// ── 6. transformateur de commande : le secondaire alimente le circuit aval
{
  const tr = Object.values(SYMBOL_MAP).find((s: any) => s.id.endsWith('/10_transformers/transformator_1f_2')) as any
  const coilDef = SYMBOL_MAP['qet:10_electric/10_allpole/310_relays_contactors_contacts/01_coils/bobine3']
  const [p1, p2] = tr.sim.primary, [s1, s2] = tr.sim.secondary
  const mk = (extra: any = {}, tie = false): any => ({ ...base, symbols: [
    { id: 'L1', defId: 'sim-l1', x: 0, y: 0, rot: 0, label: '', desc: '' }, { id: 'L2', defId: 'sim-l2', x: 0, y: 0, rot: 0, label: '', desc: '' },
    { id: 'T', defId: tr.id, x: 0, y: 0, rot: 0, label: 'T1', desc: '', ...(extra.t ?? {}) },
    { id: 'K', defId: coilDef.id, x: 0, y: 0, rot: 0, label: 'KM1', desc: '', ...(extra.k ?? {}) },
    ...(tie ? [{ id: 'N', defId: 'sim-n', x: 0, y: 0, rot: 0, label: '', desc: '' }] : []) ],
    wires: [w('L1', 'a', 'T', p1), w('L2', 'a', 'T', p2), w('T', s1, 'K', 't0'), w('T', s2, 'K', 't1'), ...(tie ? [w('T', s2, 'N', 'a')] : [])] })
  function w(a: string, ap: string, b: string, bp: string) { return { id: a + b + ap + bp, from: { symId: a, portId: ap }, to: { symId: b, portId: bp }, label: '', color: '', section: '' } }
  let r = rig(mk()).run()
  check('transformateur : primaire alimenté → bobine du secondaire alimentée', [r.energized.has('T'), r.energized.has('K')], [true, true])
  check('transformateur : tension du secondaire 24 V par défaut', r.volts['K'], 24)
  check('transformateur : pas de court-circuit', r.shorts.length, 0)
  r = rig(mk({ t: { volts: 48 } })).run()
  check('transformateur : tension du secondaire réglable (48 V)', r.volts['K'], 48)
  r = rig(mk({ k: { volts: 230 } })).run()
  check('tension nominale 230 V sous 24 V → alerte', JSON.stringify(r.badVoltage['K']), JSON.stringify({ applied: 24, rated: 230 }))
  r = rig(mk({ k: { volts: 24 } })).run()
  check('tension nominale 24 V sous 24 V → aucune alerte', r.badVoltage['K'], undefined)
  r = rig(mk({}, true)).run()
  check('secondaire relié au neutre : pas de court-circuit, bobine alimentée', [r.shorts.length, r.energized.has('K')], [0, true])
  // primaire non alimenté : on retire un fil du primaire
  const dead = mk(); dead.wires = dead.wires.filter((x: any) => x.id !== 'L2aTt1' && !(x.from.symId === 'L2'))
  r = rig(dead).run()
  check('primaire non alimenté : secondaire mort, bobine éteinte', [r.energized.has('T'), r.energized.has('K')], [false, false])
}
// ── 7. départ moteur avec transformateur de commande (cas d'usage réel)
{
  const d = T.motorStarterTransformer(base), g = rig(d)
  const S1 = g.idOf('S1'), S2 = g.idOf('S2'), T1 = g.idOf('T1')
  let r = g.run()
  check('départ avec transformateur : au repos T1 alimenté, commande hors tension', [r.energized.has(T1), g.on(r, 'KM1', 'bobine'), g.on(r, 'M1')], [true, false, false])
  r = g.run([S2])
  check('départ avec transformateur : marche → bobine 24 V, voyant et moteur', [g.on(r, 'KM1', 'bobine'), g.on(r, 'H1'), g.on(r, 'M1'), r.volts[g.idOf('KM1', 'bobine')], Object.keys(r.badVoltage).length], [true, true, true, 24, 0])
  r = g.run()
  check('départ avec transformateur : auto-maintien', [g.on(r, 'KM1', 'bobine'), g.on(r, 'M1')], [true, true])
  r = g.run([S1])
  r = g.run()
  check('départ avec transformateur : arrêt', [g.on(r, 'KM1', 'bobine'), g.on(r, 'M1')], [false, false])
  // bobine 230 V alimentée en 24 V : alerte
  const bad = T.motorStarterTransformer(base)
  bad.symbols.find((s: any) => s.label === 'KM1' && s.defId.includes('bobine')).volts = 230
  const g2 = rig(bad)
  g2.run([g2.idOf('S2')])
  const r2 = g2.run()
  check('bobine 230 V sous 24 V : alerte de tension', Object.keys(r2.badVoltage).length, 1)
}
// ── contacteur de puissance « inverseur » 3 pôles (6 bornes) : se ferme quand sa bobine est alimentée
{
  const inv = lib.symbols.find((s: any) => s.id.endsWith('com_puiss_3P_inv'))
  check('contacteur 3P « inv » : modélisé comme 3 pôles pilotés par bobine', [inv.sim?.k, inv.sim?.ctl, inv.sim?.poles?.length], ['switch', 'coil', 3])
}
// ── repères d'appareil : casse et espaces sans importance (« km1 » = « KM1 »)
{
  const d = T.reversingStarter(base)
  const g0 = rig(d)
  const S2 = g0.idOf('S2')
  d.symbols = d.symbols.map((s: any) => (s.label === 'KM1' && !s.defId.includes('bobine') ? { ...s, label: ' km1 ' } : s))
  const g = rig(d)
  let r = g.run([S2]); r = g.run()
  check('repère « km1 » (casse/espaces) : la bobine KM1 agit sur ses contacts (auto-maintien + moteur)', [r.energized.has(g.idOf('KM1', 'bobine')), r.energized.has(g.idOf('M1'))], [true, true])
}
// ── exemples ajoutés : signalisation et cascade temporisée
{
  const d = T.startLamps(base), g = rig(d)
  const S2 = g.idOf('S2')
  let r = g.run(); check('signalisation : au repos H2 allumé, H1 éteint', [g.on(r, 'H1'), g.on(r, 'H2')], [false, true])
  r = g.run([S2]); r = g.run(); check('signalisation : en marche H1 allumé, H2 éteint', [g.on(r, 'H1'), g.on(r, 'H2')], [true, false])
}
{
  const d = T.delayedCascade(base), g = rig(d)
  const S2 = g.idOf('S2')
  let r = g.run([S2]); r = g.run()
  check('cascade : KM1 et KT alimentés, KM2 pas encore', [g.on(r, 'KM1', 'bobine'), g.on(r, 'KT'), g.on(r, 'KM2')], [true, true, false])
  r = g.run([], [], 6000); r = g.run()
  check('cascade : 5 s plus tard KM2 démarre', g.on(r, 'KM2'), true)
}
// ── contrôle du schéma
{
  const { checkDoc } = await import(ROOT + '/src/check.ts')
  for (const [n, f] of [['moteur', T.motorStarter], ['inverseur', T.reversingStarter], ['signalisation', T.startLamps], ['cascade', T.delayedCascade], ['temporisation', T.timerOnDelay]] as const) {
    check(`contrôle : l'exemple « ${n} » est sans erreur`, checkDoc(f(base), SYMBOL_MAP, 'fr').filter((i: any) => i.level === 'error').length, 0)
  }
  const d = T.startLamps(base)
  d.symbols = d.symbols.filter((s: any) => !(s.label === 'KM1' && s.defId.includes('bobine')))
  const issues = checkDoc(d, SYMBOL_MAP, 'fr')
  check('contrôle : bobine supprimée → contacts KM1 signalés', issues.filter((i: any) => i.level === 'error' && /KM1/.test(i.text)).length, 3)
}
// ── défauts injectés et repères de fils par potentiel
{
  const d = T.motorStarter(base)
  const S2 = d.symbols.find((s: any) => s.label === 'S2').id
  const coilWire = d.wires.find((w: any) => d.symbols.find((s: any) => s.id === w.to.symId)?.label === 'KM1' && d.symbols.find((s: any) => s.id === w.to.symId)?.defId.includes('bobine') && d.symbols.find((s: any) => s.id === w.from.symId)?.label === 'S2')
  const coil = d.symbols.find((s: any) => s.label === 'KM1' && s.defId.includes('bobine')).id
  const run = (cut: string[]) => simulate(d, SYMBOL_MAP, {}, { pressed: new Set([S2]), toggled: new Set(), cut: new Set(cut) }, 0)
  check('défaut : sans défaut, KM1 est alimentée', run([]).energized.has(coil), true)
  check('défaut : fil de S2 coupé → KM1 reste au repos', run([coilWire.id]).energized.has(coil), false)
  const { netLabels } = await import(ROOT + '/src/nets.ts')
  const nl = netLabels(d, SYMBOL_MAP)
  const lbl = (def: string, ap: string) => nl[d.wires.find((w: any) => w.from.symId === d.symbols.find((s: any) => s.defId === def).id && w.from.portId === ap).id]
  check('repères de fils : le fil de L1 porte « L1 »', lbl('sim-l1', 'a'), 'L1')
}
// ── exercices : chaque exemple de référence réussit son exercice, et un schéma vide échoue
{
  const { EXERCISES, runExercise } = await import(ROOT + '/src/exercises.ts')
  const ref: Record<string, any> = { 'start-stop': T.motorStarter, lamp: T.startLamps, delay: T.delayedCascade, interlock: T.reversingStarter }
  for (const ex of EXERCISES.filter((e: any) => ref[e.id])) {
    const r = runExercise(ex, ref[ex.id](base), SYMBOL_MAP, 'fr')
    check(`exercice « ${ex.id} » : le schéma de référence réussit`, [r.ok, r.missing.length], [true, 0])
    check(`exercice « ${ex.id} » : un schéma vide échoue`, runExercise(ex, base, SYMBOL_MAP, 'fr').ok, false)
  }
}
// ── relais thermique : surcharge moteur injectée → déclenchement après 5 s, réarmement quand la surcharge cesse
{
  const d = T.motorStarter(base)
  const mot = d.symbols.find((s: any) => s.label === 'M1').id
  const coil = d.symbols.find((s: any) => s.label === 'KM1' && s.defId.includes('bobine'))
  const n = d.symbols.find((s: any) => s.defId === 'sim-n')
  const th = { id: 'th1', defId: lib.symbols.find((s: any) => s.id.endsWith('15_protection_contacts/contact_relais_nf_esclave')).id, x: 600, y: 360, rot: 0, label: 'F1', desc: '' }
  d.symbols.push(th)
  const w = d.wires.find((x: any) => x.from.symId === coil.id && x.from.portId === 't1' && x.to.symId === n.id)
  w.to = { symId: 'th1', portId: 't0' }
  d.wires.push({ id: 'wth', from: { symId: 'th1', portId: 't1' }, to: { symId: n.id, portId: 'a' }, label: '', color: '#000', section: '' })
  const S2 = d.symbols.find((s: any) => s.label === 'S2').id
  let mem: any = {}, now = 1_000_000
  const run = (pressed: string[], cut: string[], dt: number) => { now += dt; const r = simulate(d, SYMBOL_MAP, mem, { pressed: new Set(pressed), toggled: new Set(), cut: new Set(cut) }, now); mem = r.state; return r }
  let r = run([S2], [], 100); r = run([], [], 100)
  check('thermique : démarrage normal', [r.energized.has(coil.id), r.thermalTrip], [true, false])
  r = run([], ['ovl:' + mot], 100)
  r = run([], ['ovl:' + mot], 2000)
  check('thermique : surcharge depuis 2 s, pas encore déclenché', [r.energized.has(coil.id), r.thermalTrip], [true, false])
  r = run([], ['ovl:' + mot], 4000)
  check('thermique : surcharge depuis 6 s, KM1 coupé', [r.energized.has(coil.id), r.thermalTrip], [false, true])
  r = run([S2], ['ovl:' + mot], 100)
  check('thermique : redémarrage impossible tant que la surcharge dure', r.energized.has(coil.id), false)
  r = run([], [], 100); r = run([S2], [], 100); r = run([], [], 100)
  check('thermique : surcharge supprimée → réarmé, KM1 redémarre', [r.energized.has(coil.id), r.thermalTrip], [true, false])
}
// ── pneumatique : électrodistributeur 5/2 + vérin double effet + fin de course lié au vérin
{
  const id = (re: RegExp) => lib.symbols.find((s: any) => re.test(s.id)).id
  const mk = (key: string, defId: string, label = '') => ({ id: key, defId, x: 0, y: 0, rot: 0, label, desc: '' })
  const symbols = [
    mk('src', id(/50101000_compressed_air_source/)), mk('v', id(/502010602010_5_2_way_010/), 'YV1'), mk('cyl', id(/5030101100_double_effet/), 'A1'),
    mk('s1', id(/5010161060_silencer/)), mk('s2', id(/5010161060_silencer/)),
    mk('l', 'sim-l'), mk('sw', id(/21_selector_switches\/010_switch_1pos/), 'S1'), mk('coil', id(/01_coils\/bobine3/), 'YV1'), mk('n', 'sim-n'),
    mk('l2', 'sim-l'), mk('lim', id(/41_limit_switches\/fin_de_course_came_2_no/), 'A1+'), mk('h', id(/11_optical_signaling\/lampe2/), 'H1'), mk('n2', 'sim-n'),
  ]
  const W = (a: string, ap: string, b: string, bp: string, i: number) => ({ id: 'w' + i, from: { symId: a, portId: ap }, to: { symId: b, portId: bp }, label: '', color: '#000', section: '' })
  const wires = [
    W('src', 't0', 'v', 't4', 0), W('s1', 't0', 'v', 't0', 1), W('s2', 't0', 'v', 't2', 2),
    W('v', 't1', 'cyl', 't1', 3), W('v', 't3', 'cyl', 't0', 4), // A → côté tige, B → côté fond
    W('l', 'a', 'sw', 't0', 5), W('sw', 't1', 'coil', 't0', 6), W('coil', 't1', 'n', 'a', 7),
    W('l2', 'a', 'lim', 't0', 8), W('lim', 't1', 'h', 't0', 9), W('h', 't1', 'n2', 'a', 10),
  ]
  const d: any = { ...base, symbols, wires }
  let mem: any = {}, now = 1_000_000
  const run = (toggled: string[], dt: number) => { now += dt; const r = simulate(d, SYMBOL_MAP, mem, { pressed: new Set(), toggled: new Set(toggled) }, now); mem = r.state; return r }
  let r = run([], 0)
  check('vérin : au repos (valve non commandée) il est rentré', r.cylPos.cyl, 0)
  check('vérin : pression sur la tige au repos', [r.potentialOf['cyl:t1'], r.potentialOf['cyl:t0']], ['P', 'R'])
  r = run(['sw'], 100); check('vérin : S1 → distributeur actionné, le vérin commence à sortir', [r.valveA.v, r.potentialOf['cyl:t0']], [true, 'P'])
  r = run(['sw'], 600); check('vérin : à mi-course (~50 %)', Math.round(r.cylPos.cyl * 10) / 10 >= 0.4 && r.cylPos.cyl <= 0.6, true)
  check('vérin : en mouvement, la simulation demande un nouveau calcul rapidement', r.pendingMs !== null && r.pendingMs <= 700, true)
  check('vérin : fin de course A1+ pas encore fermé', r.energized.has('h'), false)
  r = run(['sw'], 1000); check('vérin : sorti (100 %)', r.cylPos.cyl, 1)
  r = run(['sw'], 10); check('vérin : fin de course A1+ fermé → voyant H1 allumé', r.energized.has('h'), true)
  r = run([], 100); r = run([], 1500); check('vérin : S1 relâché → rentré', [r.cylPos.cyl, r.energized.has('h')], [0, false])
}
// ── exemples électro-pneumatiques
{
  // distributeur manuel : maintenu appuyé, le vérin sort ; relâché, il rentre
  const d = T.pneumaticCylinder(base), g = rig(d)
  const V = g.idOf('V1'), A = g.idOf('A1')
  let r = g.run(); check('exemple pneumatique manuel : vérin rentré au repos', r.cylPos[A], 0)
  r = g.run([V], [], 100); r = g.run([V], [], 2000); check('exemple pneumatique manuel : distributeur maintenu → vérin sorti', r.cylPos[A], 1)
  r = g.run([], [], 100); r = g.run([], [], 2000); check('exemple pneumatique manuel : relâché → vérin rentré', r.cylPos[A], 0)
}
{
  const d = T.pneumaticElectric(base), g = rig(d)
  const S1 = g.idOf('S1'), A = g.idOf('A1')
  let r = g.run(); check('exemple électro-pneumatique : repos, H1 éteint', [r.cylPos[A], g.on(r, 'H1')], [0, false])
  r = g.run([], [S1], 100); r = g.run([], [S1], 2000); check('exemple électro-pneumatique : S1 → vérin sorti et H1 allumé', [r.cylPos[A], g.on(r, 'H1')], [1, true])
  r = g.run([], [], 100); r = g.run([], [], 2000); check('exemple électro-pneumatique : S1 coupé → vérin rentré', [r.cylPos[A], g.on(r, 'H1')], [0, false])
}
{
  const d = T.pneumaticAuto(base), g = rig(d)
  const S2 = g.idOf('S2'), A = g.idOf('A1')
  let r = g.run(); check('va-et-vient auto : repos, vérin rentré', r.cylPos[A], 0)
  r = g.run([S2], [], 100)
  let t = 0, out = false, back = false
  for (let i = 0; i < 60; i++) { r = g.run([S2], [], 100); t += 100; if (r.cylPos[A] >= 1) out = true; if (out && r.cylPos[A] <= 0) { back = true; break } }
  check('va-et-vient auto : S2 maintenu → le vérin sort puis rentre tout seul (A+ puis A-)', [out, back], [true, true])
  r = g.run([], [], 100); for (let i = 0; i < 40; i++) r = g.run([], [], 100)
  check('va-et-vient auto : S2 relâché → le vérin reste rentré', r.cylPos[A], 0)
}
// ── courant : sens et répartition (réseau de résistances)
{
  const d = T.motorStarter(base), g = rig(d)
  const S2 = g.idOf('S2')
  const wire = (fromLabel: string, toLabel: string, fromDef = '', toDef = '') => d.wires.find((w: any) => {
    const a = d.symbols.find((s: any) => s.id === w.from.symId), b = d.symbols.find((s: any) => s.id === w.to.symId)
    return (a.label === fromLabel || a.defId === fromDef) && (b.label === toLabel || b.defId === toDef)
  })
  let r = g.run([S2], [], 100)
  r = g.run([], [], 100) // S2 relâché, auto-maintien
  const dir = (w: any) => r.current[w.id]
  check('courant : fil L → S1 dans le sens de la source', dir(wire('', 'S1', 'sim-l')), 1)
  check('courant : fil S1 → contact KM1 (auto-maintien) parcouru', dir(wire('S1', 'KM1')) !== undefined, true)
  check('courant : fil bobine → neutre, de la bobine vers N', dir(wire('KM1', '', '', 'sim-n')), 1)
  check('courant : fil lampe → neutre, sens retour', dir(d.wires.find((w: any) => w.from.symId === g.idOf('H1') && w.to.symId !== undefined && d.symbols.find((s: any) => s.id === w.to.symId).defId === 'sim-n')), 1)
  // au repos : plus aucun courant
  r = g.run([], [], 100)
  const S1 = g.idOf('S1')
  r = g.run([S1], [], 100); r = g.run([], [], 100)
  check('courant : arrêt, aucun fil parcouru', Object.keys(r.current).length, 0)
  // S2 maintenu seul (avant verrouillage) : le courant passe par S2 et pas par la dérivation d'auto-maintien ouverte
  const g2 = rig(T.motorStarter(base))
  const r2 = g2.run([g2.idOf('S2')], [], 0)
  const d2 = T.motorStarter(base)
  void d2
  check('courant : S2 appuyé, des fils sont parcourus', Object.keys(r2.current).length > 0, true)
}
// ── transformateur : courants, protections conseillées, repères de bornes, conseils de conception
{
  const { transformerInfo, transformerTopology } = await import(ROOT + '/src/transformer.ts')
  const { checkDoc } = await import(ROOT + '/src/check.ts')
  const d = T.motorStarterTransformer(base)
  const tr = d.symbols.find((s: any) => s.label === 'T1')
  const info = transformerInfo(tr, SYMBOL_MAP[tr.defId])
  check('transformateur 100 VA 400/24 V : courant primaire 0,25 A, secondaire 4,17 A', [info.in1, info.in2], [0.25, 4.17])
  check('transformateur : protections conseillées 0,5 A (primaire) et 4 A (secondaire)', [info.prot1, info.prot2], [0.5, 4])
  const topo = transformerTopology(d, SYMBOL_MAP)
  const lab = topo.labels[tr.id]
  check('transformateur : primaire repéré L1 / L2', [lab.t0, lab.t1], ['L1', 'L2'])
  check('transformateur : secondaire relié à la terre → N + L', [topo.earthed[tr.id], lab.t3, lab.t2], [true, 'N', 'L'])
  const errs = (doc: any) => checkDoc(doc, SYMBOL_MAP, 'fr').filter((i: any) => i.level === 'error')
  check('conseils : l\'exemple avec transformateur protégé est sans erreur', errs(d).length, 0)
  const noEarth: any = { ...d, symbols: d.symbols.filter((s: any) => !s.defId.includes('/terre')), wires: d.wires.filter((w: any) => { const ids = new Set(d.symbols.filter((s: any) => s.defId.includes('/terre')).map((s: any) => s.id)); return !ids.has(w.from.symId) && !ids.has(w.to.symId) }) }
  const t2 = transformerTopology(noEarth, SYMBOL_MAP)
  check('transformateur : secondaire isolé → L1 / L2', [t2.earthed[tr.id], t2.labels[tr.id].t2, t2.labels[tr.id].t3], [false, 'L1', 'L2'])
  check('conseils : secondaire isolé signalé', checkDoc(noEarth, SYMBOL_MAP, 'fr').some((i: any) => /isolé de la terre/.test(i.text)), true)
  // primaire sans fusible
  const f1 = d.symbols.find((s: any) => s.label === 'F1')
  const noFuse: any = { ...d, symbols: d.symbols.filter((s: any) => s.id !== f1.id), wires: [...d.wires.filter((w: any) => w.from.symId !== f1.id && w.to.symId !== f1.id), { id: 'x1', from: { symId: d.symbols.find((s: any) => s.defId === 'sim-l1').id, portId: 'a' }, to: { symId: tr.id, portId: 't0' }, label: '', color: '#000', section: '' }, { id: 'x2', from: { symId: d.symbols.find((s: any) => s.defId === 'sim-l2').id, portId: 'a' }, to: { symId: tr.id, portId: 't1' }, label: '', color: '#000', section: '' }] }
  check('conseils : primaire de transformateur sans protection → erreur', errs(noFuse).some((i: any) => /primaire sans protection/.test(i.text)), true)
  // moteur sans disjoncteur-moteur : ni court-circuit ni surcharge
  const m = T.motorStarter(base)
  const q = m.symbols.find((s: any) => s.label === 'Q1')
  const noQ: any = { ...m, symbols: m.symbols.filter((s: any) => s.id !== q.id), wires: m.wires.filter((w: any) => w.from.symId !== q.id && w.to.symId !== q.id) }
  // les trois phases rejoignent directement le contacteur
  const k = m.symbols.find((s: any) => s.label === 'KM1' && s.defId.includes('com_puiss4'))
  const src = ['sim-l1', 'sim-l2', 'sim-l3'].map((id) => m.symbols.find((s: any) => s.defId === id).id)
  src.forEach((id: string, i: number) => noQ.wires.push({ id: 'p' + i, from: { symId: id, portId: 'a' }, to: { symId: k.id, portId: ['t0', 't2', 't4'][i] }, label: '', color: '#000', section: '' }))
  const advice = checkDoc(noQ, SYMBOL_MAP, 'fr')
  check('conseils : moteur sans protection contre les courts-circuits → erreur', advice.some((i: any) => i.level === 'error' && /courts-circuits/.test(i.text)), true)
  check('conseils : moteur sans protection contre les surcharges signalé avec sa conséquence', advice.some((i: any) => /surcharges/.test(i.text) && /brûler/.test(i.why ?? '')), true)
  check('conseils : le départ moteur protégé n\'a aucune erreur', errs(m).length, 0)
}
// ── conseils : appareil « phase + neutre » sur deux phases, transformateur non adapté à la tension du réseau
{
  const { checkDoc } = await import(ROOT + '/src/check.ts')
  const id = (re: RegExp) => lib.symbols.find((s: any) => re.test(s.id)).id
  const sym = (key: string, defId: string, label = ''): any => ({ id: key, defId, x: 0, y: 0, rot: 0, label, desc: '' })
  const W = (n: string, a: string, ap: string, b: string, bp: string): any => ({ id: n, from: { symId: a, portId: ap }, to: { symId: b, portId: bp }, label: '', color: '#000', section: '' })
  const brkDef = lib.symbols.find((s: any) => /disjonct-m_1fn$/.test(s.id))
  const [p0, p1] = brkDef.sim.poles as [string, string][]
  const up = (pole: [string, string]) => (brkDef.ports.find((p: any) => p.id === pole[0]).y < brkDef.ports.find((p: any) => p.id === pole[1]).y ? pole : [pole[1], pole[0]])
  const [a0, b0] = up(p0), [a1, b1] = up(p1)
  const lampDef = id(/11_optical_signaling\/lampe2$/)
  const brkDoc = (src0: string, src1: string): any => ({
    version: 1, paper: 'A3', title: {},
    symbols: [sym('s0', src0), sym('s1', src1), sym('q', brkDef.id, 'Q1'), sym('h', lampDef, 'H1')],
    wires: [W('w0', 's0', 'a', 'q', a0), W('w1', 's1', 'a', 'q', a1), W('w2', 'q', b0, 'h', 't0'), W('w3', 'q', b1, 'h', 't1')],
  })
  const msgs = (d: any) => checkDoc(d, SYMBOL_MAP, 'fr').filter((i: any) => i.level === 'error').map((i: any) => i.text)
  check('disjoncteur phase + neutre sur deux phases → erreur explicite', msgs(brkDoc('sim-l1', 'sim-l2')).some((t: string) => /phase \+ neutre.*2 conducteurs de phase.*bipolaire.*terre/.test(t)), true)
  check('disjoncteur phase + neutre sur phase + neutre → aucune erreur', msgs(brkDoc('sim-l1', 'sim-n')).some((t: string) => /phase \+ neutre/.test(t)), false)

  // transformateur 230 V sur deux phases / sur phase + neutre
  const tDef = lib.symbols.find((s: any) => s.id.endsWith('/10_transformers/transformator_1f_2'))
  const trDoc = (a: string, b: string, voltsPrimary?: number): any => {
    const t = sym('t', tDef.id, 'T1')
    t.volts = 24
    if (voltsPrimary) t.voltsPrimary = voltsPrimary
    return { version: 1, paper: 'A3', title: {}, symbols: [sym('sa', a), sym('sb', b), t], wires: [W('x0', 'sa', 'a', 't', 't0'), W('x1', 'sb', 'a', 't', 't1')] }
  }
  const all = (d: any) => checkDoc(d, SYMBOL_MAP, 'fr')
  const bad = all(trDoc('sim-l1', 'sim-l2', 230)).find((i: any) => i.level === 'error' && /branché/.test(i.text))
  check('transformateur 230 V sur deux phases → erreur « choisissez un primaire 400 V »', /230 V branché sur deux phases \(400 V\).*400 V/.test(bad?.text ?? ''), true)
  check('… avec la conséquence (surtension, tension secondaire)', /Surtension de 74 %.*42 V au lieu de 24 V/.test(bad?.why ?? ''), true)
  check('transformateur 400 V sur deux phases → pas d\'erreur de tension', all(trDoc('sim-l1', 'sim-l2', 400)).some((i: any) => i.level === 'error' && /primaire/.test(i.text) && /branché/.test(i.text)), false)
  check('transformateur 230 V sur phase + neutre → pas d\'erreur de tension', all(trDoc('sim-l', 'sim-n', 230)).some((i: any) => i.level === 'error' && /branché/.test(i.text)), false)
  check('transformateur 400 V sur phase + neutre (230 V) → erreur de sous-tension', all(trDoc('sim-l', 'sim-n', 400)).some((i: any) => i.level === 'error' && /400 V branché sur 230 V/.test(i.text)), true)
  check('transformateur sans tension primaire → avertissement', all(trDoc('sim-l1', 'sim-l2')).some((i: any) => i.level === 'warn' && /tension primaire non renseignée \(400 V/.test(i.text)), true)
}
// ── secondaire relié à la terre : la borne reliée est le retour (neutre), quelle que soit sa position sur le symbole
{
  for (const swap of [false, true]) {
    const d = T.motorStarterTransformer(base)
    const tr = d.symbols.find((s: any) => s.label === 'T1').id
    if (swap) {
      // on permute les deux bornes du secondaire : la phase passe sur t3, la terre sur t2
      for (const w of d.wires) for (const e of [w.from, w.to]) if (e.symId === tr && (e.portId === 't2' || e.portId === 't3')) e.portId = e.portId === 't2' ? 't3' : 't2'
    }
    const g = rig(d)
    const S2 = g.idOf('S2')
    let r = g.run([S2], [], 100); r = g.run([], [], 100)
    check(`secondaire relié à la terre (${swap ? 'permuté' : 'normal'}) : la bobine est alimentée`, g.on(r, 'KM1', 'bobine'), true)
    const hotPort = swap ? 't3' : 't2'
    const f2 = d.wires.find((w: any) => w.from.symId === tr && w.from.portId === hotPort && d.symbols.find((s: any) => s.id === w.to.symId)?.label === 'F2')
    check(`secondaire relié à la terre (${swap ? 'permuté' : 'normal'}) : le courant sort du transformateur par la phase, vers la commande`, r.current[f2.id], 1)
    const ret = d.wires.find((w: any) => w.to.symId === tr && d.symbols.find((s: any) => s.id === w.from.symId)?.label === 'KM1')
    check(`secondaire relié à la terre (${swap ? 'permuté' : 'normal'}) : le courant revient par le neutre vers le transformateur`, r.current[ret.id], 1)
  }
}
// ── caractéristiques assignées : cohérence des calibres, réglages, câbles et bilan de puissance
{
  const { checkDoc } = await import(ROOT + '/src/check.ts')
  const { motorCurrent } = await import(ROOT + '/src/ratings.ts')
  const msgs = (d: any) => checkDoc(d, SYMBOL_MAP, 'fr')
  const mk = () => {
    const d = T.motorStarter(base)
    const by = (label: string, part = '') => d.symbols.find((s: any) => s.label === label && s.defId.includes(part))
    return { d, by }
  }
  const { d, by } = mk()
  const motor = by('M1')
  motor.rated = { kw: 7.5 }
  check('moteur 7,5 kW 400 V : courant estimé ≈ 14,5 A', motorCurrent(motor, SYMBOL_MAP[motor.defId])?.value, 14.5)
  by('KM1', 'com_puiss4').rated = { in: 12 }
  let r = msgs(d)
  check('contacteur 12 A pour un moteur de 14,5 A → erreur (soudure des contacts)', r.some((i: any) => i.level === 'error' && /AC-3 12 A inférieur/.test(i.text) && /souder/.test(i.why ?? '')), true)
  by('KM1', 'com_puiss4').rated = { in: 18 }
  by('Q1').rated = { in: 25, curve: 'C', set: 20 }
  r = msgs(d)
  check('contacteur 18 A : plus d\'erreur de contacteur', r.some((i: any) => /AC-3/.test(i.text)), false)
  check('réglage thermique 20 A pour 14,5 A → erreur « moteur n\'est plus protégé »', r.some((i: any) => i.level === 'error' && /réglage thermique 20 A.*trop élevé/.test(i.text)), true)
  by('Q1').rated = { in: 25, curve: 'C', set: 10 }
  check('réglage thermique 10 A pour 14,5 A → avertissement (déclenchements intempestifs)', msgs(d).some((i: any) => i.level === 'warn' && /inférieur au courant nominal/.test(i.text)), true)
  check('courbe C devant un moteur → avertissement (courant de démarrage)', msgs(d).some((i: any) => i.level === 'warn' && /courbe C/.test(i.text)), true)
  by('Q1').rated = { in: 10 }
  check('calibre 10 A pour un moteur de 14,5 A → erreur', msgs(d).some((i: any) => i.level === 'error' && /calibre 10 A inférieur/.test(i.text)), true)
  by('Q1').rated = { in: 16, curve: 'D', set: 14.5 }
  check('Q1 16 A courbe D réglé 14,5 A : aucune erreur de caractéristiques', msgs(d).some((i: any) => i.level !== 'info' && /moteur|calibre|réglage|AC-3/i.test(i.text) && /M1|Q1|KM1/.test(i.text) && i.level === 'error'), false)
  // câble
  const q = by('Q1'), k = by('KM1', 'com_puiss4')
  const cab = d.wires.find((w: any) => w.from.symId === q.id && w.to.symId === k.id)
  cab.section = '1,5'
  q.rated = { in: 25, curve: 'D' }
  check('câble 1,5 mm² protégé par 25 A → erreur (max usuel 16 A)', msgs(d).some((i: any) => i.level === 'error' && /1,5 mm².*25 A.*16 A/.test(i.text)), true)
  q.rated = { in: 16, curve: 'D' }
  check('câble 1,5 mm² protégé par 16 A → aucune erreur de câble', msgs(d).some((i: any) => /mm² protégé/.test(i.text)), false)
  // bilan de puissance du transformateur de commande
  const t = T.motorStarterTransformer(base)
  const tr = t.symbols.find((s: any) => s.label === 'T1')
  t.symbols.find((s: any) => s.label === 'KM1' && s.defId.includes('bobine')).rated = { watts: 70 }
  t.symbols.find((s: any) => s.label === 'H1').rated = { watts: 40 }
  check('bilan : 110 VA sur un transformateur de 100 VA → erreur', checkDoc(t, SYMBOL_MAP, 'fr').some((i: any) => i.level === 'error' && /surchargé.*110 VA/.test(i.text)), true)
  t.symbols.find((s: any) => s.label === 'H1').rated = { watts: 15 }
  check('bilan : 85 VA sur 100 VA → avertissement (peu de marge)', checkDoc(t, SYMBOL_MAP, 'fr').some((i: any) => i.level === 'warn' && /85 %/.test(i.text)), true)
  t.symbols.find((s: any) => s.label === 'H1').rated = { watts: 5 }
  check('bilan : 75 VA sur 100 VA → aucun message de charge', checkDoc(t, SYMBOL_MAP, 'fr').some((i: any) => /chargé à|surchargé/.test(i.text)), false)
  void tr
}
// ── appareils de mesure : voltmètre à pointes de touche et pince ampèremétrique
{
  const { readVoltage, readCurrent, pickAt, defaultInstrument, stepRange, formatReading } = await import(ROOT + '/src/instruments.ts')
  const { routeAll } = await import(ROOT + '/src/routing.ts')
  const d = T.motorStarterTransformer(base)
  const S2 = d.symbols.find((s: any) => s.label === 'S2').id
  let mem: any = {}, now = 1e6
  let r: any = simulate(d, SYMBOL_MAP, mem, { pressed: new Set([S2]), toggled: new Set() }, now); mem = r.state
  r = simulate(d, SYMBOL_MAP, mem, { pressed: new Set(), toggled: new Set() }, now + 100)
  const routes = routeAll(d.wires, d.symbols)
  const ctx = { symbols: d.symbols, defs: SYMBOL_MAP, routes, wires: d.wires }
  const sym = (id: string) => d.symbols.find((s: any) => s.id === id)
  const wireOf = (a: string, b: string) => d.wires.find((w: any) => (sym(w.from.symId).label === a || sym(w.from.symId).defId === a) && (sym(w.to.symId).label === b || sym(w.to.symId).defId === b))
  const mid = (w: any) => { const p = routes[w.id]; let best = [p[0], p[1]], bl = 0; for (let i = 0; i + 1 < p.length; i++) { const l = Math.hypot(p[i + 1].x - p[i].x, p[i + 1].y - p[i].y); if (l > bl) { bl = l; best = [p[i], p[i + 1]] } } return { x: (best[0].x + best[1].x) / 2, y: (best[0].y + best[1].y) / 2 } }
  const volt = (pa: any, pb: any) => { const i = defaultInstrument('voltmeter', 'digital', 0, 0); i.probes = [pa, pb]; return readVoltage(i, ctx, r, d, SYMBOL_MAP) }
  const wl1 = mid(wireOf('sim-l1', 'Q1')), wl2 = mid(wireOf('sim-l2', 'Q1')), wl3 = mid(wireOf('sim-l3', 'Q1'))
  check('voltmètre : entre deux phases = 400 V', volt(wl1, wl2), 400)
  check('voltmètre : entre trois phases (L2, L3) = 400 V', volt(wl2, wl3), 400)
  check('voltmètre : deux pointes sur le même conducteur = 0 V', volt(wl1, { x: wl1.x, y: wl1.y + 1 }), 0)
  check('voltmètre : une pointe en l\'air = 0 V', volt(wl1, { x: 5, y: 5 }), 0)
  // la terre est la même partout : phase – conducteur relié à la terre du secondaire = 230 V ; phase du secondaire – terre = 24 V
  check('voltmètre : phase L1 – conducteur relié à la terre (secondaire) = 230 V', volt(wl1, mid(wireOf('KM1', 'T1'))), 230)
  check('voltmètre : phase du secondaire – terre = 24 V', volt(mid(wireOf('F2', 'S1')), mid(wireOf('KM1', 'T1'))), 24)
  check('voltmètre : phase du secondaire – phase L1 (circuits séparés) = indéterminé', volt(mid(wireOf('F2', 'S1')), wl1), null)
  const trT = d.symbols.find((s: any) => s.label === 'T1')
  // au secondaire : phase (via F2) – terre : 24 V ; neutre – terre : 0 V
  const sec = mid(wireOf('F2', 'S1')), ret = mid(wireOf('KM1', 'T1'))
  check('voltmètre : secondaire, phase vers neutre = 24 V', volt(sec, ret), 24)
  const pe = d.symbols.find((s: any) => s.defId.includes('/terre') ).id
  void pe; void trT
  // pince : courant dans les phases du moteur (4 kW → 7,7 A) et au secondaire (11 VA / 24 V → 0,458 A)
  const clamp = (pt: any) => { const i = defaultInstrument('clamp', 'digital', 0, 0); i.x = pt.x - 45; i.y = pt.y - 34; return readCurrent(i, ctx, r) }
  const c1 = clamp(mid(wireOf('Q1', 'KM1')))
  check('pince : 7,7 A dans une phase du moteur', [c1.clamped, Math.round(c1.amps * 10) / 10], [true, 7.7])
  const c2 = clamp(mid(wireOf('F2', 'S1')))
  check('pince : 0,46 A au secondaire du transformateur', Math.round(c2.amps * 100) / 100, 0.46)
  check('pince : rien à serrer → 0 A', clamp({ x: 5, y: 5 }), { amps: 0, clamped: false })
  // fils superposés (S2, contact d'auto-maintien et voyant partent tous de la borne A1 de la bobine) : la pince lit celui qui est parcouru
  const coilWires = d.wires.filter((w: any) => w.to.symId === d.symbols.find((x: any) => x.label === 'KM1' && x.defId.includes('bobine')).id && w.to.portId === 't0')
  const viaS2 = coilWires.find((w: any) => sym(w.from.symId).label === 'S2')
  const pr = routes[viaS2.id], last = pr[pr.length - 1], prev = pr[pr.length - 2]
  const near = { x: last.x + (prev.x - last.x) * 0.15, y: last.y + (prev.y - last.y) * 0.15 }
  check('pince sur des fils superposés : lit le fil parcouru (0,46 A), pas S2 ouvert', Math.round(clamp(near).amps * 100) / 100, 0.46)
  check('pickAt : une borne a priorité sur le conducteur', Object.keys(pickAt(mid(wireOf('Q1', 'KM1')), ctx)).includes('wire'), true)
  const i0 = defaultInstrument('voltmeter', 'needle', 0, 0)
  check('calibres : 600 V → 1000 V → plus haut impossible', [stepRange(i0, 1), stepRange({ ...i0, range: 1000 }, 1)], [1000, 1000])
  check('affichage numérique : 400,0 V sur 600 V ; 7,70 A sur 10 A ; 0,458 A sur 1 A', [formatReading(400, 600, 'fr'), formatReading(7.7, 10, 'fr'), formatReading(0.458, 1, 'fr')], ['400,0', '7,70', '0,458'])
}
// ── disjoncteurs différentiels simulés + propriétés ; corrections proposées par le Contrôle
{
  const { checkDoc } = await import(ROOT + '/src/check.ts')
  const { kindOf, fieldsFor } = await import(ROOT + '/src/ratings.ts')
  const rcd = lib.symbols.filter((s: any) => /50_residual_current_circuit_breaker/.test(s.id))
  check('disjoncteurs différentiels : tous simulés', rcd.every((s: any) => s.sim?.k === 'switch'), true)
  const bk = rcd.find((s: any) => /^Disjoncteur/.test(s.name.fr)), sw = rcd.find((s: any) => /^Interrupteur/.test(s.name.fr))
  check('disjoncteur différentiel : calibre, courbe, pouvoir de coupure et sensibilité', fieldsFor(SYMBOL_MAP[bk.id]).map((f: any) => f.key).join(), 'in,curve,icu,idn')
  check('interrupteur différentiel : calibre et sensibilité', [kindOf(SYMBOL_MAP[sw.id]), fieldsFor(SYMBOL_MAP[sw.id]).map((f: any) => f.key).join()], ['rcd', 'in,idn'])
  // départ moteur sans aucune caractéristique : le Contrôle propose des valeurs applicables
  const m = T.motorStarter(base)
  for (const s of m.symbols) delete s.rated
  m.symbols.find((s: any) => s.label === 'M1').rated = { kw: 4 }
  const fixes = checkDoc(m, SYMBOL_MAP, 'fr').filter((i: any) => i.fix)
  check('propositions applicables : calibre 8 A courbe D pour le disjoncteur, contacteur 9 A', [fixes.some((i: any) => i.fix.rated.in === 8 && i.fix.rated.curve === 'D'), fixes.some((i: any) => i.fix.rated.in === 9)], [true, true])
  // les appliquer fait disparaître les propositions
  for (const i of fixes) { const s = m.symbols.find((x: any) => x.id === i.fix.symId); s.rated = { ...s.rated, ...i.fix.rated } }
  check('propositions appliquées : plus aucune proposition', checkDoc(m, SYMBOL_MAP, 'fr').filter((i: any) => i.fix).length, 0)
  check('… et aucune erreur de caractéristiques', checkDoc(m, SYMBOL_MAP, 'fr').filter((i: any) => i.level === 'error').length, 0)
}
// ── tous les disjoncteurs (y compris les disjoncteurs-moteurs GV) permettent de choisir la courbe de déclenchement
{
  const { fieldsFor, kindOf } = await import(ROOT + '/src/ratings.ts')
  const brk = lib.symbols.filter((s: any) => /11_circuit_breakers|12_magneto|50_residual_current_circuit_breaker/.test(s.id) && s.sim && /^Disjoncteur/i.test(s.name.fr))
  const sans = brk.filter((s: any) => !fieldsFor(SYMBOL_MAP[s.id]).some((f: any) => f.key === 'curve' && f.list?.includes('D')))
  check(`disjoncteurs (${brk.length}) : tous proposent la courbe B / C / D…`, sans.map((s: any) => s.name.fr + ' ' + kindOf(SYMBOL_MAP[s.id])).join(' | '), '')
  const gv = lib.symbols.find((s: any) => /dis_mag_term_2f-2$/.test(s.id))
  check('disjoncteur GV 2P : calibre, courbe, plage, réglage, pouvoir de coupure', fieldsFor(SYMBOL_MAP[gv.id]).map((f: any) => f.key).join(), 'in,curve,min,max,set,icu')
}
// ── conseils de réglage d'après le circuit et les gammes de constructeurs
{
  const { settingsAdvice, wireAdvice } = await import(ROOT + '/src/settings.ts')
  const { typicalMotorCurrent, rangeFor, contactorFor } = await import(ROOT + '/src/catalog.ts')
  check('catalogue : moteur 4 kW ≈ 8,4 A, 7,5 kW = 15 A, 6 kW interpolé', [typicalMotorCurrent(4), typicalMotorCurrent(7.5), typicalMotorCurrent(6)], [8.4, 15, 12.2])
  check('catalogue : plage de réglage pour 8,4 A = 6–10 A ; pour 14 A : 13–18 A ; pour 0,3 A : 0,25–0,4 A', [rangeFor(8.4), rangeFor(14), rangeFor(0.3)], [[6, 10], [13, 18], [0.25, 0.4]])
  check('catalogue : contacteur pour 8,4 A = 9 A (4 kW) ; pour 15 A = 18 A (7,5 kW)', [contactorFor(8.4), contactorFor(15)], [[9, 4], [18, 7.5]])
  const d = T.motorStarter(base)
  for (const s of d.symbols) delete s.rated
  const by = (label: string, part = '') => d.symbols.find((s: any) => s.label === label && s.defId.includes(part))
  by('M1').rated = { kw: 4 }
  const adv = (s: any) => settingsAdvice(s, d, SYMBOL_MAP, 'fr') as any
  check('moteur 4 kW : courant type conseillé 8,4 A, cos φ 0,85, Id/In 7', [adv(by('M1')).ie?.value, adv(by('M1')).cos?.value, adv(by('M1')).ratio?.value], [8.4, 0.85, 7])
  check('contacteur : AC-3 9 A pour le moteur de 4 kW', adv(by('KM1', 'com_puiss4')).in?.value, 9)
  check('disjoncteur de départ moteur : calibre 8 A, courbe D, pouvoir de coupure 10 kA', [adv(by('Q1')).in?.value, adv(by('Q1')).curve?.value, adv(by('Q1')).icu?.value], [8, 'D', 10])
  by('M1').rated = { kw: 4, ie: 8.4 }
  check('avec le courant de plaque 8,4 A : calibre normalisé 10 A', adv(by('Q1')).in?.value, 10)
  // circuit de commande : lampe et bobine sur le transformateur de commande
  const t = T.motorStarterTransformer(base)
  for (const s of t.symbols) delete s.rated
  const tby = (label: string, part = '') => t.symbols.find((s: any) => s.label === label && s.defId.includes(part))
  const ta = (s: any) => settingsAdvice(s, t, SYMBOL_MAP, 'fr') as any
  delete tby('T1').voltsPrimary; delete tby('T1').power
  check('transformateur de commande : puissance conseillée d\'après les récepteurs (8 VA + 3 W, appel ×10 → 100 VA)', ta(tby('T1')).power?.value, 100)
  check('transformateur : primaire 400 V conseillé (entre deux phases) ; secondaire déjà à 24 V', [ta(tby('T1')).voltsPrimary?.value, ta(tby('T1')).volts], [400, undefined])
  tby('T1').power = 100; tby('T1').voltsPrimary = 400
  check('fusible du primaire : 0,5 A, aM', [ta(tby('F1')).in?.value, ta(tby('F1')).curve?.value], [0.5, 'aM'])
  check('fusible du secondaire : calibre pour la commande (0,5 A au minimum, type gG)', [typeof ta(tby('F2')).in?.value, ta(tby('F2')).curve?.value], ['number', 'gG'])
  check('bobine : puissance type 8 VA ; voyant : 3 W', [ta(tby('KM1', 'bobine')).watts?.value, ta(tby('H1')).watts?.value], [8, 3])
  // section de câble d'après la protection amont
  tby('F2').rated = { in: 4 }
  const wr = t.wires.find((w: any) => t.symbols.find((s: any) => s.id === w.from.symId)?.label === 'F2')
  check('conducteur de commande protégé par 4 A et 0,46 A : 1 mm² (minimum usuel en commande)', wireAdvice(wr, t, SYMBOL_MAP, 'fr').section?.value, '1')
  // couleurs conseillées (EN 60204-1)
  const m = T.motorStarterTransformer(base)
  const sy = (id: string) => m.symbols.find((x: any) => x.id === id)
  const wFind = (a: string, b: string) => m.wires.find((w: any) => (sy(w.from.symId).label === a || sy(w.from.symId).defId.includes(a)) && (sy(w.to.symId).label === b || sy(w.to.symId).defId.includes(b)))
  const colorOf = (w: any) => wireAdvice(w, m, SYMBOL_MAP, 'fr').color?.value
  check('couleur : phase vers disjoncteur de puissance → noir', colorOf(wFind('sim-l1', 'Q1')), '#000000')
  check('couleur : puissance moteur → noir', colorOf(wFind('Q1', 'KM1')), '#000000')
  check('couleur : conducteur de terre (moteur PE) → vert-jaune', colorOf(wFind('M1', 'terre')), 'gnye')
  check('couleur : liaison du secondaire à la terre → vert-jaune', colorOf(wFind('T1', 'terre')), 'gnye')
  check('couleur : commande 24 V alternatif (secondaire) → rouge', colorOf(wFind('F2', 'S1')), '#c80000')
  const mm = T.motorStarter(base)
  const sy2 = (id: string) => mm.symbols.find((x: any) => x.id === id)
  const w2 = (a: string, b: string) => mm.wires.find((w: any) => (sy2(w.from.symId).label === a || sy2(w.from.symId).defId.includes(a)) && (sy2(w.to.symId).label === b || sy2(w.to.symId).defId.includes(b)))
  check('couleur : commande directe sur la phase (sans transformateur) → rouge', wireAdvice(w2('sim-l', 'S1'), mm, SYMBOL_MAP, 'fr').color?.value, '#c80000')
  check('couleur : retour de la bobine au neutre → bleu clair', wireAdvice(w2('KM1', 'sim-n'), mm, SYMBOL_MAP, 'fr').color?.value, '#4fc3f7')
  const mot = wireAdvice(w2('KM1', 'M1'), mm, SYMBOL_MAP, 'fr')
  check('section : phase du moteur de 4 kW (8,4 A, calibre 10 A) → 1,5 mm² au moins', mot.section?.value, '1,5')
}
// ── couleur conseillée des conducteurs du secondaire de commande : phase rouge, neutre (côté terre) bleu clair
{
  const { wireKind } = await import(ROOT + '/src/settings.ts')
  const { transformerTopology } = await import(ROOT + '/src/transformer.ts')
  const t = T.motorStarterTransformer(base)
  const tr = t.symbols.find((s: any) => s.label === 'T1')
  const topo = transformerTopology(t, SYMBOL_MAP)
  const lab = topo.labels[tr.id] ?? {}
  const lbl = (id: string) => t.symbols.find((x: any) => x.id === id)?.label
  const kinds = t.wires.map((w: any) => [lbl(w.from.symId) + '-' + lbl(w.to.symId), wireKind(w, t, SYMBOL_MAP)])
  const kd = (n: string) => kinds.find((k: any) => k[0] === n)?.[1]
  check('secondaire de commande : retours bobine/voyant vers T1 → bleu clair (neutre), départ T1-F2 → rouge (phase)', [kd('KM1-T1'), kd('H1-T1'), kd('T1-F2')], ['neutral', 'neutral', 'control-ac'])
}

// ── rappel de protection du transformateur : marqué résolu quand un fusible / disjoncteur a un calibre
{
  const { adviseDoc } = await import(ROOT + '/src/advice.ts')
  const t = T.motorStarterTransformer(base)
  for (const s of t.symbols) delete s.rated
  const lines = (d: any) => adviseDoc(d, SYMBOL_MAP, 'fr').filter((x: any) => /Courant (primaire|secondaire)/.test(x.text))
  check('rappels de protection non résolus tant que les calibres manquent', lines(t).map((x: any) => !!x.resolved), [false, false])
  for (const s of t.symbols) if (s.label === 'F1') s.rated = { in: 0.5, curve: 'aM' }
  for (const s of t.symbols) if (s.label === 'F2') s.rated = { in: 4 }
  check('rappels résolus une fois F1 et F2 calibrés', lines(t).map((x: any) => !!x.resolved), [true, true])
}
// ── relais 24 V alternatif avec bornier
{
  const { adviseDoc } = await import(ROOT + '/src/advice.ts')
  const d = T.relay24V(base), g = rig(d)
  let r = g.run()
  check('relais 24 V : au repos H1 (contact NF) allumé, H2 éteint, bobine éteinte', [g.on(r, 'H1'), g.on(r, 'H2'), g.on(r, 'KA1', 'bobine')], [true, false, false])
  r = g.run([g.idOf('S2')])
  r = g.run()
  check('relais 24 V : marche, auto-maintien, H1 éteint et H2 allumé, tensions correctes', [g.on(r, 'KA1', 'bobine'), g.on(r, 'H1'), g.on(r, 'H2'), Object.keys(r.badVoltage).length], [true, false, true, 0])
  r = g.run([g.idOf('S1')]); r = g.run()
  check('relais 24 V : arrêt', [g.on(r, 'KA1', 'bobine'), g.on(r, 'H1'), g.on(r, 'H2')], [false, true, false])
  console.log(adviseDoc(d, SYMBOL_MAP, 'fr').filter((x: any) => x.level !== 'info').map((x: any) => x.level + ' ' + x.text))
}
// ── défauts injectés : contact collé, bobine en court-circuit
{
  const d = T.motorStarter(base), g = rig(d)
  const kmContact = d.symbols.find((s: any) => s.label === 'KM1' && s.defId.includes('con_simple'))
  let r = g.run()
  check('défaut : au repos, bobine KM1 coupée', g.on(r, 'KM1', 'bobine'), false)
  const mem = rig(d)
  const run = (cut: string[]) => simulate(d, SYMBOL_MAP, {}, { pressed: new Set(), toggled: new Set(), cut: new Set(cut) }, 2_000_000)
  const rs = run(['stuck:' + kmContact.id])
  check('défaut : contact d’auto-maintien collé → la bobine est alimentée sans appui', rs.energized.has(g.idOf('KM1', 'bobine')), true)
  const coil = g.idOf('KM1', 'bobine')
  const sc = simulate(d, SYMBOL_MAP, {}, { pressed: new Set([g.idOf('S2')]), toggled: new Set(), cut: new Set(['short:' + coil]) }, 2_000_000)
  check('défaut : bobine en court-circuit → court-circuit signalé, bobine non alimentée', [sc.shorts.length > 0, sc.energized.has(coil)], [true, false])
  void mem
}
// ── sélecteur 1-0-2 (trois positions), pédale, frein, connecteur à ressort, capteur : nouveaux modèles de simulation
{
  const ids = (re: RegExp) => lib.symbols.find((s: any) => re.test(s.id))?.id
  const sel = ids(/21_selector_switches\/key_1-0-2$/), foot = ids(/20_push_buttons\/foot_no$/), brake = ids(/30_brakes\/frein_magnetique$/)
  const conn = ids(/95_terminals_spring_box\/wire-connector-3-port$/), sens = ids(/02_sensors_inductive\/capteur_inductif_no$/)
  const LAMP = 'qet:10_electric/10_allpole/380_signaling_operating/11_optical_signaling/lampe2'
  check('nouveaux symboles présents dans la bibliothèque', [sel, foot, brake, conn, sens].every(Boolean), true)
  const defSel = SYMBOL_MAP[sel]
  check('sélecteur 1-0-2 : modèle à trois positions', defSel.sim.pos3 === true && defSel.sim.changeover.length === 1, true)
  const com = defSel.sim.changeover[0]
  const d = T.build(base, [['src', 'sim-src1', 100, 30], ['x', sel, 100, 100, 'S1'], ['h1', LAMP, 100, 240, 'H1'], ['h2', LAMP, 260, 240, 'H2']],
    [['src', 'a', 'x', com[0]], ['x', com[1], 'h1', 't0'], ['h1', 't1', 'src', 'b'], ['x', com[2], 'h2', 't0'], ['h2', 't1', 'src', 'b']])
  const g = rig(d)
  const x = d.symbols.find((v: any) => v.label === 'S1').id
  const st = (toggled: string[]) => { const r = g.run([], toggled, 100); return [g.on(r, 'H1'), g.on(r, 'H2')] }
  check('sélecteur 1-0-2 : centre = tout éteint, position 1 = H1, position 2 = H2', JSON.stringify([st([]), st([x]), st([x + ':2'])]), JSON.stringify([[false, false], [true, false], [false, true]]))
  const dp = T.build(base, [['src', 'sim-src1', 100, 30], ['p', foot, 100, 100, 'S1'], ['h', LAMP, 100, 240, 'H1']], [['src', 'a', 'p', 't0'], ['p', 't1', 'h', 't0'], ['h', 't1', 'src', 'b']])
  const gp = rig(dp)
  const pid = dp.symbols.find((v: any) => v.label === 'S1').id
  check('pédale (NO) : manœuvrable, la lampe suit', [gp.on(gp.run(), 'H1'), gp.on(gp.run([pid]), 'H1')], [false, true])
  const db = T.build(base, [['src', 'sim-src1', 100, 30], ['b', brake, 100, 100, 'Y1']], [['src', 'a', 'b', 't0'], ['b', 't1', 'src', 'b']])
  check('frein magnétique : alimenté entre ses deux bornes', rig(db).on(rig(db).run(), 'Y1'), true)
  const dc = T.build(base, [['src', 'sim-src1', 100, 30], ['c', conn, 100, 100, 'X1'], ['h', LAMP, 100, 240, 'H1']], [['src', 'a', 'c', 't0'], ['c', 't1', 'h', 't0'], ['h', 't1', 'src', 'b']])
  check('connecteur à ressort : toutes les bornes sont reliées', rig(dc).on(rig(dc).run(), 'H1'), true)
  const ds = T.build(base, [['src', 'sim-src1', 100, 30], ['c', sens, 100, 100, 'B1'], ['h', LAMP, 100, 240, 'H1']], [['src', 'a', 'c', 't0'], ['c', 't1', 'h', 't0'], ['h', 't1', 'src', 'b']])
  const gs = rig(ds), bid = ds.symbols.find((v: any) => v.label === 'B1').id
  check('capteur inductif NO : actionné en simulation, la lampe s’allume', [gs.on(gs.run(), 'H1'), gs.on(gs.run([bid], [bid]), 'H1')], [false, true])
}
// ── moteur à 6 bornes : étoile, triangle, enroulements non couplés ; sélecteur à 3 sorties ; capteur M12 ; relais statique
{
  const mot = lib.symbols.find((s: any) => /induction_motor_6_terminals$/.test(s.id))
  const lab = (l: string) => mot.ports.find((p: any) => p.label === l)?.id
  check('moteur 6 bornes : bornes repérées U1 V1 W1 U2 V2 W2', ['U1', 'V1', 'W1', 'U2', 'V2', 'W2'].every((l) => !!lab(l)), true)
  const mk = (links: any[], volts = 230) => {
    const d = T.build(base, [['src', 'sim-src3', 100, 30], ['x', mot.id, 100, 120, 'M1']], [['src', 'a', 'x', lab('U1')], ['src', 'b', 'x', lab('V1')], ['src', 'c', 'x', lab('W1')], ...links])
    d.symbols.find((v: any) => v.label === 'M1').volts = volts
    const r = simulate(d, SYMBOL_MAP, {}, { pressed: new Set(), toggled: new Set() }, 1_000_000)
    const id = d.symbols.find((v: any) => v.label === 'M1').id
    return { on: r.energized.has(id), v: r.volts[id], bad: !!r.badVoltage[id] }
  }
  const star = mk([['x', lab('U2'), 'x', lab('V2')], ['x', lab('V2'), 'x', lab('W2')]])
  check('moteur 230/400 V en étoile sur 400 V : alimenté sous 231 V, sans alerte', [star.on, Math.round(star.v ?? 0), star.bad], [true, 231, false])
  const delta = mk([['x', lab('U1'), 'x', lab('W2')], ['x', lab('V1'), 'x', lab('U2')], ['x', lab('W1'), 'x', lab('V2')]])
  check('moteur 230/400 V en triangle sur 400 V : alimenté mais surtension signalée', [delta.on, Math.round(delta.v ?? 0), delta.bad], [true, 400, true])
  check('moteur 6 bornes sans couplage : non alimenté', mk([]).on, false)
  check('moteur 6 bornes à moitié couplé (deux enroulements seulement) : non alimenté', mk([['x', lab('U2'), 'x', lab('V2')]]).on, false)
  const sel4 = lib.symbols.find((s: any) => /020_switch_3_contacts$/.test(s.id))
  const LAMP = 'qet:10_electric/10_allpole/380_signaling_operating/11_optical_signaling/lampe2'
  const outs = sel4.sim.sel.outs
  const ds = T.build(base, [['src', 'sim-src1', 100, 30], ['x', sel4.id, 100, 100, 'S1'], ['h1', LAMP, 100, 240, 'H1'], ['h2', LAMP, 220, 240, 'H2'], ['h3', LAMP, 340, 240, 'H3']],
    [['src', 'a', 'x', sel4.sim.sel.com], ['x', outs[0], 'h1', 't0'], ['x', outs[1], 'h2', 't0'], ['x', outs[2], 'h3', 't0'], ['h1', 't1', 'src', 'b'], ['h2', 't1', 'src', 'b'], ['h3', 't1', 'src', 'b']])
  const gs = rig(ds), sid = ds.symbols.find((v: any) => v.label === 'S1').id
  const st = (t: string[]) => { const r = gs.run([], t, 100); return ['H1', 'H2', 'H3'].map((l) => gs.on(r, l)) }
  check('sélecteur à 3 sorties : positions 1, 2, 3', JSON.stringify([st([]), st([sid]), st([sid + ':2'])]), JSON.stringify([[true, false, false], [false, true, false], [false, false, true]]))
  const snr = lib.symbols.find((s: any) => /inductive_sensor_no_3p_cable$/.test(s.id))
  const l1 = snr.ports.find((p: any) => p.label === '1').id, l4 = snr.ports.find((p: any) => p.label === '4').id
  const dn = T.build(base, [['src', 'sim-src1', 100, 30], ['b', snr.id, 100, 100, 'B1'], ['h', LAMP, 100, 240, 'H1']], [['src', 'a', 'b', l1], ['b', l4, 'h', 't0'], ['h', 't1', 'src', 'b']])
  const gn = rig(dn), bid = dn.symbols.find((v: any) => v.label === 'B1').id
  check('capteur inductif 3 fils NO : lampe allumée seulement quand il détecte', [gn.on(gn.run(), 'H1'), gn.on(gn.run([bid], [bid]), 'H1')], [false, true])
  const ssr = lib.symbols.find((s: any) => /relais_statique$/.test(s.id))
  const dr = T.build(base, [['src', 'sim-src1', 100, 30], ['s', 'qet:10_electric/10_allpole/380_signaling_operating/21_selector_switches/010_switch_1pos', 100, 100, 'S1'], ['x', ssr.id, 100, 200, 'K1'], ['h', LAMP, 300, 240, 'H1']],
    [['src', 'a', 's', 't0'], ['s', 't1', 'x', ssr.sim.input[0]], ['x', ssr.sim.input[1], 'src', 'b'], ['src', 'a', 'x', ssr.sim.poles[0][0]], ['x', ssr.sim.poles[0][1], 'h', 't0'], ['h', 't1', 'src', 'b']])
  const gr = rig(dr), s1 = dr.symbols.find((v: any) => v.label === 'S1').id
  const a0 = gr.on(gr.run([], [], 50), 'H1'), a1 = (() => { gr.run([], [s1], 50); return gr.on(gr.run([], [s1], 200), 'H1') })()
  check('relais statique : la sortie suit l’entrée commandée par un interrupteur', [a0, a1], [false, true])
}
// ── sens de rotation d'un moteur : l'inverseur de sens change l'ordre des phases
{
  const d = T.reversingStarter(base), g = rig(d)
  const M = g.idOf('M1')
  const dirOf = (press: string[]) => { g.run(press.map((l) => g.idOf(l)), [], 100); const r = g.run(press.map((l) => g.idOf(l)), [], 600); return r.rotation[M] }
  const fwd = dirOf(['S2'])
  g.run([g.idOf('S1')], [], 100); g.run([], [], 100)
  const rev = dirOf(['S3'])
  check('inverseur de sens : KM1 et KM2 donnent des sens de rotation opposés', [fwd !== undefined, rev !== undefined, fwd === -rev], [true, true, true])
  const r0 = g.run([g.idOf('S1')], [], 100)
  check('moteur à l’arrêt : pas de sens de rotation', r0.rotation[M], undefined)
}
// ── protections : un court-circuit fait fondre le fusible, une surcharge soutenue le fait aussi, un disjoncteur se réarme
{
  const FUSE = 'qet:10_electric/10_allpole/200_fuses_protective_gears/10_fuses/pojistka1p'
  const { simulate } = await import(ROOT + '/src/sim/engine.ts')
  const mk = (extra: any[], wires: any[], rated: any) => {
    const d = T.build(base, [['src', 'sim-src1', 100, 30], ['f', FUSE, 100, 120, 'F1'], ...extra], [['src', 'a', 'f', 't0'], ...wires])
    const f = d.symbols.find((v: any) => v.label === 'F1'); f.rated = rated
    return { d, fid: f.id }
  }
  // court-circuit : sortie du fusible reliée au neutre
  const sc = mk([], [['f', 't1', 'src', 'b']], { in: 10 })
  let r = simulate(sc.d, SYMBOL_MAP, {}, { pressed: new Set(), toggled: new Set(), cut: new Set() }, 1000)
  check('court-circuit : le fusible fond', r.tripped.has(sc.fid), true)
  check('court-circuit : plus de court-circuit après la fusion', r.shorts.length, 0)
  // surcharge : une lampe de 100 W sur un fusible de 0,2 A
  const L = 'qet:10_electric/10_allpole/380_signaling_operating/11_optical_signaling/lampe2'
  const ov = mk([['h', L, 100, 240, 'H1']], [['f', 't1', 'h', 't0'], ['h', 't1', 'src', 'b']], { in: 0.2 })
  ov.d.symbols.find((v: any) => v.label === 'H1').rated = { watts: 100 }
  const inp = { pressed: new Set<string>(), toggled: new Set<string>(), cut: new Set<string>() }
  r = simulate(ov.d, SYMBOL_MAP, {}, inp, 1000)
  check('surcharge : pas de fusion immédiate', r.tripped.has(ov.fid), false)
  r = simulate(ov.d, SYMBOL_MAP, r.state, inp, 1000 + 60000)
  check('surcharge soutenue : le fusible fond', r.tripped.has(ov.fid), true)
  const mem = { ...r.state }; delete mem['§TRIP:' + ov.fid]
  r = simulate(ov.d, SYMBOL_MAP, mem, inp, 1000 + 60100)
  check('fusible remplacé : le circuit est de nouveau alimenté', r.energized.size > 0 && !r.tripped.has(ov.fid), true)
}
// ── bouton poussoir et commutateur à tête tournante à deux contacts (NO + NF, 2 NO, 2 NF) commandés ensemble
{
  const LAMP = 'qet:10_electric/10_allpole/380_signaling_operating/11_optical_signaling/lampe2'
  const pbId = (t: string) => `own:elec/20_push_buttons/${t}`, rotId = (t: string) => `own:elec/21_selector_switches/${t}`
  const all = ['poussoir_2no', 'poussoir_2nf', 'poussoir_no_nf'].map(pbId).concat(['commutateur_2no', 'commutateur_2nf', 'commutateur_no_nf'].map(rotId))
  check('contacts multiples : 6 symboles présents', all.every((i) => !!SYMBOL_MAP[i]), true)
  // la lampe H1 sur le pôle 1 (t0-t1), H2 sur le pôle 2 (t2-t3), alimentées en parallèle
  const run = (id: string, act: boolean) => {
    const d = T.build(base, [['src', 'sim-src1', 100, 30], ['x', id, 100, 100, 'S1'], ['h1', LAMP, 100, 240, 'H1'], ['h2', LAMP, 260, 240, 'H2']],
      [['src', 'a', 'x', 't0'], ['src', 'a', 'x', 't2'], ['x', 't1', 'h1', 't0'], ['x', 't3', 'h2', 't0'], ['h1', 't1', 'src', 'b'], ['h2', 't1', 'src', 'b']])
    const g = rig(d)
    const x = d.symbols.find((v: any) => v.label === 'S1').id
    const push = SYMBOL_MAP[id].sim.ctl === 'momentary'
    const r = act ? (push ? g.run([x]) : g.run([], [x])) : g.run()
    return [g.on(r, 'H1'), g.on(r, 'H2')]
  }
  const want: Record<string, boolean[][]> = { poussoir_2no: [[false, false], [true, true]], poussoir_2nf: [[true, true], [false, false]], poussoir_no_nf: [[false, true], [true, false]] }
  for (const [t, w] of Object.entries(want)) {
    check(`poussoir ${t} : repos puis appuyé`, [run(pbId(t), false), run(pbId(t), true)], w)
    check(`commutateur ${t.replace('poussoir', 'commutateur')} : position 0 puis 1`, [run(rotId(t.replace('poussoir', 'commutateur')), false), run(rotId(t.replace('poussoir', 'commutateur')), true)], w)
  }
  // commutateur verrouillable 1-0-2 : le NO se ferme en position 1, le NF s'ouvre en position 2, rien n'est actionné au centre
  {
    const id = rotId('commutateur_3pos_no_nf')
    const d = T.build(base, [['src', 'sim-src1', 100, 30], ['x', id, 100, 100, 'S1'], ['h1', LAMP, 100, 240, 'H1'], ['h2', LAMP, 260, 240, 'H2']],
      [['src', 'a', 'x', 't0'], ['src', 'a', 'x', 't2'], ['x', 't1', 'h1', 't0'], ['x', 't3', 'h2', 't0'], ['h1', 't1', 'src', 'b'], ['h2', 't1', 'src', 'b']])
    const g = rig(d), x = d.symbols.find((v: any) => v.label === 'S1').id
    const st = (t: string[]) => { const r = g.run([], t); return [g.on(r, 'H1'), g.on(r, 'H2')] }
    check('commutateur 3 positions 1 NO + 1 NF : centre, position 1, position 2', [st([]), st([x]), st([x + ':2'])], [[false, true], [true, true], [false, false]])
  }
  const terms = effectiveTerms([{ id: 'a', defId: pbId('poussoir_no_nf'), x: 0, y: 0, rot: 0 } as any], SYMBOL_MAP).a
  check('poussoir 1 NO + 1 NF : bornes 13-14 et 21-22', [terms.t0, terms.t1, terms.t2, terms.t3], ['13', '14', '21', '22'])
}
console.log(fails ? `\n${fails} ÉCHEC(S)` : '\ntous les tests passent')
process.exit(fails ? 1 : 0)
