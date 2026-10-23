import type { Dir, Paper, PlacedSymbol, SymbolDef } from './types'
import { SYMBOL_MAP } from './symbols'

/** 1 unité = 0,375 mm. Grille = 10 unités (3,75 mm). */
export const UNIT_MM = 0.375
export const GRID = 10
export const PAPER_SIZE: Record<Paper, { w: number; h: number }> = {
  A4: { w: 792, h: 560 },
  A3: { w: 1120, h: 792 },
  A2: { w: 1584, h: 1120 },
  A1: { w: 2240, h: 1584 },
}
export const MARGIN = 14
/** Cartouche (en bas à droite de la feuille) */
export const TB_W = 480
export const TB_H = 114

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

/**
 * Valeur d'un tracé complet [borne, fin d'amorce, …, fin d'amorce, borne] : Infinity s'il est inacceptable
 * (non orthogonal, demi-tour, auto-intersection), sinon 1000 × nombre de coudes + longueur.
 */
function scoreRoute(full: P[]): number {
  const pts: P[] = []
  for (const p of full) if (!pts.length || !(pts[pts.length - 1].x === p.x && pts[pts.length - 1].y === p.y)) pts.push(p)
  if (pts.length < 2) return Infinity
  const dirs: [number, number][] = []
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1]
    const q = pts[i]
    if (p.x !== q.x && p.y !== q.y) return Infinity
    dirs.push([Math.sign(q.x - p.x), Math.sign(q.y - p.y)])
  }
  let bends = 0
  for (let i = 1; i < dirs.length; i++) {
    if (dirs[i][0] === -dirs[i - 1][0] && dirs[i][1] === -dirs[i - 1][1]) return Infinity // demi-tour (sortie ou arrivée à contre-sens d'une borne)
    if (dirs[i][0] !== dirs[i - 1][0] || dirs[i][1] !== dirs[i - 1][1]) bends++
  }
  // deux segments non adjacents ne doivent ni se croiser ni se toucher
  const seg = (i: number) => ({ a: pts[i], b: pts[i + 1], h: pts[i].y === pts[i + 1].y })
  for (let i = 0; i < dirs.length; i++) {
    for (let j = i + 2; j < dirs.length; j++) {
      const s = seg(i)
      const t = seg(j)
      const sx = [Math.min(s.a.x, s.b.x), Math.max(s.a.x, s.b.x)]
      const sy = [Math.min(s.a.y, s.b.y), Math.max(s.a.y, s.b.y)]
      const tx = [Math.min(t.a.x, t.b.x), Math.max(t.a.x, t.b.x)]
      const ty = [Math.min(t.a.y, t.b.y), Math.max(t.a.y, t.b.y)]
      if (sx[0] <= tx[1] && tx[0] <= sx[1] && sy[0] <= ty[1] && ty[0] <= sy[1]) return Infinity
    }
  }
  return bends * 1000 + pathLength(pts)
}

/**
 * Routage orthogonal entre deux bornes, avec une amorce de 20 unités. On évalue plusieurs formes (droit, en L,
 * en Z par le milieu ou en contournant) et on garde celle qui a le moins de coudes puis la longueur minimale ;
 * un trajet qui ferait demi-tour sur une borne, ou qui se croiserait lui-même, est écarté. Cela couvre aussi le cas
 * d'une borne dont le fil doit repartir « vers l'arrière » (cible située derrière la direction de sortie).
 */
export function route(a: P & { dir: Dir }, b: P & { dir: Dir }): P[] {
  const STUB = 20
  const [ax, ay] = VEC[a.dir]
  const [bx, by] = VEC[b.dir]
  const A = { x: a.x + ax * STUB, y: a.y + ay * STUB }
  const B = { x: b.x + bx * STUB, y: b.y + by * STUB }
  const pa = { x: a.x, y: a.y }
  const pb = { x: b.x, y: b.y }
  const mx = snap((A.x + B.x) / 2)
  const my = snap((A.y + B.y) / 2)
  const candidates: P[][] = [[], [{ x: A.x, y: B.y }], [{ x: B.x, y: A.y }]]
  for (const y of [my, Math.min(A.y, B.y) - STUB, Math.max(A.y, B.y) + STUB]) candidates.push([{ x: A.x, y }, { x: B.x, y }])
  for (const x of [mx, Math.min(A.x, B.x) - STUB, Math.max(A.x, B.x) + STUB]) candidates.push([{ x, y: A.y }, { x, y: B.y }])

  let best: P[] | null = null
  let bestScore = Infinity
  for (const mid of candidates) {
    const full = [pa, A, ...mid, B, pb]
    const score = scoreRoute(full)
    if (score < bestScore) {
      bestScore = score
      best = full
    }
  }
  return clean(best ?? [pa, A, { x: A.x, y: B.y }, B, pb])
}

const STUB_LEN = 20
const sameP = (p: P, q: P) => p.x === q.x && p.y === q.y

/** Supprime les points en double et les points alignés. */
export function clean(pts: P[]): P[] {
  const out: P[] = []
  for (const p of pts) {
    const last = out[out.length - 1]
    if (last && sameP(last, p)) continue
    out.push(p)
    while (out.length >= 3) {
      const [p0, p1, p2] = out.slice(-3)
      if ((p0.x === p1.x && p1.x === p2.x) || (p0.y === p1.y && p1.y === p2.y)) out.splice(out.length - 2, 1)
      else break
    }
  }
  return out
}

/**
 * Relie des points successifs par des segments horizontaux/verticaux. Entre deux points non alignés, on ajoute un coin :
 * on poursuit d'abord dans la direction courante, sauf si cela imposerait un demi-tour.
 */
function orthogonalize(pts: P[], dir0: [number, number], arrive?: { index: number; dir: [number, number] }): P[] {
  const out: P[] = [pts[0]]
  let d = dir0
  const unit = (p: P, q: P): [number, number] => [Math.sign(q.x - p.x), Math.sign(q.y - p.y)]
  for (let i = 1; i < pts.length; i++) {
    const p = out[out.length - 1]
    const q = pts[i]
    if (sameP(p, q)) continue
    if (p.x === q.x || p.y === q.y) {
      out.push(q)
      d = unit(p, q)
      continue
    }
    const horizontal = d[0] !== 0
    const c1 = horizontal ? { x: q.x, y: p.y } : { x: p.x, y: q.y }
    const c2 = horizontal ? { x: p.x, y: q.y } : { x: q.x, y: p.y }
    const dot = (c: P) => (c.x - p.x) * d[0] + (c.y - p.y) * d[1]
    // arrivée sur la borne : on ne doit pas arriver à contre-sens de l'entrée dans la borne (traversée + demi-tour)
    const okArrive = (c: P) => !arrive || i !== arrive.index || (q.x - c.x) * arrive.dir[0] + (q.y - c.y) * arrive.dir[1] >= 0
    const candidates = [c1, c2]
    const c = candidates.find((k) => dot(k) >= 0 && okArrive(k)) ?? candidates.find(okArrive) ?? c1
    out.push(c, q)
    d = unit(c, q)
  }
  return clean(out)
}

/** Tracé d'un conducteur entre deux bornes en passant par des points imposés (coudes choisis par l'utilisateur). */
export function routeVia(a: P & { dir: Dir }, b: P & { dir: Dir }, via: P[]): P[] {
  if (!via.length) return route(a, b)
  const [ax, ay] = VEC[a.dir]
  const [bx, by] = VEC[b.dir]
  const A = { x: a.x + ax * STUB_LEN, y: a.y + ay * STUB_LEN }
  const B = { x: b.x + bx * STUB_LEN, y: b.y + by * STUB_LEN }
  const pts = [{ x: a.x, y: a.y }, A, ...via, B, { x: b.x, y: b.y }]
  return orthogonalize(pts, [ax, ay], { index: pts.length - 2, dir: [-bx, -by] })
}

/** Tracé en cours de pose : de la borne de départ, par les coudes déjà posés, jusqu'au curseur. */
export function routeOpen(a: P & { dir: Dir }, via: P[], end: P): P[] {
  const [ax, ay] = VEC[a.dir]
  const A = { x: a.x + ax * STUB_LEN, y: a.y + ay * STUB_LEN }
  return orthogonalize([{ x: a.x, y: a.y }, A, ...via, end], [ax, ay])
}

export function pathLength(pts: P[]): number {
  return pts.reduce((s, p, i) => (i ? s + Math.abs(p.x - pts[i - 1].x) + Math.abs(p.y - pts[i - 1].y) : 0), 0)
}

/** Position d'insertion d'un nouveau coude q dans la liste des coudes : celle qui donne le tracé le plus court. */
export function bestInsertIndex(a: P & { dir: Dir }, b: P & { dir: Dir }, via: P[], q: P): number {
  let best = 0
  let bestLen = Infinity
  for (let j = 0; j <= via.length; j++) {
    const trial = [...via.slice(0, j), q, ...via.slice(j)]
    // longueur de la suite ordonnée des points (insensible au choix des coins : un coude hors de l'ordre allonge le trajet)
    const [ax, ay] = VEC[a.dir]
    const [bx, by] = VEC[b.dir]
    const len = pathLength([{ x: a.x, y: a.y }, { x: a.x + ax * STUB_LEN, y: a.y + ay * STUB_LEN }, ...trial, { x: b.x + bx * STUB_LEN, y: b.y + by * STUB_LEN }, { x: b.x, y: b.y }])
    if (len < bestLen) {
      bestLen = len
      best = j
    }
  }
  return best
}

export const pointsAttr = (pts: P[]) => pts.map((p) => `${p.x},${p.y}`).join(' ')
