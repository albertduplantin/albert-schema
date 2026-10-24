import type { Doc, PlacedSymbol } from './types'
import { build, type Link, type Spec } from './templates'
import { checkDoc } from './check'
import { EXERCISES, runSteps } from './exercises'
import { DEFAULT_DELAY_S } from './sim/engine'
import { basePot, sourcePots } from './sim/potentials'
import { termsWithTopology } from './transformer'
import { ALIASES, allWired, count, L, netOf, passes, scenario, syms, type Ctx, type GExercise, type GStep, type SimStep } from './guided'

/** Exercices guidés. Les étapes se cochent toutes seules d'après le schéma de l'élève ; le dernier jeu d'étapes rejoue un scénario. */

const Q = (p: string) => 'qet:10_electric/10_allpole/' + p
const PB = Q('380_signaling_operating/20_push_buttons/poussoir')
const PBN = Q('380_signaling_operating/20_push_buttons/poussoir_nf')
const SW = Q('380_signaling_operating/21_selector_switches/010_switch_1pos')
const LAMP = Q('380_signaling_operating/11_optical_signaling/lampe2')
const COIL = Q('310_relays_contactors_contacts/01_coils/bobine3')
const TCOIL = Q('310_relays_contactors_contacts/01_coils/bobine_tempo_travail')
const K = Q('310_relays_contactors_contacts/02_contacts_cross_referencing/01_auxiliary_contacts/con_simple')
const KN = Q('310_relays_contactors_contacts/02_contacts_cross_referencing/01_auxiliary_contacts/con_simple_nf')

// ── reconnaissance des composants d'après leur modèle de simulation (l'élève peut choisir un autre symbole équivalent)
type P = (c: Ctx, s: PlacedSymbol) => boolean
const model = (c: Ctx, s: PlacedSymbol) => c.defs[s.defId]?.sim
const power = (s: PlacedSymbol) => /02_power_contacts/.test(s.defId)
const HOT_POTS = new Set(['L', 'L1', 'L2', 'L3', 'LI', '+'])
const COLD_POTS = new Set(['N', 'NI', '-'])
const potsOf = (c: Ctx, s: PlacedSymbol) => { const d = c.defs[s.defId]; return d?.sim?.k === 'source' ? Object.values(sourcePots(s, d)).map(basePot) : [] }
/** Source qui fournit une phase (bloc réglable, repère L, source réseau…). */
const isSource: P = (c, s) => potsOf(c, s).some((p) => HOT_POTS.has(p))
/** Toute source qui fournit un potentiel actif : phase, neutre, + ou − (la terre n'en est pas une). */
const isSupply: P = (c, s) => potsOf(c, s).some((p) => HOT_POTS.has(p) || COLD_POTS.has(p))
/** Alimentation complète : un potentiel « chaud » et un potentiel de retour (un bloc source, ou deux repères L et N). */
const supplyOk = (c: Ctx) => c.doc.symbols.some((s) => isSource(c, s)) && c.doc.symbols.some((s) => potsOf(c, s).some((p) => COLD_POTS.has(p)))
const isNOBtn: P = (c, s) => { const m = model(c, s); return m?.k === 'switch' && m.ctl === 'momentary' && !m.nc }
const isNCBtn: P = (c, s) => { const m = model(c, s); return m?.k === 'switch' && m.ctl === 'momentary' && m.nc }
const isToggle: P = (c, s) => { const m = model(c, s); return m?.k === 'switch' && m.ctl === 'toggle' }
/** Organe de commande manuel : interrupteur ou bouton poussoir à contact travail (NO), quel que soit le symbole choisi. */
const isCtrlSw: P = (c, s) => isToggle(c, s) || isNOBtn(c, s)
const isLamp: P = (c, s) => { const m = model(c, s); return m?.k === 'load' && m.role === 'lamp' }
const isCoil: P = (c, s) => { const m = model(c, s); return m?.k === 'coil' && !m.timer }
const isTimer: P = (c, s) => { const m = model(c, s); return m?.k === 'coil' && !!m.timer }
const isNOk: P = (c, s) => { const m = model(c, s); return m?.k === 'switch' && m.ctl === 'coil' && !m.nc && !power(s) && !m.delay }
const isNCk: P = (c, s) => { const m = model(c, s); return m?.k === 'switch' && m.ctl === 'coil' && m.nc && !power(s) && !m.delay }
const all = (c: Ctx, p: P) => c.doc.symbols.filter((s) => p(c, s))
const has = (c: Ctx, p: P, n = 1) => all(c, p).length >= n
const wired = (c: Ctx, ps: P[]) => ps.every((p) => all(c, p).length > 0) && allWired(c, ps.flatMap((p) => all(c, p)), [])
const sourceWired = (c: Ctx): boolean => {
  const srcs = all(c, isSupply)
  if (!srcs.length) return false
  const used = new Set(c.doc.wires.flatMap((w) => [`${w.from.symId}:${w.from.portId}`, `${w.to.symId}:${w.to.portId}`]))
  return srcs.every((s) => Object.entries(sourcePots(s, c.defs[s.defId])).every(([port, pot]) => basePot(pot) === 'PE' || used.has(`${s.id}:${port}`)))
}

/** Bornes restées sans fil, avec leur numéro tel qu'il est affiché sur le symbole et leur côté : « borne 13 de S1 (en haut) ». */
function unwired(c: Ctx): string[] {
  const used = new Set(c.doc.wires.flatMap((w) => [`${w.from.symId}:${w.from.portId}`, `${w.to.symId}:${w.to.portId}`]))
  const terms = termsWithTopology(c.doc, c.defs)
  const fr = c.lang === 'fr'
  const side = (dir: string) => ({ up: fr ? 'en haut' : 'top', down: fr ? 'en bas' : 'bottom', left: fr ? 'à gauche' : 'left', right: fr ? 'à droite' : 'right' })[dir] ?? ''
  const out: string[] = []
  for (const s of c.doc.symbols) {
    const d = c.defs[s.defId]
    if (!d || d.cat === 'sim' && d.sim?.k !== 'source') continue
    const pots = d.sim?.k === 'source' ? sourcePots(s, d) : {}
    const who = s.label ? `${s.label} (${d.name[c.lang]})` : d.name[c.lang]
    d.ports.forEach((p, idx) => {
      if (used.has(`${s.id}:${p.id}`) || basePot(pots[p.id] ?? '') === 'PE' || (/61_pumps\/pompe_/.test(d.id) && p.dir === 'left')) return
      const num = terms[s.id]?.[p.id] || p.label || (pots[p.id] ? basePot(pots[p.id]).replace(/^([LN])I$/, '$1') : String(idx + 1))
      out.push(`${fr ? 'Aucun fil sur la borne' : 'No wire on terminal'} ${num} (${side(p.dir)}) ${fr ? 'de' : 'of'} ${who}`)
    })
  }
  return out
}
const stepPlace = (id: string, title: L, hint: L, done: GStep['done']): GStep => ({
  id, title, hint, done,
  ...(id === 'wire' || id === 'elec' ? { missing: (c: Ctx) => (c.doc.symbols.length ? unwired(c).slice(0, 8) : []) } : {}),
})
const simStep = (): GStep => ({ id: 'sim', title: L('Passez en mode Simulation', 'Switch to Simulation mode'), hint: L('Bouton « ▶ Simuler » en haut de l’écran. Cliquez ensuite sur les boutons et interrupteurs pour les manœuvrer.', 'Click “▶ Simulate” at the top of the screen. Then click buttons and switches to operate them.'), done: (c) => c.simMode })

const NAMES = new Map<unknown, [string, string]>()
const NAME_LIST: [P, string, string][] = [
  [isNOBtn, 'bouton poussoir NO', 'NO push button'], [isNCBtn, 'bouton poussoir NF', 'NC push button'], [isToggle, 'interrupteur', 'switch'],
  [isCtrlSw, 'interrupteur ou bouton poussoir NO', 'switch or NO push button'], [isLamp, 'lampe', 'lamp'], [isCoil, 'bobine', 'coil'],
  [isTimer, 'bobine temporisée', 'timed coil'], [isNOk, 'contact NO commandé par une bobine', 'coil-driven NO contact'],
  [isNCk, 'contact NF commandé par une bobine', 'coil-driven NC contact'],
]
for (const [p, fr, en] of NAME_LIST) NAMES.set(p, [fr, en])
/** Étape « posez ceci » : se coche quand tout est posé, et dit ce qui manque. `reqs` : [prédicat | 'supply', nombre minimal]. */
const needStep = (id: string, title: L, hint: L, reqs: [P | 'supply', number][]): GStep => ({
  id, title, hint,
  done: (c) => reqs.every(([p, n]) => (p === 'supply' ? supplyOk(c) : has(c, p, n))),
  missing: (c) => reqs.flatMap(([p, n]) => {
    if (p === 'supply') {
      if (supplyOk(c)) return []
      const hot = c.doc.symbols.some((s) => isSource(c, s)), cold = c.doc.symbols.some((s) => potsOf(c, s).some((q) => COLD_POTS.has(q)))
      if (!hot && !cold) return [c.lang === 'fr' ? 'une source : {{src1}}, ou deux repères {{simL}} et {{simN}}' : 'a source: {{src1}}, or an {{simL}} and a {{simN}} marker']
      return [hot ? (c.lang === 'fr' ? 'le retour de la source (neutre N ou −) : utilisez {{src1}}, ou ajoutez {{simN}}' : 'the source return (neutral N or −): use {{src1}}, or add {{simN}}') : (c.lang === 'fr' ? 'la phase de la source (L ou +) : {{simL}}' : 'the source phase (L or +): {{simL}}')]
    }
    const have = all(c, p).length
    const name = NAMES.get(p)?.[c.lang === 'fr' ? 0 : 1] ?? '?'
    return have >= n ? [] : [`${n - have} × ${name}`]
  }),
})

/** Étape finale : le circuit se comporte comme demandé (scénario rejoué dans le simulateur). */
const behaviour = (id: string, title: L, hint: L, steps: import('./exercises').Step[], labels: string[]): GStep => ({
  id, title, hint,
  done: (c) => passes(c, steps, labels),
  // conseils : repères absents, puis les vérifications du scénario qui échouent
  missing: (c) => {
    if (!c.doc.symbols.length) return []
    try {
      const r = runSteps(steps, labels, c.doc, c.defs, c.lang)
      const out = r.missing.map((l) => (c.lang === 'fr' ? 'Repère absent : ' : 'Missing tag: ') + l)
      if (!r.missing.length) for (const st of r.steps.filter((x) => !x.ok).slice(0, 3)) out.push(`${st.text}${st.detail ? ' — ' + st.detail : ''}`)
      return out
    } catch { return [] }
  },
})

Object.assign(ALIASES, {
  src1: 'sim-src1', simL: 'sim-l', simN: 'sim-n', switch: Q('380_signaling_operating/21_selector_switches/010_switch_1pos'),
  pb: Q('380_signaling_operating/20_push_buttons/poussoir'), pbnf: Q('380_signaling_operating/20_push_buttons/poussoir_nf'),
  lamp: Q('380_signaling_operating/11_optical_signaling/lampe2'), coil: Q('310_relays_contactors_contacts/01_coils/bobine3'),
  tcoil: Q('310_relays_contactors_contacts/01_coils/bobine_tempo_travail'),
  k: Q('310_relays_contactors_contacts/02_contacts_cross_referencing/01_auxiliary_contacts/con_simple'),
  knf: Q('310_relays_contactors_contacts/02_contacts_cross_referencing/01_auxiliary_contacts/con_simple_nf'),
  limit: Q('390_sensors_instruments/41_limit_switches/fin_de_course_came_2_no'),
  air: 'qet:50_pneumatic/5010_compressed_air/501010_air_generation/50101000_compressed_air_source',
  sil: 'qet:50_pneumatic/5010_compressed_air/501016_funktion_components/50101610_flow/5010161060_silencer',
  cyl2: 'qet:50_pneumatic/5030_actuators/503010_cylinder_lin/50301011_double_acting/5030101100_double_effet',
  cyl1: 'qet:50_pneumatic/5030_actuators/503010_cylinder_lin/50301010_single_acting/5030101010_simple_effet',
  v52m: 'qet:50_pneumatic/5020_velves/502010_control/50201060_5_2_way/5020106030_man_mech/502010603010_5_2_way',
  v52e: 'qet:50_pneumatic/5020_velves/502010_control/50201060_5_2_way/5020106020_elec/502010602010_5_2_way_010',
  v52b: 'qet:50_pneumatic/5020_velves/502010_control/50201060_5_2_way/5020106020_elec/502010602030_5_2_way_030',
  v32m: 'qet:50_pneumatic/5020_velves/502010_control/50201020_3_2_way/5020102030_man_mech/502010203010_3_2_way',
  tank: 'qet:30_hydraulic/21_tanks/bache_a_l_air_libre', accu: 'qet:30_hydraulic/21_tanks/bache_pressurisee', pump: 'qet:30_hydraulic/61_pumps/pompe_hydr_2',
  valve4: 'qet:30_hydraulic/31_control_valves/13_4-2/distributeur_4-2', hcyl: 'qet:30_hydraulic/51_cylinders/verin-asymetrique-doubl-effet',
  hmot: 'qet:30_hydraulic/61_pumps/moteur_hydr_1', filt: 'qet:30_hydraulic/81_filters/filtre', hvan: 'qet:30_hydraulic/45_valves/vanne_manuelle',
})

const old = (id: string) => EXERCISES.find((e) => e.id === id)!

// ── schémas de référence
const SRC: Spec = ['src', 'sim-src1', 400, 30]
const startStopSpecs = (label = 'KM1'): [Spec[], Link[]] => [
  [SRC, ['s1', PBN, 400, 110, 'S1'], ['s2', PB, 400, 210, 'S2'], ['ka', K, 480, 190, label], ['c', COIL, 390, 320, label]],
  [['src', 'a', 's1', 't0'], ['s1', 't1', 's2', 't0'], ['s1', 't1', 'ka', 't0'], ['s2', 't1', 'c', 't0'], ['ka', 't1', 'c', 't0'], ['c', 't1', 'src', 'b']],
]

const lampSwitch = (base: Doc): Doc =>
  build(base, [SRC, ['s', SW, 400, 110, 'S1'], ['h', LAMP, 400, 220, 'H1']], [['src', 'a', 's', 't0'], ['s', 't1', 'h', 't0'], ['h', 't1', 'src', 'b']])

const startStop = (base: Doc): Doc => { const [s, l] = startStopSpecs(); return build(base, s, l) }

const lamps24 = (base: Doc): Doc => {
  const d = build(base,
    [SRC, ['s1', PBN, 400, 110, 'S1'], ['s2', PB, 400, 210, 'S2'], ['ka', K, 480, 190, 'KM1'], ['c', COIL, 390, 320, 'KM1'],
      ['k2', K, 580, 110, 'KM1'], ['h1', LAMP, 580, 220, 'H1'], ['k3', KN, 680, 110, 'KM1'], ['h2', LAMP, 680, 220, 'H2']],
    [['src', 'a', 's1', 't0'], ['s1', 't1', 's2', 't0'], ['s1', 't1', 'ka', 't0'], ['s2', 't1', 'c', 't0'], ['ka', 't1', 'c', 't0'], ['c', 't1', 'src', 'b'],
      ['src', 'a', 'k2', 't0'], ['k2', 't1', 'h1', 't0'], ['h1', 't1', 'src', 'b'], ['src', 'a', 'k3', 't0'], ['k3', 't1', 'h2', 't0'], ['h2', 't1', 'src', 'b']])
  for (const s of d.symbols) if (s.defId === 'sim-src1' || /bobine3|lampe2/.test(s.defId)) s.volts = 24
  return d
}

const twoPosts = (base: Doc): Doc =>
  build(base,
    [SRC, ['s1', PBN, 400, 90, 'S1'], ['s4', PBN, 400, 170, 'S4'], ['s2', PB, 400, 260, 'S2'], ['s3', PB, 480, 260, 'S3'], ['ka', K, 560, 260, 'KM1'], ['c', COIL, 440, 380, 'KM1']],
    [['src', 'a', 's1', 't0'], ['s1', 't1', 's4', 't0'], ['s4', 't1', 's2', 't0'], ['s4', 't1', 's3', 't0'], ['s4', 't1', 'ka', 't0'], ['s2', 't1', 'c', 't0'], ['s3', 't1', 'c', 't0'], ['ka', 't1', 'c', 't0'], ['c', 't1', 'src', 'b']])

const sequence = (base: Doc): Doc =>
  build(base,
    [SRC, ['s1', PBN, 400, 90, 'S1'], ['s2', PB, 400, 190, 'S2'], ['a1', K, 480, 190, 'KM1'], ['c1', COIL, 420, 300, 'KM1'],
      ['en', K, 600, 150, 'KM1'], ['s3', PB, 600, 240, 'S3'], ['a2', K, 680, 240, 'KM2'], ['c2', COIL, 620, 340, 'KM2']],
    [['src', 'a', 's1', 't0'], ['s1', 't1', 's2', 't0'], ['s1', 't1', 'a1', 't0'], ['s2', 't1', 'c1', 't0'], ['a1', 't1', 'c1', 't0'], ['c1', 't1', 'src', 'b'],
      ['s1', 't1', 'en', 't0'], ['en', 't1', 's3', 't0'], ['en', 't1', 'a2', 't0'], ['s3', 't1', 'c2', 't0'], ['a2', 't1', 'c2', 't0'], ['c2', 't1', 'src', 'b']])

const delayed = (base: Doc): Doc => {
  const d = build(base,
    [SRC, ['s1', PBN, 400, 90, 'S1'], ['s2', PB, 400, 190, 'S2'], ['ka', K, 480, 190, 'KM1'], ['c', COIL, 420, 300, 'KM1'],
      ['k2', K, 600, 150, 'KM1'], ['kt', TCOIL, 590, 250, 'KT'], ['k3', K, 700, 150, 'KT'], ['c2', COIL, 690, 250, 'KM2']],
    [['src', 'a', 's1', 't0'], ['s1', 't1', 's2', 't0'], ['s1', 't1', 'ka', 't0'], ['s2', 't1', 'c', 't0'], ['ka', 't1', 'c', 't0'], ['c', 't1', 'src', 'b'],
      ['src', 'a', 'k2', 't0'], ['k2', 't1', 'kt', 't0'], ['kt', 't1', 'src', 'b'], ['src', 'a', 'k3', 't0'], ['k3', 't1', 'c2', 't0'], ['c2', 't1', 'src', 'b']])
  for (const s of d.symbols) if (s.defId === TCOIL) s.delay = 5
  return d
}

const interlock = (base: Doc): Doc =>
  build(base,
    [SRC, ['s1', PBN, 400, 90, 'S1'], ['s2', PB, 400, 190, 'S2'], ['a1', K, 480, 180, 'KM1'], ['i2', KN, 410, 270, 'KM2'], ['c1', COIL, 390, 340, 'KM1'],
      ['s3', PB, 560, 190, 'S3'], ['a2', K, 640, 180, 'KM2'], ['i1', KN, 570, 270, 'KM1'], ['c2', COIL, 550, 340, 'KM2']],
    [['src', 'a', 's1', 't0'], ['s1', 't1', 's2', 't0'], ['s1', 't1', 'a1', 't0'], ['s2', 't1', 'i2', 't0'], ['a1', 't1', 'i2', 't0'], ['i2', 't1', 'c1', 't0'], ['c1', 't1', 'src', 'b'],
      ['s1', 't1', 's3', 't0'], ['s1', 't1', 'a2', 't0'], ['s3', 't1', 'i1', 't0'], ['a2', 't1', 'i1', 't0'], ['i1', 't1', 'c2', 't0'], ['c2', 't1', 'src', 'b']])

/** Circuit marche / arrêt dont le contact d'auto-maintien n'est pas raccordé (panne à réparer). */
const brokenLatch = (base: Doc): Doc => {
  const d = startStop(base)
  const ka = d.symbols.find((s) => s.defId === K)!
  d.wires = d.wires.filter((w) => w.from.symId !== ka.id && w.to.symId !== ka.id)
  return d
}

const lampOn = (r: { energized: Set<string> }, c: Ctx) => all(c, isLamp).some((l) => r.energized.has(l.id))
const ids = (c: Ctx, p: P) => all(c, p).map((s) => s.id)
const simTest = (id: string, title: L, hint: L, steps: SimStep[]): GStep => ({ id, title, hint, done: (c) => scenario(c, steps) })

const ELECTRICAL: GExercise[] = [
  // ───────────────────────── électrique, niveau 1
  {
    id: 'e-lamp', domain: 'electrical', level: 1, minutes: 10,
    title: L('Allumer une lampe avec un interrupteur', 'Light a lamp with a switch'),
    summary: L('Le premier circuit : source, interrupteur, lampe.', 'The first circuit: source, switch, lamp.'),
    brief: [
      L('Cahier des charges : une lampe de 230 V doit s’allumer quand on ferme un interrupteur et s’éteindre quand on l’ouvre.', 'Brief: a 230 V lamp must light when a switch is closed and go off when it is opened.'),
      L('Le circuit est alimenté par une source monophasée : phase L et neutre N. Le courant part de la phase, traverse l’interrupteur puis la lampe, et revient par le neutre.', 'The circuit is supplied by a single-phase source: phase L and neutral N. Current leaves the phase, goes through the switch then the lamp, and returns by the neutral.'),
    ],
    parts: [
      L('Une source monophasée (L et N).', 'A single-phase source (L and N).'),
      L('Un interrupteur S1 (ou un bouton poussoir S1).', 'A switch S1 (or a push button S1).'),
      L('Une lampe H1.', 'A lamp H1.'),
    ],
    expect: [
      L('Au repos (interrupteur ouvert, bouton relâché) : la lampe H1 est éteinte.', 'At rest (switch open, button released): lamp H1 is off.'),
      L('Je ferme l’interrupteur S1 (ou j’appuie sur le bouton S1) : la lampe H1 s’allume.', 'I close switch S1 (or press button S1): lamp H1 lights.'),
      L('Je rouvre S1 (ou je relâche le bouton) : la lampe H1 s’éteint.', 'I reopen S1 (or release the button): lamp H1 goes off.'),
    ],
    solution: lampSwitch,
    steps: [
      needStep('place', L('Posez une source, un interrupteur (ou un bouton poussoir) et une lampe', 'Place a source, a switch (or a push button) and a lamp'),
        L('Bibliothèque : {{src1:loc}}, ou {{simL}} et {{simN}} du même groupe. Puis {{switch:loc}} ou {{pb:loc}} (contact normalement ouvert), et {{lamp:loc}}. La liste « Il vous manque » sous l’étape dit ce qui reste à poser.', 'Library: {{src1:loc}}, or {{simL}} and {{simN}} from the same group. Then {{switch:loc}} or {{pb:loc}} (normally open contact), and {{lamp:loc}}. The “Still missing” list under the step says what is left to place.'),[['supply', 1], [isCtrlSw, 1], [isLamp, 1]]),
      stepPlace('wire', L('Câblez le circuit en boucle : L → interrupteur → lampe → N', 'Wire the circuit as a loop: L → switch → lamp → N'),
        L('Cliquez sur une borne puis sur la suivante. La borne PE de la source reste libre. Un circuit doit toujours se refermer sur la source.', 'Click a terminal then the next one. The source PE terminal stays free. A circuit must always close back on the source.'),
        (c) => sourceWired(c) && wired(c, [isCtrlSw, isLamp])),
      simStep(),
      simTest('run', L('Actionnez l’interrupteur (ou le bouton) : la lampe s’allume ; relâchez ou rouvrez : elle s’éteint', 'Operate the switch (or button): the lamp lights; release or reopen: it goes off'),
        L('En simulation, cliquez sur l’interrupteur pour le fermer ou l’ouvrir (un bouton poussoir reste actionné tant que vous maintenez le clic). La lampe s’allume quand le courant peut circuler dans toute la boucle.', 'In simulation, click the switch to close or open it (a push button stays operated while you hold the click). The lamp lights when current can flow around the whole loop.'),
        [
          { ok: (r, c) => !lampOn(r, c) },
          { press: (c) => ids(c, isCtrlSw), toggle: (c) => ids(c, isCtrlSw), wait: 300, ok: (r, c) => lampOn(r, c) },
          { wait: 300, ok: (r, c) => !lampOn(r, c) },
        ]),
    ],
  },
  {
    id: 'e-startstop', domain: 'electrical', level: 1, minutes: 20,
    title: L('Marche / arrêt à auto-maintien', 'Start / stop with latching'),
    summary: L('Le circuit de commande de base : une impulsion démarre, le contact de la bobine maintient.', 'The basic control circuit: a pulse starts, the coil contact holds.'),
    brief: [
      old('start-stop').statement as L,
      L('Le contact d’auto-maintien porte le même repère que la bobine (KM1) : c’est ce qui le relie à elle. Les repères se posent seuls ; vérifiez-les.', 'The latching contact has the same tag as the coil (KM1): that is what ties it to the coil. Tags are assigned automatically; check them.'),
    ],
    parts: [
      L('S1 : bouton poussoir NF (arrêt). S2 : bouton poussoir NO (marche).', 'S1: NC push button (stop). S2: NO push button (start).'),
      L('KM1 : une bobine, et un contact NO de KM1 câblé en parallèle de S2 (auto-maintien).', 'KM1: a coil, and a NO contact of KM1 wired in parallel with S2 (latching).'),
    ],
    expect: [
      L('Au repos : la bobine KM1 est coupée.', 'At rest: coil KM1 is off.'),
      L('J’appuie sur S2 (marche) : KM1 s’enclenche.', 'I press S2 (start): KM1 pulls in.'),
      L('Je relâche S2 : KM1 reste enclenchée, maintenue par son propre contact.', 'I release S2: KM1 stays pulled in, held by its own contact.'),
      L('J’appuie sur S1 (arrêt) : KM1 retombe ; je relâche S1 : elle reste coupée.', 'I press S1 (stop): KM1 drops out; I release S1: it stays off.'),
    ],
    solution: startStop,
    steps: [
      needStep('place', L('Posez la source, S1 (arrêt, NF), S2 (marche, NO), la bobine KM1 et un contact NO', 'Place the source, S1 (stop, NC), S2 (start, NO), coil KM1 and a NO contact'),
        L('Boutons : {{pb:loc}} (NO) et {{pbnf:loc}}. Bobine : {{coil:loc}}. Contact : {{k:loc}} (NO). Posez d’abord S1 (arrêt) puis S2 (marche) pour que les repères soient ceux de l’énoncé.', 'Buttons: {{pb:loc}} (NO) and {{pbnf:loc}}. Coil: {{coil:loc}}. Contact: {{k:loc}} (NO). Place S1 (stop) first, then S2 (start), so tags match the brief.'),[['supply', 1], [isNCBtn, 1], [isNOBtn, 1], [isCoil, 1], [isNOk, 1]]),
      stepPlace('tags', L('Vérifiez les repères : S1 = arrêt, S2 = marche, KM1 sur la bobine et sur son contact', 'Check the tags: S1 = stop, S2 = start, KM1 on the coil and its contact'),
        L('Double-clic sur un symbole pour changer son repère. Le contact commandé par une bobine prend le repère de la dernière bobine posée.', 'Double-click a symbol to change its tag. A coil-driven contact takes the tag of the last coil placed.'),
        (c) => c.doc.symbols.some((s) => s.label === 'S1' && isNCBtn(c, s)) && c.doc.symbols.some((s) => s.label === 'S2' && isNOBtn(c, s)) && c.doc.symbols.some((s) => s.label === 'KM1' && isCoil(c, s)) && c.doc.symbols.some((s) => s.label === 'KM1' && isNOk(c, s))),
      stepPlace('wire', L('Câblez : L → S1 → (S2 en parallèle avec le contact KM1) → bobine → N', 'Wire: L → S1 → (S2 in parallel with the KM1 contact) → coil → N'),
        L('S2 et le contact KM1 sont raccordés aux deux mêmes points : en haut sur la sortie de S1, en bas sur la bobine.', 'S2 and the KM1 contact are wired to the same two points: the S1 output at the top, the coil at the bottom.'),
        (c) => sourceWired(c) && wired(c, [isNCBtn, isNOBtn, isCoil, isNOk])),
      simStep(),
      behaviour('run', L('Appui sur S2 : KM1 colle et reste collée ; appui sur S1 : elle retombe', 'Press S2: KM1 pulls in and stays; press S1: it drops'),
        L('En simulation, maintenez S2 appuyé puis relâchez : la bobine doit rester alimentée grâce à son contact. S1 coupe tout.', 'In simulation, hold S2 then release: the coil must stay energised through its contact. S1 breaks everything.'),
        old('start-stop').steps, ['S1', 'S2', 'KM1']),
    ],
  },
  // ───────────────────────── électrique, niveau 2
  {
    id: 'e-lamps24', domain: 'electrical', level: 2, minutes: 25,
    title: L('Voyants de marche et d’arrêt en 24 V alternatif', 'Run and stop lamps at 24 V AC'),
    summary: L('Un circuit de commande en 24 V : régler la source et les récepteurs, ajouter deux voyants.', 'A 24 V control circuit: set the source and loads, add two lamps.'),
    brief: [
      L('Cahier des charges : une commande marche / arrêt en 24 V alternatif. Un voyant H1 indique la marche, un voyant H2 l’arrêt.', 'Brief: a 24 V AC start / stop control. Lamp H1 shows running, lamp H2 shows stopped.'),
      L('Toute la commande est en 24 V : la source, la bobine et les deux voyants doivent être réglés à cette tension, sinon le Contrôle signale une surtension ou une sous-tension.', 'The whole control is 24 V: the source, the coil and both lamps must be set to that voltage, otherwise the Check reports over- or under-voltage.'),
    ],
    parts: [
      L('Une source 24 V alternatif ; la bobine KM1 et les deux voyants H1 et H2 réglés à 24 V.', 'A 24 V AC source; coil KM1 and both lamps H1 and H2 set to 24 V.'),
      L('S1 : bouton poussoir NF (arrêt). S2 : bouton poussoir NO (marche).', 'S1: NC push button (stop). S2: NO push button (start).'),
      L('Trois contacts de KM1 : un NO en auto-maintien, un NO qui alimente H1, un NF qui alimente H2.', 'Three KM1 contacts: one NO latching, one NO feeding H1, one NC feeding H2.'),
    ],
    expect: [
      L('Au repos : H2 (arrêt) est allumé, H1 (marche) est éteint, KM1 est coupée.', 'At rest: H2 (stopped) is on, H1 (running) is off, KM1 is off.'),
      L('J’appuie sur S2 : KM1 s’enclenche, H1 s’allume et H2 s’éteint.', 'I press S2: KM1 pulls in, H1 lights and H2 goes off.'),
      L('Je relâche S2 : tout reste ainsi (auto-maintien).', 'I release S2: everything stays that way (latching).'),
      L('J’appuie sur S1 : KM1 retombe, H1 s’éteint et H2 se rallume.', 'I press S1: KM1 drops out, H1 goes off and H2 lights again.'),
      L('Le Contrôle ne signale aucune erreur de tension.', 'The Check reports no voltage error.'),
    ],
    solution: lamps24,
    steps: [
      needStep('place', L('Posez la source, S1, S2, la bobine KM1, deux voyants H1 et H2 et trois contacts de KM1', 'Place the source, S1, S2, coil KM1, two lamps H1 and H2 and three KM1 contacts'),
        L('Un contact NO d’auto-maintien, un contact NO pour H1 (marche) et un contact NF pour H2 (arrêt). Les contacts prennent le repère de la bobine.', 'One NO latching contact, one NO contact for H1 (run) and one NC contact for H2 (stop). Contacts take the coil tag.'),[['supply', 1], [isNCBtn, 1], [isNOBtn, 1], [isCoil, 1], [isNOk, 2], [isNCk, 1], [isLamp, 2]]),
      stepPlace('volts', L('Réglez la source, la bobine et les deux voyants sur 24 V', 'Set the source, the coil and both lamps to 24 V'),
        L('Sélectionnez la source : champ « Tension de la source » = 24. Pour la bobine et chaque voyant : champ « Tension nominale » = 24 (liste ▾ des valeurs usuelles).', 'Select the source: “Source voltage” = 24. For the coil and each lamp: “Rated voltage” = 24 (usual values list ▾).'),
        (c) => all(c, isSupply).every((s) => s.volts === 24) && supplyOk(c) && all(c, isCoil).every((s) => s.volts === 24) && all(c, isLamp).length >= 2 && all(c, isLamp).every((s) => s.volts === 24)),
      stepPlace('wire', L('Câblez la commande et les deux voyants', 'Wire the control and both lamps'),
        L('Chaque voyant est en série avec son contact, entre la phase et le neutre de la source.', 'Each lamp is in series with its contact, between the phase and the neutral of the source.'),
        (c) => sourceWired(c) && wired(c, [isNCBtn, isNOBtn, isCoil, isNOk, isNCk, isLamp])),
      simStep(),
      behaviour('run', L('Au repos H2 est allumé ; en marche H1 est allumé et H2 éteint', 'At rest H2 is on; when running H1 is on and H2 off'),
        L('Le contact NO de KM1 alimente H1, son contact NF alimente H2.', 'The NO contact of KM1 feeds H1, its NC contact feeds H2.'),
        old('lamps').steps, ['S1', 'S2', 'KM1', 'H1', 'H2']),
      {
        id: 'check', title: L('Le Contrôle ne signale aucune erreur', 'The Check reports no error'),
        hint: L('Bouton « Contrôle » : si une ligne indique « V appliqués, V assignés », une tension n’est pas réglée. Le bouton « Appliquer » corrige.', 'The “Check” button: a line saying “V applied, V rated” means a voltage is not set. The “Apply” button fixes it.'),
        done: (c) => { try { return c.doc.symbols.length > 0 && !checkDoc(c.doc, c.defs, c.lang).some((i) => i.level === 'error') && passes(c, old('lamps').steps, ['S1', 'S2', 'KM1', 'H1', 'H2']) } catch { return false } },
      },
    ],
  },
  {
    id: 'e-repair', domain: 'electrical', level: 2, minutes: 15,
    title: L('Réparer : la bobine retombe au relâchement', 'Repair: the coil drops out on release'),
    summary: L('Un circuit marche / arrêt incomplet : trouver ce qui manque et le réparer.', 'An incomplete start / stop circuit: find what is missing and repair it.'),
    brief: [
      L('Cahier des charges : on vous remet un circuit marche / arrêt. Quand on appuie sur S2, la bobine KM1 colle, mais dès qu’on relâche elle retombe.', 'Brief: you are given a start / stop circuit. When S2 is pressed the coil KM1 pulls in, but as soon as it is released it drops out.'),
      L('Observez le schéma en simulation, trouvez ce qui empêche l’auto-maintien et réparez-le.', 'Watch the diagram in simulation, find what prevents latching and repair it.'),
    ],
    start: brokenLatch,
    parts: [
      L('Circuit fourni : S1 (NF, arrêt), S2 (NO, marche), bobine KM1 et un contact NO de KM1 déjà posé mais non câblé.', 'Circuit provided: S1 (NC, stop), S2 (NO, start), coil KM1 and a KM1 NO contact already placed but not wired.'),
    ],
    expect: [
      L('Panne constatée : j’appuie sur S2, KM1 s’enclenche ; dès que je relâche S2, KM1 retombe.', 'Observed fault: I press S2, KM1 pulls in; as soon as I release S2, KM1 drops out.'),
      L('Après réparation : j’appuie sur S2 puis je relâche, KM1 reste enclenchée.', 'After repair: I press S2 then release, KM1 stays pulled in.'),
      L('J’appuie sur S1 : KM1 retombe et reste coupée.', 'I press S1: KM1 drops out and stays off.'),
    ],
    solution: startStop,
    steps: [
      simStep(),
      stepPlace('diag', L('Constatez la panne : appuyez sur S2, la bobine retombe au relâchement', 'Observe the fault: press S2, the coil drops on release'),
        L('Maintenez S2 appuyé : KM1 colle (surbrillance verte). Relâchez : elle retombe. Un contact devrait la maintenir.', 'Hold S2: KM1 pulls in (green highlight). Release: it drops. A contact should hold it.'),
        (c) => c.simMode),
      stepPlace('fix', L('Réparez : raccordez le contact KM1 en parallèle avec S2', 'Repair: wire the KM1 contact in parallel with S2'),
        L('Le contact KM1 est posé mais ses deux bornes ne sont pas câblées. Une borne va sur la sortie de S1 (en haut), l’autre sur la bobine (en bas).', 'The KM1 contact is placed but its two terminals are not wired. One goes to the S1 output (top), the other to the coil (bottom).'),
        (c) => sourceWired(c) && wired(c, [isNCBtn, isNOBtn, isCoil, isNOk])),
      behaviour('run', L('Vérifiez : appui sur S2, relâchement, la bobine reste collée ; S1 l’arrête', 'Check: press S2, release, the coil stays; S1 stops it'),
        L('Le circuit doit maintenant se comporter comme un marche / arrêt normal.', 'The circuit must now behave like a normal start / stop.'),
        old('start-stop').steps, ['S1', 'S2', 'KM1']),
    ],
  },
  {
    id: 'e-twoposts', domain: 'electrical', level: 2, minutes: 20,
    title: L('Commande depuis deux postes', 'Control from two stations'),
    summary: L('Deux boutons de marche en parallèle, deux boutons d’arrêt en série.', 'Two start buttons in parallel, two stop buttons in series.'),
    brief: [old('two-posts').statement as L, L('Règle à retenir : on met les arrêts en série (n’importe lequel coupe) et les marches en parallèle (n’importe lequel démarre).', 'Rule to remember: stops in series (any one breaks) and starts in parallel (any one starts).')],
    parts: [
      L('Poste 1 : arrêt S1 (NF) et marche S2 (NO). Poste 2 : arrêt S4 (NF) et marche S3 (NO).', 'Station 1: stop S1 (NC) and start S2 (NO). Station 2: stop S4 (NC) and start S3 (NO).'),
      L('Une bobine KM1 et un contact NO de KM1 (auto-maintien).', 'One coil KM1 and one KM1 NO contact (latching).'),
    ],
    expect: [
      L('Au repos : KM1 est coupée.', 'At rest: KM1 is off.'),
      L('J’appuie sur S2 (poste 1) : KM1 s’enclenche ; je relâche : elle reste enclenchée.', 'I press S2 (station 1): KM1 pulls in; I release: it stays in.'),
      L('J’appuie sur S4 (poste 2) : KM1 retombe.', 'I press S4 (station 2): KM1 drops out.'),
      L('J’appuie sur S3 (poste 2) : KM1 s’enclenche. J’appuie sur S1 (poste 1) : elle retombe.', 'I press S3 (station 2): KM1 pulls in. I press S1 (station 1): it drops out.'),
    ],
    solution: twoPosts,
    steps: [
      needStep('place', L('Posez la source, deux arrêts NF (S1, S4), deux marches NO (S2, S3), la bobine KM1 et son contact', 'Place the source, two NC stops (S1, S4), two NO starts (S2, S3), coil KM1 and its contact'),
        L('Repères attendus : S1 et S4 pour les arrêts, S2 et S3 pour les marches. Modifiez-les par double-clic si besoin.', 'Expected tags: S1 and S4 for the stops, S2 and S3 for the starts. Double-click to change them if needed.'),[['supply', 1], [isNCBtn, 2], [isNOBtn, 2], [isCoil, 1], [isNOk, 1]]),
      stepPlace('wire', L('Câblez : les arrêts en série, les marches et le contact en parallèle, puis la bobine', 'Wire: stops in series, starts and contact in parallel, then the coil'),
        L('Les trois éléments en parallèle (S2, S3, contact KM1) sont raccordés aux mêmes deux points.', 'The three parallel elements (S2, S3, KM1 contact) are wired to the same two points.'),
        (c) => sourceWired(c) && wired(c, [isNCBtn, isNOBtn, isCoil, isNOk])),
      simStep(),
      behaviour('run', L('Marche et arrêt possibles depuis chaque poste', 'Start and stop possible from each station'),
        L('Testez S2 puis S4, S3 puis S1 : chaque marche enclenche, chaque arrêt coupe.', 'Test S2 then S4, S3 then S1: each start energises, each stop breaks.'),
        old('two-posts').steps, ['S1', 'S2', 'S3', 'S4', 'KM1']),
    ],
  },
  // ───────────────────────── électrique, niveau 3
  {
    id: 'e-delay', domain: 'electrical', level: 3, minutes: 30,
    title: L('Démarrage en cascade temporisé', 'Delayed cascade start'),
    summary: L('KM2 démarre 5 s après KM1 grâce à une bobine temporisée.', 'KM2 starts 5 s after KM1 thanks to a timed coil.'),
    brief: [old('delay').statement as L, L('La bobine temporisée KT est alimentée par un contact de KM1 ; un contact temporisé de KT enclenche ensuite KM2 après le délai réglé dans ses propriétés (5 s).', 'The timed coil KT is fed by a KM1 contact; a KT timed contact then energises KM2 after the delay set in its properties (5 s).')],
    parts: [
      L('S1 : arrêt (NF). S2 : marche (NO).', 'S1: stop (NC). S2: start (NO).'),
      L('KM1 : bobine et contact NO d’auto-maintien. KT : bobine temporisée réglée à 5 s, alimentée par un contact NO de KM1.', 'KM1: coil and NO latching contact. KT: timed coil set to 5 s, fed by a NO contact of KM1.'),
      L('KM2 : bobine alimentée par un contact NO de KT.', 'KM2: coil fed by a NO contact of KT.'),
    ],
    expect: [
      L('Au repos : KM1, KT et KM2 sont coupées.', 'At rest: KM1, KT and KM2 are off.'),
      L('J’appuie sur S2 : KM1 s’enclenche et la temporisation KT démarre ; KM2 n’est pas encore enclenchée.', 'I press S2: KM1 pulls in and the KT timer starts; KM2 is not yet in.'),
      L('Au bout de 2 s : KM2 est toujours coupée.', 'After 2 s: KM2 is still off.'),
      L('Au bout de 6 s (5 s écoulées) : KM2 s’enclenche.', 'After 6 s (5 s elapsed): KM2 pulls in.'),
      L('J’appuie sur S1 : tout retombe.', 'I press S1: everything drops out.'),
    ],
    solution: delayed,
    steps: [
      needStep('place', L('Posez la source, S1, S2, KM1 et son auto-maintien, la bobine temporisée KT, KM2 et leurs contacts', 'Place the source, S1, S2, KM1 and its latching contact, the timed coil KT, KM2 and its contacts'),
        L('Bobine temporisée : {{tcoil:loc}} (la temporisation se règle sur la bobine). Bobines : {{coil:loc}}. Contacts : trois {{k:loc}}, repérés KM1 (auto-maintien), KM1 (vers KT) et KT (vers KM2). Repères des bobines : KM1, KT, KM2.', 'Timed coil: {{tcoil:loc}} (the delay is set on the coil). Coils: {{coil:loc}}. Contacts: three {{k:loc}}, tagged KM1 (latching), KM1 (to KT) and KT (to KM2). Coil tags: KM1, KT, KM2.'),[['supply', 1], [isNCBtn, 1], [isNOBtn, 1], [isCoil, 2], [isTimer, 1], [isNOk, 3]]),
      stepPlace('delay', L('Réglez la temporisation de KT sur 5 s', 'Set the delay of KT to 5 s'),
        L('Sélectionnez la bobine KT : champ « Temporisation (s) ».', 'Select coil KT: “Delay (s)” field.'),
        (c) => all(c, isTimer).some((s) => (s.delay ?? DEFAULT_DELAY_S) === 5)),
      stepPlace('wire', L('Câblez les deux branches de commande', 'Wire both control branches'),
        L('Branche 1 : marche / arrêt de KM1. Branche 2 : contact KM1 → KT. Branche 3 : contact temporisé de KT → KM2.', 'Branch 1: start / stop of KM1. Branch 2: KM1 contact → KT. Branch 3: KT timed contact → KM2.'),
        (c) => sourceWired(c) && wired(c, [isNCBtn, isNOBtn, isCoil, isTimer, isNOk])),
      simStep(),
      behaviour('run', L('KM1 démarre tout de suite, KM2 seulement après 5 s', 'KM1 starts at once, KM2 only after 5 s'),
        L('En simulation, maintenez le temps : le chronogramme montre les deux bobines. Réglez la vitesse ×5 pour accélérer.', 'In simulation, let time pass: the timing chart shows both coils. Set speed ×5 to go faster.'),
        old('delay').steps, ['S1', 'S2', 'KM1', 'KT', 'KM2']),
    ],
  },
  {
    id: 'e-interlock', domain: 'electrical', level: 3, minutes: 30,
    title: L('Verrouillage de deux contacteurs', 'Interlocking two contactors'),
    summary: L('Deux départs qui ne doivent jamais être enclenchés ensemble.', 'Two starters that must never be energised together.'),
    brief: [old('interlock').statement as L, L('C’est la sécurité des inverseurs de sens : sans verrouillage, deux phases seraient court-circuitées si KM1 et KM2 collaient ensemble.', 'This is the safety of reversing starters: without interlock, two phases would be short-circuited if KM1 and KM2 pulled in together.')],
    parts: [
      L('S1 : arrêt général (NF). S2 : marche de KM1 (NO). S3 : marche de KM2 (NO).', 'S1: general stop (NC). S2: start of KM1 (NO). S3: start of KM2 (NO).'),
      L('KM1 et KM2 : chacun une bobine, un contact NO d’auto-maintien et un contact NF de verrouillage placé en série devant la bobine de l’autre.', 'KM1 and KM2: each one coil, one NO latching contact and one NC interlock contact placed in series in front of the other one’s coil.'),
    ],
    expect: [
      L('J’appuie sur S2 : KM1 s’enclenche seul.', 'I press S2: KM1 pulls in alone.'),
      L('J’appuie sur S3 pendant que KM1 est enclenché : KM2 reste coupée (verrouillage).', 'I press S3 while KM1 is in: KM2 stays off (interlock).'),
      L('J’appuie sur S1 : arrêt général, KM1 et KM2 sont coupées.', 'I press S1: general stop, KM1 and KM2 are off.'),
      L('J’appuie sur S3 : KM2 s’enclenche seule.', 'I press S3: KM2 pulls in alone.'),
      L('J’appuie sur S2 pendant que KM2 est enclenché : KM1 reste coupée.', 'I press S2 while KM2 is in: KM1 stays off.'),
    ],
    solution: interlock,
    steps: [
      needStep('place', L('Posez la source, S1, S2, S3, KM1 et KM2 avec chacun un contact NO et un contact NF', 'Place the source, S1, S2, S3, KM1 and KM2, each with one NO and one NC contact'),
        L('Chaque contacteur a une bobine, un contact NO d’auto-maintien et un contact NF qui sert de verrouillage sur l’autre.', 'Each contactor has a coil, a NO latching contact and an NC contact used as interlock on the other.'),[['supply', 1], [isNCBtn, 1], [isNOBtn, 2], [isCoil, 2], [isNOk, 2], [isNCk, 2]]),
      stepPlace('wire', L('Câblez : le contact NF de chaque contacteur en série avec la bobine de l’autre', 'Wire: the NC contact of each contactor in series with the other one’s coil'),
        L('Le contact NF repéré KM2 se met devant la bobine KM1, et inversement.', 'The NC contact tagged KM2 goes in front of coil KM1, and vice versa.'),
        (c) => sourceWired(c) && wired(c, [isNCBtn, isNOBtn, isCoil, isNOk, isNCk])),
      simStep(),
      behaviour('run', L('Un seul contacteur à la fois', 'Only one contactor at a time'),
        L('Essayez S3 pendant que KM1 est enclenché : KM2 doit rester coupé.', 'Try S3 while KM1 is on: KM2 must stay off.'),
        old('interlock').steps, ['S1', 'S2', 'S3', 'KM1', 'KM2']),
    ],
  },
  {
    id: 'e-sequence', domain: 'electrical', level: 3, minutes: 30,
    title: L('Démarrage séquentiel', 'Sequential start'),
    summary: L('KM2 ne démarre que si KM1 est déjà enclenché.', 'KM2 starts only if KM1 is already on.'),
    brief: [old('sequence').statement as L, L('Application typique : un convoyeur ne doit démarrer que si celui qui le suit tourne déjà.', 'Typical use: a conveyor must only start if the one after it is already running.')],
    parts: [
      L('S1 : arrêt des deux (NF). S2 : marche de KM1 (NO). S3 : marche de KM2 (NO).', 'S1: stop both (NC). S2: start of KM1 (NO). S3: start of KM2 (NO).'),
      L('KM1 : bobine + contact NO d’auto-maintien. KM2 : bobine + contact NO d’auto-maintien.', 'KM1: coil + NO latching contact. KM2: coil + NO latching contact.'),
      L('Un contact NO de KM1 placé en série devant S3 : c’est la condition de démarrage de KM2.', 'A KM1 NO contact placed in series in front of S3: this is the start condition for KM2.'),
    ],
    expect: [
      L('J’appuie sur S3 seul (KM1 pas encore enclenchée) : rien ne se passe, KM2 reste coupée.', 'I press S3 alone (KM1 not yet in): nothing happens, KM2 stays off.'),
      L('J’appuie sur S2 : KM1 s’enclenche (et reste enclenchée).', 'I press S2: KM1 pulls in (and stays in).'),
      L('J’appuie ensuite sur S3 : KM2 s’enclenche aussi.', 'I then press S3: KM2 pulls in too.'),
      L('Je relâche tout : KM1 et KM2 restent enclenchées.', 'I release everything: KM1 and KM2 stay in.'),
      L('J’appuie sur S1 : KM1 et KM2 retombent.', 'I press S1: KM1 and KM2 drop out.'),
    ],
    solution: sequence,
    steps: [
      needStep('place', L('Posez la source, S1, S2, S3, KM1, KM2 et trois contacts NO', 'Place the source, S1, S2, S3, KM1, KM2 and three NO contacts'),
        L('Deux contacts d’auto-maintien (KM1 et KM2) et un contact KM1 de condition devant S3.', 'Two latching contacts (KM1 and KM2) and one KM1 condition contact in front of S3.'),[['supply', 1], [isNCBtn, 1], [isNOBtn, 2], [isCoil, 2], [isNOk, 3]]),
      stepPlace('wire', L('Câblez : le contact KM1 de condition en série avec S3 devant la bobine KM2', 'Wire: the KM1 condition contact in series with S3 in front of coil KM2'),
        L('S1 arrête les deux : il est placé en tête, avant les deux branches.', 'S1 stops both: it sits first, before the two branches.'),
        (c) => sourceWired(c) && wired(c, [isNCBtn, isNOBtn, isCoil, isNOk])),
      simStep(),
      behaviour('run', L('S3 seul ne fait rien ; S2 puis S3 démarrent les deux ; S1 arrête tout', 'S3 alone does nothing; S2 then S3 start both; S1 stops all'),
        L('Essayez S3 avant S2 : KM2 ne doit pas démarrer.', 'Try S3 before S2: KM2 must not start.'),
        old('sequence').steps, ['S1', 'S2', 'S3', 'KM1', 'KM2']),
    ],
  },
]


// ───────────────────────── pneumatique
const PN = (p: string) => 'qet:50_pneumatic/' + p
const V52 = '5020_velves/502010_control/50201060_5_2_way/'
const CYL2 = PN('5030_actuators/503010_cylinder_lin/50301011_double_acting/5030101100_double_effet')
const CYL1 = PN('5030_actuators/503010_cylinder_lin/50301010_single_acting/5030101010_simple_effet')
const AIR = PN('5010_compressed_air/501010_air_generation/50101000_compressed_air_source')
const SIL = PN('5010_compressed_air/501016_funktion_components/50101610_flow/5010161060_silencer')
const V52M = PN(V52 + '5020106030_man_mech/502010603010_5_2_way')
const V52E = PN(V52 + '5020106020_elec/502010602010_5_2_way_010')
const V52B = PN(V52 + '5020106020_elec/502010602030_5_2_way_030')
const V32M = PN('5020_velves/502010_control/50201020_3_2_way/5020102030_man_mech/502010203010_3_2_way')
const LS = Q('390_sensors_instruments/41_limit_switches/fin_de_course_came_2_no')

const fluid = (c: Ctx, s: PlacedSymbol) => c.defs[s.defId]?.fluid
const isAir: P = (c, s) => fluid(c, s)?.k === 'fsource'
const isSilencer: P = (c, s) => fluid(c, s)?.k === 'fsink'
const isCyl2: P = (c, s) => { const f = fluid(c, s); return f?.k === 'cyl' && !!f.rod }
const isCyl1: P = (c, s) => { const f = fluid(c, s); return f?.k === 'cyl' && !f.rod }
const nPorts = (c: Ctx, s: PlacedSymbol) => c.defs[s.defId]?.ports.length ?? 0
const isMan52: P = (c, s) => { const f = fluid(c, s); return f?.k === 'valve' && f.a === 'man' && nPorts(c, s) === 5 }
const isMan32: P = (c, s) => { const f = fluid(c, s); return f?.k === 'valve' && f.a === 'man' && nPorts(c, s) === 3 }
const isManValve: P = (c, s) => { const f = fluid(c, s); return f?.k === 'valve' && f.a === 'man' }
const isElec52: P = (c, s) => { const f = fluid(c, s); return f?.k === 'valve' && f.a === 'elec' && f.b === 'spring' && nPorts(c, s) === 5 }
const isBi52: P = (c, s) => { const f = fluid(c, s); return f?.k === 'valve' && f.a === 'elec' && f.b === 'elec' && nPorts(c, s) === 5 }
const isLimit: P = (_c, s) => /41_limit_switches/.test(s.defId)
const pneuWired = (c: Ctx, ps: P[]) => ps.every((p) => all(c, p).length > 0) && allWired(c, ps.flatMap((p) => all(c, p)))
type Pos = { cylPos: Record<string, number> }
const cylPos = (r: Pos, c: Ctx, p: P) => ids(c, p).map((i) => r.cylPos[i] ?? 0)
const out = (r: Pos, c: Ctx, p: P) => cylPos(r, c, p).some((v) => v >= 0.99)
const back = (r: Pos, c: Ctx, p: P) => cylPos(r, c, p).length > 0 && cylPos(r, c, p).every((v) => v <= 0.01)
const sameTag = (c: Ctx, a: P, b: P) => all(c, a).some((x) => x.label.trim() && all(c, b).some((y) => y.label.trim().toUpperCase() === x.label.trim().toUpperCase()))

/** Partie pneumatique commune : source d'air, distributeur 5/2, vérin double effet A1 et deux silencieux d'échappement. */
const pneu52 = (valve: string, valveLabel: string, ports: { b: string; a: string; r1: string; p: string; r2: string }): [Spec[], Link[]] => [
  [['a1', CYL2, 180, 90, 'A1'], ['v', valve, 200, 230, valveLabel], ['sil1', SIL, 170, 330, ''], ['src', AIR, 250, 330, ''], ['sil2', SIL, 340, 330, '']],
  [['v', ports.b, 'a1', 't0'], ['v', ports.a, 'a1', 't1'], ['v', ports.r1, 'sil1', 't0'], ['v', ports.p, 'src', 't0'], ['v', ports.r2, 'sil2', 't0']],
]
const MAN52 = { b: 't4', a: 't1', r1: 't2', p: 't3', r2: 't0' }
const ELEC52 = { b: 't3', a: 't1', r1: 't0', p: 't4', r2: 't2' }

const pManual = (base: Doc): Doc => { const [s, l] = pneu52(V52M, 'V1', MAN52); return build(base, s, l) }
const pSingle = (base: Doc): Doc =>
  build(base, [['a1', CYL1, 180, 90, 'A1'], ['v', V32M, 200, 230, 'V1'], ['sil', SIL, 170, 330, ''], ['src', AIR, 250, 330, '']],
    [['v', 't2', 'a1', 't0'], ['v', 't1', 'src', 't0'], ['v', 't0', 'sil', 't0']])
const pElectro = (n = 1) => (base: Doc): Doc => {
  const [s, l] = pneu52(V52E, 'YV1', ELEC52)
  const sw: Spec[] = [['pwr', 'sim-src1', 480, 40], ['s1', SW, 480, 110, 'S1']]
  const lk: Link[] = [['pwr', 'a', 's1', 't0']]
  let last = 's1'
  if (n === 2) { sw.push(['s2', SW, 480, 190, 'S2']); lk.push(['s1', 't1', 's2', 't0']); last = 's2' }
  sw.push(['y', COIL, 470, n === 2 ? 290 : 210, 'YV1'])
  lk.push([last, 't1', 'y', 't0'], ['y', 't1', 'pwr', 'b'])
  return build(base, [...s, ...sw], [...l, ...lk])
}
const pBroken = (base: Doc): Doc => {
  const d = pManual(base)
  const src = d.symbols.find((x) => x.defId === AIR)!
  d.wires = d.wires.filter((w) => w.from.symId !== src.id && w.to.symId !== src.id)
  return d
}
const pAuto = (base: Doc): Doc => {
  const [s, l] = pneu52(V52B, 'YV1/YV2', { b: 't3', a: 't0', r1: 't4', p: 't2', r2: 't1' })
  return build(base,
    [...s, ['pwr', 'sim-src1', 480, 40], ['s2', PB, 480, 100, 'S2'], ['m1', LS, 480, 180, 'A1-'], ['y1', COIL, 470, 260, 'YV1'],
      ['m2', LS, 620, 150, 'A1+'], ['y2', COIL, 610, 260, 'YV2']],
    [...l, ['pwr', 'a', 's2', 't0'], ['s2', 't1', 'm1', 't0'], ['m1', 't1', 'y1', 't0'], ['y1', 't1', 'pwr', 'b'],
      ['pwr', 'a', 'm2', 't0'], ['m2', 't1', 'y2', 't0'], ['y2', 't1', 'pwr', 'b']])
}

const manualCycle: SimStep[] = [
  { ok: (r, c) => back(r, c, isCyl2) || back(r, c, isCyl1) },
  { press: (c) => ids(c, isManValve), wait: 2000, ok: (r, c) => out(r, c, isCyl2) || out(r, c, isCyl1) },
  { wait: 2000, ok: (r, c) => back(r, c, isCyl2) || back(r, c, isCyl1) },
]
const PNEUMATIC: GExercise[] = [
  {
    id: 'p-manual', domain: 'pneumatic', level: 1, minutes: 15,
    title: L('Piloter un vérin double effet avec un distributeur 5/2', 'Drive a double-acting cylinder with a 5/2 valve'),
    summary: L('Source d’air, distributeur manuel, vérin et échappements : le premier circuit pneumatique.', 'Air source, manual valve, cylinder and exhausts: the first pneumatic circuit.'),
    brief: [
      L('Cahier des charges : un vérin double effet doit sortir quand on maintient un distributeur manuel appuyé, et rentrer dès qu’on le relâche (rappel par ressort).', 'Brief: a double-acting cylinder must extend while a manual valve is held down, and retract as soon as it is released (spring return).'),
      L('Le distributeur 5/2 a cinq orifices : P (alimentation), A et B (vers le vérin), R1 et R2 (échappements, avec silencieux). Le vérin reçoit l’air d’un côté pendant que l’autre côté s’échappe.', 'The 5/2 valve has five ports: P (supply), A and B (to the cylinder), R1 and R2 (exhausts, with silencers). The cylinder gets air on one side while the other side exhausts.'),
    ],
    parts: [
      L('Une source d’air, un distributeur 5/2 manuel à ressort (V1), un vérin double effet (A1), deux silencieux.', 'An air source, a spring-return manual 5/2 valve (V1), a double-acting cylinder (A1), two silencers.'),
    ],
    expect: [
      L('Au repos (distributeur non actionné) : le vérin A1 est rentré.', 'At rest (valve not actuated): cylinder A1 is retracted.'),
      L('Je maintiens le distributeur V1 appuyé : le vérin sort en une seconde environ.', 'I hold valve V1 pressed: the cylinder extends in about a second.'),
      L('Je relâche V1 : le ressort ramène le distributeur et le vérin rentre.', 'I release V1: the spring returns the valve and the cylinder retracts.'),
    ],
    solution: pManual,
    steps: [
      needStep('place', L('Posez la source d’air, un distributeur 5/2 manuel à ressort, un vérin double effet et deux silencieux', 'Place the air source, a spring-return manual 5/2 valve, a double-acting cylinder and two silencers'),
        L('Bibliothèque pneumatique : {{air:loc}}, {{v52m:loc}}, {{cyl2:loc}} et deux {{sil:loc}}.', 'Pneumatic library: {{air:loc}}, {{v52m:loc}}, {{cyl2:loc}} and two {{sil:loc}}.'),[[isAir, 1], [isMan52, 1], [isCyl2, 1], [isSilencer, 2]]),
      stepPlace('wire', L('Raccordez : source → P ; A et B → les deux chambres du vérin ; R1 et R2 → silencieux', 'Connect: source → P; A and B → the two cylinder chambers; R1 and R2 → silencers'),
        L('Les orifices de travail (A, B) sont en haut du distributeur, l’alimentation et les échappements en bas : l’orifice central du bas est P.', 'Work ports (A, B) are at the top of the valve, supply and exhausts at the bottom: the central bottom port is P.'),
        (c) => pneuWired(c, [isAir, isMan52, isCyl2, isSilencer])),
      simStep(),
      simTest('run', L('Maintenez le distributeur : le vérin sort ; relâchez : il rentre', 'Hold the valve: the cylinder extends; release: it retracts'),
        L('En simulation, maintenez la souris enfoncée sur le distributeur. La tige se déplace en environ une seconde.', 'In simulation, hold the mouse button down on the valve. The rod moves in about a second.'), manualCycle),
    ],
  },
  {
    id: 'p-single', domain: 'pneumatic', level: 1, minutes: 15,
    title: L('Vérin simple effet et distributeur 3/2', 'Single-acting cylinder and 3/2 valve'),
    summary: L('Un vérin rappelé par ressort, commandé par un distributeur à trois orifices.', 'A spring-return cylinder driven by a three-port valve.'),
    brief: [
      L('Cahier des charges : un vérin simple effet sort tant qu’on appuie sur un bouton pneumatique et rentre quand on le relâche, rappelé par son ressort.', 'Brief: a single-acting cylinder extends while a pneumatic button is pressed and retracts when it is released, returned by its spring.'),
      L('Le distributeur 3/2 normalement fermé alimente le vérin quand il est actionné ; au repos il met le vérin à l’échappement par son orifice R.', 'The normally closed 3/2 valve feeds the cylinder when actuated; at rest it connects the cylinder to exhaust through port R.'),
    ],
    parts: [
      L('Une source d’air, un distributeur 3/2 manuel normalement fermé (V1), un vérin simple effet (A1), un silencieux.', 'An air source, a normally closed manual 3/2 valve (V1), a single-acting cylinder (A1), one silencer.'),
    ],
    expect: [
      L('Au repos : le vérin A1 est rentré (ressort), le distributeur V1 ne fait pas passer l’air.', 'At rest: cylinder A1 is retracted (spring), valve V1 passes no air.'),
      L('Je maintiens V1 appuyé : l’air arrive au vérin et celui-ci sort.', 'I hold V1 pressed: air reaches the cylinder and it extends.'),
      L('Je relâche V1 : le vérin se vide par l’orifice R et rentre sous l’effet du ressort.', 'I release V1: the cylinder exhausts through port R and retracts under its spring.'),
    ],
    solution: pSingle,
    steps: [
      needStep('place', L('Posez la source d’air, un distributeur 3/2 manuel, un vérin simple effet et un silencieux', 'Place the air source, a manual 3/2 valve, a single-acting cylinder and a silencer'),
        L('Distributeur : {{v32m:loc}} (commande manuelle, rappel par ressort, normalement fermé). Vérin : {{cyl1:loc}}. Source : {{air:loc}}. Silencieux : {{sil:loc}}.', 'Valve: {{v32m:loc}} (manual control, spring return, normally closed). Cylinder: {{cyl1:loc}}. Source: {{air:loc}}. Silencer: {{sil:loc}}.'),[[isAir, 1], [isMan32, 1], [isCyl1, 1], [isSilencer, 1]]),
      stepPlace('wire', L('Raccordez : source → P ; A → vérin ; R → silencieux', 'Connect: source → P; A → cylinder; R → silencer'),
        L('L’orifice du haut est A (sortie vers le vérin). Parmi les deux orifices du bas, P est celui qui reçoit l’air, R celui qui s’échappe.', 'The top port is A (output to the cylinder). Of the two bottom ports, P receives the air and R exhausts.'),
        (c) => pneuWired(c, [isAir, isMan32, isCyl1, isSilencer])),
      simStep(),
      simTest('run', L('Appuyez : le vérin sort ; relâchez : le ressort le fait rentrer', 'Press: the cylinder extends; release: the spring retracts it'),
        L('Si le vérin ne sort pas, vérifiez que P est bien relié à la source et A au vérin.', 'If the cylinder does not extend, check that P is connected to the source and A to the cylinder.'), manualCycle),
    ],
  },
  {
    id: 'p-electro', domain: 'pneumatic', level: 2, minutes: 25,
    title: L('Commande électrique d’un vérin', 'Electrical control of a cylinder'),
    summary: L('Une électrovanne 5/2 pilotée par un interrupteur : mélange de pneumatique et d’électricité.', 'A 5/2 solenoid valve driven by a switch: pneumatics and electricity together.'),
    brief: [
      L('Cahier des charges : un interrupteur S1 fait sortir un vérin double effet par l’intermédiaire d’une électrovanne 5/2 à rappel par ressort. Interrupteur ouvert, le vérin rentre.', 'Brief: a switch S1 extends a double-acting cylinder through a spring-return 5/2 solenoid valve. With the switch open, the cylinder retracts.'),
      L('L’électrovanne et sa bobine sont deux symboles : ils sont reliés par un repère commun (YV1). La bobine se câble comme n’importe quel récepteur électrique.', 'The solenoid valve and its coil are two symbols: they are tied by a shared tag (YV1). The coil is wired like any electrical load.'),
    ],
    parts: [
      L('Circuit pneumatique : source d’air, électrovanne 5/2 à ressort repérée YV1, vérin double effet A1, deux silencieux.', 'Pneumatic circuit: air source, spring-return 5/2 solenoid valve tagged YV1, double-acting cylinder A1, two silencers.'),
      L('Circuit électrique : source, interrupteur S1 (ou bouton), bobine repérée YV1.', 'Electrical circuit: source, switch S1 (or button), coil tagged YV1.'),
    ],
    expect: [
      L('S1 ouvert (ou bouton relâché) : la bobine YV1 n’est pas alimentée, le vérin est rentré.', 'S1 open (or button released): coil YV1 is not energised, the cylinder is retracted.'),
      L('Je ferme S1 (ou j’appuie) : YV1 est alimentée, l’électrovanne bascule et le vérin sort.', 'I close S1 (or press): YV1 is energised, the valve switches and the cylinder extends.'),
      L('J’ouvre S1 (ou je relâche) : YV1 retombe, le ressort ramène la vanne et le vérin rentre.', 'I open S1 (or release): YV1 drops out, the spring returns the valve and the cylinder retracts.'),
    ],
    solution: pElectro(1),
    steps: [
      needStep('place', L('Posez le circuit pneumatique (source, électrovanne 5/2, vérin, silencieux) et le circuit électrique (source, interrupteur, bobine)', 'Place the pneumatic circuit (source, 5/2 solenoid valve, cylinder, silencers) and the electrical circuit (source, switch, coil)'),
        L('Électrovanne : {{v52e:loc}}. Vérin : {{cyl2:loc}}. Côté électrique : {{src1:loc}}, {{switch:loc}} (ou {{pb:loc}}) et {{coil:loc}}.', 'Solenoid valve: {{v52e:loc}}. Cylinder: {{cyl2:loc}}. Electrical side: {{src1:loc}}, {{switch:loc}} (or {{pb:loc}}) and {{coil:loc}}.'),[[isAir, 1], [isElec52, 1], [isCyl2, 1], [isSilencer, 2], ['supply', 1], [isCtrlSw, 1], [isCoil, 1]]),
      stepPlace('tag', L('Donnez le même repère YV1 à l’électrovanne et à sa bobine', 'Give the same tag YV1 to the solenoid valve and its coil'),
        L('Double-clic sur chaque symbole puis champ « Repère » : YV1 des deux côtés. C’est ce repère qui fait agir la bobine sur le distributeur.', 'Double-click each symbol then the “Tag” field: YV1 on both. That tag makes the coil act on the valve.'),
        (c) => sameTag(c, isElec52, isCoil)),
      stepPlace('wire', L('Câblez la partie pneumatique et la partie électrique', 'Wire the pneumatic part and the electrical part'),
        L('Électrique : L → interrupteur → bobine → N. Pneumatique : comme pour le distributeur manuel (P, A, B, R1, R2).', 'Electrical: L → switch → coil → N. Pneumatic: as for the manual valve (P, A, B, R1, R2).'),
        (c) => pneuWired(c, [isAir, isElec52, isCyl2, isSilencer]) && sourceWired(c) && wired(c, [isCtrlSw, isCoil])),
      simStep(),
      simTest('run', L('Fermez S1 : le vérin sort ; ouvrez S1 : il rentre', 'Close S1: the cylinder extends; open S1: it retracts'),
        L('En simulation, cliquez sur l’interrupteur. Le vérin met environ une seconde à sortir.', 'In simulation, click the switch. The cylinder takes about a second to extend.'),
        [
          { ok: (r, c) => back(r, c, isCyl2) },
          { press: (c) => ids(c, isCtrlSw), toggle: (c) => ids(c, isCtrlSw), wait: 2000, ok: (r, c) => out(r, c, isCyl2) },
          { wait: 2000, ok: (r, c) => back(r, c, isCyl2) },
        ]),
    ],
  },
  {
    id: 'p-and', domain: 'pneumatic', level: 2, minutes: 25,
    title: L('Sécurité deux mains : S1 ET S2', 'Two-hand safety: S1 AND S2'),
    summary: L('Le vérin ne sort que si les deux interrupteurs sont fermés.', 'The cylinder only extends if both switches are closed.'),
    brief: [
      L('Cahier des charges : pour éviter qu’un opérateur n’ait la main sous le vérin, celui-ci ne sort que si les deux interrupteurs S1 et S2 sont fermés en même temps.', 'Brief: so an operator never has a hand under the cylinder, it only extends if both switches S1 and S2 are closed at the same time.'),
      L('Deux interrupteurs en série forment un ET logique : il suffit qu’un seul soit ouvert pour couper la bobine.', 'Two switches in series make a logical AND: it is enough for one to be open to cut the coil.'),
    ],
    parts: [
      L('Comme l’exercice précédent, avec deux interrupteurs S1 et S2 en série devant la bobine YV1.', 'As the previous exercise, with two switches S1 and S2 in series in front of coil YV1.'),
    ],
    expect: [
      L('S1 seul fermé : rien ne bouge, le vérin reste rentré.', 'Only S1 closed: nothing moves, the cylinder stays retracted.'),
      L('S2 seul fermé : rien ne bouge non plus.', 'Only S2 closed: nothing moves either.'),
      L('S1 et S2 fermés en même temps : YV1 est alimentée et le vérin sort.', 'S1 and S2 closed at the same time: YV1 is energised and the cylinder extends.'),
      L('J’ouvre l’un des deux : le vérin rentre.', 'I open either one: the cylinder retracts.'),
    ],
    solution: pElectro(2),
    steps: [
      needStep('place', L('Posez le circuit pneumatique, la source électrique, deux interrupteurs S1 et S2 et la bobine YV1', 'Place the pneumatic circuit, the electrical source, two switches S1 and S2 and coil YV1'),
        L('Reprenez le circuit de l’exercice précédent et ajoutez un second interrupteur.', 'Start from the previous exercise’s circuit and add a second switch.'),[[isAir, 1], [isElec52, 1], [isCyl2, 1], [isSilencer, 2], ['supply', 1], [isCtrlSw, 2], [isCoil, 1]]),
      stepPlace('tag', L('Repères : YV1 sur l’électrovanne et sur la bobine', 'Tags: YV1 on the solenoid valve and on the coil'),
        L('Même repère des deux côtés pour que la bobine commande la vanne.', 'Same tag on both sides so the coil drives the valve.'),
        (c) => sameTag(c, isElec52, isCoil)),
      stepPlace('wire', L('Câblez : L → S1 → S2 → bobine → N, et le circuit pneumatique', 'Wire: L → S1 → S2 → coil → N, and the pneumatic circuit'),
        L('Les deux interrupteurs sont l’un derrière l’autre, pas en parallèle.', 'The two switches are one after the other, not in parallel.'),
        (c) => pneuWired(c, [isAir, isElec52, isCyl2, isSilencer]) && sourceWired(c) && wired(c, [isCtrlSw, isCoil])),
      simStep(),
      simTest('run', L('Seul S1 fermé : rien ; S1 et S2 fermés : le vérin sort', 'Only S1 closed: nothing; S1 and S2 closed: the cylinder extends'),
        L('Testez les trois cas : S1 seul, S2 seul, les deux.', 'Test the three cases: S1 alone, S2 alone, both.'),
        [
          { press: (c) => ids(c, isCtrlSw).slice(0, 1), toggle: (c) => ids(c, isCtrlSw).slice(0, 1), wait: 2000, ok: (r, c) => back(r, c, isCyl2) },
          { press: (c) => ids(c, isCtrlSw).slice(1, 2), toggle: (c) => ids(c, isCtrlSw).slice(1, 2), wait: 2000, ok: (r, c) => back(r, c, isCyl2) },
          { press: (c) => ids(c, isCtrlSw), toggle: (c) => ids(c, isCtrlSw), wait: 2000, ok: (r, c) => out(r, c, isCyl2) },
          { wait: 2000, ok: (r, c) => back(r, c, isCyl2) },
        ]),
    ],
  },
  {
    id: 'p-repair', domain: 'pneumatic', level: 2, minutes: 15,
    title: L('Réparer : le vérin ne sort pas', 'Repair: the cylinder does not extend'),
    summary: L('Un circuit incomplet à diagnostiquer et à réparer.', 'An incomplete circuit to diagnose and repair.'),
    brief: [
      L('Cahier des charges : on vous remet un circuit pneumatique avec un distributeur manuel. Quand on appuie sur le distributeur, le vérin ne bouge pas.', 'Brief: you are given a pneumatic circuit with a manual valve. When the valve is pressed, the cylinder does not move.'),
      L('Quand un vérin ne bouge pas, on suit l’air depuis la source : chaque orifice doit être relié. Trouvez le raccord manquant.', 'When a cylinder does not move, follow the air from the source: every port must be connected. Find the missing connection.'),
    ],
    start: pBroken,
    parts: [
      L('Circuit fourni : source d’air, distributeur 5/2 manuel, vérin double effet, deux silencieux, avec un raccord manquant.', 'Circuit provided: air source, manual 5/2 valve, double-acting cylinder, two silencers, with a missing connection.'),
    ],
    expect: [
      L('Panne constatée : je maintiens le distributeur appuyé, le vérin ne bouge pas.', 'Observed fault: I hold the valve pressed, the cylinder does not move.'),
      L('Après réparation : je maintiens le distributeur, le vérin sort ; je relâche, il rentre.', 'After repair: I hold the valve, the cylinder extends; I release, it retracts.'),
    ],
    solution: pManual,
    steps: [
      simStep(),
      stepPlace('fix', L('Réparez : raccordez le raccord manquant entre la source d’air et le distributeur', 'Repair: connect the missing link between the air source and the valve'),
        L('Suivez le chemin de l’air : source d’air → orifice P (alimentation) du distributeur.', 'Follow the air path: air source → valve port P (supply).'),
        (c) => pneuWired(c, [isAir, isMan52, isCyl2, isSilencer])),
      simTest('run', L('Vérifiez : le vérin sort quand on maintient le distributeur', 'Check: the cylinder extends when the valve is held'), L('Maintenez la souris enfoncée sur le distributeur en simulation.', 'Hold the mouse button on the valve in simulation.'), manualCycle),
    ],
  },
  {
    id: 'p-auto', domain: 'pneumatic', level: 3, minutes: 40,
    title: L('Va-et-vient automatique A+ A−', 'Automatic A+ A− reciprocation'),
    summary: L('Un vérin qui sort et rentre tout seul grâce à deux fins de course et une électrovanne bistable.', 'A cylinder that extends and retracts by itself using two limit switches and a bistable solenoid valve.'),
    brief: [
      L('Cahier des charges : tant qu’on maintient S2 appuyé, le vérin A1 fait des allers-retours : il sort (A+), et dès qu’il est sorti il rentre (A−), puis ressort, etc.', 'Brief: as long as S2 is held, cylinder A1 cycles: it extends (A+), and as soon as it is out it retracts (A−), then extends again, and so on.'),
      L('On utilise une électrovanne 5/2 bistable (deux bobines YV1 et YV2 : elle garde sa position) et deux fins de course : A1− (vérin rentré) commande YV1, A1+ (vérin sorti) commande YV2.', 'A bistable 5/2 solenoid valve (two coils YV1 and YV2: it keeps its position) and two limit switches are used: A1− (cylinder retracted) drives YV1, A1+ (cylinder extended) drives YV2.'),
    ],
    parts: [
      L('Circuit pneumatique : source, électrovanne 5/2 bistable repérée YV1/YV2, vérin A1, deux silencieux.', 'Pneumatic circuit: source, bistable 5/2 solenoid valve tagged YV1/YV2, cylinder A1, two silencers.'),
      L('Commande : bouton poussoir S2, fin de course A1− (vérin rentré) vers YV1, fin de course A1+ (vérin sorti) vers YV2, deux bobines YV1 et YV2.', 'Control: push button S2, limit switch A1− (cylinder retracted) to YV1, limit switch A1+ (cylinder extended) to YV2, two coils YV1 and YV2.'),
    ],
    expect: [
      L('Au repos : le vérin est rentré et ne bouge pas.', 'At rest: the cylinder is retracted and does not move.'),
      L('Je maintiens S2 : A1− (vérin rentré) alimente YV1, le vérin sort.', 'I hold S2: A1− (cylinder retracted) energises YV1, the cylinder extends.'),
      L('Dès qu’il est sorti, A1+ alimente YV2 : la vanne bascule et le vérin rentre.', 'As soon as it is out, A1+ energises YV2: the valve switches and the cylinder retracts.'),
      L('De retour en position rentrée, A1− relance YV1 : le cycle recommence tant que S2 est maintenu.', 'Back in the retracted position, A1− energises YV1 again: the cycle restarts as long as S2 is held.'),
      L('Je relâche S2 : le vérin termine son cycle et s’arrête rentré.', 'I release S2: the cylinder finishes its cycle and stops retracted.'),
    ],
    solution: pAuto,
    steps: [
      needStep('place', L('Posez le circuit pneumatique : source, électrovanne 5/2 bistable, vérin A1, deux silencieux', 'Place the pneumatic circuit: source, bistable 5/2 solenoid valve, cylinder A1, two silencers'),
        L('Électrovanne bistable : {{v52b:loc}} (deux bobines). Nommez le vérin A1 ({{cyl2:loc}}).', 'Bistable solenoid valve: {{v52b:loc}} (two coils). Name the cylinder A1 ({{cyl2:loc}}).'),[[isAir, 1], [isBi52, 1], [isCyl2, 1], [isSilencer, 2]]),
      needStep('elec', L('Posez la commande : source, bouton S2, deux fins de course A1− et A1+, deux bobines YV1 et YV2', 'Place the control: source, button S2, two limit switches A1− and A1+, two coils YV1 and YV2'),
        L('Un fin de course prend le repère du vérin suivi de + ou − : « A1+ » est actionné quand le vérin A1 est sorti, « A1- » quand il est rentré. L’électrovanne bistable porte le repère « YV1/YV2 ».', 'A limit switch takes the cylinder tag followed by + or −: “A1+” is actuated when cylinder A1 is out, “A1-” when it is in. The bistable valve is tagged “YV1/YV2”.'),[['supply', 1], [isNOBtn, 1], [isLimit, 2], [isCoil, 2]]),
      stepPlace('wire', L('Câblez : S2 → A1− → YV1 ; A1+ → YV2 ; et le circuit pneumatique', 'Wire: S2 → A1− → YV1; A1+ → YV2; and the pneumatic circuit'),
        L('A1+ est alimenté directement par la phase : dès que le vérin est sorti il commande YV2. A1− est derrière S2 : il relance un cycle tant que S2 est maintenu.', 'A1+ is fed directly by the phase: as soon as the cylinder is out it drives YV2. A1− is behind S2: it starts a new cycle as long as S2 is held.'),
        (c) => pneuWired(c, [isAir, isBi52, isCyl2, isSilencer]) && sourceWired(c) && wired(c, [isNOBtn, isCoil]) && allWired(c, all(c, isLimit))),
      simStep(),
      simTest('run', L('S2 maintenu : le vérin sort puis rentre tout seul ; relâché, il termine son cycle et s’arrête rentré', 'S2 held: the cylinder extends then retracts by itself; released, it finishes its cycle and stops retracted'),
        L('Maintenez S2 appuyé quelques secondes en observant le chronogramme.', 'Hold S2 down for a few seconds while watching the timing chart.'),
        [
          { ok: (r, c) => back(r, c, isCyl2) },
          { press: (c) => ids(c, isNOBtn), wait: 1500, ok: (r, c) => out(r, c, isCyl2) },
          { wait: 3500, ok: (r, c) => back(r, c, isCyl2) },
        ]),
    ],
  },
]

// ───────────────────────── hydraulique (validation structurelle : pas de simulation hydraulique)
const HY = (p: string) => 'qet:30_hydraulic/' + p
const TANK = HY('21_tanks/bache_a_l_air_libre')
const ACCU = HY('21_tanks/bache_pressurisee')
const PUMP = HY('61_pumps/pompe_hydr_2')
const VALVE4 = HY('31_control_valves/13_4-2/distributeur_4-2')
const HCYL = HY('51_cylinders/verin-asymetrique-doubl-effet')
const HMOT = HY('61_pumps/moteur_hydr_1')
const HFILT = HY('81_filters/filtre')
const HVAN = HY('45_valves/vanne_manuelle')

const isTank: P = (_c, s) => /21_tanks\/bache_a_l_air_libre/.test(s.defId)
const isAccu: P = (_c, s) => /21_tanks\/bache_pressurisee/.test(s.defId)
const isPump: P = (_c, s) => /61_pumps\/pompe_/.test(s.defId)
const isHMotor: P = (_c, s) => /61_pumps\/moteur_hydr/.test(s.defId)
const isHValve4: P = (c, s) => /31_control_valves/.test(s.defId) && nPorts(c, s) === 4
const isHCyl: P = (c, s) => /51_cylinders\/verin/.test(s.defId) && nPorts(c, s) >= 2
const isHFilter: P = (_c, s) => /81_filters/.test(s.defId)
const isHManual: P = (_c, s) => /45_valves\/vanne_man/.test(s.defId)
const portsDir = (c: Ctx, s: PlacedSymbol, dir: string) => (c.defs[s.defId]?.ports ?? []).filter((p) => p.dir === dir).map((p) => p.id)
const dirNets = (c: Ctx, s: PlacedSymbol, dir: string, n: (a: string, b: string) => string) => portsDir(c, s, dir).map((p) => n(s.id, p))
const FLUID_NAMES: [P, string, string][] = [
  [isAir, 'source d’air comprimé', 'compressed air source'], [isSilencer, 'silencieux', 'silencer'], [isCyl2, 'vérin double effet', 'double-acting cylinder'],
  [isCyl1, 'vérin simple effet', 'single-acting cylinder'], [isMan52, 'distributeur 5/2 manuel', 'manual 5/2 valve'], [isMan32, 'distributeur 3/2 manuel', 'manual 3/2 valve'],
  [isElec52, 'électrovanne 5/2 à ressort', 'spring-return 5/2 solenoid valve'], [isBi52, 'électrovanne 5/2 bistable', 'bistable 5/2 solenoid valve'],
  [isLimit, 'fin de course', 'limit switch'], [isTank, 'bâche', 'tank'], [isPump, 'pompe', 'pump'], [isHValve4, 'distributeur 4 voies', '4-way valve'],
  [isHCyl, 'vérin hydraulique', 'hydraulic cylinder'], [isHMotor, 'moteur hydraulique', 'hydraulic motor'], [isHManual, 'vanne manuelle', 'manual valve'],
  [isHFilter, 'filtre', 'filter'], [isAccu, 'accumulateur', 'accumulator'],
]
for (const [p, fr, en] of FLUID_NAMES) NAMES.set(p, [fr, en])
const hydroStatic = (c: Ctx, ps: P[]) => ps.every((p) => all(c, p).length > 0) && allWired(c, ps.flatMap((p) => all(c, p)), ['t2'])

/** Boucles complètes : bâche → pompe → distributeur 4 voies → charge (vérin ou moteur), avec retour à la bâche. */
function hydroLoops(c: Ctx, load: P, relaxed = false): { pump: PlacedSymbol; valve: PlacedSymbol; load: PlacedSymbol }[] {
  const n = netOf(c)
  const res: { pump: PlacedSymbol; valve: PlacedSymbol; load: PlacedSymbol }[] = []
  const usedV = new Set<string>(), usedL = new Set<string>()
  for (const t of all(c, isTank)) {
    const tankNets = [...dirNets(c, t, 'up', n), ...dirNets(c, t, 'down', n)]
    for (const p of all(c, isPump)) {
      if (!relaxed && !dirNets(c, p, 'down', n).some((x) => tankNets.includes(x))) continue // aspiration à la bâche (relaxed : peut passer par des organes en série)
      const outNets = dirNets(c, p, 'up', n)
      for (const v of all(c, isHValve4)) {
        if (usedV.has(v.id)) continue
        const down = dirNets(c, v, 'down', n)
        if (down.length < 2 || down[0] === down[1] || !down.some((x) => outNets.includes(x)) || !down.some((x) => tankNets.includes(x))) continue
        const up = dirNets(c, v, 'up', n)
        for (const l of all(c, load)) {
          if (usedL.has(l.id)) continue
          const lp = (c.defs[l.defId]?.ports ?? []).filter((q) => q.dir === 'up' || q.dir === 'down').map((q) => n(l.id, q.id))
          if (lp.length >= 2 && up.length >= 2 && up[0] !== up[1] && up.every((x) => lp.includes(x))) { res.push({ pump: p, valve: v, load: l }); usedV.add(v.id); usedL.add(l.id); break }
        }
      }
    }
  }
  return res
}

/** Le chemin « bâche → éléments à deux orifices → aspiration de la pompe » traverse tous les éléments donnés (dans un ordre quelconque). */
function suctionThrough(c: Ctx, elems: PlacedSymbol[]): boolean {
  const n = netOf(c)
  const tanks = all(c, isTank).flatMap((t) => [...dirNets(c, t, 'up', n), ...dirNets(c, t, 'down', n)])
  const pumps = all(c, isPump).flatMap((p) => dirNets(c, p, 'down', n))
  const edges = elems.map((e) => (c.defs[e.defId]?.ports ?? []).map((q) => n(e.id, q.id)))
  if (edges.some((e) => e.length < 2)) return false
  if (pumps.some((x) => tanks.includes(x))) return false // la pompe ne doit plus aspirer directement dans la bâche
  const perms = (a: number[]): number[][] => (a.length <= 1 ? [a] : a.flatMap((x, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).map((r) => [x, ...r])))
  for (const order of perms(elems.map((_, i) => i))) {
    for (let mask = 0; mask < 1 << order.length; mask++) {
      let cur: string[] = tanks
      let ok = true
      order.forEach((idx, k) => {
        const [a, b] = (mask >> k) & 1 ? [edges[idx][1], edges[idx][0]] : [edges[idx][0], edges[idx][1]]
        if (!cur.includes(a)) ok = false
        cur = [b]
      })
      if (ok && cur.some((x) => pumps.includes(x))) return true
    }
  }
  return false
}

const hCircuit = (load: string): [Spec[], Link[]] => [
  [['tank', TANK, 300, 330, ''], ['pump', PUMP, 150, 200, ''], ['v', VALVE4, 330, 190, ''], ['load', load, 500, 60, 'A1']],
  [['pump', 't1', 'tank', 't0'], ['pump', 't0', 'v', 't0'], ['v', 't1', 'tank', 't0'], ['v', 't2', 'load', 't0'], ['v', 't3', 'load', 't1']],
]
const hCyl = (base: Doc): Doc => { const [s, l] = hCircuit(HCYL); return build(base, s, l) }
const hMotor = (base: Doc): Doc => { const [s, l] = hCircuit(HMOT); return build(base, s, l) }
const hFilter = (base: Doc): Doc => {
  const [s, l] = hCircuit(HCYL)
  // la ligne d'aspiration traverse une vanne d'arrêt puis un filtre
  const links = l.filter((x) => !(x[0] === 'pump' && x[1] === 't1'))
  return build(base, [...s, ['van', HVAN, 250, 260, 'V1'], ['fil', HFILT, 200, 300, 'F1']], [...links, ['tank', 't0', 'van', 't0'], ['van', 't1', 'fil', 't0'], ['fil', 't1', 'pump', 't1']])
}
const hAccu = (base: Doc): Doc => {
  const [s, l] = hCircuit(HCYL)
  return build(base, [...s, ['acc', ACCU, 250, 100, '']], [...l, ['pump', 't0', 'acc', 't0']])
}
const hTwo = (base: Doc): Doc =>
  build(base,
    [['tank', TANK, 300, 400, ''], ['pump', PUMP, 100, 250, ''], ['v1', VALVE4, 280, 250, ''], ['c1', HCYL, 450, 120, 'A1'], ['v2', VALVE4, 280, 130, ''], ['c2', HCYL, 450, 30, 'A2']],
    [['pump', 't1', 'tank', 't0'], ['pump', 't0', 'v1', 't0'], ['pump', 't0', 'v2', 't0'], ['v1', 't1', 'tank', 't0'], ['v2', 't1', 'tank', 't0'],
      ['v1', 't2', 'c1', 't0'], ['v1', 't3', 'c1', 't1'], ['v2', 't2', 'c2', 't0'], ['v2', 't3', 'c2', 't1']])

const HYDRAULIC: GExercise[] = [
  {
    id: 'h-cyl', domain: 'hydraulic', level: 1, minutes: 20,
    title: L('Circuit hydraulique d’un vérin', 'Hydraulic circuit for a cylinder'),
    summary: L('Bâche, pompe, distributeur 4 voies et vérin : le circuit de base, avec son retour à la bâche.', 'Tank, pump, 4-way valve and cylinder: the basic circuit, with its return to the tank.'),
    brief: [
      L('Cahier des charges : une pompe aspire l’huile dans une bâche et l’envoie à un distributeur 4 voies. Le distributeur dirige l’huile vers l’une ou l’autre chambre d’un vérin double effet ; l’huile de l’autre chambre retourne à la bâche.', 'Brief: a pump draws oil from a tank and sends it to a 4-way valve. The valve directs the oil to one or the other chamber of a double-acting cylinder; the oil from the other chamber returns to the tank.'),
      L('En hydraulique, l’huile ne s’échappe pas à l’air : elle revient toujours à la bâche. Un circuit est donc toujours une boucle fermée sur la bâche.', 'In hydraulics the oil does not vent to air: it always returns to the tank. A circuit is therefore always a loop closed on the tank.'),
    ],
    parts: [
      L('Une bâche, une pompe, un distributeur 4 voies, un vérin double effet.', 'A tank, a pump, a 4-way valve, a double-acting cylinder.'),
    ],
    expect: [
      L('La pompe aspire l’huile dans la bâche (aspiration reliée à la bâche).', 'The pump draws oil from the tank (suction connected to the tank).'),
      L('Son refoulement va à l’orifice P du distributeur (un des deux orifices du bas).', 'Its delivery goes to port P of the valve (one of the two bottom ports).'),
      L('L’autre orifice du bas, T, retourne à la bâche.', 'The other bottom port, T, returns to the tank.'),
      L('Les deux orifices du haut, A et B, vont aux deux chambres du vérin : selon la position du distributeur, l’huile entre par l’une et ressort par l’autre vers la bâche.', 'The two top ports, A and B, go to the two cylinder chambers: depending on the valve position, oil enters one and leaves the other towards the tank.'),
    ],
    solution: hCyl,
    steps: [
      needStep('place', L('Posez la bâche, la pompe, un distributeur 4 voies et un vérin double effet', 'Place the tank, the pump, a 4-way valve and a double-acting cylinder'),
        L('Bibliothèque hydraulique : {{tank:loc}}, {{pump:loc}}, {{valve4:loc}} et {{hcyl:loc}}.', 'Hydraulic library: {{tank:loc}}, {{pump:loc}}, {{valve4:loc}} and {{hcyl:loc}}.'),[[isTank, 1], [isPump, 1], [isHValve4, 1], [isHCyl, 1]]),
      stepPlace('wire', L('Raccordez tous les orifices', 'Connect every port'),
        L('Le refoulement de la pompe (en haut) va sur un orifice du bas du distributeur (P). L’autre orifice du bas (T) retourne à la bâche. Les deux orifices du haut (A et B) vont aux deux chambres du vérin.', 'The pump delivery (top) goes to a bottom port of the valve (P). The other bottom port (T) returns to the tank. The two top ports (A and B) go to the two cylinder chambers.'),
        (c) => hydroStatic(c, [isTank, isPump, isHValve4, isHCyl])),
      stepPlace('loop', L('Le circuit est complet : aspiration à la bâche, refoulement au distributeur, retour à la bâche, les deux chambres du vérin reliées', 'The circuit is complete: suction from the tank, delivery to the valve, return to the tank, both cylinder chambers connected'),
        L('Vérifiez que l’aspiration de la pompe et le retour T du distributeur arrivent bien tous deux sur la bâche, et que P est sur le refoulement.', 'Check that the pump suction and the valve return T both reach the tank, and that P is on the delivery side.'),
        (c) => hydroLoops(c, isHCyl).length >= 1),
    ],
  },
  {
    id: 'h-motor', domain: 'hydraulic', level: 1, minutes: 20,
    title: L('Circuit hydraulique d’un moteur', 'Hydraulic circuit for a motor'),
    summary: L('Le même principe pour faire tourner un moteur hydraulique dans les deux sens.', 'The same principle to turn a hydraulic motor in both directions.'),
    brief: [
      L('Cahier des charges : un moteur hydraulique doit tourner dans les deux sens, commandé par un distributeur 4 voies alimenté par une pompe.', 'Brief: a hydraulic motor must turn in both directions, driven by a 4-way valve fed by a pump.'),
      L('Le schéma est le même que pour un vérin : le moteur remplace simplement le vérin. Inverser le distributeur inverse le sens de rotation.', 'The diagram is the same as for a cylinder: the motor simply replaces the cylinder. Reversing the valve reverses the direction of rotation.'),
    ],
    parts: [
      L('Une bâche, une pompe, un distributeur 4 voies, un moteur hydraulique.', 'A tank, a pump, a 4-way valve, a hydraulic motor.'),
    ],
    expect: [
      L('Même câblage que pour le vérin : aspiration à la bâche, refoulement à P, T à la bâche.', 'Same wiring as for the cylinder: suction to the tank, delivery to P, T to the tank.'),
      L('Les orifices A et B du distributeur vont aux deux orifices du moteur.', 'Ports A and B of the valve go to the two ports of the motor.'),
      L('Selon la position du distributeur, l’huile entre par l’un ou l’autre orifice : le moteur tourne dans un sens ou dans l’autre.', 'Depending on the valve position, oil enters one port or the other: the motor turns one way or the other.'),
    ],
    solution: hMotor,
    steps: [
      needStep('place', L('Posez la bâche, la pompe, un distributeur 4 voies et un moteur hydraulique', 'Place the tank, the pump, a 4-way valve and a hydraulic motor'),
        L('Le moteur remplace le vérin : {{hmot:loc}}, avec la même bâche, la même pompe et le même distributeur ({{tank}}, {{pump}}, {{valve4}}).', 'The motor replaces the cylinder: {{hmot:loc}}, with the same tank, pump and valve ({{tank}}, {{pump}}, {{valve4}}).'),[[isTank, 1], [isPump, 1], [isHValve4, 1], [isHMotor, 1]]),
      stepPlace('wire', L('Raccordez l’ensemble comme pour le vérin', 'Connect everything as for the cylinder'),
        L('Pompe → P ; T → bâche ; A et B → les deux orifices du moteur ; aspiration de la pompe → bâche.', 'Pump → P; T → tank; A and B → the two motor ports; pump suction → tank.'),
        (c) => hydroStatic(c, [isTank, isPump, isHValve4, isHMotor])),
      stepPlace('loop', L('Le circuit est complet et refermé sur la bâche', 'The circuit is complete and closed on the tank'),
        L('Deux orifices de moteur, deux orifices de travail du distributeur, reliés deux à deux.', 'Two motor ports, two valve work ports, connected in pairs.'),
        (c) => hydroLoops(c, isHMotor).length >= 1),
    ],
  },
  {
    id: 'h-filter', domain: 'hydraulic', level: 2, minutes: 25,
    title: L('Protéger l’aspiration : vanne d’arrêt et filtre', 'Protect the suction: shut-off valve and filter'),
    summary: L('Ajouter sur la ligne d’aspiration une vanne manuelle et un filtre.', 'Add a manual valve and a filter on the suction line.'),
    brief: [
      L('Cahier des charges : sur le circuit du vérin, la pompe doit être protégée des impuretés par un filtre d’aspiration, et on doit pouvoir isoler la bâche par une vanne manuelle pour intervenir sur la pompe.', 'Brief: on the cylinder circuit, the pump must be protected from contamination by a suction filter, and the tank must be isolable by a manual valve so the pump can be serviced.'),
      L('Les deux organes se placent en série sur la ligne bâche → pompe : bâche, vanne d’arrêt, filtre, pompe. Posés directement sur un fil, ils s’y insèrent seuls.', 'Both parts go in series on the tank → pump line: tank, shut-off valve, filter, pump. Dropped on a wire, they insert themselves.'),
    ],
    parts: [
      L('Le circuit du vérin complet, plus une vanne manuelle et un filtre sur la ligne d’aspiration.', 'The complete cylinder circuit, plus a manual valve and a filter on the suction line.'),
    ],
    expect: [
      L('La pompe n’aspire plus directement dans la bâche : l’huile passe d’abord par la vanne manuelle, puis par le filtre, puis entre dans la pompe.', 'The pump no longer draws directly from the tank: oil first passes through the manual valve, then the filter, then enters the pump.'),
      L('Le reste du circuit est inchangé : refoulement à P, T à la bâche, A et B au vérin.', 'The rest of the circuit is unchanged: delivery to P, T to the tank, A and B to the cylinder.'),
      L('Fermer la vanne isole la bâche pour intervenir sur la pompe.', 'Closing the valve isolates the tank so the pump can be serviced.'),
    ],
    solution: hFilter,
    steps: [
      stepPlace('base', L('Réalisez d’abord le circuit de base : bâche, pompe, distributeur et vérin raccordés', 'First build the basic circuit: tank, pump, valve and cylinder connected'),
        L('Reprenez l’exercice « Circuit hydraulique d’un vérin ».', 'Redo the “Hydraulic circuit for a cylinder” exercise.'),
        (c) => hydroStatic(c, [isTank, isPump, isHValve4, isHCyl]) && hydroLoops(c, isHCyl, true).length >= 1),
      needStep('place', L('Posez une vanne manuelle et un filtre', 'Place a manual valve and a filter'),
        L('Vanne : {{hvan:loc}}. Filtre : {{filt:loc}}. Posez-les sur le fil entre la bâche et la pompe : le fil se coupe et se raccorde tout seul.', 'Valve: {{hvan:loc}}. Filter: {{filt:loc}}. Drop them on the wire between tank and pump: the wire is cut and reconnected by itself.'),[[isHManual, 1], [isHFilter, 1]]),
      stepPlace('series', L('Sur la ligne d’aspiration : bâche → vanne → filtre → pompe', 'On the suction line: tank → valve → filter → pump'),
        L('Chaque organe a deux orifices : l’un côté bâche, l’autre côté pompe. L’aspiration ne doit plus aller directement de la bâche à la pompe.', 'Each part has two ports: one tank side, one pump side. The suction must no longer go straight from tank to pump.'),
        (c) => { const v = all(c, isHManual)[0], f = all(c, isHFilter)[0]; return !!v && !!f && suctionThrough(c, [v, f]) }),
    ],
  },
  {
    id: 'h-accu', domain: 'hydraulic', level: 2, minutes: 25,
    title: L('Ajouter un accumulateur', 'Add an accumulator'),
    summary: L('Un réservoir sous pression sur le refoulement de la pompe.', 'A pressurised reservoir on the pump delivery.'),
    brief: [
      L('Cahier des charges : on veut lisser les à-coups de pression et garder une réserve d’huile sous pression. On ajoute un accumulateur sur la ligne de refoulement de la pompe.', 'Brief: we want to smooth pressure pulses and keep a reserve of pressurised oil. An accumulator is added on the pump delivery line.'),
      L('L’accumulateur est un piquage sur la ligne de pression : il se raccorde au même point que le refoulement de la pompe, avant le distributeur.', 'The accumulator is a branch on the pressure line: it connects at the same point as the pump delivery, before the valve.'),
    ],
    parts: [
      L('Le circuit du vérin complet, plus un accumulateur.', 'The complete cylinder circuit, plus an accumulator.'),
    ],
    expect: [
      L('L’accumulateur se raccorde sur la ligne de refoulement, entre la pompe et l’orifice P du distributeur.', 'The accumulator connects on the delivery line, between the pump and port P of the valve.'),
      L('Le reste du circuit est inchangé.', 'The rest of the circuit is unchanged.'),
      L('Il stocke de l’huile sous pression quand la pompe en fournit trop et en restitue quand la demande augmente, ce qui lisse les à-coups.', 'It stores pressurised oil when the pump supplies too much and returns it when demand rises, smoothing pulses.'),
    ],
    solution: hAccu,
    steps: [
      stepPlace('base', L('Réalisez d’abord le circuit de base', 'First build the basic circuit'),
        L('Bâche, pompe, distributeur et vérin raccordés.', 'Tank, pump, valve and cylinder connected.'),
        (c) => hydroStatic(c, [isTank, isPump, isHValve4, isHCyl]) && hydroLoops(c, isHCyl).length >= 1),
      needStep('place', L('Posez un accumulateur (bâche pressurisée)', 'Place an accumulator (pressurised tank)'),
        L('Accumulateur : {{accu:loc}}.', 'Accumulator: {{accu:loc}}.'),[[isAccu, 1]]),
      stepPlace('wire', L('Raccordez l’accumulateur sur le refoulement de la pompe', 'Connect the accumulator to the pump delivery'),
        L('Il se branche sur le fil entre la pompe et l’orifice P du distributeur. Son seul orifice est relié à cette ligne.', 'It branches onto the wire between the pump and port P of the valve. Its single port connects to that line.'),
        (c) => { const n = netOf(c); const outNets = all(c, isPump).flatMap((p) => dirNets(c, p, 'up', n)); return all(c, isAccu).some((a) => (c.defs[a.defId]?.ports ?? []).some((q) => outNets.includes(n(a.id, q.id)))) && allWired(c, all(c, isAccu)) }),
    ],
  },
  {
    id: 'h-two', domain: 'hydraulic', level: 3, minutes: 35,
    title: L('Deux vérins sur une même pompe', 'Two cylinders on one pump'),
    summary: L('Une pompe, une bâche, deux distributeurs : deux vérins commandés séparément.', 'One pump, one tank, two valves: two independently controlled cylinders.'),
    brief: [
      L('Cahier des charges : une seule pompe alimente deux vérins A1 et A2, chacun commandé par son propre distributeur 4 voies. Les deux distributeurs sont alimentés en parallèle par la pompe et retournent à la même bâche.', 'Brief: a single pump feeds two cylinders A1 and A2, each driven by its own 4-way valve. Both valves are fed in parallel by the pump and return to the same tank.'),
      L('« En parallèle » signifie que le refoulement de la pompe se divise en deux branches, une par distributeur : chaque vérin peut bouger sans l’autre.', '“In parallel” means the pump delivery splits into two branches, one per valve: each cylinder can move without the other.'),
    ],
    parts: [
      L('Une bâche, une seule pompe, deux distributeurs 4 voies, deux vérins A1 et A2.', 'One tank, a single pump, two 4-way valves, two cylinders A1 and A2.'),
    ],
    expect: [
      L('La pompe aspire dans la bâche et son refoulement se divise en deux branches, une vers l’orifice P de chaque distributeur.', 'The pump draws from the tank and its delivery splits into two branches, one to port P of each valve.'),
      L('Le distributeur 1 commande le vérin A1 (ses orifices A et B vont aux deux chambres de A1).', 'Valve 1 drives cylinder A1 (its ports A and B go to the two chambers of A1).'),
      L('Le distributeur 2 commande le vérin A2 de la même façon.', 'Valve 2 drives cylinder A2 in the same way.'),
      L('Les orifices T des deux distributeurs retournent à la bâche : chaque vérin peut être commandé sans l’autre.', 'The T ports of both valves return to the tank: each cylinder can be driven without the other.'),
    ],
    solution: hTwo,
    steps: [
      needStep('place', L('Posez la bâche, la pompe, deux distributeurs 4 voies et deux vérins', 'Place the tank, the pump, two 4-way valves and two cylinders'),
        L('Posez un seul exemplaire de bâche et de pompe, mais deux distributeurs et deux vérins.', 'Place a single tank and a single pump, but two valves and two cylinders.'),[[isTank, 1], [isPump, 1], [isHValve4, 2], [isHCyl, 2]]),
      stepPlace('wire', L('Raccordez tous les orifices', 'Connect all the ports'),
        L('Le refoulement de la pompe alimente les orifices P des deux distributeurs ; leurs orifices T retournent à la bâche.', 'The pump delivery feeds port P of both valves; their T ports return to the tank.'),
        (c) => hydroStatic(c, [isTank, isPump, isHValve4, isHCyl])),
      stepPlace('loops', L('Chaque vérin est commandé par son distributeur, avec retour à la bâche', 'Each cylinder is driven by its valve, with return to the tank'),
        L('Les deux boucles doivent être complètes : pompe → distributeur → vérin → bâche.', 'Both loops must be complete: pump → valve → cylinder → tank.'),
        (c) => hydroLoops(c, isHCyl).length >= 2),
    ],
  },
]

export const GUIDED: GExercise[] = [...ELECTRICAL, ...PNEUMATIC, ...HYDRAULIC]
export const guidedById = (id: string) => GUIDED.find((g) => g.id === id)
void count; void syms
