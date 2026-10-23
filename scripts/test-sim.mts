// Tests du moteur de simulation : npm test
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
  for (const ex of EXERCISES) {
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
console.log(fails ? `\n${fails} ÉCHEC(S)` : '\ntous les tests passent')
process.exit(fails ? 1 : 0)
