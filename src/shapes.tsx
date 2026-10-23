import type { PlacedSymbol, Shape, StrokeStyle } from './types'
import { symBBox } from './geometry'

/** Tracé en tirets d'un style de trait (undefined : trait continu). */
export function dashArray(style: StrokeStyle, w: number): string | undefined {
  if (style === 'dashed') return `${w * 5 + 3} ${w * 3 + 2}`
  if (style === 'dotted') return `0.1 ${w * 2.4 + 2.5}`
  if (style === 'dashdot') return `${w * 6 + 3} ${w * 2 + 2} 0.1 ${w * 2 + 2}`
  return undefined
}

export const STROKES: StrokeStyle[] = ['solid', 'dashed', 'dotted', 'dashdot']
export const SHAPE_WIDTHS = [0.8, 1.2, 1.6, 2.4, 3.5]
export const SHAPE_COLORS = ['#000000', '#c80000', '#0050c8', '#008000', '#e08000', '#7a7a7a', '#6a00a0']
export const SHAPE_FILLS = ['#c80000', '#0050c8', '#008000', '#e0b000', '#7a7a7a']

type Pt = { x: number; y: number }

/** Sommets absolus d'une polyligne. */
export const polyPoints = (s: Shape): Pt[] => (s.pts ?? []).map((p) => ({ x: s.x + p.x, y: s.y + p.y }))

/** Rectangle englobant (x1 ≤ x2, y1 ≤ y2). */
export function shapeBox(s: Shape) {
  if (s.kind === 'poly') {
    const ps = [{ x: s.x, y: s.y }, ...polyPoints(s)]
    return { x1: Math.min(...ps.map((p) => p.x)), y1: Math.min(...ps.map((p) => p.y)), x2: Math.max(...ps.map((p) => p.x)), y2: Math.max(...ps.map((p) => p.y)) }
  }
  const x2 = s.x + s.w, y2 = s.y + s.h
  return { x1: Math.min(s.x, x2), y1: Math.min(s.y, y2), x2: Math.max(s.x, x2), y2: Math.max(s.y, y2) }
}

/** Les lignes dessinées à main levée sont ramenées à l'horizontale ou à la verticale quand elles en sont proches. */
export function straighten(dx: number, dy: number): { dx: number; dy: number } {
  if (Math.abs(dy) < Math.abs(dx) * 0.2) return { dx, dy: 0 }
  if (Math.abs(dx) < Math.abs(dy) * 0.2) return { dx: 0, dy }
  return { dx, dy }
}

/** Poignées de redimensionnement : codes n, s, e, w combinés (rectangle, ellipse), p0 / p1 (ligne) ou v0… (sommets d'une polyligne). */
export function shapeHandles(s: Shape): { code: string; x: number; y: number }[] {
  if (s.kind === 'line') return [{ code: 'p0', x: s.x, y: s.y }, { code: 'p1', x: s.x + s.w, y: s.y + s.h }]
  if (s.kind === 'poly') return [{ code: 'v0', x: s.x, y: s.y }, ...polyPoints(s).map((p, i) => ({ code: 'v' + (i + 1), x: p.x, y: p.y }))].slice(0, (s.pts?.length ?? 0) + 1)
  const b = shapeBox(s), mx = (b.x1 + b.x2) / 2, my = (b.y1 + b.y2) / 2
  return [
    { code: 'nw', x: b.x1, y: b.y1 }, { code: 'n', x: mx, y: b.y1 }, { code: 'ne', x: b.x2, y: b.y1 },
    { code: 'e', x: b.x2, y: my }, { code: 'se', x: b.x2, y: b.y2 }, { code: 's', x: mx, y: b.y2 },
    { code: 'sw', x: b.x1, y: b.y2 }, { code: 'w', x: b.x1, y: my },
  ]
}

/** Forme redimensionnée en tirant la poignée `code` jusqu'au point `pt` (déjà calé). */
export function resizeShape(o: Shape, code: string, pt: Pt): Shape {
  if (o.kind === 'line') {
    if (code === 'p0') {
      const f = straighten((o.x + o.w) - pt.x, (o.y + o.h) - pt.y)
      return { ...o, x: o.x + o.w - f.dx, y: o.y + o.h - f.dy, w: f.dx, h: f.dy }
    }
    const f = straighten(pt.x - o.x, pt.y - o.y)
    return { ...o, w: f.dx, h: f.dy }
  }
  if (o.kind === 'poly') {
    const i = Number(code.slice(1))
    const abs = [{ x: o.x, y: o.y }, ...polyPoints(o)]
    abs[i] = pt
    return { ...o, x: abs[0].x, y: abs[0].y, pts: abs.slice(1).map((p) => ({ x: p.x - abs[0].x, y: p.y - abs[0].y })) }
  }
  const b = shapeBox(o)
  let { x1, y1, x2, y2 } = b
  if (code.includes('w')) x1 = pt.x
  if (code.includes('e')) x2 = pt.x
  if (code.includes('n')) y1 = pt.y
  if (code.includes('s')) y2 = pt.y
  return { ...o, x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) }
}

/** Abscisses et ordonnées des bords des symboles et des autres formes, vers lesquelles un tracé s'aimante. */
export function snapTargets(symbols: PlacedSymbol[], shapes: Shape[], skip?: string) {
  const xs: number[] = [], ys: number[] = []
  for (const s of symbols) { const b = symBBox(s); xs.push(b.x1, b.x2); ys.push(b.y1, b.y2) }
  for (const s of shapes) if (s.id !== skip && s.kind !== 'image') { const b = shapeBox(s); xs.push(b.x1, b.x2); ys.push(b.y1, b.y2) }
  return { xs, ys }
}

/** Point `p` tourné de `deg` degrés autour de `c`. */
export function rotatePt(p: { x: number; y: number }, deg: number, c: { x: number; y: number }) {
  const r = (deg * Math.PI) / 180, cs = Math.cos(r), sn = Math.sin(r)
  return { x: c.x + (p.x - c.x) * cs - (p.y - c.y) * sn, y: c.y + (p.x - c.x) * sn + (p.y - c.y) * cs }
}

/** Redimensionne une forme pivotée : le pointeur est ramené dans le repère de la forme, et le bord opposé reste en place à l'écran. */
export function resizeRotated(o: Shape, code: string, pt: { x: number; y: number }): Shape {
  if (!o.rot || o.kind === 'line' || o.kind === 'poly') return resizeShape(o, code, pt)
  const b = shapeBox(o)
  const c0 = { x: (b.x1 + b.x2) / 2, y: (b.y1 + b.y2) / 2 }
  const next = resizeShape(o, code, rotatePt(pt, -o.rot, c0))
  const ax = code.includes('e') ? b.x1 : code.includes('w') ? b.x2 : c0.x
  const ay = code.includes('s') ? b.y1 : code.includes('n') ? b.y2 : c0.y
  const nb = shapeBox(next)
  const c1 = { x: (nb.x1 + nb.x2) / 2, y: (nb.y1 + nb.y2) / 2 }
  const before = rotatePt({ x: ax, y: ay }, o.rot, c0)
  const after = rotatePt({ x: ax, y: ay }, o.rot, c1)
  return { ...next, x: next.x + before.x - after.x, y: next.y + before.y - after.y }
}

/** Valeur calée sur la grille, ou sur le bord le plus proche s'il est à moins de `tol` unités. */
export function snapTo(v: number, grid: (n: number) => number, targets: number[], tol = 5): number {
  let best = grid(v), d = Infinity
  for (const t of targets) { const e = Math.abs(t - v); if (e < tol && e < d) { d = e; best = t } }
  return best
}

function arrowHead(tx: number, ty: number, fx: number, fy: number, width: number) {
  // pointe en (tx, ty), la ligne arrive de (fx, fy)
  const a = Math.atan2(ty - fy, tx - fx), L = 5 + width * 2.5, hw = L * 0.38
  const bx = tx - Math.cos(a) * L, by = ty - Math.sin(a) * L
  return `${tx},${ty} ${bx + Math.sin(a) * hw},${by - Math.cos(a) * hw} ${bx - Math.sin(a) * hw},${by + Math.cos(a) * hw}`
}

/** Chemin SVG d'un arc d'ellipse inscrit dans la boîte de la forme. */
export function arcPath(s: Shape): string {
  const b = shapeBox(s)
  const cx = (b.x1 + b.x2) / 2, cy = (b.y1 + b.y2) / 2, rx = (b.x2 - b.x1) / 2, ry = (b.y2 - b.y1) / 2
  const a0 = s.a0 ?? 180, a1 = s.a1 ?? 360
  const n = Math.max(2, Math.ceil(Math.abs(((a1 - a0) % 360 + 360) % 360 || 360) / 6))
  let sweep = ((a1 - a0) % 360 + 360) % 360
  if (sweep === 0) sweep = 360
  const pts: string[] = []
  for (let i = 0; i <= n; i++) {
    const t = ((a0 + (sweep * i) / n) * Math.PI) / 180
    pts.push(`${i ? 'L' : 'M'}${(cx + rx * Math.cos(t)).toFixed(2)} ${(cy + ry * Math.sin(t)).toFixed(2)}`)
  }
  return pts.join('')
}

/** Dessin d'une forme (aussi utilisé pour l'export : tout est en attributs SVG, sans style externe). */
export function ShapeView({ s, opacity }: { s: Shape; opacity?: number }) {
  if (s.rot) {
    const b = shapeBox(s)
    return <g transform={`rotate(${s.rot} ${(b.x1 + b.x2) / 2} ${(b.y1 + b.y2) / 2})`}><ShapeView s={{ ...s, rot: undefined }} opacity={opacity} /></g>
  }
  const dash = dashArray(s.stroke, s.width)
  const common = { stroke: s.color, strokeWidth: s.width, strokeDasharray: dash, strokeLinecap: (s.stroke === 'dotted' ? 'round' : 'butt') as 'round' | 'butt', opacity }
  const fillProps = s.fill ? { fill: s.fill, fillOpacity: 0.16 } : { fill: 'none' }
  const b = shapeBox(s)
  if (s.kind === 'image') {
    return s.href ? <image href={s.href} x={b.x1} y={b.y1} width={b.x2 - b.x1} height={b.y2 - b.y1} preserveAspectRatio="none" opacity={opacity} /> : null
  }
  if (s.kind === 'line') {
    const x2 = s.x + s.w, y2 = s.y + s.h
    return (
      <g>
        <line x1={s.x} y1={s.y} x2={x2} y2={y2} {...common} />
        {s.arrow && <polygon points={arrowHead(x2, y2, s.x, s.y, s.width)} fill={s.color} stroke="none" opacity={opacity} />}
        {s.arrow === 'both' && <polygon points={arrowHead(s.x, s.y, x2, y2, s.width)} fill={s.color} stroke="none" opacity={opacity} />}
      </g>
    )
  }
  if (s.kind === 'poly') {
    const ps = [{ x: s.x, y: s.y }, ...polyPoints(s)]
    const pts = ps.map((p) => `${p.x},${p.y}`).join(' ')
    return s.closed
      ? <polygon points={pts} {...common} {...fillProps} strokeLinejoin="round" />
      : <polyline points={pts} {...common} fill="none" strokeLinejoin="round" />
  }
  if (s.kind === 'arc') return <path d={arcPath(s)} {...common} fill="none" />
  return (
    <g>
      {s.kind === 'ellipse'
        ? <ellipse cx={(b.x1 + b.x2) / 2} cy={(b.y1 + b.y2) / 2} rx={(b.x2 - b.x1) / 2} ry={(b.y2 - b.y1) / 2} {...common} {...fillProps} />
        : <rect x={b.x1} y={b.y1} width={b.x2 - b.x1} height={b.y2 - b.y1} rx={s.rounded ? 10 : 0} {...common} {...fillProps} />}
      {s.label && <text x={b.x1 + 8} y={b.y1 + 13} fontSize={10} fontWeight={600} fill={s.color} stroke="none" opacity={opacity}>{s.label}</text>}
    </g>
  )
}

/** Symboles dont la boîte est entièrement dans le cadre : ils suivent le cadre quand il porte `carry`. */
export function insideOf(frame: Shape, symbols: PlacedSymbol[], shapes: Shape[], notes: { id: string; x: number; y: number }[] = []) {
  const f = shapeBox(frame)
  const within = (b: { x1: number; y1: number; x2: number; y2: number }) => b.x1 >= f.x1 && b.x2 <= f.x2 && b.y1 >= f.y1 && b.y2 <= f.y2
  return {
    symbols: symbols.filter((s) => within(symBBox(s))).map((s) => s.id),
    shapes: shapes.filter((s) => s.id !== frame.id && within(shapeBox(s))).map((s) => s.id),
    notes: notes.filter((n) => n.x >= f.x1 && n.x <= f.x2 && n.y >= f.y1 && n.y <= f.y2).map((n) => n.id),
  }
}
