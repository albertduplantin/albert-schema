import type { PlacedSymbol, SymbolDef } from './types'

/**
 * Numérotation des bornes (repères 13-14, 21-22, A1-A2…).
 *
 * Tous les symboles d'un même appareil (même repère, ex. KM1 : bobine, contacts de puissance, contacts auxiliaires)
 * partagent une seule série de numéros : deux contacts ne portent jamais les mêmes bornes. Les numéros sont attribués
 * automatiquement, dans l'ordre de pose, selon la convention EN 50005 :
 *  - contacts de puissance : 1-2, 3-4, 5-6, puis 7-8… ;
 *  - contacts auxiliaires : un « rang » par contact ; NO x3-x4, NF x1-x2, inverseur x1-x2-x4 (13-14, 21-22, 33-34…) ;
 *  - bobines : A1-A2, puis B1-B2…
 * Exception : les boutons-poussoirs (catégorie « boutons-poussoirs ») ne participent pas à cette unicité. Un poussoir à un seul
 * contact porte toujours 1-2 (contact NF) ou 3-4 (contact NO), quel que soit son repère ; plusieurs poussoirs peuvent donc
 * porter les mêmes numéros, sans être signalés comme doublons.
 * L'utilisateur peut imposer ses propres numéros (`PlacedSymbol.terms`) : ils sont réservés, et les autres bornes de
 * l'appareil s'adaptent. Modifier la première borne d'un pôle fait suivre les autres (13 → 53 donne 54).
 */

export interface TermGroup {
  /** « pole » : bornes d'un contact ; « changeover » : commun, repos, travail ; « winding » : enroulement ; « port » : borne isolée */
  kind: 'pole' | 'changeover' | 'winding' | 'port'
  index: number
  ports: string[]
}

const POWER = /(02_power_contacts|11_circuit_breakers|12_magneto|20_disconnecting)/
/** Contacts de relais thermique (nom du fichier d'origine) */
const THERMAL = /(contact_relais|termique|thermique)/
/** Boutons-poussoirs : exemptés de l'unicité des numéros au sein d'un appareil */
const PUSH = /20_push_buttons/
const isPush = (s: { defId: string }) => PUSH.test(s.defId)

/**
 * Repères normalisés imposés à certains symboles (ils remplacent ceux du dessin d'origine) :
 *  - lampes et avertisseurs : X1 / X2 (A1 / A2 est réservé aux bobines) ;
 *  - contacts de relais thermique : 95-96 (NF) et 97-98 (NO).
 */
function standardLabels(def: SymbolDef): Record<string, string> {
  const m = def.sim
  if (m?.k === 'load' && (m.role === 'lamp' || m.role === 'buzzer') && m.ports.length === 2) {
    const [a, b] = ordered(def, m.ports)
    return { [a]: 'X1', [b]: 'X2' }
  }
  if (m?.k === 'switch' && m.poles.length === 1 && !m.changeover?.length && PUSH.test(def.id)) {
    const [a, b] = ordered(def, m.poles[0])
    return m.nc ? { [a]: '1', [b]: '2' } : { [a]: '3', [b]: '4' }
  }
  if (m?.k === 'switch' && m.poles.length > 1 && !m.changeover?.length && PUSH.test(def.id)) {
    // bouton à plusieurs contacts : un rang par contact (13-14, 21-22…), repos 1-2 / travail 3-4 selon sa nature
    const out: Record<string, string> = {}
    m.poles.forEach((pl, i) => {
      const [a, b] = ordered(def, pl)
      const nc = m.ncPoles?.[i] ?? m.nc
      out[a] = String((i + 1) * 10 + (nc ? 1 : 3)); out[b] = String((i + 1) * 10 + (nc ? 2 : 4))
    })
    return out
  }
  if (m?.k === 'switch' && m.poles.length === 1 && !m.changeover?.length && THERMAL.test(def.id.split('/').pop() ?? '')) {
    const [a, b] = ordered(def, m.poles[0])
    return m.nc ? { [a]: '95', [b]: '96' } : { [a]: '97', [b]: '98' }
  }
  return {}
}

/** Ordre de lecture d'un jeu de bornes : de haut en bas, puis de gauche à droite (dessin d'origine). */
function ordered(def: SymbolDef, ids: string[]): string[] {
  const at = (id: string) => def.ports.find((p) => p.id === id) ?? { x: 0, y: 0 }
  return [...ids].sort((a, b) => at(a).y - at(b).y || at(a).x - at(b).x)
}

/** Regroupement des bornes d'un symbole pour la saisie. */
export function termGroups(def: SymbolDef): TermGroup[] {
  const m = def.sim
  const groups: TermGroup[] = []
  const used = new Set<string>()
  const push = (kind: TermGroup['kind'], ports: string[]) => {
    groups.push({ kind, index: groups.filter((g) => g.kind === kind).length, ports })
    ports.forEach((p) => used.add(p))
  }
  if (m?.k === 'switch') {
    for (const [com, nc, no] of m.changeover ?? []) push('changeover', [com, nc, no])
    for (const pole of m.poles) push('pole', ordered(def, pole))
  } else if (m?.k === 'coil') {
    push('winding', ordered(def, m.ports))
  } else if (m?.k === 'transformer') {
    push('winding', ordered(def, m.primary))
    push('winding', ordered(def, m.secondary))
  }
  for (const p of ordered(def, def.ports.map((x) => x.id).filter((id) => !used.has(id)))) push('port', [p])
  return groups
}

const isNum = (s: string | undefined): s is string => !!s && /^\d+$/.test(s)

/** Clé d'appareil : les symboles de même repère partagent leurs numéros ; un symbole sans repère est seul. */
const deviceKey = (s: PlacedSymbol) => (s.label ? 'L:' + s.label.replace(/\s+/g, '').toUpperCase() : 'S:' + s.id)

/**
 * Repères de toutes les bornes de chaque symbole : saisie de l'utilisateur, sinon repère du symbole d'origine,
 * sinon numéro attribué automatiquement (unique au sein de l'appareil).
 * `ignoreTerms` : ne tient pas compte des numéros saisis sur ce symbole (pour connaître son numéro « par défaut »).
 */
export function effectiveTerms(symbols: PlacedSymbol[], defs: Record<string, SymbolDef>, ignoreTerms?: string): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {}
  const devices = new Map<string, PlacedSymbol[]>()
  for (const s of symbols) {
    const k = deviceKey(s)
    if (!devices.has(k)) devices.set(k, [])
    devices.get(k)!.push(s)
  }

  for (const list of devices.values()) {
    const used = new Set<string>()
    for (const s of list) {
      const def = defs[s.defId]
      if (!def) continue
      const own: Record<string, string> = {}
      const fixed = standardLabels(def)
      for (const p of def.ports) {
        const v = (s.id === ignoreTerms ? undefined : s.terms?.[p.id]) ?? fixed[p.id] ?? p.label
        if (v) {
          own[p.id] = v
          if (!isPush(s)) used.add(v)
        }
      }
      out[s.id] = own
    }

    // numéros attribués aux contacts de puissance : ils ne comptent pas comme rangs de contacts auxiliaires (7-8… 11-12)
    const powerNumbers = new Set<string>()
    /** rang (dizaine) déjà occupé par un contact auxiliaire de l'appareil */
    const rankTaken = (r: number) => [...used].some((v) => !powerNumbers.has(v) && /^\d{2}$/.test(v) && Number(v[0]) === r)

    for (const s of list) {
      const def = defs[s.defId]
      const m = def?.sim
      if (!def || !m) continue
      const mine = out[s.id]
      if (m.k === 'switch' && (m.ctl !== 'fixed' || POWER.test(def.id))) {
        const power = POWER.test(def.id)
        for (const g of termGroups(def)) {
          if (g.kind !== 'pole' && g.kind !== 'changeover') continue
          if (g.ports.some((p) => mine[p])) continue // déjà numérotée (saisie ou repère du symbole d'origine)
          let labels: number[]
          if (power && g.kind === 'pole') {
            let n = 1
            while (used.has(String(n)) || used.has(String(n + 1))) n += 2
            labels = [n, n + 1]
            labels.forEach((v) => powerNumbers.add(String(v)))
          } else {
            const wanted = (r: number) => (g.kind === 'changeover' ? [r * 10 + 1, r * 10 + 2, r * 10 + 4] : (m.ncPoles?.[g.index] ?? m.nc) ? [r * 10 + 1, r * 10 + 2] : [r * 10 + 3, r * 10 + 4])
            let r = 1
            while (r < 9 && (rankTaken(r) || wanted(r).some((v) => used.has(String(v))))) r++
            labels = wanted(r)
          }
          g.ports.forEach((p, i) => {
            mine[p] = String(labels[i])
            if (!isPush(s)) used.add(String(labels[i]))
          })
        }
      } else if (m.k === 'coil') {
        const g = termGroups(def)[0]
        if (g.ports.some((p) => mine[p])) continue
        let letter = 65 // A
        while (used.has(String.fromCharCode(letter) + '1') || used.has(String.fromCharCode(letter) + '2')) letter++
        g.ports.forEach((p, i) => {
          mine[p] = String.fromCharCode(letter) + (i + 1)
          used.add(mine[p])
        })
      }
    }
  }
  return out
}

/** Repère par défaut d'une borne (numérotation automatique), hors saisie de l'utilisateur. */
export function defaultTerm(symbols: PlacedSymbol[], defs: Record<string, SymbolDef>, symId: string, portId: string): string {
  return effectiveTerms(symbols, defs, symId)[symId]?.[portId] ?? ''
}

/**
 * Applique une saisie et propage le décalage :
 *  - première borne du premier groupe : toutes les autres bornes numériques suivent (même écart qu'au départ) ;
 *  - première borne d'un autre pôle : seules les bornes de ce pôle suivent ;
 *  - toute autre borne : modification isolée.
 * Une saisie vide rétablit le repère par défaut. `defaults` : repères par défaut du symbole (numérotation automatique).
 */
export function editTerm(def: SymbolDef, terms: Record<string, string> | undefined, portId: string, value: string, defaults: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = { ...(terms ?? {}) }
  const clean = value.trim().slice(0, 6)
  if (clean === '') delete out[portId]
  else out[portId] = clean
  if (!isNum(clean)) return out

  const groups = termGroups(def)
  const gi = groups.findIndex((g) => g.ports.includes(portId))
  if (gi < 0 || groups[gi].ports[0] !== portId) return out
  const anchorDefault = defaults[portId]
  if (!isNum(anchorDefault)) return out

  const follow = gi === 0 ? groups.flatMap((g) => g.ports) : groups[gi].ports
  for (const q of follow) {
    if (q === portId) continue
    const d = defaults[q]
    if (isNum(d)) out[q] = String(Number(clean) + Number(d) - Number(anchorDefault))
  }
  return out
}

/**
 * Comme `editTerm`, mais sans jamais reprendre un numéro déjà utilisé par un autre symbole du même appareil :
 * en cas de collision, les bornes modifiées sont décalées automatiquement (rang suivant : +10, ou pôle suivant : +2).
 */
export function editTermUnique(
  def: SymbolDef,
  terms: Record<string, string> | undefined,
  portId: string,
  value: string,
  defaults: Record<string, string>,
  others: ReadonlySet<string>,
): Record<string, string> {
  const next = editTerm(def, terms, portId, value, defaults)
  const edited = Object.keys(next).filter((p) => next[p] !== terms?.[p])
  const numeric = edited.filter((p) => isNum(next[p]))
  if (!numeric.length) return next
  const step = numeric.every((p) => next[p].length >= 2) ? 10 : 2
  for (let i = 0; i < 40 && numeric.some((p) => others.has(next[p])); i++) {
    for (const p of numeric) next[p] = String(Number(next[p]) + step)
  }
  return next
}

/** Numéros portés par plus d'un symbole d'un même appareil (ou deux fois par le même symbole). */
export function duplicateTerms(symbols: PlacedSymbol[], eff: Record<string, Record<string, string>>): Set<string> {
  const dup = new Set<string>()
  const seen = new Map<string, Map<string, string>>() // appareil → numéro → « symbole:borne »
  for (const s of symbols) {
    if (isPush(s)) continue // poussoirs : numéros libres (1-2 ou 3-4)
    const k = deviceKey(s)
    if (!seen.has(k)) seen.set(k, new Map())
    const m = seen.get(k)!
    for (const [port, v] of Object.entries(eff[s.id] ?? {})) {
      if (!isNum(v)) continue
      const who = `${s.id}:${port}`
      const prev = m.get(v)
      if (prev && prev !== who) {
        dup.add(who)
        dup.add(prev)
      } else m.set(v, who)
    }
  }
  return dup
}

/** Numéros déjà pris par les AUTRES symboles du même appareil. */
export function othersTerms(symbols: PlacedSymbol[], eff: Record<string, Record<string, string>>, symId: string): Set<string> {
  const me = symbols.find((s) => s.id === symId)
  const out = new Set<string>()
  if (!me) return out
  const key = deviceKey(me)
  for (const s of symbols) {
    if (s.id === symId || deviceKey(s) !== key || isPush(s)) continue
    for (const v of Object.values(eff[s.id] ?? {})) out.add(v)
  }
  return out
}

/**
 * Garantit l'unicité des numéros saisis sur un symbole (à appeler en fin de saisie) : si un pôle porte un numéro déjà pris
 * par un autre symbole du même appareil, les numéros saisis de ce pôle sont incrémentés (rang suivant +10, ou pôle suivant +2).
 */
export function ensureUnique(def: SymbolDef, terms: Record<string, string> | undefined, others: ReadonlySet<string>): Record<string, string> | undefined {
  if (!terms) return terms
  const out = { ...terms }
  for (const g of termGroups(def)) {
    const mine = g.ports.filter((p) => isNum(out[p]))
    if (!mine.length) continue
    const step = mine.every((p) => out[p].length >= 2) ? 10 : 2
    for (let i = 0; i < 40 && mine.some((p) => others.has(out[p])); i++) {
      for (const p of mine) out[p] = String(Number(out[p]) + step)
    }
  }
  return out
}
