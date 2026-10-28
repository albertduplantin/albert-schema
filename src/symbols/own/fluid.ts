import type { SymbolDef } from '../../types'
import { BG, DASH, box, circle, diamond, f, line, path, poly, rect, text, type Own, type PortInfo, type Pt } from './kit'

const T = (fr: string, en: string) => ({ fr, en })

/** Flèche pleine dont la pointe est en (x, y) et qui pointe vers +x (à tourner si besoin). */
const tri = (x: number, y: number, s: number, fill: boolean) => path(`M${f(x)} ${f(y)}L${f(x - s * 1.6)} ${f(y - s)}L${f(x - s * 1.6)} ${f(y + s)}Z`, fill ? 'fill="currentColor"' : BG)

/** Pose un motif dessiné « à plat » (flux vers +x, centré en 0,0) au point `c`, tourné de `deg`. */
const place = (c: Pt, deg: number, inner: string) => `<g transform="translate(${f(c[0])} ${f(c[1])}) rotate(${deg})">${inner}</g>`

/** Angle de rotation d'un motif dont le flux entre par la borne `dir` : le flux va vers l'intérieur du symbole. */
const inward: Record<PortInfo['dir'], number> = { left: 0, right: 180, up: 90, down: -90 }
const away: Record<PortInfo['dir'], Pt> = { left: [1, 0], right: [-1, 0], up: [0, 1], down: [0, -1] }

/** Symbole à une borne : tige de 6 puis motif de demi-longueur `half`, orienté vers l'intérieur. */
function oneport(p: PortInfo, half: number, inner: string, stub = 6): string {
  const a = away[p.dir]
  const c: Pt = [p.x + a[0] * (stub + half), p.y + a[1] * (stub + half)]
  return line([p.x, p.y], [p.x + a[0] * stub, p.y + a[1] * stub]) + place(c, inward[p.dir], inner)
}

/** Symbole à deux bornes alignées : tiges jusqu'au motif posé au milieu ; le flux va de la borne `a` à la borne `b`. */
function twoport(a: PortInfo, b: PortInfo, half: number, inner: string): string {
  const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2
  const horiz = Math.abs(a.x - b.x) >= Math.abs(a.y - b.y)
  const deg = horiz ? (b.x >= a.x ? 0 : 180) : b.y >= a.y ? 90 : -90
  const u: Pt = horiz ? [Math.sign(b.x - a.x) || 1, 0] : [0, Math.sign(b.y - a.y) || 1]
  const ea: Pt = [cx - u[0] * half, cy - u[1] * half], eb: Pt = [cx + u[0] * half, cy + u[1] * half]
  // si les deux bornes ne sont pas exactement alignées, on raccorde par un coude
  const join = (p: PortInfo, e: Pt) => (horiz ? path(poly([p.x, p.y], [e[0], p.y], e), 'fill="none"') : path(poly([p.x, p.y], [p.x, e[1]], e), 'fill="none"'))
  return join(a, ea) + join(b, eb) + place([cx, cy], deg, inner)
}

// ───────────────────────── motifs (flux vers +x, centrés en 0,0)
const G = {
  filter: (): [number, string] => [10, diamond(0, 0, 10) + line([0, -10], [0, 10], DASH)],
  dryer: (): [number, string] => [10, diamond(0, 0, 10) + line([-6, 0], [6, 0], DASH) + path('M-4 -4q4 -4 8 0', 'fill="none"')],
  lubricator: (): [number, string] => [10, diamond(0, 0, 10) + path('M0 -5L-3 1A3.2 3.2 0 0 0 3 1Z', 'fill="currentColor"')],
  cooler: (heat: boolean): [number, string] => [10, diamond(0, 0, 10) + tri(7, 0, 2.6, !heat) + tri(-2, 0, 2.6, heat)],
  controlled: (): [number, string] => [10, diamond(0, 0, 10) + text(0, 3, 'θ', 9)],
  separator: (auto: boolean): [number, string] => [10, diamond(0, 0, 10) + line([0, -10], [0, 10], DASH) + path('M-3 12L3 12L0 17Z', auto ? 'fill="currentColor"' : BG)],
  regulator: (): [number, string] => [10, rect(-10, -10, 20, 20, BG) + path('M-7 7L7 -7', 'fill="none"') + path('M4 -7L7 -7L7 -4', 'fill="none"') + path('M-3 -10q-2 -2 0 -4t0 -4', 'fill="none"')],
  check: (): [number, string] => [10, circle(-3, 0, 3.2, BG) + path('M3 -5L8 0L3 5', 'fill="none"') + line([-10, 0], [-6.2, 0]) + line([8, 0], [10, 0])],
  valve: (): [number, string] => [10, path('M-10 -7L10 7V-7L-10 7Z', BG)],
  gauge: (mark: string): [number, string] => [9, circle(0, 0, 9, BG) + (mark ? text(0, 3.2, mark, 9, 'font-weight="700"') : path('M-4 4L3 -4', 'fill="none"') + circle(0, 0, 1.2, 'fill="currentColor"'))],
  tank: (w: number): [number, string] => [w, path(`M${f(-w)} -9H${f(w)}V9H${f(-w)}Z`, BG) + path(`M${f(-w)} 0H${f(w)}`, 'stroke-dasharray="2 3"')],
  coupling: (): [number, string] => [6, circle(0, 0, 3, BG)],
  hose: (): [number, string] => [10, path('M-10 0q2.5 -5 5 0t5 0t5 0t5 0', 'fill="none"')],
}

const gaugeMark = (n: string): string => (/vide/i.test(n) ? 'V' : /thermom/i.test(n) ? 'θ' : /flux|débit/i.test(n) ? 'Q' : /niveau/i.test(n) ? 'L' : /tachym/i.test(n) ? 'n' : /couple/i.test(n) ? 'C' : /pression/i.test(n) ? 'P' : '')

// ───────────────────────── recettes
/** Éléments de traitement de l'air (filtre, sécheur, lubrificateur…) à deux bornes alignées. */
function airTreatment(def: SymbolDef, ports: PortInfo[]): Omit<Own, 'std'> | null {
  const n = def.name.fr
  const main = ports.filter((p) => p.dir === 'left' || p.dir === 'right').sort((a, b) => a.x - b.x)
  const drains = ports.filter((p) => p.dir === 'down' || p.dir === 'up')
  if (main.length < 2) return null
  const a = main[0], b = main[main.length - 1]
  let g: [number, string], name = T('', '')
  if (/sécheur/i.test(n)) { g = G.dryer(); name = T('Sécheur d’air comprimé', 'Compressed-air dryer') }
  else if (/lubrificateur/i.test(n) && !/filtre/i.test(n)) { g = G.lubricator(); name = T('Lubrificateur', 'Lubricator') }
  else if (/refroidissement/i.test(n)) { g = G.cooler(false); name = T('Refroidisseur d’air comprimé', 'Compressed-air cooler') }
  else if (/chauffage/i.test(n)) { g = G.cooler(true); name = T('Réchauffeur d’air comprimé', 'Compressed-air heater') }
  else if (/température/i.test(n)) { g = G.controlled(); name = T('Régulation de température de l’air', 'Air temperature control') }
  else if (/séparation|séparateur/i.test(n) && !/filtre/i.test(n)) { g = G.separator(/automatique/i.test(n)); name = T(/automatique/i.test(n) ? 'Séparateur d’eau à purge automatique' : 'Séparateur d’eau à purge manuelle', /automatique/i.test(n) ? 'Water separator, automatic drain' : 'Water separator, manual drain') }
  else if (/filtre/i.test(n)) { g = G.filter(); name = /séparation|séparateur/i.test(n) ? T(/automatique/i.test(n) ? 'Filtre avec séparateur d’eau, purge automatique' : 'Filtre avec séparateur d’eau, purge manuelle', 'Filter with water separator') : T('Filtre à air comprimé', 'Compressed-air filter') }
  else return null
  let svg = twoport(a, b, g[0], g[1])
  if (/indicateur/i.test(n)) { name = T(name.fr + ' avec indicateur de colmatage', name.en + ' with clogging indicator') }
  if (/aimant/i.test(n)) { name = T(name.fr + ' avec aimant', name.en + ' with magnet') }
  if (/échangeur/i.test(n)) { name = T(name.fr + ' à échangeur de chaleur', name.en + ' with heat exchanger') }
  const cx = (a.x + b.x) / 2
  for (const d of drains) svg += line([cx, a.y + (d.dir === 'down' ? 10 : -10)], [d.x, d.y], DASH)
  return { svg, name }
}

/** Unité de maintenance : filtre, séparateur, régulateur, manomètre et lubrificateur dans un cadre en pointillés. */
function maintenanceUnit(def: SymbolDef, ports: PortInfo[]): Omit<Own, 'std'> | null {
  const n = def.name.fr
  if (!/unité d.entretien|unité de maintenance/i.test(n)) return null
  const main = ports.filter((p) => p.dir === 'left' || p.dir === 'right').sort((a, b) => a.x - b.x)
  if (main.length < 2) return null
  const a = main[0], b = main[main.length - 1], cy = a.y
  const items: string[] = [G.filter()[1], G.regulator()[1]]
  const lub = /lubrificateur|luxe/i.test(n), man = /manomètre|luxe/i.test(n)
  if (lub) items.push(G.lubricator()[1])
  const step = 26
  const w = items.length * step
  const x0 = (a.x + b.x) / 2 - w / 2
  let svg = line([a.x, a.y], [x0, cy]) + line([x0 + w, cy], [b.x, b.y])
  svg += rect(x0, cy - 20, w, 40, `fill="none" ${DASH}`)
  items.forEach((it, i) => { svg += place([x0 + step / 2 + i * step, cy], 0, `<g transform="scale(.8)">${it}</g>`) })
  if (man) svg += circle(x0 + w / 2, cy - 30, 6, BG) + text(x0 + w / 2, cy - 27.5, 'P', 7, 'font-weight="700"') + line([x0 + w / 2, cy - 24], [x0 + w / 2, cy - 14], DASH)
  const d = ports.find((p) => p.dir === 'down')
  if (d && /séparateur/i.test(n)) svg += line([x0 + step / 2, cy + 8], [x0 + step / 2, d.y], DASH)
  const drain = /automatique/i.test(n) ? ', purge automatique' : /manuel/i.test(n) ? ', purge manuelle' : ''
  const parts = `filtre, régulateur${man ? ', manomètre' : ''}${lub ? ', lubrificateur' : ''}`
  return { svg, name: T(`Unité de maintenance (${parts}${drain})`, `Air service unit (${parts})`) }
}

type R = Omit<Own, 'std'> | null
const hydOf = (def: SymbolDef) => def.domain === 'hydraulic'
const pid = (ports: PortInfo[], id?: string) => ports.find((p) => p.id === id)
const arrowHead = (to: Pt, from: Pt, s = 3.2): string => {
  const a = Math.atan2(to[1] - from[1], to[0] - from[0])
  const p = (k: number, w: number): Pt => [to[0] - Math.cos(a) * k - Math.sin(a) * w, to[1] - Math.sin(a) * k + Math.cos(a) * w]
  return path(poly(to, p(s * 1.8, s), p(s * 1.8, -s)) + 'Z', 'fill="currentColor"')
}
/** Triangle d'énergie dans un cercle (centre c, rayon r) : la pointe regarde vers `toward`. */
const energy = (c: Pt, r: number, toward: Pt, fill: boolean): string => {
  const dx = toward[0] - c[0], dy = toward[1] - c[1], len = Math.hypot(dx, dy) || 1
  const u: Pt = [dx / len, dy / len], n: Pt = [-u[1], u[0]]
  const tip: Pt = [c[0] + u[0] * (r - 1), c[1] + u[1] * (r - 1)]
  const b: Pt = [c[0] - u[0] * r * 0.25, c[1] - u[1] * r * 0.25]
  const k = r * 0.62
  return path(poly(tip, [b[0] + n[0] * k, b[1] + n[1] * k], [b[0] - n[0] * k, b[1] - n[1] * k]) + 'Z', fill ? 'fill="currentColor"' : BG)
}
/** Trait de la borne jusqu'au cercle (centre c, rayon r), selon l'axe de la borne. */
/** Triangle d'énergie d'un moteur : base contre le cercle du côté de l'orifice `from`, pointe vers le centre. */
const energyIn = (c: Pt, r: number, from: Pt, fill: boolean): string => {
  const dx = from[0] - c[0], dy = from[1] - c[1], len = Math.hypot(dx, dy) || 1
  const u: Pt = [dx / len, dy / len], n: Pt = [-u[1], u[0]]
  const base: Pt = [c[0] + u[0] * (r - 1), c[1] + u[1] * (r - 1)]
  const tip: Pt = [c[0] + u[0] * 1.5, c[1] + u[1] * 1.5]
  const k = r * 0.55
  return path(poly(tip, [base[0] + n[0] * k, base[1] + n[1] * k], [base[0] - n[0] * k, base[1] - n[1] * k]) + 'Z', fill ? 'fill="currentColor"' : BG)
}
const toCircle = (p: PortInfo, c: Pt, r: number): string => {
  if (p.dir === 'up' || p.dir === 'down') {
    const dx = Math.abs(p.x - c[0])
    const edge = dx >= r ? c[1] : c[1] + Math.sign(p.y - c[1] || 1) * Math.sqrt(r * r - dx * dx)
    return line([p.x, p.y], [p.x, edge])
  }
  const dy = Math.abs(p.y - c[1])
  const edge = dy >= r ? c[0] : c[0] + Math.sign(p.x - c[0] || 1) * Math.sqrt(r * r - dy * dy)
  return line([p.x, p.y], [edge, p.y])
}

function pumpOrMotor(def: SymbolDef, ports: PortInfo[]): R {
  const fl = def.fluid, n = def.name.fr
  const isPump = fl?.k === 'fpump' || /^Pompe-moteur/i.test(n), isMotor = fl?.k === 'fmotor'
  if (!isPump && !isMotor) return null
  const hyd = hydOf(def), r = isPump ? 15 : 17
  const vertical = hyd && ports.some((p) => p.dir === 'up' || p.dir === 'down')
  let c: Pt
  if (isMotor && !hyd) c = [def.w * 0.6, def.h / 2]
  else if (vertical) c = [ports[0].x, def.h / 2]
  else c = [def.w / 2, def.h / 2]
  let svg = circle(c[0], c[1], r, BG)
  const roles = fl?.k === 'fpump' ? [fl.out, fl.in] : []
  for (const p of ports) svg += vertical && p.dir === 'left' && !roles.includes(p.id) ? line([p.x, p.y], [c[0] - r, c[1]], DASH) : toCircle(p, c, r)
  if (fl?.k === 'fpump') {
    const out = pid(ports, fl.out)
    if (out) svg += energy(c, r, [out.x, out.y], hyd)
  } else if (isPump) {
    for (const p of ports.filter((q) => q.dir === 'up' || q.dir === 'down').slice(0, 2)) svg += energy(c, r, [p.x, p.y], true)
  } else if (fl?.k === 'fmotor') {
    for (const id of [fl.a, fl.b]) {
      const p = pid(ports, id)
      if (p) svg += energyIn(c, r, [p.x, p.y], hyd)
    }
  }
  if (/variable/i.test(n)) svg += line([c[0] - r - 3, c[1] + r + 3], [c[0] + r + 3, c[1] - r - 3]) + arrowHead([c[0] + r + 3, c[1] - r - 3], [c[0] - r, c[1] + r])
  if (def.w - c[0] > r + 18) svg += line([c[0] + r, c[1]], [Math.min(def.w, c[0] + r + 22), c[1]])
  let name: { fr: string; en: string }
  if (isPump) name = fl?.k === 'fpump' ? (/variable/i.test(n) ? T('Pompe hydraulique à cylindrée variable', 'Variable-displacement hydraulic pump') : T('Pompe hydraulique à cylindrée fixe', 'Fixed-displacement hydraulic pump')) : T('Pompe-moteur hydraulique', 'Hydraulic pump-motor')
  else {
    const two = fl?.k === 'fmotor' && !!fl.b
    const sens = two ? 'deux sens de rotation' : fl?.k === 'fmotor' && fl.rev ? 'sens antihoraire' : 'sens horaire'
    const air = hyd ? 'hydraulique' : 'pneumatique'
    name = T(`Moteur ${air}, ${sens}${/vitesse variable/i.test(n) ? ', vitesse variable' : ''}`, `${hyd ? 'Hydraulic' : 'Air'} motor, ${two ? 'both directions' : 'one direction'}`)
  }
  return { svg, name }
}

/** Pièces élémentaires d'un distributeur (cellule à 2, 3 ou 4 orifices) : traits fléchés entre orifices reliés, barre sur les orifices fermés. */
function cell(def: SymbolDef, ports: PortInfo[]): R {
  const fl = def.fluid
  if (fl?.k !== 'fnet' || !/^[234] (orifices|voies)/i.test(def.name.fr)) return null
  const ys = ports.map((p) => p.y)
  const y0 = Math.min(...ys), y1 = Math.max(...ys)
  const x1 = Math.max(...ports.map((p) => p.x)) + 10, x0 = Math.min(...ports.map((p) => p.x)) - 10
  let svg = rect(x0, y0, x1 - x0, y1 - y0, BG)
  const used = new Set<string>()
  const inside = (p: PortInfo): Pt => [p.x, p.dir === 'up' ? y0 + 4 : y1 - 4]
  for (const [a, b] of fl.links) {
    const pa = pid(ports, a), pb = pid(ports, b)
    if (!pa || !pb) continue
    used.add(a)
    used.add(b)
    const ia = inside(pa), ib = inside(pb)
    if (pa.dir === pb.dir) {
      const dy = pa.dir === 'up' ? 9 : -9
      svg += path(poly(ia, [ia[0], ia[1] + dy], [ib[0], ib[1] + dy], ib), 'fill="none"') + arrowHead(ib, [ib[0], ib[1] + dy])
    } else svg += line(ia, ib) + arrowHead(ib, ia)
  }
  for (const p of ports) {
    if (!used.has(p.id)) {
      const i = inside(p)
      svg += line([i[0] - 4, i[1]], [i[0] + 4, i[1]])
    }
  }
  return { svg, name: T(def.name.fr.replace(/^(\d) Orifices?/i, '$1 orifices').replace(/Voies/, 'voies'), def.name.fr) }
}

function closedPlug(def: SymbolDef, ports: PortInfo[]): R {
  const n = def.name.fr
  if (/^2 Orifices (obtures|fermes)/i.test(n) && ports.length === 2) {
    const [a, b] = ports
    const bar = (p: PortInfo, q: PortInfo): string => {
      const m: Pt = [p.x + (q.x - p.x) * 0.35, p.y + (q.y - p.y) * 0.35]
      const vert = p.dir === 'up' || p.dir === 'down'
      return line([p.x, p.y], m) + (vert ? line([m[0] - 5, m[1]], [m[0] + 5, m[1]]) : line([m[0], m[1] - 5], [m[0], m[1] + 5]))
    }
    return { svg: bar(a, b) + bar(b, a), name: T('Deux orifices obturés', 'Two plugged ports') }
  }
  if (/^2 Orifices passants?$/i.test(n) && ports.length === 2) return { svg: line([ports[0].x, ports[0].y], [ports[1].x, ports[1].y]), name: T('Deux orifices reliés', 'Two connected ports') }
  if (/^Bouchon/i.test(n)) return { svg: oneport(ports[0], 5, line([-5, 0], [4, 0]) + line([4, -5], [4, 5])), name: T('Bouchon', 'Plug') }
  return null
}

function tanks(def: SymbolDef, ports: PortInfo[]): R {
  const n = def.name.fr, w = def.w, h = def.h
  if (/^Bâche à l/i.test(n)) return { svg: path(`M${f(w * 0.12)} ${f(h * 0.25)}V${f(h - 3)}H${f(w * 0.88)}V${f(h * 0.25)}`, 'fill="none"') + line([ports[0].x, ports[0].y], [ports[0].x, h * 0.55]) + line([w * 0.12 + 3, h * 0.5], [w * 0.88 - 3, h * 0.5], DASH), name: T('Réservoir à l’air libre', 'Vented reservoir') }
  if (/^Bâche pressurisée/i.test(n)) {
    const x0 = 5, x1 = w - 5, y1 = h - 26
    return { svg: rect(x0, 4, x1 - x0, y1 - 4, `rx="12" ${BG}`) + line([x0 + 2, 34], [x1 - 2, 34], DASH) + line([ports[0].x, ports[0].y], [ports[0].x, y1]) + text(w / 2, 22, 'N₂', 8), name: T('Accumulateur hydraulique', 'Hydraulic accumulator') }
  }
  if (/^Accumulateur d.air|^Stockage d.air/i.test(n)) {
    const main = ports.filter((p) => p.dir === 'left' || p.dir === 'right').sort((a, b) => a.x - b.x)
    const y = main[0].y, x0 = main[0].x + 10, x1 = main[main.length - 1].x - 10
    let svg = rect(x0, y - 10, x1 - x0, 20, `rx="10" ${BG}`) + line([main[0].x, y], [x0, y]) + line([x1, y], [main[main.length - 1].x, y])
    for (const d of ports.filter((p) => p.dir === 'down')) svg += line([d.x, y + 10], [d.x, d.y], DASH)
    return { svg, name: T(ports.some((p) => p.dir === 'down') ? 'Réservoir d’air comprimé avec purge' : 'Réservoir d’air comprimé', 'Compressed-air receiver') }
  }
  return null
}

function gaugesAndSwitches(def: SymbolDef, ports: PortInfo[]): R {
  const fl = def.fluid, n = def.name.fr
  if (fl?.k === 'fpress') {
    const p = ports[0], a = away[p.dir]
    const c: Pt = [p.x + a[0] * 20, p.y + a[1] * 20]
    const sensor = /analogique|capteur/i.test(n)
    return { svg: line([p.x, p.y], [p.x + a[0] * 10, p.y + a[1] * 10]) + rect(c[0] - 10, c[1] - 9, 20, 18, BG) + text(c[0], c[1] + 3, 'P', 9, 'font-weight="700"') + line([c[0] + 10, c[1]], [c[0] + 18, c[1]], DASH) + line([c[0] + 18, c[1] - 5], [c[0] + 18, c[1] + 5]), name: sensor ? T(/analogique/i.test(n) ? 'Capteur de pression analogique' : 'Capteur de pression', 'Pressure sensor') : T(/électronique/i.test(n) ? 'Pressostat électronique' : /contact/i.test(n) ? 'Pressostat à contact' : 'Pressostat', 'Pressure switch') }
  }
  if (fl?.k === 'fflow') {
    const a = pid(ports, fl.a), b = pid(ports, fl.b)
    if (!a || !b) return null
    const c: Pt = [(a.x + b.x) / 2, (a.y + b.y) / 2]
    return { svg: line([a.x, a.y], [b.x, b.y]) + circle(c[0], c[1], 10, BG) + text(c[0], c[1] + 3.5, 'Q', 10, 'font-weight="700"'), name: T('Débitmètre', 'Flow meter') }
  }
  if (fl?.k !== 'fgauge' || /régulateur/i.test(n)) return null
  const mark = gaugeMark(n), r = 9
  if (ports.length === 1) {
    const p = ports[0], a = away[p.dir], c: Pt = [p.x + a[0] * (6 + r), p.y + a[1] * (6 + r)]
    return { svg: line([p.x, p.y], [p.x + a[0] * 6, p.y + a[1] * 6]) + circle(c[0], c[1], r, BG) + (mark ? text(c[0], c[1] + 3.2, mark, 9, 'font-weight="700"') : line([c[0] - 4, c[1] + 4], [c[0] + 3, c[1] - 4]) + circle(c[0], c[1], 1.2, 'fill="currentColor"')) }
  }
  if (ports.length >= 2) {
    const c: Pt = [ports.reduce((s, p) => s + p.x, 0) / ports.length, ports.reduce((s, p) => s + p.y, 0) / ports.length]
    if (ports.every((p) => p.dir === 'up' || p.dir === 'down')) c[1] = Math.min(...ports.map((p) => p.y)) + (ports[0].dir === 'down' ? -18 : 18)
    let svg = circle(c[0], c[1], r + 1, BG) + (mark ? text(c[0], c[1] + 3.2, mark, 9, 'font-weight="700"') : '')
    for (const p of ports) svg += toCircle(p, c, r + 1)
    return { svg }
  }
  return null
}

function sources(def: SymbolDef, ports: PortInfo[]): R {
  const fl = def.fluid, n = def.name.fr
  if (fl?.k === 'fsource' && /^Source/i.test(n)) return { svg: oneport(ports[0], 7, circle(0, 0, 7, BG) + path('M-3 0L3 -3.5V3.5Z', 'fill="currentColor"'), 6), name: /énergie/i.test(n) ? T('Source d’énergie pneumatique', 'Pneumatic energy source') : T('Source d’air comprimé', 'Compressed-air supply') }
  if (fl?.k === 'fsource' && /compresseur/i.test(n)) {
    const p = ports[0], a = away[p.dir], c: Pt = [p.x + a[0] * 16, p.y + a[1] * 16]
    let svg = line([p.x, p.y], [p.x + a[0] * 6, p.y + a[1] * 6]) + circle(c[0], c[1], 10, BG) + place(c, inward[p.dir], path('M-9 -2L7 -8M-9 2L7 8', 'fill="none"'))
    if (/moteur/i.test(n)) {
      const m: Pt = [Math.max(12, c[0] - 30), c[1] + 0]
      svg += circle(m[0], m[1], 10, BG) + text(m[0], m[1] + 3.5, 'M', 10, 'font-weight="700"') + line([m[0] + 10, m[1]], [c[0] - 10, c[1]])
    }
    if (/variable/i.test(n)) svg += line([c[0] - 12, c[1] + 12], [c[0] + 12, c[1] - 12]) + arrowHead([c[0] + 12, c[1] - 12], [c[0] - 12, c[1] + 12])
    return { svg, name: /moteur/i.test(n) ? T('Compresseur entraîné par moteur', 'Motor-driven air compressor') : /variable/i.test(n) ? T('Compresseur à vitesse variable', 'Variable-speed air compressor') : T('Compresseur d’air', 'Air compressor') }
  }
  if (fl?.k === 'fsink' && /^Silencieux/i.test(n)) return { svg: oneport(ports[0], 7, path('M-4 -6L6 0L-4 6Z', BG), 5), name: /vide/i.test(n) ? T('Silencieux pour vide', 'Vacuum silencer') : T('Silencieux', 'Silencer') }
  return null
}

function valves(def: SymbolDef, ports: PortInfo[]): R {
  const n = def.name.fr
  if (!/^Vanne/i.test(n) || /régulation/i.test(n) || /rapide/i.test(n)) return null
  const main = ports.filter((p) => p.dir === 'left' || p.dir === 'right').sort((a, b) => a.x - b.x)
  if (main.length < 2) return null
  const a = main[0], b = main[1], cx = (a.x + b.x) / 2, cy = a.y
  const three = ports.find((p) => p.dir === 'down')
  let svg = line([a.x, a.y], [cx - 10, cy]) + line([cx + 10, cy], [b.x, b.y]) + path(`M${f(cx - 10)} ${f(cy - 7)}L${f(cx + 10)} ${f(cy + 7)}V${f(cy - 7)}L${f(cx - 10)} ${f(cy + 7)}Z`, BG)
  if (three) svg += line([cx, cy], [three.x, three.y]) + circle(cx, cy, 1.6, 'fill="currentColor"')
  const top = cy - 7
  if (/électromagn/i.test(n)) svg += line([cx, top], [cx, top - 4]) + rect(cx - 6, top - 14, 12, 10, BG) + line([cx - 6, top - 4], [cx + 6, top - 14])
  else if (/motoris/i.test(n)) svg += line([cx, top], [cx, top - 4]) + circle(cx, top - 10, 6, BG) + text(cx, top - 7.5, 'M', 8, 'font-weight="700"')
  else svg += line([cx, top], [cx, top - 7]) + line([cx - 5, top - 7], [cx + 5, top - 7])
  const how = /électromagn/i.test(n) ? 'à commande électromagnétique' : /motoris/i.test(n) ? 'motorisée' : 'à commande manuelle'
  const kind = /Vanne d.arrêt/i.test(n) ? 'd’arrêt ' : three ? 'trois voies ' : ''
  return { svg, name: T(`Vanne ${kind}${how}`, 'Valve') }
}

/** Clapet anti-retour : passage libre vers +x. Siège en V (pointe en amont), bille dans sa bouche ; le ressort pousse la bille contre le siège. */
const checkGlyph = (spring: boolean): string =>
  path('M1.2 -5.5L-5 0L1.2 5.5', 'fill="none"') + circle(3.6, 0, 3.4, BG) + (spring ? path('M7 0l1.4 -2.6l2.8 5.2l1.4 -2.6', 'fill="none"') : '')

function inlineParts(def: SymbolDef, ports: PortInfo[]): R {
  const fl = def.fluid
  if (fl?.k === 'check') {
    const from = pid(ports, fl.from), to = pid(ports, fl.to)
    if (!from || !to) return null
    const c: Pt = [(from.x + to.x) / 2, from.y]
    const dir = to.x > from.x ? 1 : -1
    const spring = !/sans ressort/i.test(def.name.fr) && /ressort/i.test(def.name.fr)
    // passage libre de `from` vers `to` : le siège (V) est en amont, la bille en aval ; le ressort pousse la bille contre le siège
    let svg = line([from.x, from.y], [c[0] - dir * 10, c[1]]) + line([c[0] + dir * 10, c[1]], [to.x, to.y])
    svg += place(c, dir > 0 ? 0 : 180, checkGlyph(spring))
    const pilot = fl.pilot ? pid(ports, fl.pilot) : undefined
    if (pilot) svg += line([pilot.x, pilot.y], [pilot.x, c[1] - 12], DASH) + line([pilot.x, c[1] - 12], [c[0], c[1] - 12], DASH) + line([c[0], c[1] - 12], [c[0], c[1] - 5], DASH)
    return { svg, name: pilot ? T('Clapet anti-retour piloté', 'Pilot-operated check valve') : spring ? T('Clapet anti-retour à ressort', 'Spring-loaded check valve') : T('Clapet anti-retour', 'Check valve') }
  }
  if (fl?.k === 'fthrottle') {
    const a = pid(ports, fl.a), b = pid(ports, fl.b)
    if (!a || !b) return null
    const c: Pt = [(a.x + b.x) / 2, (a.y + b.y) / 2]
    // passage continu ; deux arcs qui l'étranglent ; flèche de réglage oblique
    let svg = line([a.x, a.y], [b.x, b.y]) + path(`M${f(c[0] - 5)} ${f(c[1] - 8)}Q${f(c[0])} ${f(c[1])} ${f(c[0] - 5)} ${f(c[1] + 8)}M${f(c[0] + 5)} ${f(c[1] - 8)}Q${f(c[0])} ${f(c[1])} ${f(c[0] + 5)} ${f(c[1] + 8)}`, 'fill="none"')
    svg += `<g class="needle" style="transform-box:fill-box;transform-origin:50% 50%;transform:rotate(var(--nd,0deg));transition:transform .35s ease-out">` + line([c[0] - 10, c[1] + 11], [c[0] + 10, c[1] - 11]) + arrowHead([c[0] + 10, c[1] - 11], [c[0] - 10, c[1] + 11]) + '</g>'
    if (fl.comp) {
      // régulateur compensé : le cadre de la balance de pression et son triangle (côté amont) entourent l'étrangleur
      svg += rect(c[0] - 14, c[1] - 14, 28, 28, 'fill="none"') + path(`M${f(c[0] - 6)} ${f(c[1])}L${f(c[0] - 12)} ${f(c[1] - 3)}V${f(c[1] + 3)}Z`, 'fill="currentColor"')
    }
    if (fl.oneWay) {
      // retour libre : clapet dans une dérivation sous le passage, entre deux points de raccordement
      const x0 = c[0] - 19, x1 = c[0] + 19, y = c[1] + 22
      svg += circle(x0, c[1], 1.8, 'fill="currentColor"') + circle(x1, c[1], 1.8, 'fill="currentColor"')
      svg += path(`M${f(x0)} ${f(c[1])}V${f(y)}H${f(c[0] - 6.5)}M${f(c[0] + 5)} ${f(y)}H${f(x1)}V${f(c[1])}`, 'fill="none"')
      svg += place([c[0], y], 180, checkGlyph(false)) // le passage libre va de b vers a
    }
    if (a.x > b.x) svg = `<g transform="translate(${f(a.x + b.x)} 0) scale(-1 1)">${svg}</g>`
    return { svg, name: fl.comp ? T('Régulateur de débit compensé en pression, unidirectionnel', 'Pressure-compensated flow regulator, one-way') : fl.oneWay ? T('Limiteur de débit unidirectionnel', 'One-way flow control valve') : T('Limiteur de débit réglable', 'Adjustable flow restrictor') }
  }
  if (fl?.k === 'logic') {
    const out = pid(ports, fl.out), i1 = pid(ports, fl.ins[0]), i2 = pid(ports, fl.ins[1])
    if (!out || !i1 || !i2) return null
    const c: Pt = [out.x, i1.y]
    let svg = line([i1.x, i1.y], [c[0] - 8, c[1]]) + line([i2.x, i2.y], [c[0] + 8, c[1]]) + line([out.x, out.y], [out.x, c[1] - 7]) + path(`M${f(c[0] - 8)} ${f(c[1])}L${f(c[0] - 4)} ${f(c[1] - 7)}H${f(c[0] + 4)}L${f(c[0] + 8)} ${f(c[1])}L${f(c[0] + 4)} ${f(c[1] + 7)}H${f(c[0] - 4)}Z`, BG)
    svg += fl.op === 'and' ? text(c[0], c[1] + 3, '&', 9, 'font-weight="700"') : circle(c[0], c[1], 2.8, 'fill="currentColor"')
    return { svg, name: fl.op === 'and' ? T('Soupape à deux pressions (ET)', 'Two-pressure valve (AND)') : T('Sélecteur de circuit (OU)', 'Shuttle valve (OR)') }
  }
  return null
}

function misc(def: SymbolDef, ports: PortInfo[]): R {
  const n = def.name.fr
  const lr = ports.filter((p) => p.dir === 'left' || p.dir === 'right').sort((a, b) => a.x - b.x)
  if (/^Diviseur de débit/i.test(n) && lr.length >= 3) {
    const l = lr.find((p) => p.dir === 'left')!, rs = lr.filter((p) => p.dir === 'right')
    const x0 = l.x + 20, x1 = rs[0].x - 20
    let svg = line([l.x, l.y], [x0, l.y]) + rect(x0, Math.min(...rs.map((p) => p.y)) - 6, x1 - x0, Math.abs(rs[0].y - rs[1].y) + 12, BG) + text((x0 + x1) / 2, (rs[0].y + rs[1].y) / 2 + 3, '÷', 10)
    for (const p of rs) svg += line([x1, p.y], [p.x, p.y])
    return { svg, name: T('Diviseur de débit', 'Flow divider') }
  }
  if (/^Raccord rapide/i.test(n) && lr.length >= 2) {
    const a = lr[0], b = lr[lr.length - 1], c = (a.x + b.x) / 2
    return { svg: line([a.x, a.y], [c - 3, a.y]) + line([c + 3, b.y], [b.x, b.y]) + path(`M${f(c - 8)} ${f(a.y - 5)}L${f(c - 3)} ${f(a.y)}L${f(c - 8)} ${f(a.y + 5)}M${f(c + 8)} ${f(a.y - 5)}L${f(c + 3)} ${f(a.y)}L${f(c + 8)} ${f(a.y + 5)}`, 'fill="none"'), name: /clapet/i.test(n) ? T('Raccord rapide avec clapet anti-retour', 'Quick coupling with check valve') : T('Raccord rapide', 'Quick coupling') }
  }
  if (/^(Câble|Connection souple|Broche rotative)/i.test(n) && lr.length >= 2) {
    let svg = ''
    const lefts = lr.filter((p) => p.dir === 'left'), rights = lr.filter((p) => p.dir === 'right')
    for (const l of lefts) {
      const r = rights.find((q) => Math.abs(q.y - l.y) < 1) ?? rights[0]
      const c = (l.x + r.x) / 2
      svg += line([l.x, l.y], [c - 10, l.y]) + line([c + 10, r.y], [r.x, r.y]) + path(`M${f(c - 10)} ${f(l.y)}q2.5 -5 5 0t5 0t5 0t5 0`, 'fill="none"')
    }
    return { svg, name: /Broche/.test(n) ? T(lefts.length > 1 ? `Joint tournant à ${lefts.length} voies` : 'Joint tournant', 'Rotary union') : /Câble/.test(n) ? T(/électrique/i.test(n) ? 'Câble électrique' : 'Câble de connexion', 'Cable link') : T('Liaison souple', 'Flexible hose') }
  }
  if (/^Soupape tarr/i.test(n) && lr.length >= 2) {
    const a = lr[0], b = lr[lr.length - 1], c = (a.x + b.x) / 2
    return { svg: line([a.x, a.y], [c - 7, a.y]) + line([c + 7, b.y], [b.x, b.y]) + rect(c - 7, a.y - 16, 14, 16, BG) + line([c, a.y - 2], [c, a.y - 13]) + arrowHead([c, a.y - 13], [c, a.y - 2]) + path(`M${f(c)} ${f(a.y - 16)}l-3 -2l6 -3l-6 -3l3 -2`, 'fill="none"'), name: T('Soupape de limitation de pression', 'Pressure relief valve') }
  }
  if (/régulateur de pression|consigne analogique|régulation indépendante/i.test(n)) {
    const g = G.regulator()[1]
    if (ports.length >= 2) {
      const name = /indépendante/i.test(n) ? T('Régulateur de débit compensé en pression', 'Pressure-compensated flow control') : T('Régulateur de pression à consigne analogique', 'Pressure regulator, analogue setpoint')
      return { svg: twoport(ports[0], ports[1], 10, g), name }
    }
    return { svg: oneport(ports[0], 10, g), name: T('Régulateur de pression manuel', 'Manual pressure regulator') }
  }
  if (/^[ÉE]changeur/i.test(n) && lr.length >= 2) {
    const a = lr[0], b = lr[lr.length - 1], cx = (a.x + b.x) / 2
    return { svg: line([a.x, a.y], [cx - 22, a.y]) + line([cx + 22, b.y], [b.x, b.y]) + diamond(cx, a.y, 22) + path(`M${f(cx - 14)} ${f(a.y - 8)}L${f(cx + 14)} ${f(a.y - 8)}M${f(cx - 14)} ${f(a.y + 8)}L${f(cx + 14)} ${f(a.y + 8)}`, 'fill="none"'), name: T('Échangeur de chaleur eau-huile', 'Water-oil heat exchanger') }
  }
  if (/vérin hydraulique télescopique|Verin hydraulique telescopique/i.test(n)) {
    let svg = rect(4, 4, def.w - 40, 18, BG) + rect(def.w - 40, 8, 24, 10, BG) + line([def.w - 16, 13], [def.w, 13])
    for (const p of ports) svg += line([p.x, p.y], [p.x, 22])
    return { svg, name: T('Vérin hydraulique télescopique', 'Telescopic hydraulic cylinder') }
  }
  return null
}

/** Limiteur et réducteur de pression : case carrée, ressort réglable, pilotage par la pression (trait pointillé). */
function pressureValves(def: SymbolDef, ports: PortInfo[]): R {
  const fl = def.fluid
  if (fl?.k !== 'relief' && fl?.k !== 'reducer') return null
  const p = pid(ports, fl.p), t = pid(ports, fl.k === 'relief' ? fl.t : fl.a)
  if (!p || !t) return null
  const y = p.y, S = 24, x0 = def.w / 2 - S / 2, y0 = y - S / 2
  // carré traversé par les orifices à mi-hauteur ; ressort réglable au-dessus
  let svg = line([p.x, y], [x0, y]) + line([x0 + S, t.y], [t.x, t.y]) + rect(x0, y0, S, S, BG)
  const sx = x0 + S * 0.6
  svg += path(`M${f(sx)} ${f(y0)}l-3.2 -2l6.4 -3l-6.4 -3l6.4 -3l-6.4 -3l3.2 -2`, 'fill="none"')
  svg += line([x0 + 3, y0 - 4], [x0 + S + 2, y0 - 14]) + arrowHead([x0 + S + 2, y0 - 14], [x0 + 3, y0 - 4])
  if (fl.k === 'relief') {
    // fermé au repos : la flèche est décalée vers le bas, hors de l'axe des orifices ; le pilotage vient de l'amont
    svg += line([x0 + 3, y0 + S - 3.5], [x0 + S - 3, y0 + S - 3.5]) + arrowHead([x0 + S - 3, y0 + S - 3.5], [x0 + 3, y0 + S - 3.5])
    svg += path(`M${f(x0 - 6)} ${f(y)}V${f(y0 + S + 6)}H${f(x0 + S * 0.52)}V${f(y0 + S)}`, `fill="none" ${DASH}`) + line([x0 - 6, y], [x0, y])
  } else {
    // ouvert au repos : la flèche est dans l'axe des orifices ; le pilotage vient de l'aval
    svg += line([x0 + 3, y], [x0 + S - 3, y]) + arrowHead([x0 + S - 3, y], [x0 + 3, y])
    svg += path(`M${f(x0 + S + 6)} ${f(y)}V${f(y0 + S + 6)}H${f(x0 + S * 0.48)}V${f(y0 + S)}`, `fill="none" ${DASH}`)
  }
  return { svg }
}

/** Groupe motopompe : moteur électrique, accouplement et pompe hydraulique (cylindrée fixe ou variable régulée en pression). */
function pumpGroup(def: SymbolDef, ports: PortInfo[]): R {
  const fl = def.fluid
  if (fl?.k !== 'fpump' || !/^Groupe motopompe/i.test(def.name.fr)) return null
  const out = pid(ports, fl.out), inn = pid(ports, fl.in)
  if (!out || !inn) return null
  const cy = (out.y + inn.y) / 2, px = out.x, mx = px - 38
  let svg = circle(mx, cy, 14, BG) + text(mx, cy + 5, 'M', 14, 'font-weight="700"') + rect(mx - 15, cy + 15, 30, 3, 'fill="currentColor"')
  svg += line([mx + 14, cy], [px - 14, cy]) + rect(mx + 17, cy - 4, 6, 8, BG)
  svg += circle(px, cy, 14, BG) + toCircle(out, [px, cy], 14) + toCircle(inn, [px, cy], 14) + energy([px, cy], 14, [out.x, out.y], true)
  if (fl.variable) svg += line([px - 18, cy + 18], [px + 18, cy - 18]) + arrowHead([px + 18, cy - 18], [px - 18, cy + 18])
  // signal Load Sensing : trait pointillé vers le régulateur de la pompe
  const ls = fl.ls ? pid(ports, fl.ls) : undefined
  if (ls) svg += path(`M${f(ls.x)} ${f(ls.y)}H${f(px + 22)}V${f(cy - 20)}`, `fill="none" ${DASH}`) + text(ls.x - 6, ls.y - 4, 'LS', 7)
  return { svg }
}

const RECIPES: ((def: SymbolDef, ports: PortInfo[]) => R)[] = [
  maintenanceUnit,
  pressureValves,
  pumpGroup,
  pumpOrMotor,
  cell,
  closedPlug,
  tanks,
  gaugesAndSwitches,
  sources,
  valves,
  inlineParts,
  misc,
  airTreatment,
]

export function ownFluid(def: SymbolDef): R {
  const ports = def.ports as PortInfo[]
  for (const r of RECIPES) {
    const o = r(def, ports)
    if (o) return o
  }
  return null
}

/** Appareils rares, non simulés : boîtier repéré par un sigle (le nom complet reste dans l'infobulle). */
const BOXED: [RegExp, string, string, string][] = [
  [/^Distributeur 3-2/i, '3/2', 'Distributeur 3/2 (non simulé)', '3/2 valve (not simulated)'],
  [/Servovalve 4-2/i, 'SV 4/2', 'Servovalve 4/2 (non simulée)', '4/2 servo valve (not simulated)'],
  [/Servovalve 4-3/i, 'SV 4/3', 'Servovalve 4/3 (non simulée)', '4/3 servo valve (not simulated)'],
  [/ouverture rapide/i, 'VOR', 'Vanne à ouverture rapide', 'Quick-opening valve'],
  [/Reniflard/i, 'REN', 'Reniflard', 'Breather'],
  [/Ventilation continue/i, 'VENT', 'Ventilation continue', 'Continuous ventilation'],
  [/Répartiteurs/i, 'RÉP', 'Répartiteur', 'Manifold'],
]

const ownFluidBase = ownFluid
export function ownFluidAll(def: SymbolDef): R {
  const o = ownFluidBase(def)
  if (o) return o
  const ports = def.ports as PortInfo[]
  for (const [re, t, fr, en] of BOXED) if (re.test(def.name.fr)) return { svg: box(def.w, def.h, ports, { title: t }), name: T(fr, en) }
  return null
}
