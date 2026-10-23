import type { Doc, SymbolDef } from './types'
import { simulate } from './sim/engine'

/**
 * Repère de chaque fil par équipotentielle : les fils reliés entre eux (sans traverser un appareil) portent le même repère ;
 * un réseau relié à une source prend le nom de son potentiel (L1, N, +24 V…), les autres sont numérotés dans l'ordre.
 */
export function netLabels(doc: Doc, defs: Record<string, SymbolDef>): Record<string, string> {
  const parent = new Map<string, string>()
  const find = (x: string): string => {
    if (!parent.has(x)) parent.set(x, x)
    let r = x
    while (parent.get(r) !== r) r = parent.get(r)!
    parent.set(x, r)
    return r
  }
  const k = (r: { symId: string; portId: string }) => `${r.symId}:${r.portId}`
  for (const w of doc.wires) parent.set(find(k(w.from)), find(k(w.to)))
  let pots: Record<string, string | null> = {}
  try {
    pots = simulate(doc, defs, {}, { pressed: new Set(), toggled: new Set() }, 0).potentialOf
  } catch { /* schéma incomplet */ }
  const byNet = new Map<string, string>()
  let n = 0
  const out: Record<string, string> = {}
  for (const w of doc.wires) {
    const root = find(k(w.from))
    if (!byNet.has(root)) {
      const pot = pots[k(w.from)] ?? pots[k(w.to)]
      byNet.set(root, pot && !pot.startsWith('~') ? pot.split('@')[0] : String(++n))
    }
    out[w.id] = byNet.get(root)!
  }
  return out
}
