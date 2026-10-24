import type { Doc, Domain, Lang, SymbolDef } from './types'
import { L, type Ctx, type GExercise, type GStep } from './guided'
import { isOperableDef, simulate, DEFAULT_DELAY_S, type SimMemory, type SimResult } from './sim/engine'
import { kindOf } from './ratings'
import { SYMBOL_MAP } from './symbols'
import { basePot, sourcePots } from './sim/potentials'

/** Exercice publié depuis la page d'administration : cahier des charges, comportement attendu et schéma de référence. */
export interface CustomExo {
  id: string
  domain: Domain
  level: 1 | 2 | 3
  minutes: number
  title: { fr: string; en: string }
  summary: { fr: string; en: string }
  brief: { fr: string[]; en: string[] }
  expect: { fr: string[]; en: string[] }
  doc: Doc
}

/** Famille de symbole pour comparer deux schémas : deux symboles équivalents en simulation comptent pour le même (bouton NO de n'importe quelle série…). */
function signature(def: SymbolDef | undefined): string {
  if (!def) return '?'
  const m = def.sim
  if (!m) return def.fluid ? `fluid:${def.fluid.k}:${def.id}` : def.id
  if (m.k === 'source') return 'source'
  if (m.k === 'switch') return `switch:${m.ctl}:${m.nc ? 'nc' : 'no'}:${m.changeover?.length ? 'co' : ''}:${m.delay ? 'delay' : ''}:${/02_power_contacts/.test(def.id) ? 'power' : ''}:${kindOf(def) ?? ''}`
  if (m.k === 'coil') return `coil:${m.timer ?? ''}`
  if (m.k === 'load') return `load:${m.role}:${m.windings ? 'w' : ''}`
  return `${m.k}:${def.id}`
}

const isGround = (def: SymbolDef | undefined) => !!def && /terre|earth|ground/i.test(def.id + def.name.fr + def.name.en) && !def.sim?.k
/** Appareil que l'élève manœuvre (bouton, interrupteur, vanne manuelle), hors protections. */
const isControl = (def: SymbolDef | undefined) => !!isOperableDef(def) && !kindOf(def)
/** Appareil dont l'état est observé : bobines, récepteurs, vérins. */
const isOutput = (def: SymbolDef | undefined) => def?.sim?.k === 'coil' || def?.sim?.k === 'load' || def?.fluid?.k === 'cyl'

/** Bornes que l'élève n'a pas à câbler : la terre d'une source (et le repère PE). */
const optionalPorts = (s: Doc['symbols'][number], d: SymbolDef | undefined): Set<string> => {
  const out = new Set<string>()
  if (d?.sim?.k === 'source') for (const [port, pot] of Object.entries(sourcePots(s, d))) if (basePot(pot) === 'PE') out.add(port)
  for (const p of d?.ports ?? []) if (/^PE$/i.test(p.label ?? '')) out.add(p.id)
  return out
}
const labelOf = (s: { label: string }) => s.label.trim()

/** Plan de manœuvres déduit de la solution : chaque organe de commande est actionné puis relâché ; on note ce qui est alimenté. */
function trace(doc: Doc, defs: Record<string, SymbolDef>, controls: string[], watched: Set<string>, wait: number): string[][] | null {
  try {
    let mem: SimMemory = {}
    let now = 1_000_000
    const out: string[][] = []
    const observe = (r: SimResult): string[] => {
      const names = new Set<string>()
      for (const s of doc.symbols) {
        const l = labelOf(s)
        if (!l || !watched.has(l) || !isOutput(defs[s.defId])) continue
        if (defs[s.defId]?.fluid?.k === 'cyl' ? (r.cylPos[s.id] ?? 0) > 0.5 : r.energized.has(s.id)) names.add(l)
      }
      return [...names].sort()
    }
    const step = (pressed: Set<string>, toggled: Set<string>) => {
      const inp = { pressed, toggled, cut: new Set<string>() }
      let r = simulate(doc, defs, mem, inp, now)
      mem = r.state
      now += wait
      r = simulate(doc, defs, mem, inp, now)
      mem = r.state
      out.push(observe(r))
    }
    step(new Set(), new Set())
    for (const label of controls) {
      const ids = doc.symbols.filter((s) => labelOf(s) === label && isControl(defs[s.defId])).map((s) => s.id)
      if (!ids.length) return null
      const momentary = ids.filter((i) => isOperableDef(defs[doc.symbols.find((s) => s.id === i)!.defId]) === 'momentary')
      const toggles = ids.filter((i) => !momentary.includes(i))
      step(new Set(momentary), new Set(toggles))
      step(new Set(), new Set())
    }
    return out
  } catch { return null }
}

/** Construit l'exercice guidé complet à partir d'un exercice publié : les étapes se déduisent du schéma de référence. */
export function customExercise(x: CustomExo): GExercise {
  const defs = SYMBOL_MAP
  const ref = x.doc
  const need = new Map<string, { n: number; name: { fr: string; en: string } }>()
  for (const s of ref.symbols) {
    const d = defs[s.defId]
    if (!d || isGround(d) || d.decor) continue
    const sig = signature(d)
    const e = need.get(sig) ?? { n: 0, name: d.name }
    e.n++
    need.set(sig, e)
  }
  const watchedList = [...new Set(ref.symbols.filter((s) => labelOf(s) && isOutput(defs[s.defId])).map(labelOf))]
  const watched = new Set(watchedList)
  const controls = [...new Set(ref.symbols.filter((s) => labelOf(s) && isControl(defs[s.defId])).map(labelOf))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  const tags = [...new Set(ref.symbols.filter((s) => labelOf(s) && (isControl(defs[s.defId]) || isOutput(defs[s.defId]))).map(labelOf))]
  const maxDelay = Math.max(0, ...ref.symbols.map((s) => { const m = defs[s.defId]?.sim; return m?.k === 'coil' && m.timer ? s.delay ?? DEFAULT_DELAY_S : 0 }))
  const wait = Math.max(800, maxDelay * 1000 + 500)
  const simulable = ref.symbols.some((s) => defs[s.defId]?.sim) && controls.length > 0
  const expected = simulable ? trace(ref, defs, controls, watched, wait) : null

  const counts = (c: Ctx) => {
    const m = new Map<string, number>()
    for (const s of c.doc.symbols) m.set(signature(c.defs[s.defId]), (m.get(signature(c.defs[s.defId])) ?? 0) + 1)
    return m
  }
  const missingParts = (c: Ctx): string[] => {
    const have = counts(c)
    const fr = c.lang === 'fr'
    const out: string[] = []
    for (const [sig, e] of need) {
      const g = have.get(sig) ?? 0
      if (g < e.n) out.push(`${fr ? 'À poser' : 'To place'} : ${e.name[c.lang]} × ${e.n - g}`)
    }
    return out
  }
  const placeStep: GStep = {
    id: 'place', title: L('Posez tout le matériel du schéma', 'Place all the equipment of the diagram'),
    hint: L('Le cahier des charges et la liste « Il vous manque » indiquent les appareils à poser. Des symboles équivalents (autre série, autre dessin) sont acceptés.', 'The brief and the “Still missing” list tell you which devices to place. Equivalent symbols (other series, other drawing) are accepted.'),
    done: (c) => c.doc.symbols.length > 0 && missingParts(c).length === 0,
    missing: (c) => (c.doc.symbols.length ? missingParts(c) : []),
  }
  const tagMissing = (c: Ctx) => tags.filter((t) => !c.doc.symbols.some((s) => labelOf(s) === t)).map((t) => (c.lang === 'fr' ? 'Repère absent : ' : 'Missing tag: ') + t)
  const tagStep: GStep = {
    id: 'tags', title: L(`Repérez les appareils : ${tags.join(', ')}`, `Tag the devices: ${tags.join(', ')}`),
    hint: L('Double-clic sur un symbole pour changer son repère. Les contacts commandés par une bobine prennent le repère de cette bobine.', 'Double-click a symbol to change its tag. Coil-driven contacts take the tag of their coil.'),
    done: (c) => c.doc.symbols.length > 0 && tagMissing(c).length === 0,
    missing: (c) => (c.doc.symbols.length ? tagMissing(c) : []),
  }
  const wireStep: GStep = {
    id: 'wire', title: L('Câblez le schéma : aucune borne ne reste libre', 'Wire the diagram: no terminal left free'),
    hint: L('Chaque borne des appareils posés doit recevoir un fil (sauf la terre). Cliquez sur une borne puis sur une autre pour tracer un conducteur.', 'Every terminal of the placed devices must get a wire (except earth). Click a terminal then another to draw a conductor.'),
    done: (c) => {
      const list = c.doc.symbols.filter((s) => !isGround(c.defs[s.defId]) && !c.defs[s.defId]?.decor)
      if (!list.length) return false
      const used = new Set(c.doc.wires.flatMap((w) => [`${w.from.symId}:${w.from.portId}`, `${w.to.symId}:${w.to.portId}`]))
      return list.every((s) => { const opt = optionalPorts(s, c.defs[s.defId]); return (c.defs[s.defId]?.ports ?? []).every((p) => opt.has(p.id) || used.has(`${s.id}:${p.id}`)) })
    },
    missing: (c) => {
      if (!c.doc.symbols.length) return []
      const used = new Set(c.doc.wires.flatMap((w) => [`${w.from.symId}:${w.from.portId}`, `${w.to.symId}:${w.to.portId}`]))
      const out: string[] = []
      for (const s of c.doc.symbols) {
        if (isGround(c.defs[s.defId]) || c.defs[s.defId]?.decor) continue
        const opt = optionalPorts(s, c.defs[s.defId])
        for (const p of c.defs[s.defId]?.ports ?? []) if (!opt.has(p.id) && !used.has(`${s.id}:${p.id}`)) out.push(`${labelOf(s) || c.defs[s.defId].name[c.lang]} : ${c.lang === 'fr' ? 'borne' : 'terminal'} ${p.label || p.id}`)
      }
      return out.slice(0, 8)
    },
  }
  const simStep: GStep = {
    id: 'sim', title: L('Passez en mode Simulation', 'Switch to Simulation mode'),
    hint: L('Bouton « ▶ Simuler » en haut de l’écran. Cliquez ensuite sur les boutons et interrupteurs pour les manœuvrer.', 'Click “▶ Simulate” at the top of the screen. Then click buttons and switches to operate them.'),
    done: (c) => c.simMode,
  }
  /** Compare le comportement du schéma de l'élève à celui de la référence, manœuvre par manœuvre. */
  const diff = (c: Ctx): string[] => {
    if (!expected) return []
    const got = trace(c.doc, c.defs, controls, watched, wait)
    const fr = c.lang === 'fr'
    if (!got) return [fr ? 'Un organe de commande est introuvable : vérifiez les repères.' : 'A control device is missing: check the tags.']
    const phases = ['', ...controls.flatMap((l) => [l, l])]
    const out: string[] = []
    expected.forEach((e, i) => {
      if (JSON.stringify(e) === JSON.stringify(got[i])) return
      const when = i === 0 ? (fr ? 'Au repos' : 'At rest') : i % 2 === 1 ? (fr ? `J’appuie sur ${phases[i]}` : `I press ${phases[i]}`) : (fr ? `Je relâche ${phases[i]}` : `I release ${phases[i]}`)
      const list = (a: string[]) => (a.length ? a.join(', ') : fr ? 'rien' : 'nothing')
      out.push(`${when} : ${fr ? 'attendu' : 'expected'} ${list(e)} — ${fr ? 'obtenu' : 'got'} ${list(got[i] ?? [])}`)
    })
    return out
  }
  const runStep: GStep = {
    id: 'run', title: L('Le fonctionnement est conforme au cahier des charges', 'The behaviour meets the brief'),
    hint: L('En simulation, manœuvrez chaque bouton : ce qui s’allume doit correspondre au fonctionnement attendu. Les écarts constatés sont listés sous l’étape.', 'In simulation, operate each button: what lights up must match the expected behaviour. Differences found are listed under the step.'),
    done: (c) => c.doc.symbols.length > 0 && diff(c).length === 0,
    missing: (c) => (c.doc.symbols.length ? diff(c).slice(0, 4) : []),
  }
  const pair = (a: string[], b: string[]): L[] => a.map((fr, i) => ({ fr, en: b[i] ?? fr }))
  return {
    id: 'u-' + x.id, domain: x.domain, level: x.level, minutes: x.minutes,
    title: x.title, summary: x.summary,
    brief: pair(x.brief.fr, x.brief.en),
    parts: [L(`Matériel : ${[...need.values()].map((e) => `${e.n} × ${e.name.fr}`).join(' ; ')}.`, `Equipment: ${[...need.values()].map((e) => `${e.n} × ${e.name.en}`).join('; ')}.`)],
    expect: pair(x.expect.fr, x.expect.en),
    solution: (base) => ({ ...base, ...structuredClone(ref), title: base.title }),
    steps: [placeStep, ...(tags.length ? [tagStep] : []), wireStep, ...(expected ? [simStep, runStep] : [])],
  }
}

export const isLang = (v: unknown): v is Lang => v === 'fr' || v === 'en'
