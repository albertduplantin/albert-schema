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
console.log(fails ? `\n${fails} ÉCHEC(S)` : '\ntous les tests passent')
process.exit(fails ? 1 : 0)
