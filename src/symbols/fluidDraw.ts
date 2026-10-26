import type { PortDef, SymbolDef } from '../types'
import { exhaustPortIds, pilotNumbers, portNumbers, solenoidNames } from '../fluidNames'

/**
 * Dessin dynamique des distributeurs et des vérins pneumatiques et hydrauliques (inspiré des simulateurs de circuits fluides) :
 * les cases du distributeur glissent pour amener la case active devant les orifices, le piston du vérin se déplace et chaque chambre
 * est colorée selon sa pression (rouge = sous pression, bleu = échappement ou retour à la bâche, orange = fuite).
 * Les orifices restent exactement à la place de ceux du symbole d'origine : les fils existants ne bougent pas.
 */
export type Pot = string | null | undefined

export const PRESS_COLOR = { P: '#e53935', R: '#1e88e5', X: '#fb8c00' } as const
const stroke = (p: Pot) => (p === 'P' || p === 'R' || p === 'X' ? PRESS_COLOR[p] : 'currentColor')
const fillOf = (p: Pot) => (p === 'P' ? 'rgba(229,57,53,0.55)' : p === 'R' ? 'rgba(30,136,229,0.45)' : p === 'X' ? 'rgba(251,140,0,0.5)' : 'rgba(0,0,0,0)')
const n = (v: number) => Math.round(v * 100) / 100

type Valve = Extract<NonNullable<SymbolDef['fluid']>, { k: 'valve' }>
type Cyl = Extract<NonNullable<SymbolDef['fluid']>, { k: 'cyl' }>

const fluidPorts = (def: SymbolDef) => def.ports.filter((p) => p.dir === 'up' || p.dir === 'down')

/** Le symbole peut être dessiné dynamiquement : tous ses orifices de travail sont en haut et en bas (distributeur) ou en bas (vérin). */
export function isDynamic(def: SymbolDef | undefined): boolean {
  const f = def?.fluid
  if (!def || !f) return false
  if (f.k === 'valve') return fluidPorts(def).length >= 2 && def.ports.every((p) => p.dir === 'up' || p.dir === 'down' || p.dir === 'left' || p.dir === 'right')
  if (f.k === 'cyl') return def.ports.every((p) => p.dir === 'down')
  return false
}

// ───────────────────────── distributeurs

export interface ValveView {
  /** case active (fractionnaire pendant le glissement) : 0 = case de gauche (commande A), 1 = case de repos, 2 = case de droite (commande B, trois positions) */
  pos: number
  pot: (portId: string) => Pot
  /** bobine ou commande A / B alimentée */
  a?: boolean
  b?: boolean
  /** repère du distributeur : sert à afficher le nom des électroaimants (1V1+ et 1V1−) */
  label?: string
}

/** Case active d'un distributeur selon son état. */
export const valveIndex = (f: Valve, a: boolean, b: boolean): number => (f.three ? (a ? 0 : b ? 2 : 1) : a ? 0 : 1)

const arrow = (x1: number, y1: number, x2: number, y2: number, color: string): string => {
  const ang = Math.atan2(y2 - y1, x2 - x1)
  const s = 3.6
  const px = (a: number, d: number) => n(x2 - Math.cos(a) * d)
  const py = (a: number, d: number) => n(y2 - Math.sin(a) * d)
  const l = ang + 0.45, r = ang - 0.45
  return `<path d="M${px(l, s)} ${py(l, s)}L${n(x2)} ${n(y2)}L${px(r, s)} ${py(r, s)}" fill="none" stroke="${color}"/>`
}

export function valveSvg(def: SymbolDef, view: ValveView): string {
  const f = def.fluid as Valve
  const fp = fluidPorts(def)
  const xs = fp.map((p) => p.x)
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2
  const cw = Math.max(Math.max(...xs) - Math.min(...xs) + 40, 48)
  const H = def.h
  const ch = Math.max(22, H - 8)
  const y0 = (H - ch) / 2, y1 = y0 + ch
  const cells: [string, string][][] = f.three ? [f.act, f.rest, f.actB ?? []] : [f.act, f.rest]
  const centre = (k: number) => cx + (k - view.pos) * cw
  const side = (p: PortDef | undefined) => (p?.dir === 'up' ? y0 : y1)
  const byId = (id: string) => fp.find((p) => p.id === id)
  let out = ''
  // orifices : tuyaux jusqu'à la case devant eux, colorés par leur pression
  for (const p of fp) {
    const c = stroke(view.pot(p.id))
    out += `<path d="M${n(p.x)} ${n(p.dir === 'up' ? 0 : H)}V${n(p.dir === 'up' ? y0 : y1)}" stroke="${c}" stroke-width="${c === 'currentColor' ? 1.4 : 2}" fill="none"/>`
  }
  cells.forEach((links, k) => {
    const c = centre(k)
    const active = Math.abs(k - view.pos) < 0.5
    out += `<rect x="${n(c - cw / 2)}" y="${n(y0)}" width="${n(cw)}" height="${n(ch)}" fill="var(--bg)" stroke="currentColor" stroke-width="${active ? 1.6 : 1}"${active ? '' : ' stroke-opacity="0.55"'}/>`
    const vx = (p: PortDef) => c + (p.x - cx)
    const used = new Set<string>()
    for (const [a, b] of links) {
      const pa = byId(a), pb = byId(b)
      if (!pa || !pb) continue
      used.add(a); used.add(b)
      const qa = view.pot(a), qb = view.pot(b)
      const q = qa === 'X' || qb === 'X' ? 'X' : qa === 'P' || qb === 'P' ? 'P' : qa === 'R' || qb === 'R' ? 'R' : null
      const col = active ? stroke(q) : '#9a9a9a'
      const w = active && q ? 2 : 1.2
      const xa = vx(pa), xb = vx(pb), ya = side(pa), yb = side(pb)
      if (pa.dir !== pb.dir) {
        out += `<path d="M${n(xa)} ${n(ya)}L${n(xb)} ${n(yb)}" stroke="${col}" stroke-width="${w}" fill="none"/>${arrow(xa, ya, xb, yb, col)}`
      } else {
        const dy = pa.dir === 'up' ? 7 : -7
        out += `<path d="M${n(xa)} ${n(ya)}V${n(ya + dy)}H${n(xb)}V${n(yb)}" stroke="${col}" stroke-width="${w}" fill="none"/>`
      }
    }
    // orifices obturés dans cette case : petite barre en T
    for (const p of fp) {
      if (used.has(p.id)) continue
      const x = vx(p), y = side(p), dy = p.dir === 'up' ? 4 : -4
      out += `<path d="M${n(x)} ${n(y)}V${n(y + dy)}M${n(x - 3)} ${n(y + dy)}H${n(x + 3)}" stroke="${active ? 'currentColor' : '#9a9a9a'}" stroke-width="1.2" fill="none"/>`
    }
  })
  // commandes aux deux extrémités du tiroir (elles accompagnent les cases)
  const xl = centre(0) - cw / 2, xr = centre(cells.length - 1) + cw / 2
  const pilot = (dirName: 'left' | 'right') => def.ports.find((p) => p.dir === dirName)
  const solenoid = (x: number, dir: 1 | -1, on: boolean, ym: number, side: 'a' | 'b') =>
    `<rect data-sol="${side}" style="cursor:pointer" x="${n(dir < 0 ? x - 13 : x)}" y="${n(ym - 6)}" width="13" height="12" fill="${on ? '#ffd54f' : 'var(--bg)'}" stroke="currentColor"/><path d="M${n(dir < 0 ? x - 13 : x)} ${n(ym + 6)}L${n(dir < 0 ? x : x + 13)} ${n(ym - 6)}" stroke="currentColor"/>`
  const pilotShape = (x: number, dir: 1 | -1, port: PortDef | undefined, ym: number) => {
    const c = stroke(port ? view.pot(port.id) : null)
    const xe = x + dir * 9 // extrémité extérieure de la flèche
    const tip = x
    return `${port ? `<path d="M${n(port.x)} ${n(port.y)}${port.y !== ym ? `V${n(ym)}` : ''}H${n(xe)}" stroke="${c}" fill="none"/>` : ''}<path d="M${n(xe)} ${n(ym - 4)}V${n(ym + 4)}L${n(tip)} ${n(ym)}Z" fill="${c === 'currentColor' ? 'currentColor' : c}" stroke="${c}"/>`
  }
  const pl = pilot('left'), pr = pilot('right')
  const yl = f.a === 'pneu' && pl ? pl.y : y0 + ch / 2
  const yr = f.b === 'pneu' && pr ? pr.y : y0 + ch / 2
  const pil = pilotNumbers(def)
  const [namesA, namesB] = solenoidNames(view.label ?? '', pil)
  // numéros normalisés des orifices (1 alimentation, 2 et 4 utilisations, 3 et 5 échappements) et des commandes (14, 12, 10)
  const nums = portNumbers(def)
  const exhaust = new Set(exhaustPortIds(def))
  for (const p of fp) {
    const t = nums[p.id]
    const sil = exhaust.has(p.id)
    if (t) out += `<text x="${n(p.x + (sil ? 6 : 2.5))}" y="${n(p.dir === 'up' ? -2 : H + 7)}" font-size="6" fill="currentColor" stroke="none">${t}</text>`
    // silencieux d'échappement posé sur l'orifice : triangle dont la pointe regarde l'atmosphère
    if (sil) { const s = p.dir === 'up' ? -1 : 1, y = p.dir === 'up' ? 0 : H; out += `<path d="M${n(p.x - 3.5)} ${n(y + s * 1)}L${n(p.x + 3.5)} ${n(y + s * 1)}L${n(p.x)} ${n(y + s * 8)}Z" fill="var(--bg)" stroke="currentColor" stroke-width="1"/>` }
  }
  const tag = (x: number, y: number, t: string | undefined) => (t ? `<text x="${n(x)}" y="${n(y)}" font-size="6" text-anchor="middle" fill="currentColor" stroke="none">${t.replace('-', '−')}</text>` : '')
  const pilotNo = (x: number, y: number, t: string | undefined, anchor: 'start' | 'end') => (t ? `<text x="${n(x)}" y="${n(y)}" font-size="5.5" text-anchor="${anchor}" fill="currentColor" stroke="none">${t}</text>` : '')
  if (f.a === 'elec') out += solenoid(xl, -1, !!view.a, yl, 'a') + tag(xl - 6.5, yl - 8, namesA[0]) + pilotNo(xl - 14, yl + 2, pil[0], 'end')
  else if (f.a === 'man') out += `<path d="M${n(xl)} ${n(yl)}H${n(xl - 4)}" stroke="currentColor"/><rect x="${n(xl - 13)}" y="${n(yl - 5)}" width="9" height="10" fill="var(--bg)" stroke="currentColor"/><path d="M${n(xl - 11)} ${n(yl - 2)}H${n(xl - 6)}M${n(xl - 8.5)} ${n(yl - 2)}V${n(yl + 3)}" stroke="currentColor" fill="none"/>`
  else if (f.a === 'pneu') out += pilotShape(xl, -1, pl, yl)
  if (f.b === 'spring') {
    const pts = [0, 2, 4, 7, 10, 13, 16, 18].map((d, i) => `${n(xr + d)} ${n(yr + (i % 2 ? 4 : -4) * (i === 0 || i === 7 ? 0 : 1))}`)
    out += `<path d="M${pts.join('L')}" fill="none" stroke="currentColor"/>`
  } else if (f.b === 'elec') out += solenoid(xr, 1, !!view.b, yr, 'b') + tag(xr + 6.5, yr - 8, namesB[0]) + pilotNo(xr + 14, yr + 2, pil[1], 'start')
  else if (f.b === 'pneu') out += pilotShape(xr, 1, pr, yr)
  return out
}

// ───────────────────────── vérins

export interface Detector { label: string; at: number; on: boolean }

export interface CylView {
  /** détecteurs de position posés sur le vérin */
  detectors?: Detector[]
  /** position de la tige : 0 = rentrée, 1 = sortie */
  p: number
  potCap: Pot
  potRod: Pot
}

interface CylGeom { left: number; right: number; yb: number; bh: number; rodRight: boolean; capX: number; rodX?: number }

function cylGeom(def: SymbolDef): CylGeom {
  const f = def.fluid as Cyl
  const cap = def.ports.find((p) => p.id === f.cap)!
  const rod = f.rod ? def.ports.find((p) => p.id === f.rod) : undefined
  const bh = Math.max(12, Math.min(20, def.h - 14))
  const yb = def.h - 8 - bh
  if (rod) {
    const rodRight = rod.x > cap.x
    return { left: Math.min(cap.x, rod.x) - 10, right: Math.max(cap.x, rod.x) + 10, yb, bh, rodRight, capX: cap.x, rodX: rod.x }
  }
  // simple effet : la tige sort à l'opposé de l'orifice (poussée) ou du côté de l'orifice (traction)
  const toRight = f.single === 'pull' ? cap.x > def.w / 2 : cap.x < def.w / 2
  const rodRight = toRight
  return { left: rodRight ? cap.x - 10 : cap.x - 50, right: rodRight ? cap.x + 50 : cap.x + 10, yb, bh, rodRight, capX: cap.x }
}

/** Position de repos de la tige : rentrée, ou sortie pour un simple effet à ressort de sortie. */
export const cylRest = (def: SymbolDef): number => ((def.fluid as Cyl).single === 'pull' ? 1 : 0)

export function cylinderSvg(def: SymbolDef, view: CylView): string {
  const f = def.fluid as Cyl
  const g = cylGeom(def)
  const sign = g.rodRight ? 1 : -1
  const len = g.right - g.left
  const capEnd = g.rodRight ? g.left : g.right
  const rodEnd = g.rodRight ? g.right : g.left
  const pc = capEnd + sign * (4 + (len - 8) * Math.min(1, Math.max(0, view.p)))
  const ym = g.yb + g.bh / 2
  const rect = (a: number, b: number) => `x="${n(Math.min(a, b))}" y="${n(g.yb)}" width="${n(Math.abs(b - a))}" height="${n(g.bh)}"`
  let out = ''
  // chambres : colorées selon leur pression (la chambre alimentée grandit, l'autre se vide)
  out += `<rect ${rect(capEnd, pc - sign * 2)} fill="${fillOf(view.potCap)}" stroke="none"/>`
  if (f.rod) out += `<rect ${rect(pc + sign * 2, rodEnd)} fill="${fillOf(view.potRod)}" stroke="none"/>`
  out += `<rect x="${n(g.left)}" y="${n(g.yb)}" width="${n(len)}" height="${n(g.bh)}" fill="none" stroke="currentColor" stroke-width="1.4"/>`
  // ressort de rappel du simple effet, dans la chambre sans orifice
  if (!f.rod) {
    const a = pc + sign * 2, z = f.single === 'pull' ? capEnd : rodEnd
    const from = f.single === 'pull' ? pc - sign * 2 : a
    const pts: string[] = []
    const teeth = 7
    for (let i = 0; i <= teeth; i++) pts.push(`${n(from + ((z - from) * i) / teeth)} ${n(ym + (i === 0 || i === teeth ? 0 : i % 2 ? -4 : 4))}`)
    out += `<path d="M${pts.join('L')}" fill="none" stroke="currentColor"/>`
  }
  // piston, tige et embout
  const tip = pc + sign * (len - 4 + 14)
  out += `<rect x="${n(pc - 2)}" y="${n(g.yb + 1)}" width="4" height="${n(g.bh - 2)}" fill="currentColor" stroke="currentColor"/>`
  out += `<rect x="${n(Math.min(pc, tip))}" y="${n(ym - 2.4)}" width="${n(Math.abs(tip - pc))}" height="4.8" fill="#cfd8dc" stroke="currentColor" stroke-width="1.1"/><path d="M${n(tip)} ${n(ym - 6)}V${n(ym + 6)}" stroke="currentColor" stroke-width="2" fill="none"/>`
  out += `<path d="M${n(rodEnd)} ${n(g.yb)}V${n(ym - 1.8)}M${n(rodEnd)} ${n(ym + 1.8)}V${n(g.yb + g.bh)}" stroke="currentColor" stroke-width="2.4" fill="none"/>`
  // orifices : tuyaux jusqu'au corps, colorés par leur pression
  const stub = (x: number, pot: Pot) => {
    const c = stroke(pot)
    return `<path d="M${n(x)} ${n(def.h)}V${n(g.yb + g.bh)}" stroke="${c}" stroke-width="${c === 'currentColor' ? 1.4 : 2}" fill="none"/>`
  }
  // détecteurs de position : repère sur le corps, allumé quand le piston passe devant
  for (const d of view.detectors ?? []) {
    const x = capEnd + sign * (4 + (len - 8) * Math.min(1, Math.max(0, d.at)))
    out += `<rect x="${n(x - 3)}" y="${n(g.yb + g.bh)}" width="6" height="5" fill="${d.on ? '#43a047' : 'var(--bg)'}" stroke="currentColor"/><text x="${n(x)}" y="${n(g.yb + g.bh + 12)}" font-size="6" text-anchor="middle" fill="currentColor" stroke="none">${d.label}</text>`
  }
  out += stub(g.capX, view.potCap)
  if (g.rodX !== undefined) out += stub(g.rodX, view.potRod)
  return out
}

/** Dessin au repos, sans couleur : vignettes de la palette et symbole en édition. */
export function staticSvg(def: SymbolDef): string | null {
  if (!isDynamic(def)) return null
  const f = def.fluid
  if (f?.k === 'valve') return valveSvg(def, { pos: 1, pot: () => null })
  if (f?.k === 'cyl') return cylinderSvg(def, { p: cylRest(def), potCap: null, potRod: null })
  return null
}
