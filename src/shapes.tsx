import type { Shape, StrokeStyle } from './types'

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

/** Rectangle englobant (x1 ≤ x2, y1 ≤ y2). */
export function shapeBox(s: Shape) {
  const x2 = s.x + s.w, y2 = s.y + s.h
  return { x1: Math.min(s.x, x2), y1: Math.min(s.y, y2), x2: Math.max(s.x, x2), y2: Math.max(s.y, y2) }
}

/** Les lignes dessinées à main levée sont ramenées à l'horizontale ou à la verticale quand elles en sont proches. */
export function straighten(dx: number, dy: number): { dx: number; dy: number } {
  if (Math.abs(dy) < Math.abs(dx) * 0.2) return { dx, dy: 0 }
  if (Math.abs(dx) < Math.abs(dy) * 0.2) return { dx: 0, dy }
  return { dx, dy }
}

/** Poignées de redimensionnement : codes n, s, e, w combinés (rectangle, ellipse) ou p0 / p1 (ligne). */
export function shapeHandles(s: Shape): { code: string; x: number; y: number }[] {
  if (s.kind === 'line') return [{ code: 'p0', x: s.x, y: s.y }, { code: 'p1', x: s.x + s.w, y: s.y + s.h }]
  const b = shapeBox(s), mx = (b.x1 + b.x2) / 2, my = (b.y1 + b.y2) / 2
  return [
    { code: 'nw', x: b.x1, y: b.y1 }, { code: 'n', x: mx, y: b.y1 }, { code: 'ne', x: b.x2, y: b.y1 },
    { code: 'e', x: b.x2, y: my }, { code: 'se', x: b.x2, y: b.y2 }, { code: 's', x: mx, y: b.y2 },
    { code: 'sw', x: b.x1, y: b.y2 }, { code: 'w', x: b.x1, y: my },
  ]
}

/** Forme redimensionnée en tirant la poignée `code` jusqu'au point `pt` (déjà calé sur la grille). */
export function resizeShape(o: Shape, code: string, pt: { x: number; y: number }): Shape {
  if (o.kind === 'line') {
    if (code === 'p0') {
      const f = straighten((o.x + o.w) - pt.x, (o.y + o.h) - pt.y)
      return { ...o, x: o.x + o.w - f.dx, y: o.y + o.h - f.dy, w: f.dx, h: f.dy }
    }
    const f = straighten(pt.x - o.x, pt.y - o.y)
    return { ...o, w: f.dx, h: f.dy }
  }
  const b = shapeBox(o)
  let { x1, y1, x2, y2 } = b
  if (code.includes('w')) x1 = pt.x
  if (code.includes('e')) x2 = pt.x
  if (code.includes('n')) y1 = pt.y
  if (code.includes('s')) y2 = pt.y
  return { ...o, x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) }
}

function arrowHead(tx: number, ty: number, fx: number, fy: number, width: number) {
  // pointe en (tx, ty), la ligne arrive de (fx, fy)
  const a = Math.atan2(ty - fy, tx - fx), L = 5 + width * 2.5, hw = L * 0.38
  const bx = tx - Math.cos(a) * L, by = ty - Math.sin(a) * L
  return `${tx},${ty} ${bx + Math.sin(a) * hw},${by - Math.cos(a) * hw} ${bx - Math.sin(a) * hw},${by + Math.cos(a) * hw}`
}

/** Dessin d'une forme (aussi utilisé pour l'export : tout est en attributs SVG, sans style externe). */
export function ShapeView({ s, opacity }: { s: Shape; opacity?: number }) {
  const dash = dashArray(s.stroke, s.width)
  const common = { stroke: s.color, strokeWidth: s.width, strokeDasharray: dash, strokeLinecap: (s.stroke === 'dotted' ? 'round' : 'butt') as 'round' | 'butt', opacity }
  const fill = s.fill ?? 'none'
  const fillProps = s.fill ? { fill, fillOpacity: 0.16 } : { fill: 'none' }
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
  const b = shapeBox(s)
  return (
    <g>
      {s.kind === 'ellipse'
        ? <ellipse cx={(b.x1 + b.x2) / 2} cy={(b.y1 + b.y2) / 2} rx={(b.x2 - b.x1) / 2} ry={(b.y2 - b.y1) / 2} {...common} {...fillProps} />
        : <rect x={b.x1} y={b.y1} width={b.x2 - b.x1} height={b.y2 - b.y1} rx={s.rounded ? 10 : 0} {...common} {...fillProps} />}
      {s.label && <text x={b.x1 + 8} y={b.y1 + 13} fontSize={10} fontWeight={600} fill={s.color} stroke="none" opacity={opacity}>{s.label}</text>}
    </g>
  )
}
