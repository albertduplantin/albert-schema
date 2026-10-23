import type { Doc, Lang, PlacedSymbol } from './types'
import { SYMBOL_MAP } from './symbols'

/** Borne de bornier (X1.1, X1.2…) : le repère est celui du bornier suivi du numéro de la borne. */
export const isTerminal = (defId: string) => !!SYMBOL_MAP[defId]?.id.includes('130_terminals_terminal_strips')
export const stripOf = (label: string) => (/^(.*?)\.(\d+)$/.exec(label)?.[1] ?? label).replace(/\.$/, '')

const numOf = (label: string) => Number(/\.(\d+)$/.exec(label)?.[1] ?? 0)

export interface TerminalRow {
  strip: string
  terminal: string
  /** conducteurs reliés au côté « entrée » (haut) et « sortie » (bas) de la borne */
  inWires: string[]
  outWires: string[]
}

/** Nom lisible de l'autre extrémité d'un conducteur : appareil:borne. */
function endName(doc: Doc, symId: string, portId: string): string {
  const s = doc.symbols.find((x) => x.id === symId)
  if (!s) return '?'
  const def = SYMBOL_MAP[s.defId]
  const port = def.ports.find((p) => p.id === portId)
  const name = s.label || def.prefix || def.name.fr
  return port?.label ? `${name}:${port.label}` : name
}

/** Liste de bornier : pour chaque borne, les conducteurs qui y arrivent et en repartent (repère, section, couleur, autre extrémité). */
export function terminalRows(doc: Doc, lang: Lang): TerminalRow[] {
  const rows: TerminalRow[] = []
  const terms = doc.symbols.filter((s) => isTerminal(s.defId) && s.label)
  const colorName = (c: string) => (c === 'gnye' ? (lang === 'fr' ? 'vert-jaune' : 'green-yellow') : c)
  const describe = (s: PlacedSymbol, portIds: string[]) => {
    const out: string[] = []
    for (const w of doc.wires) {
      for (const [mine, other] of [[w.from, w.to], [w.to, w.from]] as const) {
        if (mine.symId !== s.id || !portIds.includes(mine.portId)) continue
        const bits = [w.label, w.section && w.section + ' mm²', w.color && w.color !== '#000000' ? colorName(w.color) : ''].filter(Boolean).join(' · ')
        out.push(`${endName(doc, other.symId, other.portId)}${bits ? ` (${bits})` : ''}`)
      }
    }
    return out
  }
  for (const s of terms) {
    const def = SYMBOL_MAP[s.defId]
    // t0 : haut, t1 : bas ; les autres bornes (dérivation latérale) sont comptées côté sortie
    const top = def.ports.filter((p) => p.id === 't0').map((p) => p.id)
    const rest = def.ports.filter((p) => p.id !== 't0').map((p) => p.id)
    rows.push({ strip: stripOf(s.label), terminal: s.label, inWires: describe(s, top), outWires: describe(s, rest) })
  }
  return rows.sort((a, b) => a.strip.localeCompare(b.strip, undefined, { numeric: true }) || numOf(a.terminal) - numOf(b.terminal))
}
