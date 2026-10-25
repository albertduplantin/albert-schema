import { tokenize } from './sim/plc'
import type { PlcAction, PlcContact, PlcProgram, PlcRung, PlcStep, PlcTransition } from './sim/plc'

/**
 * Opérations d'édition du programme d'un automate (fonctions pures, utilisées par l'éditeur graphique).
 * Invariant : les étapes sont numérotées 0, 1, 2… dans l'ordre où elles sont dessinées ; chaque opération renumérote ce qu'il faut,
 * y compris les références « X2 » dans les conditions et les contacts Ladder.
 */

/** Réécrit les références d'étapes (X2, t/X2/3s) d'un texte selon une table de renumérotation. */
export function mapStepRefs(text: string, map: Map<number, number>): string {
  return text.replace(/\bX(\d+)\b/gi, (m, d: string) => (map.has(Number(d)) ? `X${map.get(Number(d))}` : m))
}

/** Applique une table ancien n° → nouveau n° à tout le programme ; les étapes absentes de la table disparaissent. */
export function renumber(prog: PlcProgram, map: Map<number, number>): PlcProgram {
  const steps = prog.steps
    .filter((s) => map.has(s.id))
    .map((s) => ({ ...s, id: map.get(s.id)!, actions: s.actions.map((a) => ({ ...a, var: mapStepRefs(a.var, map) })) }))
    .sort((a, b) => a.id - b.id)
  const transitions = prog.transitions.map((t) => ({
    ...t, from: t.from.filter((s) => map.has(s)).map((s) => map.get(s)!), to: t.to.filter((s) => map.has(s)).map((s) => map.get(s)!), cond: mapStepRefs(t.cond, map),
  }))
  const ladder = prog.ladder.map((r) => ({ ...r, branches: r.branches.map((b) => b.map((c) => ({ ...c, var: mapStepRefs(c.var, map) }))) }))
  return { ...prog, steps, transitions, ladder }
}

const emptyStep = (id: number): PlcStep => ({ id, actions: [] })

/** Insère une étape à la position `index` (0 = avant la première, n = après la dernière). Une transition entre ses deux voisines est coupée en deux. */
export function insertStep(prog: PlcProgram, index: number, step?: Omit<PlcStep, 'id'>): { prog: PlcProgram; id: number } {
  const n = prog.steps.length
  const k = Math.max(0, Math.min(n, index))
  const map = new Map<number, number>()
  prog.steps.forEach((s, i) => map.set(s.id, i < k ? i : i + 1))
  const base = renumber(prog, map)
  const created: PlcStep = { ...emptyStep(k), ...(step ?? {}), id: k, init: step?.init ?? (n === 0 ? true : undefined) }
  let transitions = base.transitions
  const before = k - 1, after = k + 1
  const direct = transitions.findIndex((t) => t.from.length === 1 && t.to.length === 1 && t.from[0] === before && t.to[0] === after)
  if (n > 0 && k > 0 && k < n && direct >= 0) {
    const old = transitions[direct]
    transitions = [...transitions.slice(0, direct), { from: [before], to: [k], cond: old.cond }, { from: [k], to: [after], cond: '1' }, ...transitions.slice(direct + 1)]
  } else if (k === n && n > 0) transitions = [...transitions, { from: [n - 1], to: [k], cond: '1' }]
  else if (k === 0 && n > 0) transitions = [{ from: [k], to: [1], cond: '1' }, ...transitions]
  return { prog: { ...base, steps: [...base.steps.slice(0, k), created, ...base.steps.slice(k)], transitions }, id: k }
}

/** Supprime une étape et rebranche son prédécesseur sur son successeur quand il n'y en a qu'un de chaque côté. */
export function deleteStep(prog: PlcProgram, id: number): PlcProgram {
  const ins = prog.transitions.filter((t) => t.to.includes(id))
  const outs = prog.transitions.filter((t) => t.from.includes(id))
  let transitions = prog.transitions.filter((t) => !t.from.includes(id) && !t.to.includes(id))
  if (ins.length === 1 && outs.length === 1 && ins[0].to.length === 1 && outs[0].from.length === 1 && !ins[0].from.includes(id) && !outs[0].to.includes(id)) {
    // la condition qui faisait quitter l'étape précédente est conservée
    transitions = [...transitions, { from: ins[0].from, to: outs[0].to, cond: ins[0].cond }]
  }
  transitions = [...transitions].sort((x, y) => Math.min(...x.from, 99) - Math.min(...y.from, 99))
  const map = new Map<number, number>()
  let j = 0
  for (const s of prog.steps) if (s.id !== id) map.set(s.id, j++)
  const removed = prog.steps.find((s) => s.id === id)
  const kept = renumber({ ...prog, transitions }, map)
  // si l'étape initiale a disparu, la première étape le devient
  if (removed?.init && kept.steps.length && !kept.steps.some((s) => s.init)) kept.steps[0] = { ...kept.steps[0], init: true }
  return kept
}

/** Déplace une étape (avec ses actions) à une autre position de la séquence : elle quitte son emplacement (voisins rebranchés) puis s'insère à `to`. */
export function moveStep(prog: PlcProgram, id: number, to: number): PlcProgram {
  const step = prog.steps.find((s) => s.id === id)
  if (!step) return prog
  const pos = prog.steps.findIndex((s) => s.id === id)
  if (to === pos || to === pos + 1) return prog
  const without = deleteStep(prog, id)
  const target = to > pos ? to - 1 : to
  const { actions, init, comment } = step
  const r = insertStep(without, target, { actions, init, comment })
  // l'étape initiale reste unique
  return r.prog
}

/** Ajoute `name` à une condition : « 1 » ou vide est remplacé, sinon on ajoute `ET` (ou `ET NON`). */
export function appendCond(cond: string, name: string, neg = false): string {
  const t = cond.trim()
  const term = neg ? `NON ${name}` : name
  if (!t || t === '1') return term
  if (/\bOU\b|\bOR\b|\+/.test(t) && !/^\(.*\)$/.test(t)) return `(${t}) ET ${term}`
  return `${t} ET ${term}`
}

export const addTransition = (prog: PlcProgram, from: number, to: number, cond = '1'): PlcProgram => ({ ...prog, transitions: [...prog.transitions, { from: [from], to: [to], cond }] })

export const setStep = (prog: PlcProgram, id: number, p: Partial<PlcStep>): PlcProgram => ({ ...prog, steps: prog.steps.map((s) => (s.id === id ? { ...s, ...p } : s)) })
export const setTransition = (prog: PlcProgram, i: number, p: Partial<PlcTransition>): PlcProgram => ({ ...prog, transitions: prog.transitions.map((t, k) => (k === i ? { ...t, ...p } : t)) })
export const addAction = (prog: PlcProgram, id: number, a: PlcAction): PlcProgram => {
  const s = prog.steps.find((x) => x.id === id)
  return s ? setStep(prog, id, { actions: [...s.actions, a] }) : prog
}

/** Fait de `id` la seule étape initiale. */
export const setInitial = (prog: PlcProgram, id: number, on: boolean): PlcProgram => ({ ...prog, steps: prog.steps.map((s) => (s.id === id ? { ...s, init: on || undefined } : on ? { ...s, init: undefined } : s)) })

// ── Ladder
export type CoilKind = PlcRung['coil']['kind']
export const newRung = (contact?: PlcContact): PlcRung => ({ branches: [[contact ?? { var: '' }]], coil: { kind: '=', var: '' } })

export function insertContact(rung: PlcRung, branch: number, at: number, c: PlcContact): PlcRung {
  if (branch >= rung.branches.length) return { ...rung, branches: [...rung.branches, [c]] }
  return { ...rung, branches: rung.branches.map((b, i) => (i === branch ? [...b.slice(0, at), c, ...b.slice(at)] : b)) }
}
export function removeContact(rung: PlcRung, branch: number, at: number): PlcRung {
  return { ...rung, branches: rung.branches.map((b, i) => (i === branch ? b.filter((_, k) => k !== at) : b)).filter((b) => b.length > 0) }
}
export function setContact(rung: PlcRung, branch: number, at: number, p: Partial<PlcContact>): PlcRung {
  return { ...rung, branches: rung.branches.map((b, i) => (i === branch ? b.map((c, k) => (k === at ? { ...c, ...p } : c)) : b)) }
}
export const setCoil = (rung: PlcRung, p: Partial<PlcRung['coil']>): PlcRung => ({ ...rung, coil: { ...rung.coil, ...p, ...(p.kind === 'TON' && !(rung.coil.preset || p.preset) ? { preset: 2000 } : {}) } })
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  const copy = [...list]
  const [x] = copy.splice(from, 1)
  copy.splice(to > from ? to - 1 : to, 0, x)
  return copy
}

/** Problèmes détectés dans le programme (affichés sous l'éditeur). */
export function lint(prog: PlcProgram, known: Set<string>, lang: 'fr' | 'en'): string[] {
  const fr = lang === 'fr'
  const out: string[] = []
  if (prog.steps.length && !prog.steps.some((s) => s.init)) out.push(fr ? 'Aucune étape initiale : le Grafcet ne démarrera pas.' : 'No initial step: the Grafcet will not start.')
  for (const t of prog.transitions) {
    if (!t.from.length || !t.to.length) out.push(fr ? 'Une transition n’a pas d’étape de départ ou d’arrivée.' : 'A transition has no source or target step.')
  }
  for (const s of prog.steps) {
    if (!prog.transitions.some((t) => t.to.includes(s.id)) && !s.init) out.push(fr ? `L’étape ${s.id} n’est atteinte par aucune transition.` : `Step ${s.id} is reached by no transition.`)
    if (!prog.transitions.some((t) => t.from.includes(s.id))) out.push(fr ? `L’étape ${s.id} n’a pas de transition de sortie : le cycle s’y arrêtera.` : `Step ${s.id} has no outgoing transition: the cycle will stop there.`)
  }
  const unknown = new Set<string>()
  const check = (v: string) => { const t = v.trim(); if (t && !known.has(t.toLowerCase()) && !/^(?:[IQ]0\.\d|M\d+|X\d+|T\d+)$/i.test(t)) unknown.add(t) }
  for (const t of prog.transitions) {
    try { for (const k of tokenize(t.cond)) { if (k.t === 'id' && !/^\d+$/.test(k.v)) check(k.v); else if (k.t === 'edge') check(k.v.split('|')[1]) } } catch { out.push(fr ? `Condition mal écrite : « ${t.cond} ».` : `Badly formed condition: “${t.cond}”.`) }
  }
  for (const s of prog.steps) for (const a of s.actions) { if (!a.var.trim()) out.push(fr ? `Étape ${s.id} : une action n’a pas de variable.` : `Step ${s.id}: an action has no variable.`); else check(a.var) }
  for (const r of prog.ladder) { for (const b of r.branches) for (const c of b) if (c.var.trim()) check(c.var); if (r.coil.var.trim()) check(r.coil.var) }
  if (unknown.size) out.push(fr ? `Variable inconnue : ${[...unknown].join(', ')} (donnez-lui un nom dans « Variables » ou utilisez une adresse I0.x, Q0.x, M0…).` : `Unknown variable: ${[...unknown].join(', ')}.`)
  return out
}
