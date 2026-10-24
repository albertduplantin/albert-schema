import type { Doc, PlacedSymbol } from './types'
import { build, type Link, type Spec } from './templates'
import { checkDoc } from './check'
import { EXERCISES } from './exercises'
import { DEFAULT_DELAY_S } from './sim/engine'
import { allWired, count, L, passes, syms, type Ctx, type GExercise, type GStep } from './guided'

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
const isSource: P = (_c, s) => s.defId === 'sim-src1'
const isNOBtn: P = (c, s) => { const m = model(c, s); return m?.k === 'switch' && m.ctl === 'momentary' && !m.nc }
const isNCBtn: P = (c, s) => { const m = model(c, s); return m?.k === 'switch' && m.ctl === 'momentary' && m.nc }
const isToggle: P = (c, s) => { const m = model(c, s); return m?.k === 'switch' && m.ctl === 'toggle' }
const isLamp: P = (c, s) => { const m = model(c, s); return m?.k === 'load' && m.role === 'lamp' }
const isCoil: P = (c, s) => { const m = model(c, s); return m?.k === 'coil' && !m.timer }
const isTimer: P = (c, s) => { const m = model(c, s); return m?.k === 'coil' && !!m.timer }
const isNOk: P = (c, s) => { const m = model(c, s); return m?.k === 'switch' && m.ctl === 'coil' && !m.nc && !power(s) && !m.delay }
const isNCk: P = (c, s) => { const m = model(c, s); return m?.k === 'switch' && m.ctl === 'coil' && m.nc && !power(s) && !m.delay }
const all = (c: Ctx, p: P) => c.doc.symbols.filter((s) => p(c, s))
const has = (c: Ctx, p: P, n = 1) => all(c, p).length >= n
const wired = (c: Ctx, ps: P[]) => ps.every((p) => all(c, p).length > 0) && allWired(c, ps.flatMap((p) => all(c, p)), [])
const sourceWired = (c: Ctx) => allWired(c, all(c, isSource), ['c']) // la borne PE reste libre

const stepPlace = (id: string, title: L, hint: L, done: GStep['done']): GStep => ({ id, title, hint, done })
const simStep = (): GStep => ({ id: 'sim', title: L('Passez en mode Simulation', 'Switch to Simulation mode'), hint: L('Bouton « ▶ Simuler » en haut de l’écran. Cliquez ensuite sur les boutons et interrupteurs pour les manœuvrer.', 'Click “▶ Simulate” at the top of the screen. Then click buttons and switches to operate them.'), done: (c) => c.simMode })

/** Étape finale : le circuit se comporte comme demandé (scénario rejoué dans le simulateur). */
const behaviour = (id: string, title: L, hint: L, steps: import('./exercises').Step[], labels: string[]): GStep => ({ id, title, hint, done: (c) => passes(c, steps, labels) })

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

export const GUIDED: GExercise[] = [
  // ───────────────────────── électrique, niveau 1
  {
    id: 'e-lamp', domain: 'electrical', level: 1, minutes: 10,
    title: L('Allumer une lampe avec un interrupteur', 'Light a lamp with a switch'),
    summary: L('Le premier circuit : source, interrupteur, lampe.', 'The first circuit: source, switch, lamp.'),
    brief: [
      L('Cahier des charges : une lampe de 230 V doit s’allumer quand on ferme un interrupteur et s’éteindre quand on l’ouvre.', 'Brief: a 230 V lamp must light when a switch is closed and go off when it is opened.'),
      L('Le circuit est alimenté par une source monophasée : phase L et neutre N. Le courant part de la phase, traverse l’interrupteur puis la lampe, et revient par le neutre.', 'The circuit is supplied by a single-phase source: phase L and neutral N. Current leaves the phase, goes through the switch then the lamp, and returns by the neutral.'),
    ],
    solution: lampSwitch,
    steps: [
      stepPlace('place', L('Posez la source, un interrupteur et une lampe', 'Place the source, a switch and a lamp'),
        L('Bibliothèque ▸ « Sources et alimentations » : « Source monophasée ou continue ». Puis un interrupteur (recherchez « interrupteur » ou « switch ») et une lampe (recherchez « lampe »).', 'Library ▸ “Sources and power supplies”: “Single-phase or DC source”. Then a switch and a lamp (search “switch”, “lamp”).'),
        (c) => has(c, isSource) && has(c, isToggle) && has(c, isLamp)),
      stepPlace('wire', L('Câblez le circuit en boucle : L → interrupteur → lampe → N', 'Wire the circuit as a loop: L → switch → lamp → N'),
        L('Cliquez sur une borne puis sur la suivante. La borne PE de la source reste libre. Un circuit doit toujours se refermer sur la source.', 'Click a terminal then the next one. The source PE terminal stays free. A circuit must always close back on the source.'),
        (c) => sourceWired(c) && wired(c, [isToggle, isLamp])),
      simStep(),
      behaviour('run', L('Fermez l’interrupteur : la lampe s’allume ; ouvrez-le : elle s’éteint', 'Close the switch: the lamp lights; open it: it goes off'),
        L('En simulation, cliquez sur l’interrupteur pour le fermer ou l’ouvrir. La lampe s’allume quand le courant peut circuler dans toute la boucle.', 'In simulation, click the switch to close or open it. The lamp lights when current can flow around the whole loop.'),
        [
          { expect: { H1: false }, say: L('Interrupteur ouvert : lampe éteinte', 'Switch open: lamp off') },
          { toggle: ['S1'], expect: { H1: true }, say: L('Interrupteur fermé : lampe allumée', 'Switch closed: lamp on') },
          { expect: { H1: false }, say: L('Réouvert : lampe éteinte', 'Reopened: lamp off') },
        ], ['S1', 'H1']),
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
    solution: startStop,
    steps: [
      stepPlace('place', L('Posez la source, S1 (arrêt, NF), S2 (marche, NO), la bobine KM1 et un contact NO', 'Place the source, S1 (stop, NC), S2 (start, NO), coil KM1 and a NO contact'),
        L('Boutons : « poussoir » (NO) et « poussoir NF ». Bobine : « bobine ». Contact : « contact simple » (NO) dans les contacts auxiliaires. Posez d’abord S1 (arrêt) puis S2 (marche) pour que les repères soient ceux de l’énoncé.', 'Buttons: “push button” (NO) and “push button NC”. Coil: “coil”. Contact: “simple contact” (NO) in auxiliary contacts. Place S1 (stop) first, then S2 (start), so tags match the brief.'),
        (c) => has(c, isSource) && has(c, isNCBtn) && has(c, isNOBtn) && has(c, isCoil) && has(c, isNOk)),
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
    solution: lamps24,
    steps: [
      stepPlace('place', L('Posez la source, S1, S2, la bobine KM1, deux voyants H1 et H2 et trois contacts de KM1', 'Place the source, S1, S2, coil KM1, two lamps H1 and H2 and three KM1 contacts'),
        L('Un contact NO d’auto-maintien, un contact NO pour H1 (marche) et un contact NF pour H2 (arrêt). Les contacts prennent le repère de la bobine.', 'One NO latching contact, one NO contact for H1 (run) and one NC contact for H2 (stop). Contacts take the coil tag.'),
        (c) => has(c, isSource) && has(c, isNCBtn) && has(c, isNOBtn) && has(c, isCoil) && has(c, isNOk, 2) && has(c, isNCk) && has(c, isLamp, 2)),
      stepPlace('volts', L('Réglez la source, la bobine et les deux voyants sur 24 V', 'Set the source, the coil and both lamps to 24 V'),
        L('Sélectionnez la source : champ « Tension de la source » = 24. Pour la bobine et chaque voyant : champ « Tension nominale » = 24 (liste ▾ des valeurs usuelles).', 'Select the source: “Source voltage” = 24. For the coil and each lamp: “Rated voltage” = 24 (usual values list ▾).'),
        (c) => all(c, isSource).every((s) => s.volts === 24) && has(c, isSource) && all(c, isCoil).every((s) => s.volts === 24) && all(c, isLamp).length >= 2 && all(c, isLamp).every((s) => s.volts === 24)),
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
    solution: twoPosts,
    steps: [
      stepPlace('place', L('Posez la source, deux arrêts NF (S1, S4), deux marches NO (S2, S3), la bobine KM1 et son contact', 'Place the source, two NC stops (S1, S4), two NO starts (S2, S3), coil KM1 and its contact'),
        L('Repères attendus : S1 et S4 pour les arrêts, S2 et S3 pour les marches. Modifiez-les par double-clic si besoin.', 'Expected tags: S1 and S4 for the stops, S2 and S3 for the starts. Double-click to change them if needed.'),
        (c) => has(c, isSource) && has(c, isNCBtn, 2) && has(c, isNOBtn, 2) && has(c, isCoil) && has(c, isNOk)),
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
    solution: delayed,
    steps: [
      stepPlace('place', L('Posez la source, S1, S2, KM1 et son auto-maintien, la bobine temporisée KT, KM2 et leurs contacts', 'Place the source, S1, S2, KM1 and its latching contact, the timed coil KT, KM2 and its contacts'),
        L('Bobine temporisée : « bobine temporisée au travail » (la temporisation se règle sur la bobine). Contacts : trois « contacts simples » NO, repérés KM1 (auto-maintien), KM1 (vers KT) et KT (vers KM2). Repères des bobines : KM1, KT, KM2.', 'Timed coil: “on-delay coil” (the delay is set on the coil). Contacts: three NO “simple contacts” tagged KM1 (latching), KM1 (to KT) and KT (to KM2). Coil tags: KM1, KT, KM2.'),
        (c) => has(c, isSource) && has(c, isNCBtn) && has(c, isNOBtn) && has(c, isCoil, 2) && has(c, isTimer) && has(c, isNOk, 3)),
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
    solution: interlock,
    steps: [
      stepPlace('place', L('Posez la source, S1, S2, S3, KM1 et KM2 avec chacun un contact NO et un contact NF', 'Place the source, S1, S2, S3, KM1 and KM2, each with one NO and one NC contact'),
        L('Chaque contacteur a une bobine, un contact NO d’auto-maintien et un contact NF qui sert de verrouillage sur l’autre.', 'Each contactor has a coil, a NO latching contact and an NC contact used as interlock on the other.'),
        (c) => has(c, isSource) && has(c, isNCBtn) && has(c, isNOBtn, 2) && has(c, isCoil, 2) && has(c, isNOk, 2) && has(c, isNCk, 2)),
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
    solution: sequence,
    steps: [
      stepPlace('place', L('Posez la source, S1, S2, S3, KM1, KM2 et trois contacts NO', 'Place the source, S1, S2, S3, KM1, KM2 and three NO contacts'),
        L('Deux contacts d’auto-maintien (KM1 et KM2) et un contact KM1 de condition devant S3.', 'Two latching contacts (KM1 and KM2) and one KM1 condition contact in front of S3.'),
        (c) => has(c, isSource) && has(c, isNCBtn) && has(c, isNOBtn, 2) && has(c, isCoil, 2) && has(c, isNOk, 3)),
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

export const guidedById = (id: string) => GUIDED.find((g) => g.id === id)
void count; void syms
