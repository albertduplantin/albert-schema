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
console.log(fails ? `\n${fails} ÉCHEC(S)` : '\ntous les tests passent')
process.exit(fails ? 1 : 0)
