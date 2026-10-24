import type { Doc, Domain, Lang, PlacedSymbol, SymbolDef } from './types'
import { runSteps, type Step } from './exercises'

/**
 * Exercices guidés : un cahier des charges, des étapes numérotées (chacune se coche toute seule quand le schéma de l'élève la
 * réalise), un indice par étape et un schéma de solution. Les étapes de comportement rejouent un scénario dans le simulateur.
 */
export interface L { fr: string; en: string }

export interface Ctx {
  /** schéma de l'élève (toutes feuilles réunies) */
  doc: Doc
  defs: Record<string, SymbolDef>
  lang: Lang
  /** la simulation est-elle lancée ? */
  simMode: boolean
}

export interface GStep {
  id: string
  title: L
  hint: L
  done: (c: Ctx) => boolean
}

export interface GExercise {
  id: string
  domain: Domain
  level: 1 | 2 | 3
  minutes: number
  title: L
  summary: L
  /** cahier des charges, un paragraphe par entrée */
  brief: L[]
  /** schéma de départ (par défaut : feuille vide) */
  start?: (base: Doc) => Doc
  /** schéma de référence, chargé par « Voir une solution » */
  solution: (base: Doc) => Doc
  steps: GStep[]
}

export const L = (fr: string, en: string): L => ({ fr, en })

// ── aides à la vérification du dessin
/** Symboles dont l'identifiant correspond au motif. */
export const syms = (c: Ctx, re: RegExp): PlacedSymbol[] => c.doc.symbols.filter((s) => re.test(s.defId))
export const count = (c: Ctx, re: RegExp) => syms(c, re).length
export const labelled = (c: Ctx, label: string) => c.doc.symbols.filter((s) => s.label.trim().toUpperCase() === label.toUpperCase())

/** Chaque borne (sauf `skip`) de chaque symbole de la liste porte au moins un fil. */
export function allWired(c: Ctx, list: PlacedSymbol[], skip: string[] = []): boolean {
  if (!list.length) return false
  const used = new Set(c.doc.wires.flatMap((w) => [`${w.from.symId}:${w.from.portId}`, `${w.to.symId}:${w.to.portId}`]))
  return list.every((s) => (c.defs[s.defId]?.ports ?? []).every((p) => skip.includes(p.id) || used.has(`${s.id}:${p.id}`)))
}

/** Réseaux de fils : deux bornes reliées par des fils (sans traverser de composant) ont la même racine. */
export function netOf(c: Ctx): (symId: string, portId: string) => string {
  const parent = new Map<string, string>()
  const find = (k: string): string => {
    const p = parent.get(k)
    if (p === undefined || p === k) { parent.set(k, k); return k }
    const r = find(p)
    parent.set(k, r)
    return r
  }
  for (const w of c.doc.wires) parent.set(find(`${w.from.symId}:${w.from.portId}`), find(`${w.to.symId}:${w.to.portId}`))
  return (symId, portId) => find(`${symId}:${portId}`)
}

/** Les deux bornes sont reliées entre elles par des fils. */
export function joined(c: Ctx, a: [PlacedSymbol, string], b: [PlacedSymbol, string]): boolean {
  const n = netOf(c)
  return n(a[0].id, a[1]) === n(b[0].id, b[1])
}

/** Le schéma réussit le scénario de simulation (manœuvres et états attendus, par repère). */
export const passes = (c: Ctx, steps: Step[], labels: string[]): boolean => {
  if (!c.doc.symbols.length) return false
  try { return runSteps(steps, labels, c.doc, c.defs, c.lang).ok } catch { return false }
}
