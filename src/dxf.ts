import type { Doc, PlacedSymbol, Shape } from './types'
import { MARGIN, PAPER_SIZE, TB_H, TB_W, UNIT_MM, rotCenter } from './geometry'
import { routeAll } from './routing'
import { SYMBOL_MAP } from './symbols'
import { arcPath, polyPoints, rotatePt, shapeBox } from './shapes'

/**
 * Export DXF (AutoCAD R12, texte) : feuille, symboles, conducteurs, formes et textes, en millimètres, axe Y vers le haut.
 * Les symboles sont convertis depuis leur dessin SVG (traits, rectangles, cercles, ellipses et chemins, courbes échantillonnées).
 */

type Pt = [number, number]
type M = [number, number, number, number, number, number] // matrice affine SVG [a b c d e f]
const ID: M = [1, 0, 0, 1, 0, 0]
const mul = (m: M, n: M): M => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
]
const apply = (m: M, p: Pt): Pt => [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]]

function parseTransform(t: string | undefined): M {
  let m = ID
  if (!t) return m
  for (const part of t.matchAll(/(\w+)\(([^)]*)\)/g)) {
    const a = part[2].split(/[\s,]+/).filter(Boolean).map(Number)
    let n: M = ID
    if (part[1] === 'translate') n = [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0]
    else if (part[1] === 'scale') n = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0]
    else if (part[1] === 'rotate') {
      const r = ((a[0] ?? 0) * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r)
      n = [c, s, -s, c, 0, 0]
      if (a.length >= 3) n = mul(mul([1, 0, 0, 1, a[1], a[2]], n), [1, 0, 0, 1, -a[1], -a[2]])
    } else if (part[1] === 'matrix' && a.length === 6) n = a as M
    m = mul(m, n)
  }
  return m
}

const attrs = (s: string) => {
  const o: Record<string, string> = {}
  for (const m of s.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) o[m[1]] = m[2]
  return o
}

/** Points d'un chemin SVG (courbes échantillonnées), sous-chemins séparés. */
export function pathPolylines(d: string): { pts: Pt[]; closed: boolean }[] {
  const out: { pts: Pt[]; closed: boolean }[] = []
  const tok = [...d.matchAll(/([MmLlHhVvCcSsQqTtAaZz])|(-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)/gi)].map((m) => m[1] ?? Number(m[2]))
  let i = 0
  let cur: Pt = [0, 0], start: Pt = [0, 0]
  let sub: Pt[] = []
  let lastCtl: Pt | null = null
  let cmd = ''
  const num = () => tok[i++] as unknown as number
  const flush = (closed: boolean) => { if (sub.length > 1) out.push({ pts: sub, closed }); sub = [] }
  const bez = (p0: Pt, p1: Pt, p2: Pt, p3: Pt) => { for (let k = 1; k <= 10; k++) { const t = k / 10, u = 1 - t; sub.push([u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]]) } }
  while (i < tok.length) {
    if (typeof tok[i] === 'string') cmd = tok[i++] as string
    const rel = cmd === cmd.toLowerCase()
    const c = cmd.toUpperCase()
    const ox = rel ? cur[0] : 0, oy = rel ? cur[1] : 0
    if (c === 'Z') { cur = start; if (sub.length) { sub.push(start); flush(true) } continue }
    if (c === 'M') { flush(false); cur = [num() + ox, num() + oy]; start = cur; sub = [cur]; cmd = rel ? 'l' : 'L'; lastCtl = null; continue }
    if (c === 'L') { cur = [num() + ox, num() + oy]; sub.push(cur); lastCtl = null }
    else if (c === 'H') { cur = [num() + ox, cur[1]]; sub.push(cur); lastCtl = null }
    else if (c === 'V') { cur = [cur[0], num() + oy]; sub.push(cur); lastCtl = null }
    else if (c === 'C') { const p1: Pt = [num() + ox, num() + oy], p2: Pt = [num() + ox, num() + oy], p3: Pt = [num() + ox, num() + oy]; bez(cur, p1, p2, p3); cur = p3; lastCtl = p2 }
    else if (c === 'S') { const p1: Pt = lastCtl ? [2 * cur[0] - lastCtl[0], 2 * cur[1] - lastCtl[1]] : cur; const p2: Pt = [num() + ox, num() + oy], p3: Pt = [num() + ox, num() + oy]; bez(cur, p1, p2, p3); cur = p3; lastCtl = p2 }
    else if (c === 'Q' || c === 'T') {
      const q: Pt = c === 'Q' ? [num() + ox, num() + oy] : lastCtl ? [2 * cur[0] - lastCtl[0], 2 * cur[1] - lastCtl[1]] : cur
      const p3: Pt = [num() + ox, num() + oy]
      bez(cur, [cur[0] + (2 / 3) * (q[0] - cur[0]), cur[1] + (2 / 3) * (q[1] - cur[1])], [p3[0] + (2 / 3) * (q[0] - p3[0]), p3[1] + (2 / 3) * (q[1] - p3[1])], p3)
      cur = p3; lastCtl = q
    } else if (c === 'A') {
      const rx = Math.abs(num()), ry = Math.abs(num()), rot = num(), large = num(), sweep = num()
      const end: Pt = [num() + ox, num() + oy]
      for (const p of arcPoints(cur, end, rx, ry, rot, !!large, !!sweep)) sub.push(p)
      cur = end; lastCtl = null
    } else break
  }
  flush(false)
  return out
}

/** Échantillonnage d'un arc elliptique SVG (conversion paramétrique, annexe F.6 de la spécification SVG). */
function arcPoints(p0: Pt, p1: Pt, rx: number, ry: number, rotDeg: number, large: boolean, sweep: boolean): Pt[] {
  if (rx === 0 || ry === 0 || (p0[0] === p1[0] && p0[1] === p1[1])) return [p1]
  const phi = (rotDeg * Math.PI) / 180, cp = Math.cos(phi), sp = Math.sin(phi)
  const dx = (p0[0] - p1[0]) / 2, dy = (p0[1] - p1[1]) / 2
  const x1 = cp * dx + sp * dy, y1 = -sp * dx + cp * dy
  const lam = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry)
  if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam) }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1
  const co = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den))
  const cx1 = (co * rx * y1) / ry, cy1 = (-co * ry * x1) / rx
  const cx = cp * cx1 - sp * cy1 + (p0[0] + p1[0]) / 2, cy = sp * cx1 + cp * cy1 + (p0[1] + p1[1]) / 2
  const ang = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)
  const t1 = ang(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry)
  let dt = ang((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry)
  if (!sweep && dt > 0) dt -= 2 * Math.PI
  if (sweep && dt < 0) dt += 2 * Math.PI
  const n = Math.max(4, Math.ceil(Math.abs(dt) / (Math.PI / 12)))
  const pts: Pt[] = []
  for (let k = 1; k <= n; k++) {
    const t = t1 + (dt * k) / n
    pts.push([cp * rx * Math.cos(t) - sp * ry * Math.sin(t) + cx, sp * rx * Math.cos(t) + cp * ry * Math.sin(t) + cy])
  }
  return pts
}

/** Traits (suites de points) d'un dessin SVG de symbole, après application de la matrice `base`. */
export function svgStrokes(svg: string, base: M): { pts: Pt[]; closed: boolean }[] {
  const out: { pts: Pt[]; closed: boolean }[] = []
  const stack: M[] = [base]
  for (const tag of svg.matchAll(/<(\/?)(\w+)([^>]*?)(\/?)>/g)) {
    const [, closing, name, rest, self] = tag
    if (closing) { if (name === 'g') stack.pop(); continue }
    const a = attrs(rest)
    const m = mul(stack[stack.length - 1], parseTransform(a.transform))
    const push = (pts: Pt[], closed = false) => out.push({ pts: pts.map((p) => apply(m, p)), closed })
    if (name === 'g') { if (!self) stack.push(m); else continue; continue }
    if (a.fill === 'currentColor' && name === 'text') continue
    if (name === 'line') push([[+a.x1, +a.y1], [+a.x2, +a.y2]])
    else if (name === 'rect') { const x = +(a.x ?? 0), y = +(a.y ?? 0), w = +a.width, h = +a.height; if (w > 0 && h > 0) push([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], true) }
    else if (name === 'circle' || name === 'ellipse') {
      const cx = +(a.cx ?? 0), cy = +(a.cy ?? 0), rx = +(a.rx ?? a.r), ry = +(a.ry ?? a.r)
      const pts: Pt[] = []
      for (let k = 0; k <= 24; k++) pts.push([cx + rx * Math.cos((k / 24) * 2 * Math.PI), cy + ry * Math.sin((k / 24) * 2 * Math.PI)])
      push(pts, true)
    } else if (name === 'polyline' || name === 'polygon') {
      const n = (a.points ?? '').split(/[\s,]+/).filter(Boolean).map(Number)
      const pts: Pt[] = []
      for (let k = 0; k + 1 < n.length; k += 2) pts.push([n[k], n[k + 1]])
      push(pts, name === 'polygon')
    } else if (name === 'path' && a.d) for (const sp of pathPolylines(a.d)) push(sp.pts, sp.closed)
  }
  return out
}

const COLORS: Record<string, number> = { '#000000': 7, '#c80000': 1, '#0050c8': 5, '#4fc3f7': 4, gnye: 3, '#008000': 3, '#8a5a00': 30, '#7a7a7a': 8, '#e08000': 30, '#6a00a0': 6 }

export function dxfOf(doc: Doc): string {
  const { w: PW, h: PH } = PAPER_SIZE[doc.paper]
  const mm = UNIT_MM
  const X = (x: number) => (x * mm).toFixed(3)
  const Y = (y: number) => ((PH - y) * mm).toFixed(3)
  const lines: string[] = []
  const g = (code: number, v: string | number) => lines.push(String(code), String(v))
  const ent = (type: string, layer: string, color?: number) => { g(0, type); g(8, layer); if (color !== undefined) g(62, color) }
  const line = (a: Pt, b: Pt, layer: string, color?: number) => { ent('LINE', layer, color); g(10, X(a[0])); g(20, Y(a[1])); g(30, 0); g(11, X(b[0])); g(21, Y(b[1])); g(31, 0) }
  const poly = (pts: Pt[], closed: boolean, layer: string, color?: number) => {
    for (let i = 0; i + 1 < pts.length; i++) line(pts[i], pts[i + 1], layer, color)
    if (closed && pts.length > 2) line(pts[pts.length - 1], pts[0], layer, color)
  }
  const text = (x: number, y: number, h: number, s: string, layer: string, rot = 0, color?: number) => {
    if (!s) return
    ent('TEXT', layer, color); g(10, X(x)); g(20, Y(y)); g(30, 0); g(40, (h * mm).toFixed(3)); g(1, s.replace(/\r?\n/g, ' ')); if (rot) g(50, -rot)
  }

  // feuille : cadre et cartouche
  poly([[MARGIN, MARGIN], [PW - MARGIN, MARGIN], [PW - MARGIN, PH - MARGIN], [MARGIN, PH - MARGIN]], true, 'SHEET')
  const tx = PW - MARGIN - TB_W, ty = PH - MARGIN - TB_H
  poly([[tx, ty], [PW - MARGIN, ty], [PW - MARGIN, PH - MARGIN], [tx, PH - MARGIN]], true, 'SHEET')
  const t = doc.title
  text(tx + 6, ty + 20, 12, t.title ?? '', 'SHEET')
  text(tx + 6, ty + 40, 8, [t.company, t.author, t.date].filter(Boolean).join(' · '), 'SHEET')

  // symboles
  const byId = new Map<string, PlacedSymbol>()
  for (const s of doc.symbols) {
    byId.set(s.id, s)
    const def = SYMBOL_MAP[s.defId]
    if (!def || def.cat === 'sim') continue
    const { cx, cy } = rotCenter(def)
    const base = mul([1, 0, 0, 1, s.x, s.y], parseTransform(`rotate(${s.rot} ${cx} ${cy})`))
    for (const st of svgStrokes(def.svg.replace(/var\(--bg\)/g, '#fff'), base)) poly(st.pts, st.closed, 'SYMBOLS')
    text(s.x + def.w + 4, s.y + 10, 7, s.label, 'TEXT')
  }
  // conducteurs
  const routes = routeAll(doc.wires, doc.symbols)
  for (const wr of doc.wires) {
    const r = routes[wr.id]
    if (r) poly(r.map((p) => [p.x, p.y] as Pt), false, 'WIRES', COLORS[wr.color])
  }
  // formes
  for (const s of doc.shapes ?? []) {
    const b = shapeBox(s)
    const layer = 'SHAPES'
    const ctr = { x: (b.x1 + b.x2) / 2, y: (b.y1 + b.y2) / 2 }
    const rot = (pts: Pt[]): Pt[] => (s.rot ? pts.map((p) => { const q = rotatePt({ x: p[0], y: p[1] }, s.rot!, ctr); return [q.x, q.y] as Pt }) : pts)
    if (s.kind === 'rect') poly(rot([[b.x1, b.y1], [b.x2, b.y1], [b.x2, b.y2], [b.x1, b.y2]]), true, layer, COLORS[s.color])
    else if (s.kind === 'line') poly(rot([[s.x, s.y], [s.x + s.w, s.y + s.h]]), false, layer, COLORS[s.color])
    else if (s.kind === 'poly') poly(rot([[s.x, s.y], ...polyPoints(s).map((p) => [p.x, p.y] as Pt)]), !!s.closed, layer, COLORS[s.color])
    else if (s.kind === 'ellipse' || s.kind === 'arc') {
      poly(rot(ellipsePoints(s)), s.kind === 'ellipse', layer, COLORS[s.color])
    }
    if (s.label && s.kind === 'rect') text(b.x1 + 8, b.y1 + 13, 10, s.label, 'TEXT')
  }
  // annotations
  for (const n of doc.notes ?? []) n.text.split('\n').forEach((l, i) => text(n.x, n.y + n.size + i * n.size * 1.2, n.size, l, 'TEXT'))

  const layers: [string, number][] = [['SHEET', 7], ['SYMBOLS', 7], ['WIRES', 7], ['SHAPES', 5], ['TEXT', 7]]
  const head: string[] = []
  const hg = (code: number, v: string | number) => head.push(String(code), String(v))
  hg(0, 'SECTION'); hg(2, 'HEADER'); hg(9, '$ACADVER'); hg(1, 'AC1009'); hg(0, 'ENDSEC')
  hg(0, 'SECTION'); hg(2, 'TABLES'); hg(0, 'TABLE'); hg(2, 'LAYER'); hg(70, layers.length)
  for (const [n, c] of layers) { hg(0, 'LAYER'); hg(2, n); hg(70, 0); hg(62, c); hg(6, 'CONTINUOUS') }
  hg(0, 'ENDTAB'); hg(0, 'ENDSEC')
  hg(0, 'SECTION'); hg(2, 'ENTITIES')
  g(0, 'ENDSEC'); g(0, 'EOF')
  return head.join('\n') + '\n' + lines.join('\n') + '\n'
}

function ellipsePoints(s: Shape): Pt[] {
  const b = shapeBox(s)
  const cx = (b.x1 + b.x2) / 2, cy = (b.y1 + b.y2) / 2, rx = (b.x2 - b.x1) / 2, ry = (b.y2 - b.y1) / 2
  if (s.kind === 'arc') {
    const pts: Pt[] = []
    for (const sp of pathPolylines(arcPath(s))) pts.push(...sp.pts)
    return pts
  }
  const pts: Pt[] = []
  for (let k = 0; k <= 36; k++) pts.push([cx + rx * Math.cos((k / 36) * 2 * Math.PI), cy + ry * Math.sin((k / 36) * 2 * Math.PI)])
  return pts
}
