// Hydraulique quantitative : groupe motopompe, limiteur de pression, distributeur 4/3, moteur, vérin, limiteurs de débit : npm test
const ROOT = '..'
const { SYMBOL_MAP, SYMBOLS } = await import(ROOT + '/src/symbols/index.ts')
const T = await import(ROOT + '/src/templates.ts')
const { simulate } = await import(ROOT + '/src/sim/engine.ts')
const lib = (await import('./lib-full.mjs')).loadFull()
for (const s of lib.symbols) { SYMBOLS.push(s); SYMBOL_MAP[s.id] = s }
const base: any = { version: 1, paper: 'A3', title: {}, symbols: [], wires: [] }
let fails = 0
const check = (name: string, got: any, want: any) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log((ok ? 'ok   ' : 'ÉCHEC'), name, ok ? '' : `(obtenu ${JSON.stringify(got)}, attendu ${JSON.stringify(want)})`) }
const near = (name: string, got: number, want: number, tol: number) => { const ok = Math.abs(got - want) <= tol; if (!ok) fails++; console.log((ok ? 'ok   ' : 'ÉCHEC'), name, ok ? `(${got.toFixed(1)})` : `(obtenu ${got.toFixed(2)}, attendu ${want} ± ${tol})`) }

const H = (t: string) => 'own:hyd/' + t
const TANK = lib.symbols.find((s: any) => s.domain === 'hydraulic' && s.fluid?.k === 'fsink')
const TK = TANK.ports[0].id
const rig = (doc: any) => {
  let mem: any = {}, now = 1_000_000
  const run = (pressed: string[] = [], dt = 0) => { now += dt; const r = simulate(doc, SYMBOL_MAP, mem, { pressed: new Set(pressed), toggled: new Set(), cut: new Set() }, now); mem = r.state; return r }
  return { run, id: (label: string) => doc.symbols.find((s: any) => s.label === label)?.id }
}
const num = (s: string | undefined) => Number((s ?? '').replace(/[^0-9,]/g, '').replace(',', '.'))

// ── TP1 : limiteur de pression, moteur hydraulique, distributeur 4/3 (pompe 18 cm³ à 1500 tr/min = 27 L/min)
const tp1 = (centre = 'd43_o') => T.build(base,
  [['tank', TANK.id, 240, 300], ['pump', H('groupe_pompe_fixe'), 160, 220, 'GMP'], ['rv', H('limiteur_pression'), 260, 200, 'LP'], ['gp', H('manometre'), 100, 150, 'M1'],
    ['v', H(centre), 200, 100, '1V1'], ['m', H('moteur_hydraulique'), 200, 20, 'M2'], ['tank2', TANK.id, 320, 140]],
  [['pump', 'i', 'tank', TK], ['pump', 'o', 'rv', 'p'], ['pump', 'o', 'v', 'p'], ['pump', 'o', 'gp', 'a'], ['rv', 't', 'tank2', TK], ['v', 't', 'tank2', TK], ['v', 'a', 'm', 'a'], ['v', 'b', 'm', 'b']])
{
  const d = tp1()
  const g = rig(d)
  const gauge = g.id('M1'), motor = g.id('M2'), relief = g.id('LP'), pump = g.id('GMP')
  d.symbols.find((s: any) => s.id === relief).rated = { set: 100 }
  let r = g.run([], 0); r = g.run([], 3000)
  near('pompe : débit 27 L/min corrigé des fuites (18 cm³, 1500 tr/min)', num(r.fluidInfo[pump]), 25.1, 1.5)
  near('distributeur au repos (centre fermé) : la pression monte au tarage du limiteur (100 bar)', num(r.fluidInfo[gauge]), 103, 4)
  check('distributeur au repos : le limiteur est ouvert', /ouvert/.test(r.fluidInfo[relief]), true)
  check('distributeur au repos : le moteur est arrêté', (r.motorRpm[motor] ?? 0) < 0.5, true)
  const v = g.id('1V1')
  r = g.run([v], 200); r = g.run([v], 3000)
  near('position croisée, charge faible : pression = charge + débit / k (≈ 17 bar)', num(r.fluidInfo[gauge]), 17.5, 3)
  near('position croisée : vitesse du moteur (26,6 L/min, 100 cm³) ≈ 266 tr/min', r.motorRpm[motor], 266, 8)
  check('position croisée : le limiteur reste fermé', r.fluidInfo[relief], 'fermé')
  d.symbols.find((s: any) => s.id === motor).rated = { load: 50 }
  r = g.run([v], 200); r = g.run([v], 3000)
  near('charge 50 bar : pression ≈ 62 bar', num(r.fluidInfo[gauge]), 62.5, 4)
  near('charge 50 bar : la vitesse change à peine (débit imposé par la pompe)', r.motorRpm[motor], 258, 8)
  d.symbols.find((s: any) => s.id === motor).rated = { load: 95 }
  r = g.run([v], 200); r = g.run([v], 3000)
  check('charge 95 bar : le limiteur s’ouvre et le moteur ralentit', [/ouvert/.test(r.fluidInfo[relief]), r.motorRpm[motor] < 200], [true, true])
}
// centres : H et M (tandem) déchargent la pompe, Y et fermé laissent monter la pression
for (const [tail, low] of [['d43_o', false], ['d43_h', true], ['d43_m', true], ['d43_y', false]] as const) {
  const d = tp1(tail)
  const g = rig(d)
  let r = g.run([], 0); r = g.run([], 3000)
  check(`4/3 ${tail} au repos : ${low ? 'la pompe débite à la bâche (pression basse)' : 'la pompe est bloquée (pression au tarage)'}`, num(r.fluidInfo[g.id('M1')]) < 15, low)
}
// les distributeurs hydrauliques sont nombreux, dessinés et simulables
const valves = lib.symbols.filter((s: any) => s.domain === 'hydraulic' && s.fluid?.k === 'valve' && !s.legacy)
check('distributeurs hydrauliques : au moins 15 symboles', valves.length >= 15, true)
check('distributeurs hydrauliques : chacun a un dessin', valves.every((s: any) => s.svg && s.svg.length > 100), true)

// ── TP2 : limiteurs de débit unidirectionnels à l'admission : la vitesse du moteur suit l'ouverture
{
  const d = T.build(base,
    [['tank', TANK.id, 240, 300], ['pump', H('groupe_pompe_fixe'), 160, 220, 'GMP'], ['rv', H('limiteur_pression'), 260, 200, 'LP'],
      ['v', H('d43_o'), 200, 100, '1V1'], ['la', H('limiteur_debit_uni'), 120, 60, 'LA'], ['lb', H('limiteur_debit_uni_inverse'), 280, 60, 'LB'],
      ['m', H('moteur_hydraulique'), 200, 20, 'M2'], ['tank2', TANK.id, 320, 140]],
    [['pump', 'i', 'tank', TK], ['pump', 'o', 'rv', 'p'], ['pump', 'o', 'v', 'p'], ['rv', 't', 'tank2', TK], ['v', 't', 'tank2', TK],
      ['v', 'a', 'la', 'a'], ['la', 'b', 'm', 'a'], ['v', 'b', 'lb', 'a'], ['lb', 'b', 'm', 'b']])
  const g = rig(d)
  const m = g.id('M2'), v = g.id('1V1'), la = g.id('LA'), lb = g.id('LB')
  for (const id of [la, lb]) d.symbols.find((s: any) => s.id === id).rated = { open: 15 }
  let r = g.run([v], 0); r = g.run([v], 3000)
  const slow = r.motorRpm[m]
  for (const id of [la, lb]) d.symbols.find((s: any) => s.id === id).rated = { open: 80 }
  r = g.run([v], 200); r = g.run([v], 3000)
  check('limiteurs de débit : plus ils sont ouverts, plus le moteur tourne vite', r.motorRpm[m] > slow, true)
  check('limiteurs de débit : étranglés, le débit en excès passe par le limiteur de pression', slow < 200, true)
}

// ── distributeur 4/3 à levier : un clic maintenu sur le levier de gauche ou de droite
{
  const d = tp1('d43_levier_o')
  const g = rig(d)
  const v = g.id('1V1'), m = g.id('M2')
  let r = g.run([], 0); r = g.run([], 1500)
  check('4/3 à levier : au repos (centre fermé) le moteur est arrêté', (r.motorRpm[m] ?? 0) < 0.5, true)
  r = g.run([v], 100); r = g.run([v], 1500)
  const left = r.motorRpm[m]
  r = g.run([v + ':B'], 100); r = g.run([v + ':B'], 1500)
  check('4/3 à levier : levier à gauche et à droite font tourner le moteur dans les deux sens', [left > 100, r.motorRpm[m] > 100, r.fluidMotor[m] !== 0], [true, true, true])
  r = g.run([], 100); r = g.run([], 1500)
  check('4/3 à levier : relâché, le levier revient au centre (ressorts) et le moteur s’arrête', (r.motorRpm[m] ?? 0) < 0.5, true)
}
// ── distributeur proportionnel : la position du joystick règle la vitesse
{
  const d = tp1('d43_prop')
  const g = rig(d)
  const v = d.symbols.find((s: any) => s.label === '1V1'), m = g.id('M2')
  v.rated = { joy: 100 }
  let r = g.run([], 0); r = g.run([], 1500)
  const fast = r.motorRpm[m]
  v.rated = { joy: 15 }
  r = g.run([], 100); r = g.run([], 1500)
  const slow = r.motorRpm[m]
  v.rated = { joy: 0 }
  r = g.run([], 100); r = g.run([], 1500)
  check('proportionnel : joystick à fond → vitesse maximale ; peu incliné → plus lent ; au centre → arrêt', [fast > slow * 1.5, slow > 5, (r.motorRpm[m] ?? 0) < 0.5], [true, true, true])
  v.rated = { joy: -100 }
  r = g.run([], 100); r = g.run([], 1500)
  check('proportionnel : joystick de l’autre côté → moteur dans l’autre sens', r.fluidMotor[m] !== 0 && r.motorRpm[m] > 100, true)
}
// ── pompe Load Sensing : la pression de la pompe suit la charge (+ 14 bar), au repos elle ne débite presque pas
{
  const d = T.build(base,
    [['tank', TANK.id, 240, 300], ['pump', H('groupe_pompe_ls'), 160, 220, 'GMP'], ['gp', H('manometre'), 100, 150, 'M1'],
      ['v', H('d43_o'), 200, 100, '1V1'], ['m', H('moteur_hydraulique'), 200, 20, 'M2'], ['tank2', TANK.id, 320, 140]],
    [['pump', 'i', 'tank', TK], ['pump', 'o', 'v', 'p'], ['pump', 'o', 'gp', 'a'], ['v', 't', 'tank2', TK], ['v', 'a', 'm', 'a'], ['v', 'b', 'm', 'b'], ['v', 'b', 'pump', 'x']])
  const g = rig(d)
  const v = g.id('1V1'), m = g.id('M2'), pump = g.id('GMP')
  d.symbols.find((s: any) => s.id === m).rated = { load: 40 }
  let r = g.run([], 0); r = g.run([], 1500)
  check('Load Sensing : au repos la pompe débite à peine (régulation de pression)', num(r.fluidInfo[pump]) < 3, true)
  r = g.run([v], 100); r = g.run([v], 1500)
  near('Load Sensing : la pression de pompe vaut la pression de charge + 14 bar environ', num(r.fluidInfo[g.id('M1')]), 40 + 12.5 + 14, 14)
}
// ── exemples du banc : moteur et vérin
{
  const d = T.hydraulicMotor(base)
  const g = rig(d)
  const v = g.id('1V1'), m = g.id('M2')
  let r = g.run([], 0); r = g.run([], 2000)
  check('exemple moteur : au repos le moteur est arrêté', (r.motorRpm[m] ?? 0) < 0.5, true)
  r = g.run([v], 100); r = g.run([v], 2000)
  check('exemple moteur : un clic sur l’électrovanne fait tourner le moteur', r.motorRpm[m] > 20, true)
  check('exemple moteur : les trois manomètres affichent des bar', ['G1', 'G2', 'G3'].every((l) => /bar/.test(r.fluidInfo[g.id(l)] ?? '')), true)
}
{
  const d = T.hydraulicCylinder(base)
  const g = rig(d)
  const v = g.id('1V1'), c = g.id('1A')
  d.symbols.find((s: any) => s.id === g.id('LB')).rated = { open: 5 }
  let r = g.run([], 0); r = g.run([], 500)
  check('exemple vérin : au repos la tige ne bouge pas', r.cylPos[c], 0)
  // côté B du distributeur (position parallèle : P→A fond, B→T tige) : sortie, l'échappement de la tige passe par le limiteur LB
  r = g.run([v + ':B'], 100); r = g.run([v + ':B'], 600)
  const mid = r.cylPos[c]
  check('exemple vérin : la tige sort sous la pression du fond', mid > 0 && mid < 1, true)
  const gp = num(r.fluidInfo[g.id('G3')]), gtige = num(r.fluidInfo[g.id('G2')])
  check('limiteur à l’échappement : effet multiplicateur, la pression côté tige dépasse celle de la pompe', gtige > gp, true)
  const slow = r.cylV ?? null
  void slow
}

console.log(fails ? `\n${fails} ÉCHEC(S)` : '\ntous les tests hydrauliques passent')
process.exit(fails ? 1 : 0)
