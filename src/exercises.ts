import type { Doc, Lang, SymbolDef } from './types'
import { devKey, isOperableDef, simulate, type SimMemory } from './sim/engine'

/** Un pas du scénario de test : on manœuvre des boutons (par repère), on laisse passer du temps, puis on vérifie l'état d'appareils (par repère). */
export interface Step {
  /** boutons maintenus appuyés pendant ce pas */
  press?: string[]
  /** temps simulé écoulé avant la vérification (ms) */
  wait?: number
  /** état attendu : repère → alimenté ? */
  expect: Record<string, boolean>
  say: { fr: string; en: string }
}

export interface Exercise {
  id: string
  level: 1 | 2 | 3
  title: { fr: string; en: string }
  statement: { fr: string; en: string }
  /** repères à utiliser, rappelés à l'élève */
  labels: string[]
  steps: Step[]
}

const S = (fr: string, en: string) => ({ fr, en })

export const EXERCISES: Exercise[] = [
  {
    id: 'start-stop', level: 1,
    title: S('Marche / arrêt à auto-maintien', 'Start / stop with latching'),
    statement: S(
      'Dessinez un circuit de commande : source L, bouton d’arrêt S1 (contact NF), bouton de marche S2 (contact NO), bobine KM1 et son contact d’auto-maintien KM1 en parallèle de S2, retour au neutre N.',
      'Draw a control circuit: source L, stop button S1 (NC), start button S2 (NO), coil KM1 and its latching contact KM1 in parallel with S2, return to neutral N.'),
    labels: ['S1', 'S2', 'KM1'],
    steps: [
      { expect: { KM1: false }, say: S('Au repos, KM1 est coupée', 'At rest, KM1 is off') },
      { press: ['S2'], expect: { KM1: true }, say: S('Appui sur S2 : KM1 s’enclenche', 'Press S2: KM1 pulls in') },
      { expect: { KM1: true }, say: S('S2 relâché : KM1 reste enclenchée (auto-maintien)', 'S2 released: KM1 stays on (latching)') },
      { press: ['S1'], expect: { KM1: false }, say: S('Appui sur S1 : KM1 retombe', 'Press S1: KM1 drops out') },
      { expect: { KM1: false }, say: S('S1 relâché : KM1 reste coupée', 'S1 released: KM1 stays off') },
    ],
  },
  {
    id: 'lamp', level: 1,
    title: S('Voyant de marche', 'Run lamp'),
    statement: S(
      'Ajoutez au circuit précédent un voyant H1 qui s’allume tant que KM1 est enclenchée (commandé par un second contact KM1).',
      'Add to the previous circuit a lamp H1 that is on while KM1 is energised (driven by a second KM1 contact).'),
    labels: ['S1', 'S2', 'KM1', 'H1'],
    steps: [
      { expect: { KM1: false, H1: false }, say: S('Au repos, H1 éteint', 'At rest, H1 is off') },
      { press: ['S2'], expect: { KM1: true, H1: true }, say: S('Marche : KM1 et H1 allumés', 'Run: KM1 and H1 on') },
      { expect: { KM1: true, H1: true }, say: S('Après relâchement : toujours en marche', 'After release: still running') },
      { press: ['S1'], expect: { KM1: false, H1: false }, say: S('Arrêt : tout s’éteint', 'Stop: everything goes off') },
    ],
  },
  {
    id: 'delay', level: 2,
    title: S('Démarrage retardé de 5 s', '5 s delayed start'),
    statement: S(
      'Un appui sur S2 enclenche KM1 (auto-maintien). Une bobine temporisée KT (5 s, à la montée), alimentée par un contact de KM1, enclenche KM2 par un contact KT. S1 arrête tout.',
      'Pressing S2 energises KM1 (latched). A timed coil KT (5 s on-delay), fed by a KM1 contact, energises KM2 through a KT contact. S1 stops everything.'),
    labels: ['S1', 'S2', 'KM1', 'KT', 'KM2'],
    steps: [
      { expect: { KM1: false, KM2: false }, say: S('Au repos, rien n’est alimenté', 'At rest nothing is energised') },
      { press: ['S2'], expect: { KM1: true, KT: true, KM2: false }, say: S('Marche : KM1 et KT alimentées, KM2 pas encore', 'Run: KM1 and KT on, KM2 not yet') },
      { wait: 2000, expect: { KM2: false }, say: S('Après 2 s : KM2 toujours coupée', 'After 2 s: KM2 still off') },
      { wait: 4000, expect: { KM2: true }, say: S('Après 6 s : KM2 enclenchée', 'After 6 s: KM2 on') },
      { press: ['S1'], expect: { KM1: false, KM2: false }, say: S('Arrêt : tout retombe', 'Stop: all drop out') },
    ],
  },
  {
    id: 'interlock', level: 3,
    title: S('Verrouillage de deux contacteurs', 'Interlocking two contactors'),
    statement: S(
      'Deux départs : S2 enclenche KM1, S3 enclenche KM2 (chacun avec son auto-maintien), S1 arrête tout. Un contact NF de chaque contacteur, en série avec la bobine de l’autre, interdit leur enclenchement simultané.',
      'Two starters: S2 energises KM1, S3 energises KM2 (each latched), S1 stops all. An NC contact of each contactor, in series with the other’s coil, prevents both from pulling in together.'),
    labels: ['S1', 'S2', 'S3', 'KM1', 'KM2'],
    steps: [
      { press: ['S2'], expect: { KM1: true, KM2: false }, say: S('S2 : KM1 seul', 'S2: KM1 only') },
      { press: ['S3'], expect: { KM1: true, KM2: false }, say: S('S3 pendant KM1 : KM2 reste verrouillée', 'S3 while KM1 is on: KM2 stays locked out') },
      { press: ['S1'], expect: { KM1: false, KM2: false }, say: S('S1 : arrêt général', 'S1: general stop') },
      { press: ['S3'], expect: { KM1: false, KM2: true }, say: S('S3 : KM2 seule', 'S3: KM2 only') },
      { press: ['S2'], expect: { KM1: false, KM2: true }, say: S('S2 pendant KM2 : KM1 reste verrouillée', 'S2 while KM2 is on: KM1 stays locked out') },
    ],
  },
]

export interface StepResult { text: string; ok: boolean; detail?: string }

/** Rejoue le scénario sur le schéma de l'élève. */
export function runExercise(ex: Exercise, doc: Doc, defs: Record<string, SymbolDef>, lang: Lang): { ok: boolean; steps: StepResult[]; missing: string[] } {
  const present = new Set(doc.symbols.map((s) => devKey(s.label)))
  const missing = ex.labels.filter((l) => !present.has(devKey(l)))
  let mem: SimMemory = {}
  let now = 1_000_000
  const steps: StepResult[] = []
  const byLabel = (l: string) => doc.symbols.filter((s) => devKey(s.label) === devKey(l))
  for (const st of ex.steps) {
    now += st.wait ?? 100
    const pressed = new Set<string>()
    for (const l of st.press ?? []) for (const s of byLabel(l)) if (isOperableDef(defs[s.defId])) pressed.add(s.id)
    let r = simulate(doc, defs, mem, { pressed, toggled: new Set() }, now)
    mem = r.state
    // laisse le circuit se stabiliser (retombée d'un relais, etc.)
    r = simulate(doc, defs, mem, { pressed, toggled: new Set() }, now + 1)
    mem = r.state
    const bad: string[] = []
    for (const [l, want] of Object.entries(st.expect)) {
      const got = byLabel(l).some((s) => r.energized.has(s.id))
      if (got !== want) bad.push(`${l} : ${got ? (lang === 'fr' ? 'alimenté' : 'on') : (lang === 'fr' ? 'coupé' : 'off')}`)
    }
    steps.push({ text: st.say[lang], ok: bad.length === 0, detail: bad.join(', ') })
  }
  return { ok: missing.length === 0 && steps.every((s) => s.ok), steps, missing }
}
