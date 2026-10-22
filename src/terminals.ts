import type { SymbolDef } from './types'

/**
 * Numérotation des bornes (repères 13-14, 21-22, A1-A2…).
 *
 * Chaque symbole posé peut redéfinir le repère de ses bornes (`PlacedSymbol.terms`). On regroupe les bornes par
 * pôle (les deux bornes d'un contact) pour que la saisie soit rapide : on modifie la PREMIÈRE borne du premier
 * pôle et toutes les autres suivent (13 → 53 donne 54 ; un contact à trois pôles 13-14 / 23-24 / 33-34 devient
 * 53-54 / 63-64 / 73-74). On peut ensuite corriger chaque borne séparément.
 */

export interface TermGroup {
  /** « pole » : bornes d'un contact ; « inverseur » : commun, repos, travail ; « winding » : enroulement ; « port » : borne isolée */
  kind: 'pole' | 'changeover' | 'winding' | 'port'
  index: number
  ports: string[]
}

const POWER = /(02_power_contacts|11_circuit_breakers|12_magneto|20_disconnecting)/

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

/** Numérotation normalisée proposée (vide si le symbole n'a pas de convention connue). */
export function suggestTerms(def: SymbolDef): Record<string, string> {
  const m = def.sim
  const out: Record<string, string> = {}
  if (m?.k === 'switch') {
    const power = POWER.test(def.id)
    termGroups(def).forEach((g) => {
      if (g.kind === 'pole') {
        const k = g.index
        // contacts auxiliaires : NO 13-14, 23-24… ; NF 21-22, 31-32… (la position 1 est réservée au NO)
        const base = power ? [2 * k + 1, 2 * k + 2] : m.nc ? [(k + 2) * 10 + 1, (k + 2) * 10 + 2] : [(k + 1) * 10 + 3, (k + 1) * 10 + 4]
        g.ports.forEach((p, i) => (out[p] = String(base[i])))
      } else if (g.kind === 'changeover') {
        const r = (g.index + 1) * 10
        out[g.ports[0]] = String(r + 1)
        out[g.ports[1]] = String(r + 2)
        out[g.ports[2]] = String(r + 4)
      }
    })
  } else if (m?.k === 'coil') {
    const [a1, a2] = ordered(def, m.ports)
    out[a1] = 'A1'
    out[a2] = 'A2'
  }
  return out
}

/** Repère affiché par défaut pour une borne : celui du symbole d'origine, sinon la numérotation normalisée. */
export function defaultTerm(def: SymbolDef, portId: string): string {
  return def.ports.find((p) => p.id === portId)?.label ?? suggestTerms(def)[portId] ?? ''
}

const isNum = (s: string | undefined): s is string => !!s && /^\d+$/.test(s)

/**
 * Applique une saisie et propage le décalage :
 *  - première borne du premier groupe : toutes les autres bornes numériques suivent (même écart qu'à l'origine) ;
 *  - première borne d'un autre pôle : seules les bornes de ce pôle suivent ;
 *  - toute autre borne : modification isolée.
 * Une saisie vide rétablit le repère par défaut.
 */
export function editTerm(def: SymbolDef, terms: Record<string, string> | undefined, portId: string, value: string): Record<string, string> {
  const out: Record<string, string> = { ...(terms ?? {}) }
  const clean = value.trim().slice(0, 6)
  if (clean === '') delete out[portId]
  else out[portId] = clean
  if (!isNum(clean)) return out

  const groups = termGroups(def)
  const gi = groups.findIndex((g) => g.ports.includes(portId))
  if (gi < 0 || groups[gi].ports[0] !== portId) return out
  const anchorDefault = defaultTerm(def, portId)
  if (!isNum(anchorDefault)) return out

  const follow = gi === 0 ? groups.flatMap((g) => g.ports) : groups[gi].ports
  for (const q of follow) {
    if (q === portId) continue
    const d = defaultTerm(def, q)
    if (isNum(d)) out[q] = String(Number(clean) + Number(d) - Number(anchorDefault))
  }
  return out
}
