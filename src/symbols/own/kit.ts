/**
 * Boîte à outils de dessin des symboles de l'application : primitives SVG, contacts à lame animée, enveloppes d'appareils.
 * Les symboles reprennent le cadre et les bornes de ceux qu'ils remplacent, pour que les schémas existants ne bougent pas.
 */
export type Pt = [number, number]
export interface PortInfo { id: string; x: number; y: number; dir: 'up' | 'down' | 'left' | 'right'; label?: string }

/** Dessin propre d'un symbole : même cadre et mêmes bornes que l'ancien, tracé par l'application d'après la forme normalisée. */
export interface Own {
  svg: string
  /** lames des contacts animées par la simulation : rotation (°) à appliquer pour passer à l'autre état ; `closed` = la lame est dessinée conductrice */
  blades?: { rot: number; closed: boolean }[]
  spin?: { cx: number; cy: number; r: number }
  name?: { fr: string; en: string }
  std?: string
}

export const f = (v: number) => String(Math.round(v * 10) / 10)
export const poly = (...pts: Pt[]) => 'M' + pts.map((p) => `${f(p[0])} ${f(p[1])}`).join('L')
export const path = (d: string, attrs = '') => `<path d="${d}"${attrs ? ' ' + attrs : ''}/>`
export const line = (a: Pt, b: Pt, attrs = '') => path(poly(a, b), attrs)
export const rect = (x: number, y: number, w: number, h: number, attrs = '') => `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}"${attrs ? ' ' + attrs : ''}/>`
export const circle = (cx: number, cy: number, r: number, attrs = '') => `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}"${attrs ? ' ' + attrs : ''}/>`
export const text = (x: number, y: number, t: string, size = 8, attrs = '') => `<text x="${f(x)}" y="${f(y)}" font-size="${size}" text-anchor="middle" fill="currentColor" stroke="none"${attrs ? ' ' + attrs : ''}>${t}</text>`
export const DASH = 'stroke-dasharray="3 2"'
export const BG = 'fill="var(--bg)"'

/** Lame animée : la simulation la fait pivoter de `rot` degrés autour de la charnière (variable CSS --b{n}). */
export function blade(n: number, hinge: Pt, tip: Pt, extra: string[] = [], extraPts: Pt[] = []): string {
  const pts = [hinge, tip, ...extraPts]
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1])
  const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys)
  const ox = w < 0.01 ? 50 : ((hinge[0] - Math.min(...xs)) / w) * 100
  const oy = h < 0.01 ? 100 : ((hinge[1] - Math.min(...ys)) / h) * 100
  const d = [poly(hinge, tip), ...extra].join('')
  return `<path class="blade" style="transform-box:fill-box;transform-origin:${f(ox)}% ${f(oy)}%;transform:rotate(var(--b${n},0deg));transition:transform .25s ease-out" d="${d}" fill="none"/>`
}

/** Angle (°, sens horaire à l'écran) qui amène le vecteur `a` sur le vecteur `b`. */
export function angle(a: Pt, b: Pt): number {
  const cross = a[0] * b[1] - a[1] * b[0]
  const dot = a[0] * b[0] + a[1] * b[1]
  return Math.round((Math.atan2(cross, dot) * 180) / Math.PI)
}

export type PoleMark = 'none' | 'nc' | 'breaker' | 'disconnector' | 'contactor'
export interface PoleOut { svg: string; rot: number; mid: Pt; /** milieu de la lame une fois fermée */ midClosed: Pt; /** contact fermé au repos (NF) : la lame est dessinée appuyée contre la barre */ nc?: boolean }

/** Pôle de contact entre deux bornes (haut, bas) : fût fixe en haut, lame articulée en bas, ouverte au repos. */
export function pole(n: number, top: Pt, bot: Pt, mark: PoleMark = 'none'): PoleOut {
  const L = bot[1] - top[1]
  const m = Math.max(5, Math.min(14, L * 0.28))
  const tipY = top[1] + m
  const hingeY = bot[1] - m
  const span = Math.max(6, hingeY - tipY)
  const open: Pt = [top[0] - span * 0.38, tipY]
  const hinge: Pt = [bot[0], hingeY]
  const closed: Pt = [top[0], tipY]
  // contact NF : au repos la lame touche l'extrémité de la barre ; actionné, elle s'écarte vers la position ouverte
  // (sens normalisé : la barre part vers la droite du conducteur amont et la lame, articulée en bas, s'appuie dessus en penchant à droite)
  const away: Pt = [top[0] + 4 + span * 0.3, tipY]
  const rest: Pt = mark === 'nc' ? [top[0] + 4, tipY] : open
  const rot = mark === 'nc'
    ? angle([rest[0] - hinge[0], rest[1] - hinge[1]], [away[0] - hinge[0], away[1] - hinge[1]])
    : angle([open[0] - hinge[0], open[1] - hinge[1]], [closed[0] - hinge[0], closed[1] - hinge[1]])
  let svg = line(top, closed) + line(bot, hinge)
  const extra: string[] = []
  const extraPts: Pt[] = []
  if (mark === 'nc') svg += line([top[0], tipY], [top[0] + 4, tipY])
  if (mark === 'breaker') {
    const y = tipY - 5
    svg += line([top[0] - 3, y - 3], [top[0] + 3, y + 3]) + line([top[0] - 3, y + 3], [top[0] + 3, y - 3])
  }
  if (mark === 'disconnector') {
    // petite barre perpendiculaire au milieu de la lame (elle pivote avec elle)
    const mx = (hinge[0] + open[0]) / 2, my = (hinge[1] + open[1]) / 2
    const vx = open[0] - hinge[0], vy = open[1] - hinge[1], len = Math.hypot(vx, vy)
    const px = (-vy / len) * 3.5, py = (vx / len) * 3.5
    extra.push(poly([mx - px, my - py], [mx + px, my + py]))
    extraPts.push([mx - px, my - py], [mx + px, my + py])
  }
  if (mark === 'contactor') {
    // contacteur : demi-cercle accroché au bas du conducteur amont, bombé du côté de la lame
    const r = 3.6
    svg += path(`M${f(top[0])} ${f(tipY - 2 * r)}A${r} ${r} 0 0 0 ${f(top[0])} ${f(tipY)}`, 'fill="none"')
  }
  svg += blade(n, hinge, rest, extra, extraPts)
  const alt: Pt = mark === 'nc' ? away : closed
  return { svg, rot, mid: [(hinge[0] + rest[0]) / 2, (hinge[1] + rest[1]) / 2], midClosed: [(hinge[0] + alt[0]) / 2, (hinge[1] + alt[1]) / 2], nc: mark === 'nc' }
}

export type Head = 'none' | 'push' | 'mushroom' | 'rotate' | 'lever' | 'cam' | 'key'

/** Liaison mécanique en pointillés entre les pôles, puis tête de commande à gauche du premier. */
export function actuator(mids: Pt[], head: Head, shift = 0): string {
  if (!mids.length) return ''
  const sorted = [...mids].sort((a, b) => a[0] - b[0])
  const first = sorted[0], last = sorted[sorted.length - 1]
  let svg = ''
  if (sorted.length > 1) svg += line(first, last, DASH)
  if (head === 'none') return svg
  const x = first[0] - 8, y = first[1]
  svg += line(first, [x, y], DASH)
  switch (head) {
    case 'push':
      // bouton poussoir : la commande (crochet) et sa liaison en pointillés suivent la lame quand on appuie
      svg = (sorted.length > 1 ? line(first, last, DASH) : '') + `<g class="head" style="transform:translateX(calc(var(--hs,0) * ${f(shift)}px));transition:transform .25s ease-out">` + line(first, [x - 1, y], DASH) + path(`M${f(x + 3)} ${f(y - 5.5)}H${f(x - 1)}V${f(y + 5.5)}H${f(x + 3)}`, 'fill="none"') + '</g>'
      break
    case 'mushroom': svg += path(`M${f(x)} ${f(y - 7)}A7 7 0 0 0 ${f(x)} ${f(y + 7)}Z`, 'fill="currentColor"'); break
    case 'rotate': svg += path(`M${f(x)} ${f(y - 7)}A7 7 0 0 0 ${f(x)} ${f(y + 7)}Z`, 'fill="currentColor"') + path(`M${f(x - 5)} ${f(y - 9)}A9 9 0 0 1 ${f(x - 5)} ${f(y + 9)}`, 'fill="none"') + path(`M${f(x - 7)} ${f(y + 8)}L${f(x - 4)} ${f(y + 9)}L${f(x - 5)} ${f(y + 5.5)}`, 'fill="none"'); break
    case 'lever': svg += line([x, y], [x - 4, y - 7]) + line([x - 4, y - 7], [x - 8, y - 7]); break
    case 'cam': svg += circle(x - 3, y, 3, BG) + line([x - 6, y], [x - 9, y]); break
    case 'key': svg += circle(x - 3, y, 3, BG) + line([x - 6, y], [x - 12, y]) + line([x - 12, y], [x - 12, y + 3]) + line([x - 9, y], [x - 9, y + 3]); break
  }
  return svg
}

/** Contact(s) : un pôle par paire de bornes, lames animées dans l'ordre de `poles`, liaison mécanique et tête de commande. */
export function contacts(ports: PortInfo[], poles: [string, string][], mark: PoleMark | PoleMark[], head: Head): { svg: string; blades: { rot: number; closed: boolean }[] } | null {
  const by = new Map(ports.map((p) => [p.id, p]))
  let svg = ''
  const blades: { rot: number; closed: boolean }[] = []
  const mids: Pt[] = []
  let shift = 0
  for (let i = 0; i < poles.length; i++) {
    const a = by.get(poles[i][0]), b = by.get(poles[i][1])
    if (!a || !b || Math.abs(a.y - b.y) < 12) return null
    const [t, u] = a.y < b.y ? [a, b] : [b, a]
    const p = pole(i, [t.x, t.y], [u.x, u.y], Array.isArray(mark) ? mark[i] ?? 'none' : mark)
    svg += p.svg
    blades.push({ rot: p.rot, closed: !!p.nc })
    mids.push(p.mid)
    if (i === 0) shift = p.midClosed[0] - p.mid[0]
  }
  return { svg: svg + actuator(mids, head, shift), blades }
}

/** Boîtier d'appareil : rectangle entre les bornes (une borne à l'intérieur du cadre est posée sur son bord), titre et pictogramme au centre. */
export function box(w: number, h: number, ports: PortInfo[], opts: { title?: string; sub?: string; glyph?: string; inset?: number } = {}): string {
  const inset = opts.inset ?? 10
  const ups = ports.filter((p) => p.dir === 'up'), dns = ports.filter((p) => p.dir === 'down'), lfs = ports.filter((p) => p.dir === 'left'), rts = ports.filter((p) => p.dir === 'right')
  const edge = (vals: number[], fallback: number, onEdge: (m: number) => boolean, pad: number, pick: (a: number[]) => number) => {
    if (!vals.length) return fallback
    const m = pick(vals)
    return onEdge(m) ? m : m + pad
  }
  const y0 = edge(ups.map((p) => p.y), 1, (m) => m >= 5, inset, (a) => Math.max(...a))
  const y1 = edge(dns.map((p) => p.y), h - 1, (m) => m <= h - 5, -inset, (a) => Math.min(...a))
  const x0 = edge(lfs.map((p) => p.x), 1, (m) => m >= 5, inset, (a) => Math.max(...a))
  const x1 = edge(rts.map((p) => p.x), w - 1, (m) => m <= w - 5, -inset, (a) => Math.min(...a))
  let svg = rect(x0, y0, x1 - x0, y1 - y0, BG)
  for (const p of ports) {
    if (p.dir === 'up' && p.y < y0 - 0.5) svg += line([p.x, p.y], [p.x, y0])
    else if (p.dir === 'down' && p.y > y1 + 0.5) svg += line([p.x, p.y], [p.x, y1])
    else if (p.dir === 'left' && p.x < x0 - 0.5) svg += line([p.x, p.y], [x0, p.y])
    else if (p.dir === 'right' && p.x > x1 + 0.5) svg += line([p.x, p.y], [x1, p.y])
  }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2
  if (opts.glyph) svg += opts.glyph.replace(/\{cx\}/g, f(cx)).replace(/\{cy\}/g, f(cy))
  if (opts.title) svg += text(cx, cy + (opts.sub ? -1 : 3), opts.title, Math.min(9, Math.max(5.5, (x1 - x0) / (opts.title.length * 0.7 + 1))), 'font-weight="700"')
  if (opts.sub) svg += text(cx, cy + 8, opts.sub, 6)
  return svg
}

/** Losange (capteurs) centré en (cx, cy). */
export const diamond = (cx: number, cy: number, r: number, attrs = '') => path(`M${f(cx)} ${f(cy - r)}L${f(cx + r)} ${f(cy)}L${f(cx)} ${f(cy + r)}L${f(cx - r)} ${f(cy)}Z`, attrs || BG)

/** Terre. */
export const earth = (x: number, y: number) => line([x, y], [x, y + 8]) + line([x - 8, y + 8], [x + 8, y + 8]) + line([x - 5, y + 12], [x + 5, y + 12]) + line([x - 2, y + 16], [x + 2, y + 16])
