import type { Doc, PlacedSymbol, Wire } from './types'
import { SYMBOL_MAP } from './symbols'
import { uid } from './geometry'

type Spec = [key: string, defId: string, x: number, y: number, rot?: 0 | 90 | 180 | 270]
type Link = [from: string, fromPort: string, to: string, toPort: string]

function build(base: Doc, specs: Spec[], links: Link[]): Doc {
  const ids: Record<string, string> = {}
  const counters: Record<string, number> = {}
  const symbols: PlacedSymbol[] = specs.map(([key, defId, x, y, rot = 0]) => {
    const prefix = SYMBOL_MAP[defId].prefix
    counters[prefix] = (counters[prefix] ?? 0) + 1
    ids[key] = uid()
    return { id: ids[key], defId, x, y, rot, label: prefix + counters[prefix], desc: '' }
  })
  const wires: Wire[] = links.map(([a, ap, b, bp]) => ({
    id: uid(), from: { symId: ids[a], portId: ap }, to: { symId: ids[b], portId: bp }, label: '', color: '#000000', section: '',
  }))
  return { ...base, symbols, wires }
}

/** Départ moteur : disjoncteur → contacteur → moteur, bobine à part. */
export const motorStarter = (base: Doc): Doc =>
  build(base,
    [
      ['q', 'el-cb3', 300, 140],
      ['k', 'el-ct3', 300, 260],
      ['m', 'el-motor3', 300, 400],
      ['c', 'el-coil', 560, 260],
    ],
    [
      ['q', 'b1', 'k', 'a1'], ['q', 'b2', 'k', 'a2'], ['q', 'b3', 'k', 'a3'],
      ['k', 'b1', 'm', 'u'], ['k', 'b2', 'm', 'v'], ['k', 'b3', 'm', 'w'],
    ])

/** Vérin double effet piloté par un distributeur 4/2. */
export const pneumaticCylinder = (base: Doc): Doc =>
  build(base,
    [
      ['a', 'pn-cyl-da', 300, 140],
      ['v', 'pn-v42', 280, 260],
      ['s', 'pn-src', 330, 380],
      ['e', 'pn-exh', 400, 380],
    ],
    [
      ['a', 'a', 'v', 'a'], ['a', 'b', 'v', 'b'], ['s', 'a', 'v', 'p'], ['e', 'a', 'v', 't'],
    ])
