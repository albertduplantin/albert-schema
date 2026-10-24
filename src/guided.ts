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
  /** conseils : ce qui manque encore pour réussir l'étape (affiché sous l'étape en cours) */
  missing?: (c: Ctx) => string[]
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
  /** matériel à utiliser, avec les repères attendus */
  parts: L[]
  /** fonctionnement attendu, exactement : « j'appuie sur S1, la lampe H1 s'allume… » */
  expect: L[]
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
  return list.every((s) => (c.defs[s.defId]?.ports ?? []).every((p) => skip.includes(p.id) || /^PE$/i.test(p.label ?? '') || used.has(`${s.id}:${p.id}`)))
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

// ── scénarios de simulation libres (pneumatique, électro-pneumatique)
import { simulate, type SimMemory, type SimResult } from './sim/engine'

export interface SimStep {
  /** organes à maintenir appuyés (identifiants), calculés sur le schéma de l'élève */
  press?: (c: Ctx) => string[]
  /** interrupteurs fermés */
  toggle?: (c: Ctx) => string[]
  /** temps simulé écoulé avant la mesure (ms) */
  wait?: number
  /** état attendu */
  ok: (r: SimResult, c: Ctx) => boolean
}

/** Rejoue des manœuvres sur le schéma de l'élève : à chaque pas, le calcul est fait à l'instant de la manœuvre puis `wait` ms plus tard. */
export function scenario(c: Ctx, steps: SimStep[]): boolean {
  if (!c.doc.symbols.length) return false
  try {
    let mem: SimMemory = {}
    let now = 1_000_000
    for (const st of steps) {
      const inp = { pressed: new Set(st.press?.(c) ?? []), toggled: new Set(st.toggle?.(c) ?? []) }
      let r = simulate(c.doc, c.defs, mem, inp, now)
      mem = r.state
      now += st.wait ?? 100
      r = simulate(c.doc, c.defs, mem, inp, now)
      mem = r.state
      if (!st.ok(r, c)) return false
    }
    return true
  } catch { return false }
}

// ── noms exacts des symboles de la bibliothèque dans les textes des exercices
import { CATEGORIES, SYMBOL_MAP } from './symbols'

/** Alias courts → identifiants de symboles, déclarés par les exercices. */
export const ALIASES: Record<string, string> = {}

/**
 * Remplace `{{alias}}` par « Nom exact du symbole » (dans la langue de l'interface) et `{{alias:loc}}` par « Nom » suivi de son
 * emplacement dans la bibliothèque (menu ▸ groupe) : les textes ne peuvent ainsi pas s'écarter des noms réellement affichés.
 */
export function fillNames(text: string, lang: Lang): string {
  return text.replace(/\{\{(\w+)(:loc)?\}\}/g, (m, alias: string, loc?: string) => {
    const def = SYMBOL_MAP[ALIASES[alias] ?? '']
    if (!def) return m
    const name = def.name[lang]
    if (!loc) return `« ${name} »`
    const menuId = def.menu ?? def.cat
    const menu = CATEGORIES[def.domain].find((c) => c.id === menuId)?.name[lang]
    const where = [menu, def.group?.[lang]].filter(Boolean).join(' ▸ ')
    return where ? `« ${name} » (${where})` : `« ${name} »`
  })
}
