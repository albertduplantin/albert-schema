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
const num = (s: string | undefined) => { const m = /(\d+(?:,\d+)?)/.exec(s ?? ''); return m ? Number(m[1].replace(',', '.')) : 0 }

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
// ── charge du moteur en N·m : pression = frottement + couple × 20π / cylindrée ; le couple et la puissance affichés suivent
{
  const d = tp1()
  const g = rig(d)
  const m = g.id('M2'), v = g.id('1V1'), gauge = g.id('M1')
  d.symbols.find((s: any) => s.id === g.id('LP')).rated = { set: 200 }
  d.symbols.find((s: any) => s.id === m).rated = { disp: 100, torque: 50 }
  let r = g.run([v], 0); r = g.run([v], 2500)
  near('moteur chargé à 50 N·m (100 cm³) : pression ≈ 2 + 31,4 + 13 bar', num(r.fluidInfo[gauge]), 46.4, 4)
  const info = r.fluidInfo[m]
  near('moteur chargé : le couple affiché vaut la charge (50 N·m)', Number(/C = (\d+(?:,\d+)?) N·m/.exec(info)?.[1].replace(',', '.')), 50, 1.5)
  d.symbols.find((s: any) => s.id === m).rated = { disp: 100, torque: 120 }
  r = g.run([v], 200); r = g.run([v], 2500)
  near('moteur chargé à 120 N·m : pression ≈ 2 + 75 + 13 bar', num(r.fluidInfo[gauge]), 90.5, 5)
  // 200 N·m dépasse le tarage (200 bar fixé ci-dessus → 127 bar nécessaires reste sous le tarage) : on abaisse le tarage à 100 bar, le moteur cale
  d.symbols.find((s: any) => s.id === g.id('LP')).rated = { set: 100 }
  d.symbols.find((s: any) => s.id === m).rated = { disp: 100, torque: 200 }
  r = g.run([v], 200); r = g.run([v], 2500)
  check('moteur trop chargé (127 bar nécessaires, tarage 100) : il cale, le limiteur évacue tout le débit', [(r.motorRpm[m] ?? 0) < 1, /ouvert/.test(r.fluidInfo[g.id('LP')])], [true, true])
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
// ── pompe Load Sensing : la pression de la pompe suit la charge (+ 15 bar), au repos elle ne débite presque pas
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
  near('Load Sensing : la pression de pompe vaut la pression de charge + 15 bar environ', num(r.fluidInfo[g.id('M1')]), 40 + 12.5 + 15, 15)
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
  // circulation de l'huile : débit dans chaque conducteur
  const wire = (a: string, ap: string, b: string, bp: string) => d.wires.find((w: any) => w.from.symId === g.id(a) && w.from.portId === ap && w.to.symId === g.id(b) && w.to.portId === bp)?.id
  const wf = (a: string, ap: string, b: string, bp: string) => r.oilWire[wire(a, ap, b, bp)] ?? 0
  near('circulation : la pompe refoule ≈ 26 L/min vers le distributeur', wf('GMP', 'o', '1V1', 'p'), 26, 2)
  near('circulation : rien ne passe vers le limiteur de pression (fermé)', wf('GMP', 'o', 'LP', 'p'), 0, 0.5)
  near('circulation : l’huile arrive au moteur par le côté B', wf('1V1', 'b', 'LB', 'a'), 26, 2)
  near('circulation : et repart par le côté A (sens inverse du fil)', wf('LA', 'b', 'M2', 'a'), -26, 2)
  check('limiteur de débit : l’aiguille monte quand il devient passant', (r.needle[g.id('LB')] ?? 0) > 0.5, true)
  // tachymètre posé sur le moteur
  const { defaultInstrument, readSpeed, JAW } = await import(ROOT + '/src/instruments.ts')
  const mot = d.symbols.find((s: any) => s.id === m)
  const md = SYMBOL_MAP[mot.defId]
  const tacho = defaultInstrument('tacho', 'digital', 0, 0)
  tacho.x = mot.x + md.w / 2 - JAW.x
  tacho.y = mot.y + md.h / 2 - JAW.y
  const reading = readSpeed(tacho, d.symbols, SYMBOL_MAP, r)
  check('tachymètre : lit la vitesse du moteur hydraulique', [reading.found, Math.abs(reading.rpm - r.motorRpm[m]) < 0.01], [true, true])
  tacho.x += 300
  check('tachymètre : loin du moteur, il ne lit rien', readSpeed(tacho, d.symbols, SYMBOL_MAP, r).found, false)
  // réglage des limiteurs de débit
  for (const id of [g.id('LA'), g.id('LB')]) d.symbols.find((s: any) => s.id === id).rated = { open: 10 }
  r = g.run([v], 200); r = g.run([v], 2000)
  check('réglage : limiteur presque fermé, le moteur ralentit et l’aiguille retombe', [r.motorRpm[m] < 200, (r.needle[g.id('LB')] ?? 1) < 0.9], [true, true])
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
  // charge sur la tige : effort affiché = pression fond × section fond − pression tige × section annulaire ; au-delà de la force du limiteur, la tige cale
  const cylInfo = r.fluidInfo[c]
  check('vérin : l’effort s’affiche en daN', /F = -?\d+ daN/.test(cylInfo), true)
  const dd = T.hydraulicCylinder(base)
  const gg = rig(dd)
  const cc = gg.id('1A')
  dd.symbols.find((s: any) => s.id === gg.id('LB')).rated = { open: 100 }
  dd.symbols.find((s: any) => s.id === gg.id('LA')).rated = { open: 100 }
  dd.symbols.find((s: any) => s.id === cc).rated = { bore: 50, rod: 30, stroke: 350, load: 2500 }
  let r2 = gg.run([gg.id('1V1') + ':B'], 0); r2 = gg.run([gg.id('1V1') + ':B'], 3000)
  check('vérin : 2500 daN sur la tige (50 mm, 100 bar) dépassent la force du limiteur : la tige ne sort pas', r2.cylPos[cc] < 0.05, true)
  dd.symbols.find((s: any) => s.id === cc).rated = { bore: 50, rod: 30, stroke: 350, load: 1000 }
  r2 = gg.run([gg.id('1V1') + ':B'], 200); r2 = gg.run([gg.id('1V1') + ':B'], 3000)
  check('vérin : 1000 daN (≈ 51 bar) : la tige sort', r2.cylPos[cc] > 0.9, true)
}

// ── TP5 à TP9 du banc : valeurs du corrigé
{
  const info = (r: any, g: any, l: string) => num(r.fluidInfo[g.id(l)])
  const play = (doc: any, key: string, ms = 2500) => { const g = rig(doc); g.run([], 0); g.run([], 1500); const id = g.id(key.split(':')[0]) + (key.includes(':') ? ':B' : ''); g.run([id], 100); return { g, r: g.run([id], ms) } }
  const d5 = T.hydraulicTP5(base)
  let t = play(d5, '1V1')
  near('TP5 : moteur croisé ≈ 300 tr/min (limiteur B)', t.r.motorRpm[t.g.id('M2')], 300, 25)
  t = play(d5, '1V1:B')
  near('TP5 : moteur parallèle ≈ 200 tr/min (limiteur A)', t.r.motorRpm[t.g.id('M2')], 200, 25)
  t = play(d5, '1V2', 6000)
  near('TP5 : vérin en butée côté tige : la pression monte au limiteur secondaire B (40 bar)', info(t.r, t.g, 'G5'), 40, 5)
  t = play(d5, '1V2:B', 6000)
  near('TP5 : vérin en butée côté fond : la pression monte au limiteur secondaire A (80 bar)', info(t.r, t.g, 'G4'), 80, 5)
  { // moteur et vérin ensemble : le vérin en butée limite la pression à son secondaire, le ΔP des limiteurs du moteur baisse, le moteur ralentit
    const g = rig(d5); g.run([], 0); g.run([], 1500)
    const both = [g.id('1V1') + ':B', g.id('1V2') + ':B']
    g.run(both, 100)
    const r = g.run(both, 7000)
    check('TP5 : en butée, le moteur tourne moins vite qu’en travaillant seul (≈ 200 tr/min)', r.motorRpm[g.id('M2')] < 195, true)
    near('TP5 : la pression de pompe est celle du limiteur secondaire du vérin (≈ 80 bar)', info(r, g, 'G3'), 80, 6)
  }
  const d6 = T.hydraulicTP6(base)
  t = play(d6, '1V2:B', 6000)
  near('TP6 : réducteur : la pression du vérin reste à 50 bar en butée', info(t.r, t.g, 'G4'), 50, 3)
  t = play(d6, '1V1')
  near('TP6 : le moteur garde sa vitesse (≈ 300 tr/min) pendant que le vérin est réduit', t.r.motorRpm[t.g.id('M2')], 300, 25)
  t = play(d6, '1V2:B', 6000)
  check('TP6 : la flèche du réducteur se décale quand il se referme (50 bar atteints)', t.r.needle[t.g.id('RP')], 1)
  t = play(d6, '1V2:B', 300)
  check('TP6 : et reste dans l’axe (ouvert) tant que le vérin avance librement sous le tarage', t.r.needle[t.g.id('RP')], 0)
  const d7 = T.hydraulicTP7(base)
  t = play(d7, '1V1:B', 6000)
  near('TP7 : clapets croisés : pression côté fond au limiteur de pression (≈ 100 bar)', info(t.r, t.g, 'G1'), 100, 8)
  { const g = rig(d7); g.run([], 0); const r = g.run([], 3000); check('TP7 : au centre du distributeur le vérin reste immobile', info(r, g, 'G1') + info(r, g, 'G2') < 8, true) }
  const d8 = T.hydraulicTP8(base)
  { const g = rig(d8); g.run([], 0); const r = g.run([], 1500)
    near('TP8 : au repos la pompe garde sa pression de régulation (≈ 100 bar)', info(r, g, 'G3'), 100, 6)
    check('TP8 : au repos la pompe ne débite presque rien', num(r.fluidInfo[g.id('GMP')]) < 2, true) }
  t = play(d8, '1V1')
  near('TP8 : en charge la pompe ne fournit que le débit du moteur (≈ 15 L/min)', num(t.r.fluidInfo[t.g.id('GMP')]), 15, 3)
  near('TP8 : et reste à la pression de régulation (≈ 100 bar)', info(t.r, t.g, 'G3'), 100, 6)
  const d9 = T.hydraulicTP9(base)
  t = play(d9, '1V1')
  near('TP9 : Load Sensing : pression de pompe = pression de charge + 15 bar', info(t.r, t.g, 'G3') - info(t.r, t.g, 'G2'), 15, 3)
  near('TP9 : vitesse du moteur ≈ 300 tr/min', t.r.motorRpm[t.g.id('M2')], 300, 30)
}

// grille : chaque orifice d'un appareil hydraulique tombe sur un multiple de 10 (sinon les fils sont de travers)
{
  const off = lib.symbols.filter((s: any) => s.domain === 'hydraulic').flatMap((s: any) => s.ports.filter((p: any) => p.x % 10 || p.y % 10).map((p: any) => `${s.id}:${p.id}(${p.x},${p.y})`))
  check('grille : tous les orifices hydrauliques sont sur la grille de 10', off, [])
}

console.log(fails ? `\n${fails} ÉCHEC(S)` : '\ntous les tests hydrauliques passent')
process.exit(fails ? 1 : 0)
