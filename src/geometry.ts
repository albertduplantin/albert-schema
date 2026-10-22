import type { Dir, Paper, PlacedSymbol, SymbolDef } from './types'
import { SYMBOL_MAP } from './symbols'

/** 1 unité = 0,25 mm. Grille = 10 unités (2,5 mm). */
export const GRID = 10
export const PAPER_SIZE: Record<Paper, { w: number; h: number }> = {
  A4: { w: 1188, h: 840 },
  A3: { w: 1680, h: 1188 },
  A2: { w: 2376, h: 1680 },
  A1: { w: 3360, h: 2376 },
}
export const MARGIN = 20

export const snap = (v: number) => Math.round(v / GRID) * GRID

export const uid = () => Math.random().toString(36).slice(2, 9)

const VEC: Record<Dir, [number, number]> = { up: [0, -1], right: [1, 0], down: [0, 1], left: [-1, 0] }
const ORDER: Dir[] = ['up', 'right', 'down', 'left']

export const rotCenter = (def: SymbolDef) => ({ cx: Math.round(def.w / 20) * 10, cy: Math.round(def.h / 20) * 10 })

function rotPt(dx: number, dy: number, rot: number) {
  const a = (rot * Math.PI) / 180
  const c = Math.round(Math.cos(a))
  const s = Math.round(Math.sin(a))
  return { x: dx * c - dy * s, y: dx * s + dy * c }
}

export function rotDir(dir: Dir, rot: number): Dir {
  return ORDER[(ORDER.indexOf(dir) + rot / 90) % 4]
}

export const dirVec = (d: Dir) => VEC[d]

export function portPos(sym: PlacedSymbol, portId: string) {
  const def = SYMBOL_MAP[sym.defId]
  const port = def.ports.find((p) => p.id === portId)
  if (!port) return null
  const { cx, cy } = rotCenter(def)
  const r = rotPt(port.x - cx, port.y - cy, sym.rot)
  return { x: sym.x + cx + r.x, y: sym.y + cy + r.y, dir: rotDir(port.dir, sym.rot) }
}

export function symBBox(sym: PlacedSymbol) {
  const def = SYMBOL_MAP[sym.defId]
  const { cx, cy } = rotCenter(def)
  const pts = [
    [0, 0],
    [def.w, 0],
    [def.w, def.h],
    [0, def.h],
  ].map(([x, y]) => {
    const r = rotPt(x - cx, y - cy, sym.rot)
    return { x: sym.x + cx + r.x, y: sym.y + cy + r.y }
  })
  const xs = pts.map((p) => p.x)
  const ys = pts.map((p) => p.y)
  return { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) }
}

interface P {
  x: number
  y: number
}

/** Routage orthogonal entre deux bornes, avec une amorce de 20 unités. */
export function route(a: P & { dir: Dir }, b: P & { dir: Dir }): P[] {
  const STUB = 20
  const [ax, ay] = VEC[a.dir]
  const [bx, by] = VEC[b.dir]
  const A = { x: a.x + ax * STUB, y: a.y + ay * STUB }
  const B = { x: b.x + bx * STUB, y: b.y + by * STUB }
  const aV = a.dir === 'up' || a.dir === 'down'
  const bV = b.dir === 'up' || b.dir === 'down'
  let mid: P[]
  if (aV && bV) {
    const m = snap((A.y + B.y) / 2)
    mid = [A, { x: A.x, y: m }, { x: B.x, y: m }, B]
  } else if (!aV && !bV) {
    const m = snap((A.x + B.x) / 2)
    mid = [A, { x: m, y: A.y }, { x: m, y: B.y }, B]
  } else if (aV) {
    mid = [A, { x: A.x, y: B.y }, B]
  } else {
    mid = [A, { x: B.x, y: A.y }, B]
  }
  const pts = [{ x: a.x, y: a.y }, ...mid, { x: b.x, y: b.y }]
  // supprime doublons et points alignés
  const out: P[] = []
  for (const p of pts) {
    const last = out[out.length - 1]
    if (last && last.x === p.x && last.y === p.y) continue
    out.push(p)
    while (out.length >= 3) {
      const [p0, p1, p2] = out.slice(-3)
      if ((p0.x === p1.x && p1.x === p2.x) || (p0.y === p1.y && p1.y === p2.y)) out.splice(out.length - 2, 1)
      else break
    }
  }
  return out
}

export const pointsAttr = (pts: P[]) => pts.map((p) => `${p.x},${p.y}`).join(' ')
