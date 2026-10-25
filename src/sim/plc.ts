/**
 * Automate programmable simulé : Grafcet (étapes, transitions, actions N / S / R) et langage à contacts (Ladder : contacts, bobines, temporisation).
 * Un « scan » lit les entrées, fait évoluer le Grafcet, calcule les réseaux Ladder et produit les sorties.
 *
 * Variables : entrées I0.0…I0.7, sorties Q0.0…Q0.7, mémentos M0…, étapes X0…, temporisateurs T1… (bit « écoulé »). Des noms symboliques peuvent
 * remplacer ces adresses (table `names`).
 */
export interface PlcAction { kind: 'N' | 'S' | 'R'; var: string }
export interface PlcStep { id: number; init?: boolean; actions: PlcAction[]; comment?: string }
export interface PlcTransition { from: number[]; to: number[]; cond: string }
export interface PlcContact { var: string; neg?: boolean }
export interface PlcRung {
  /** branches en parallèle (OU), chacune en série (ET) */
  branches: PlcContact[][]
  coil: { kind: '=' | 'S' | 'R' | 'TON'; var: string; preset?: number }
  comment?: string
}
export interface PlcProgram {
  /** noms symboliques : adresse → nom (« I0.0 » → « dcy ») */
  names: Record<string, string>
  steps: PlcStep[]
  transitions: PlcTransition[]
  ladder: PlcRung[]
}

export const emptyProgram = (): PlcProgram => ({ names: {}, steps: [], transitions: [], ladder: [] })
export const N_IN = 8
export const N_OUT = 8

export interface PlcState {
  /** étapes actives et instant d'activation (ms) */
  steps: number[]
  since: Record<number, number>
  /** variables mémorisées (S / R, mémentos) */
  latched: Record<string, boolean>
  /** temporisateurs : instant de démarrage et bit « écoulé » */
  timers: Record<string, { start: number | null; done: boolean }>
  /** valeurs lues au scan précédent (détection de fronts) */
  prev: Record<string, boolean>
  /** entrées lues et sorties produites */
  inputs: boolean[]
  out: boolean[]
}

// ───────────────────────── expressions de réceptivité

type Tok = { t: 'id' | 'and' | 'or' | 'not' | '(' | ')' | 'edge' | 'time'; v: string }

const WORDS: Record<string, Tok['t']> = { ET: 'and', AND: 'and', '.': 'and', '*': 'and', '&': 'and', OU: 'or', OR: 'or', '+': 'or', '|': 'or', NON: 'not', NOT: 'not', '/': 'not', '!': 'not', '¬': 'not' }

export function tokenize(src: string): Tok[] {
  const out: Tok[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (/\s/.test(c)) { i++; continue }
    if (c === '(' || c === ')') { out.push({ t: c, v: c }); i++; continue }
    // durée écrite « t/X2/3s » ou « T(3s) »
    const tm = /^(?:t\s*\/\s*X(\d+)\s*\/\s*|T\s*\(\s*)(\d+(?:[.,]\d+)?)\s*(ms|s)\s*\)?/i.exec(src.slice(i))
    if (tm) { out.push({ t: 'time', v: `${tm[1] ?? ''}|${Number(tm[2].replace(',', '.')) * (tm[3].toLowerCase() === 's' ? 1000 : 1)}` }); i += tm[0].length; continue }
    // fronts : ↑I0.1  ou  R(I0.1)  /  ↓I0.1  ou  F(I0.1)
    const ed = /^(?:([↑↓])\s*|([RF])\s*\(\s*)([A-Za-z_][\w.]*)\s*\)?/.exec(src.slice(i))
    if (ed && (ed[1] || /\(/.test(ed[0]))) { out.push({ t: 'edge', v: `${ed[1] === '↓' || ed[2] === 'F' ? 'F' : 'R'}|${ed[3]}` }); i += ed[0].length; continue }
    if ('./*&+|!¬'.includes(c) && !(c === '.' && /\d/.test(src[i + 1] ?? '') && /[\w]/.test(src[i - 1] ?? ''))) { out.push({ t: WORDS[c], v: c }); i++; continue }
    const w = /^[A-Za-z_À-ſ][\w.À-ſ]*|^\d+/.exec(src.slice(i))
    if (!w) throw new Error('caractère inattendu : ' + c)
    const up = w[0].toUpperCase()
    if (WORDS[up]) out.push({ t: WORDS[up], v: up })
    else out.push({ t: 'id', v: w[0] })
    i += w[0].length
  }
  return out
}

export type Expr =
  | { k: 'var'; name: string }
  | { k: 'const'; v: boolean }
  | { k: 'not'; e: Expr }
  | { k: 'and' | 'or'; a: Expr; b: Expr }
  | { k: 'edge'; kind: 'R' | 'F'; name: string }
  | { k: 'time'; step: number | null; ms: number }

export function parseExpr(src: string): Expr {
  const toks = tokenize(src)
  let p = 0
  const peek = () => toks[p]
  const orE = (): Expr => {
    let a = andE()
    while (peek()?.t === 'or') { p++; a = { k: 'or', a, b: andE() } }
    return a
  }
  const andE = (): Expr => {
    let a = notE()
    while (peek() && (peek().t === 'and' || peek().t === 'id' || peek().t === 'not' || peek().t === '(' || peek().t === 'edge' || peek().t === 'time')) {
      if (peek().t === 'and') p++ // « A B » sans opérateur vaut « A ET B »
      a = { k: 'and', a, b: notE() }
    }
    return a
  }
  const notE = (): Expr => {
    if (peek()?.t === 'not') { p++; return { k: 'not', e: notE() } }
    return atom()
  }
  const atom = (): Expr => {
    const t = toks[p++]
    if (!t) throw new Error('expression incomplète')
    if (t.t === '(') { const e = orE(); if (toks[p++]?.t !== ')') throw new Error('parenthèse fermante manquante'); return e }
    if (t.t === 'edge') { const [kind, name] = t.v.split('|'); return { k: 'edge', kind: kind as 'R' | 'F', name } }
    if (t.t === 'time') { const [st, ms] = t.v.split('|'); return { k: 'time', step: st ? Number(st) : null, ms: Number(ms) } }
    if (t.t === 'id') return t.v === '1' ? { k: 'const', v: true } : t.v === '0' ? { k: 'const', v: false } : /^true$/i.test(t.v) ? { k: 'const', v: true } : { k: 'var', name: t.v }
    throw new Error('opérande attendu')
  }
  if (!toks.length) return { k: 'const', v: true }
  const e = orE()
  if (p < toks.length) throw new Error('expression mal formée')
  return e
}

/** Vérifie une réceptivité : retourne un message d'erreur, ou null si elle est correcte. */
export function checkExpr(src: string): string | null {
  try { parseExpr(src); return null } catch (e) { return (e as Error).message }
}

// ───────────────────────── exécution

/** Adresse canonique d'un nom : « dcy » → « I0.0 » si défini dans la table des noms, sinon le nom lui-même en majuscules. */
function resolver(names: Record<string, string>): (n: string) => string {
  const back = new Map<string, string>()
  for (const [addr, nm] of Object.entries(names)) if (nm.trim()) back.set(nm.trim().toLowerCase(), addr.toUpperCase())
  return (n) => back.get(n.toLowerCase()) ?? n.toUpperCase()
}

const inIndex = (a: string) => { const m = /^I0?\.(\d)$/.exec(a); return m ? Number(m[1]) : -1 }

export interface ScanResult { state: PlcState; pending: number[] }

export function initialState(prog: PlcProgram, now: number): PlcState {
  const steps = prog.steps.filter((s) => s.init).map((s) => s.id)
  return { steps, since: Object.fromEntries(steps.map((i) => [i, now])), latched: {}, timers: {}, prev: {}, inputs: Array(N_IN).fill(false), out: Array(N_OUT).fill(false) }
}

export function scan(prog: PlcProgram, prev: PlcState | undefined, inputs: boolean[], now: number): ScanResult {
  const st: PlcState = prev ? { ...prev, steps: [...prev.steps], since: { ...prev.since }, latched: { ...prev.latched }, timers: { ...prev.timers }, prev: {} } : initialState(prog, now)
  const R = resolver(prog.names)
  const pending: number[] = []
  const lastVals = prev?.prev ?? {}
  const seen: Record<string, boolean> = {}
  const cur: Record<string, boolean> = {} // valeurs des sorties et mémentos pendant le scan

  const read = (raw: string): boolean => {
    const a = R(raw)
    const i = inIndex(a)
    let v: boolean
    if (i >= 0) v = !!inputs[i]
    else if (/^X\d+$/.test(a)) v = st.steps.includes(Number(a.slice(1)))
    else if (/^T\d+$/.test(a)) v = !!st.timers[a]?.done
    else v = cur[a] ?? st.latched[a] ?? (prev ? prev.out[outIndex(a)] : false) ?? false
    seen[a] = v
    return v
  }
  const outIndex = (a: string) => { const m = /^Q0?\.(\d)$/.exec(a); return m ? Number(m[1]) : -1 }

  const evalE = (e: Expr, from: number[]): boolean => {
    switch (e.k) {
      case 'const': return e.v
      case 'var': return read(e.name)
      case 'not': return !evalE(e.e, from)
      case 'and': return evalE(e.a, from) && evalE(e.b, from)
      case 'or': return evalE(e.a, from) || evalE(e.b, from)
      case 'edge': { const v = read(e.name); const was = lastVals[R(e.name)] ?? false; return e.kind === 'R' ? v && !was : !v && was }
      case 'time': {
        const step = e.step ?? from[0]
        const since = step === undefined ? undefined : st.since[step]
        if (since === undefined || !st.steps.includes(step!)) return false
        const left = e.ms - (now - since)
        if (left > 0) { pending.push(Math.max(1, left)); return false }
        return true
      }
    }
  }

  // 1. Grafcet : franchissement des transitions dont toutes les étapes amont sont actives et dont la réceptivité est vraie
  const active = new Set(st.steps)
  const fire: PlcTransition[] = []
  const consumed = new Set<number>()
  for (const tr of prog.transitions) {
    if (!tr.from.length || !tr.from.every((s) => active.has(s)) || tr.from.some((s) => consumed.has(s))) continue
    let ok = false
    try { ok = evalE(parseExpr(tr.cond), tr.from) } catch { ok = false }
    if (ok) { fire.push(tr); tr.from.forEach((s) => consumed.add(s)) }
  }
  for (const tr of fire) {
    tr.from.forEach((s) => { active.delete(s); delete st.since[s] })
    tr.to.forEach((s) => { active.add(s); st.since[s] = now })
  }
  st.steps = [...active].sort((a, b) => a - b)

  // 2. actions des étapes actives : N (tant que l'étape est active), S (mise à 1 mémorisée), R (remise à 0)
  const n: Record<string, boolean> = {}
  for (const step of prog.steps) {
    if (!active.has(step.id)) continue
    for (const a of step.actions) {
      const v = R(a.var)
      if (a.kind === 'N') n[v] = true
      else if (a.kind === 'S') st.latched[v] = true
      else st.latched[v] = false
    }
  }
  for (const [v, on] of Object.entries(st.latched)) cur[v] = on
  for (const [v, on] of Object.entries(n)) cur[v] = on || cur[v]

  // 3. Ladder : chaque réseau est évalué dans l'ordre
  const ladderOut: Record<string, boolean> = {}
  for (const rung of prog.ladder) {
    const res = rung.branches.length === 0 ? true : rung.branches.some((br) => br.every((c) => (c.var ? read(c.var) !== !!c.neg : true)))
    const v = R(rung.coil.var || '')
    if (!v) continue
    if (rung.coil.kind === '=') { ladderOut[v] = (ladderOut[v] ?? false) || res; cur[v] = (cur[v] ?? false) || res }
    else if (rung.coil.kind === 'S') { if (res) { st.latched[v] = true; cur[v] = true } }
    else if (rung.coil.kind === 'R') { if (res) { st.latched[v] = false; cur[v] = false } }
    else {
      // temporisation à l'enclenchement : le bit « écoulé » passe à 1 après la durée réglée
      const tm = st.timers[v] ?? { start: null, done: false }
      const preset = rung.coil.preset ?? 1000
      if (res) {
        const start = tm.start ?? now
        const done = now - start >= preset
        st.timers[v] = { start, done }
        if (!done) pending.push(Math.max(1, preset - (now - start)))
      } else st.timers[v] = { start: null, done: false }
    }
  }
  st.inputs = Array.from({ length: N_IN }, (_, i) => !!inputs[i])
  st.out = Array.from({ length: N_OUT }, (_, i) => !!cur[`Q0.${i}`])
  inputs.forEach((v, i) => { seen[`I0.${i}`] = !!v })
  st.prev = seen
  return { state: st, pending }
}

/** Valeur courante d'une variable (affichage en direct) à partir de l'état de l'automate. */
export function varValue(prog: PlcProgram, st: PlcState | undefined, raw: string): boolean {
  if (!st) return false
  const a = resolver(prog.names)(raw)
  const i = inIndex(a)
  if (i >= 0) return !!st.inputs[i]
  const o = /^Q0?\.(\d)$/.exec(a)
  if (o) return !!st.out[Number(o[1])]
  if (/^X\d+$/.test(a)) return st.steps.includes(Number(a.slice(1)))
  if (/^T\d+$/.test(a)) return !!st.timers[a]?.done
  return !!(st.latched[a] ?? st.prev[a])
}
