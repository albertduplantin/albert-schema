import type { PlcProgram, PlcTransition } from './sim/plc'
import { mapStepRefs, renumber } from './plcEdit'

/**
 * Structure graphique d'un Grafcet : séquences, divergences et convergences en OU (sélection de séquence) ou en ET (parallélisme), sauts.
 * Le programme reste une liste d'étapes et de transitions (une transition relie une ou plusieurs étapes amont à une ou plusieurs étapes aval) ;
 * ce module en déduit l'arbre à dessiner et fournit les opérations d'édition qui gardent le programme cohérent.
 */
export type GNode =
  | { k: 'step'; id: number }
  | { k: 'tr'; i: number }
  /** divergence en OU : chaque branche commence par une transition ; `merge` = étape où les branches se rejoignent */
  | { k: 'or'; branches: GNode[][]; merge: number | null }
  /** divergence en ET : chaque branche commence par une étape ; `join` = transition de convergence (dessinée après le bloc) */
  | { k: 'and'; branches: GNode[][]; join: number | null }
  /** renvoi vers une étape déjà dessinée (reprise de séquence, boucle) */
  | { k: 'jump'; to: number }

type End = { kind: 'end' } | { kind: 'jump' } | { kind: 'merge'; x: number } | { kind: 'join'; i: number }

/** Arbre à dessiner : une liste de séquences (la première part de l'étape initiale ; les suivantes sont des étapes isolées ou d'autres étapes initiales). */
export function parseGraph(prog: PlcProgram): GNode[][] {
  const tr = prog.transitions
  const outs = (s: number) => tr.map((t, i) => ({ t, i })).filter(({ t }) => t.from.includes(s))
  const incoming = (x: number) => tr.filter((t) => t.to.includes(x)).length
  const visited = new Set<number>()

  function follow(i: number, ctx: 'main' | 'or' | 'and', nodes: GNode[]): { end: End } | { cur: number } {
    const t = tr[i]
    nodes.push({ k: 'tr', i })
    if (!t.to.length) return { end: { kind: 'end' } }
    if (t.to.length === 1) {
      const x = t.to[0]
      if (visited.has(x)) { nodes.push({ k: 'jump', to: x }); return { end: { kind: 'jump' } } }
      if (ctx === 'or' && incoming(x) > 1) return { end: { kind: 'merge', x } }
      nodes.push({ k: 'step', id: x }); visited.add(x)
      return { cur: x }
    }
    // divergence en ET : une branche par étape d'arrivée
    const results = t.to.map((y) => seq(y, 'and'))
    const j = results.map((r) => (r.end.kind === 'join' ? r.end.i : -1)).find((v) => v >= 0) ?? -1
    nodes.push({ k: 'and', branches: results.map((r) => r.nodes), join: j >= 0 ? j : null })
    if (j < 0) return { end: { kind: 'end' } }
    return follow(j, ctx, nodes)
  }

  function cont(start: number, ctx: 'main' | 'or' | 'and', nodes: GNode[]): End {
    let cur = start
    for (;;) {
      const all = outs(cur)
      const o = all.filter(({ t }) => t.from.length === 1)
      if (!all.length) return { kind: 'end' }
      if (!o.length) return { kind: 'join', i: all[0].i } // transition de convergence : gérée par le bloc ET qui contient cette séquence
      if (o.length === 1) {
        const r = follow(o[0].i, ctx, nodes)
        if ('end' in r) return r.end
        cur = r.cur
        continue
      }
      // divergence en OU
      const ends: End[] = []
      const branches = o.map(({ i }) => {
        const b: GNode[] = []
        const r = follow(i, 'or', b)
        ends.push('end' in r ? r.end : cont(r.cur, 'or', b))
        return b
      })
      const merge = ends.find((e): e is { kind: 'merge'; x: number } => e.kind === 'merge')
      const join = ends.find((e): e is { kind: 'join'; i: number } => e.kind === 'join')
      nodes.push({ k: 'or', branches, merge: merge ? merge.x : null })
      if (join && !merge) return join
      if (!merge) return { kind: 'end' }
      if (visited.has(merge.x)) { nodes.push({ k: 'jump', to: merge.x }); return { kind: 'jump' } }
      nodes.push({ k: 'step', id: merge.x }); visited.add(merge.x)
      cur = merge.x
    }
  }

  function seq(start: number, ctx: 'main' | 'or' | 'and'): { nodes: GNode[]; end: End } {
    if (visited.has(start)) return { nodes: [{ k: 'jump', to: start }], end: { kind: 'jump' } }
    const nodes: GNode[] = [{ k: 'step', id: start }]
    visited.add(start)
    return { nodes, end: cont(start, ctx, nodes) }
  }

  const roots: number[] = [
    ...prog.steps.filter((s) => s.init).map((s) => s.id),
    ...prog.steps.filter((s) => !s.init && !tr.some((t) => t.to.includes(s.id))).map((s) => s.id),
  ]
  const seqs: GNode[][] = []
  for (const r of roots) if (!visited.has(r)) seqs.push(seq(r, 'main').nodes)
  // étapes restantes (cycles sans entrée) : une séquence chacune
  for (const s of prog.steps) if (!visited.has(s.id)) seqs.push(seq(s.id, 'main').nodes)
  return seqs
}

/** Numéros d'étapes dans l'ordre où elles sont dessinées (de haut en bas, de gauche à droite). */
export function drawOrder(seqs: GNode[][]): number[] {
  const out: number[] = []
  const walk = (nodes: GNode[]) => {
    for (const n of nodes) {
      if (n.k === 'step') out.push(n.id)
      else if (n.k === 'or' || n.k === 'and') n.branches.forEach(walk)
    }
  }
  seqs.forEach(walk)
  return out
}

/** Renumérote les étapes 0, 1, 2… dans l'ordre du dessin (les références X2 des conditions suivent). */
export function normalize(prog: PlcProgram): PlcProgram {
  if (prog.manual) return prog // numéros choisis à la main : on n'y touche pas
  const order = drawOrder(parseGraph(prog))
  const map = new Map<number, number>()
  order.forEach((id, k) => map.set(id, k))
  let j = order.length
  for (const s of prog.steps) if (!map.has(s.id)) map.set(s.id, j++)
  if ([...map].every(([a, b]) => a === b)) return prog
  const r = renumber(prog, map)
  return { ...r, transitions: r.transitions.map((t) => ({ ...t, cond: mapStepRefs(t.cond, map) })) }
}

const newId = (prog: PlcProgram) => prog.steps.reduce((m, s) => Math.max(m, s.id), -1) + 1
const withStep = (prog: PlcProgram, id: number, extra: Partial<{ actions: { kind: 'N' | 'S' | 'R'; var: string }[]; comment: string }> = {}): PlcProgram => ({
  ...prog, steps: [...prog.steps, { id, actions: extra.actions ?? [], comment: extra.comment }],
})

/** Insère une étape sur la transition `i` : elle conserve la condition d'origine en amont ; la nouvelle étape est suivie d'une condition « 1 ». */
export function splitTransition(prog: PlcProgram, i: number): PlcProgram {
  const t = prog.transitions[i]
  if (!t || t.to.length === 0) return prog
  const n = newId(prog)
  const p = withStep(prog, n)
  const first: PlcTransition = { from: t.from, to: [n], cond: t.cond }
  const second: PlcTransition = { from: [n], to: t.to, cond: '1' }
  return normalize({ ...p, transitions: [...p.transitions.slice(0, i), first, second, ...p.transitions.slice(i + 1)] })
}

/** Ajoute une étape à la suite d'une étape qui n'a pas de transition de sortie. */
export function appendStep(prog: PlcProgram, after: number): PlcProgram {
  const n = newId(prog)
  const p = withStep(prog, n)
  return normalize({ ...p, transitions: [...p.transitions, { from: [after], to: [n], cond: '1' }] })
}

/** Ajoute une nouvelle étape initiale en tête du Grafcet (ou crée l'étape initiale d'un Grafcet vide). */
export function insertAtStart(prog: PlcProgram): PlcProgram {
  const n = newId(prog)
  const first = prog.steps.find((s) => s.init)
  const p = withStep(prog, n)
  if (!first) return normalize({ ...p, steps: p.steps.map((s) => (s.id === n ? { ...s, init: true } : s)) })
  return normalize({
    ...p,
    steps: p.steps.map((s) => (s.id === n ? { ...s, init: true } : s.id === first.id ? { ...s, init: undefined } : s)),
    transitions: [{ from: [n], to: [first.id], cond: '1' }, ...p.transitions],
  })
}

/** Divergence en OU (sélection de séquence) : ajoute à l'étape une branche alternative qui rejoint la même étape d'arrivée que la séquence existante. */
export function addAlternative(prog: PlcProgram, step: number): PlcProgram {
  const n = newId(prog)
  const p = withStep(prog, n)
  const outs = p.transitions.map((t, i) => ({ t, i })).filter(({ t }) => t.from.length === 1 && t.from[0] === step)
  const target = outs[0]?.t.to.length === 1 ? outs[0].t.to[0] : undefined
  const add: PlcTransition[] = [{ from: [step], to: [n], cond: '1' }]
  if (target !== undefined) add.push({ from: [n], to: [target], cond: '1' })
  const at = outs.length ? outs[outs.length - 1].i + 1 : p.transitions.length
  return normalize({ ...p, transitions: [...p.transitions.slice(0, at), ...add, ...p.transitions.slice(at)] })
}

/** Divergence en ET (parallélisme) sur la transition `i` : une étape de plus est activée en même temps, et la convergence l'attend. */
export function addParallel(prog: PlcProgram, i: number): PlcProgram {
  const t = prog.transitions[i]
  if (!t || t.to.length === 0 || t.from.length !== 1) return prog
  const n = newId(prog)
  const p = withStep(prog, n)
  const transitions = p.transitions.map((x) => ({ ...x }))
  transitions[i].to = [...t.to, n]
  // convergence : la transition qui part de plusieurs des étapes d'arrivée (ou, à défaut, la suite de l'unique étape d'arrivée) attend aussi la nouvelle branche
  const join = transitions.find((x, k) => k !== i && x.from.length > 1 && t.to.some((s) => x.from.includes(s)))
  if (join) join.from = [...join.from, n]
  else if (t.to.length === 1) {
    const u = transitions.find((x, k) => k !== i && x.from.length === 1 && x.from[0] === t.to[0])
    if (u) u.from = [t.to[0], n]
  }
  return normalize({ ...p, transitions })
}

/** Supprime une étape : si elle est entre une seule transition d'entrée et une seule de sortie, ses voisines se rejoignent ; sinon ses liaisons disparaissent. */
export function removeStep(prog: PlcProgram, id: number): PlcProgram {
  const ins = prog.transitions.filter((t) => t.to.includes(id))
  const outs = prog.transitions.filter((t) => t.from.includes(id))
  let transitions: PlcTransition[]
  if (ins.length === 1 && outs.length === 1 && ins[0].to.length === 1 && outs[0].from.length === 1 && ins[0] !== outs[0]) {
    const bridged = { ...ins[0], to: outs[0].to }
    transitions = prog.transitions.filter((t) => t !== outs[0]).map((t) => (t === ins[0] ? bridged : t))
  } else {
    transitions = prog.transitions
      .map((t) => ({ ...t, from: t.from.filter((s) => s !== id), to: t.to.filter((s) => s !== id) }))
      .filter((t) => t.from.length > 0 && t.to.length > 0)
  }
  const removed = prog.steps.find((s) => s.id === id)
  let steps = prog.steps.filter((s) => s.id !== id)
  if (removed?.init && steps.length && !steps.some((s) => s.init)) steps = steps.map((s, k) => (k === 0 ? { ...s, init: true } : s))
  const next: PlcProgram = { ...prog, steps, transitions }
  // les références à l'étape supprimée dans les conditions deviennent fausses : on les laisse visibles pour que l'utilisateur les corrige
  return normalize(next)
}

export const removeTransition = (prog: PlcProgram, i: number): PlcProgram => ({ ...prog, transitions: prog.transitions.filter((_, k) => k !== i) })

/** Convertit une suite d'ordres de type « A+ B+ A- B- » (ou « A+ (B+ C+) B- ») en Grafcet complet : étapes, actions, réceptivités fin de course. */
export function fromSequence(prog: PlcProgram, text: string, start = 'dcy'): PlcProgram {
  // une étape = un ou plusieurs ordres simultanés « (A+ B+) » ; les fins de course sont a1 / a0, b1 / b0…
  const groups: string[][] = []
  const re = /\(([^)]*)\)|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text.trim()))) {
    const items = (m[1] ?? m[2]).split(/[\s,;/]+/).filter((x) => /^[A-Za-z]\w*[+-]$/.test(x))
    if (items.length) groups.push(items)
  }
  if (!groups.length) return prog
  const sensor = (o: string) => `${o.slice(0, -1).toLowerCase()}${o.endsWith('+') ? '1' : '0'}`
  const steps = [{ id: 0, init: true as const, actions: [], comment: 'attente' }, ...groups.map((g, i) => ({ id: i + 1, actions: g.map((o) => ({ kind: 'N' as const, var: o })), comment: g.join(' ') }))]
  const transitions: PlcTransition[] = [{ from: [0], to: [1], cond: start }]
  groups.forEach((g, i) => {
    const cond = g.map(sensor).join(' ET ')
    transitions.push({ from: [i + 1], to: [i + 2 <= groups.length ? i + 2 : 0], cond })
  })
  return { ...prog, steps, transitions, ladder: prog.ladder }
}

/** Donne un autre numéro à une étape (les références X2 des conditions suivent). Si le numéro est déjà pris, les deux étapes échangent leurs numéros. La numérotation passe en manuel. */
export function setStepNumber(prog: PlcProgram, id: number, no: number): PlcProgram {
  if (!Number.isInteger(no) || no < 0 || no > 999 || !prog.steps.some((s) => s.id === id)) return prog
  if (no === id) return { ...prog, manual: true }
  const map = new Map<number, number>()
  for (const s of prog.steps) map.set(s.id, s.id)
  const other = prog.steps.find((s) => s.id === no)
  map.set(id, no)
  if (other) map.set(no, id)
  return { ...renumber(prog, map), manual: true }
}

/** Revient à la numérotation automatique : 0, 1, 2… dans l'ordre du dessin. */
export const autoNumber = (prog: PlcProgram): PlcProgram => normalize({ ...prog, manual: undefined })
