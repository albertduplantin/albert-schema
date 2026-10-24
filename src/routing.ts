import type { PlacedSymbol, PortRef, Wire } from './types'
import { clean, portPos, routeVia } from './geometry'

/**
 * Routage de l'ensemble des conducteurs : séparation en « couloirs ».
 *
 * Chaque fil est d'abord tracé seul (`routeVia`). Quand plusieurs fils différents empruntent le même couloir au même
 * endroit (typiquement les trois phases d'un contacteur déplacé de côté), leurs segments intermédiaires se superposent
 * et on ne peut plus les distinguer. On les écarte alors sur des couloirs distincts, espacés de 10 unités (ou 5 si la
 * place manque). L'ordre des couloirs est d'abord choisi groupe par groupe, puis amélioré par échanges tant que le
 * nombre total de croisements diminue.
 *
 * Règles :
 *  - un fil tracé à la main (coudes imposés) n'est jamais déplacé ;
 *  - les deux amorces qui sortent des bornes restent en place (seule leur longueur varie) ;
 *  - deux fils qui partent de la même borne peuvent se superposer : c'est un même point électrique (dérivation) ;
 *  - le calcul est déterministe : le résultat ne dépend que de la position des symboles et des fils.
 */

type P = { x: number; y: number }

export interface RouteInfo {
  /** tracé automatique (sans coudes imposés) : seul celui-ci peut être déplacé */
  auto: boolean
  /** bornes de départ et d'arrivée (`symbole:borne`) */
  ports: [string, string]
}

const GAP = 10 // écart entre deux couloirs
const HALF = 5 // écart réduit quand la place manque
const MIN_SEG = 10 // longueur minimale d'un segment adjacent après déplacement
const TOL = 1
const MAX_SWAP_PASSES = 6

const portKey = (r: PortRef) => `${r.symId}:${r.portId}`
const sign = (v: number) => (v > 0 ? 1 : v < 0 ? -1 : 0)

/** Un segment intermédiaire déplaçable : horizontal (`h`) ou vertical. */
interface Mobile {
  wire: string
  k: number
  h: boolean
  c: number // coordonnée perpendiculaire au segment (y si horizontal, x si vertical), au moment du calcul des groupes
  lo: number // étendue du segment le long de son axe
  hi: number
  min: number // bornes de déplacement autorisées pour c
  max: number
  a1: number // position des deux amorces perpendiculaires sur l'axe du segment
  a2: number
  from: number // coordonnée perpendiculaire du point précédent / suivant
  to: number
}

function mobilesOf(wire: string, pts: P[]): Mobile[] {
  const out: Mobile[] = []
  for (let k = 1; k <= pts.length - 3; k++) {
    const p = pts[k]
    const q = pts[k + 1]
    const h = p.y === q.y
    if (!h && p.x !== q.x) continue
    const ax = h ? 'y' : 'x' // axe perpendiculaire
    const bx = h ? 'x' : 'y' // axe du segment
    const prev = pts[k - 1][ax]
    const next = pts[k + 2][ax]
    const cur = p[ax]
    const t1 = sign(cur - prev)
    const t2 = sign(next - cur)
    let min = -Infinity
    let max = Infinity
    if (t1 > 0) min = Math.max(min, prev + MIN_SEG)
    else if (t1 < 0) max = Math.min(max, prev - MIN_SEG)
    if (t2 > 0) max = Math.min(max, next - MIN_SEG)
    else if (t2 < 0) min = Math.max(min, next + MIN_SEG)
    out.push({ wire, k, h, c: cur, lo: Math.min(p[bx], q[bx]), hi: Math.max(p[bx], q[bx]), min, max, a1: p[bx], a2: q[bx], from: prev, to: next })
  }
  return out
}

interface Seg {
  h: boolean
  c: number
  lo: number
  hi: number
}

/** Tous les segments d'un tracé. */
function allSegs(pts: P[]): Seg[] {
  const out: Seg[] = []
  for (let i = 0; i + 1 < pts.length; i++) {
    const p = pts[i]
    const q = pts[i + 1]
    if (p.y === q.y && p.x !== q.x) out.push({ h: true, c: p.y, lo: Math.min(p.x, q.x), hi: Math.max(p.x, q.x) })
    else if (p.x === q.x && p.y !== q.y) out.push({ h: false, c: p.x, lo: Math.min(p.y, q.y), hi: Math.max(p.y, q.y) })
  }
  return out
}

const overlapLen = (a: { lo: number; hi: number }, b: { lo: number; hi: number }) => Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo)

const shareNode = (a: RouteInfo, b: RouteInfo) => a.ports.some((p) => b.ports.includes(p))

/**
 * Deux tracés peuvent-ils interférer ? Leurs rectangles englobants, élargis de `NEAR` (plus que le plus grand décalage de couloir),
 * se touchent. Évite de comparer segment par segment des fils éloignés : le coût devient proche du linéaire sur un grand schéma.
 */
const NEAR = 120
function near(a: P[], b: P[]): boolean {
  let ax1 = Infinity, ay1 = Infinity, ax2 = -Infinity, ay2 = -Infinity
  for (const p of a) { if (p.x < ax1) ax1 = p.x; if (p.x > ax2) ax2 = p.x; if (p.y < ay1) ay1 = p.y; if (p.y > ay2) ay2 = p.y }
  for (const p of b) if (p.x >= ax1 - NEAR && p.x <= ax2 + NEAR && p.y >= ay1 - NEAR && p.y <= ay2 + NEAR) return true
  // aucun sommet de b dans le cadre de a : b peut tout de même enjamber a
  let bx1 = Infinity, by1 = Infinity, bx2 = -Infinity, by2 = -Infinity
  for (const p of b) { if (p.x < bx1) bx1 = p.x; if (p.x > bx2) bx2 = p.x; if (p.y < by1) by1 = p.y; if (p.y > by2) by2 = p.y }
  return bx1 <= ax2 + NEAR && bx2 >= ax1 - NEAR && by1 <= ay2 + NEAR && by2 >= ay1 - NEAR
}

/** Croisements propres entre deux tracés (un segment vertical traverse un segment horizontal). */
function crossPair(a: P[], b: P[]): number {
  const sa = allSegs(a)
  const sb = allSegs(b)
  let n = 0
  for (const s of sa) {
    for (const u of sb) {
      if (s.h === u.h) continue
      const [h, v] = s.h ? [s, u] : [u, s]
      if (v.c > h.lo && v.c < h.hi && h.c > v.lo && h.c < v.hi) n++
    }
  }
  return n
}

/** Croisements entre les fils `ids` et tous les autres, hors fils qui partagent une borne. */
function crossCost(ids: string[], routes: Record<string, P[]>, info: Record<string, RouteInfo>, all: string[]): number {
  let n = 0
  const set = new Set(ids)
  for (const i of ids) {
    for (const j of all) {
      if (j === i || (set.has(j) && j < i) || !near(routes[i], routes[j]) || shareNode(info[i], info[j])) continue
      n += crossPair(routes[i], routes[j])
    }
  }
  return n
}

/** Croisements entre les amorces perpendiculaires de `i` et le segment de `j` (et réciproquement), pour l'ordre initial d'un groupe. */
function groupCrossings(i: Mobile, ci: number, j: Mobile, cj: number): number {
  const cut = (m: Mobile, cm: number, o: Mobile, co: number) => {
    let n = 0
    for (const [pos, y0, y1] of [[m.a1, m.from, cm], [m.a2, cm, m.to]] as const) {
      if (pos > o.lo && pos < o.hi && co > Math.min(y0, y1) && co < Math.max(y0, y1)) n++
    }
    return n
  }
  return cut(i, ci, j, cj) + cut(j, cj, i, ci)
}

function permutations<T>(a: T[]): T[][] {
  if (a.length <= 1) return [a]
  const out: T[][] = []
  a.forEach((x, i) => {
    for (const rest of permutations([...a.slice(0, i), ...a.slice(i + 1)])) out.push([x, ...rest])
  })
  return out
}

/** Place le segment `m` à la coordonnée `c` (sans nettoyage : les indices des autres segments restent valides). */
function setTrack(routes: Record<string, P[]>, m: Mobile, c: number) {
  const pts = routes[m.wire]
  const axis = m.h ? 'y' : 'x'
  pts[m.k] = { ...pts[m.k], [axis]: c }
  pts[m.k + 1] = { ...pts[m.k + 1], [axis]: c }
}

/**
 * Sépare les segments qui se superposent. `routes` est modifié sur place ; seuls les tracés automatiques bougent.
 * Exporté pour les tests.
 */
export function separateRoutes(routes: Record<string, P[]>, info: Record<string, RouteInfo>): void {
  const ids = Object.keys(routes).sort()
  const mobiles: Mobile[] = []
  for (const id of ids) if (info[id]?.auto) mobiles.push(...mobilesOf(id, routes[id]))
  if (!mobiles.length) return

  // ── 1. groupes de segments déplaçables qui se superposent
  const parent = mobiles.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  for (let i = 0; i < mobiles.length; i++) {
    for (let j = i + 1; j < mobiles.length; j++) {
      const a = mobiles[i]
      const b = mobiles[j]
      if (a.h !== b.h || a.wire === b.wire || Math.abs(a.c - b.c) >= TOL || overlapLen(a, b) <= TOL) continue
      if (shareNode(info[a.wire], info[b.wire])) continue
      parent[find(i)] = find(j)
    }
  }
  const groupMap = new Map<number, Mobile[]>()
  mobiles.forEach((m, i) => {
    const r = find(i)
    if (!groupMap.has(r)) groupMap.set(r, [])
    groupMap.get(r)!.push(m)
  })

  // couloirs de chaque groupe, puis ordre initial (le moins de croisements au sein du groupe)
  interface Placed { members: Mobile[]; tracks: number[]; cur: number[] }
  const placed: Placed[] = []
  for (const members of groupMap.values()) {
    const n = members.length
    if (n < 2) continue
    const lo = Math.max(...members.map((m) => m.min))
    const hi = Math.min(...members.map((m) => m.max))
    const c0 = members[0].c
    for (const sp of [GAP, HALF]) {
      const span = (n - 1) * sp
      if (hi - lo < span) continue
      let start = c0 - Math.floor((n - 1) / 2) * sp
      if (start < lo) start += Math.ceil((lo - start) / sp) * sp
      if (start + span > hi) start -= Math.ceil((start + span - hi) / sp) * sp
      if (start < lo || start + span > hi) continue
      const tracks = Array.from({ length: n }, (_, i) => start + i * sp)
      const orders = n <= 6 ? permutations(members.map((_, i) => i)) : [members.map((_, i) => i)]
      let best: number[] = orders[0]
      let bestScore = Infinity
      for (const order of orders) {
        let score = 0
        for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) score += groupCrossings(members[order[a]], tracks[a], members[order[b]], tracks[b])
        if (score < bestScore) {
          bestScore = score
          best = order
        }
      }
      const cur = new Array<number>(n)
      best.forEach((mi, slot) => (cur[mi] = tracks[slot]))
      placed.push({ members, tracks, cur })
      break
    }
  }
  for (const g of placed) g.members.forEach((m, i) => setTrack(routes, m, g.cur[i]))

  // paires voisines sans superposition (par ex. deux montées côte à côte) : elles peuvent s'échanger, ce qui compte pour l'ordre des autres segments du faisceau
  const covered = new Set<Mobile>(placed.flatMap((g) => g.members))
  for (let i = 0; i < mobiles.length; i++) {
    const a = mobiles[i]
    if (covered.has(a)) continue
    for (let j = i + 1; j < mobiles.length; j++) {
      const b = mobiles[j]
      if (covered.has(b) || a.h !== b.h || a.wire === b.wire || a.c === b.c || Math.abs(a.c - b.c) > 2 * GAP || overlapLen(a, b) <= TOL) continue
      if (shareNode(info[a.wire], info[b.wire])) continue
      if (b.c < a.min || b.c > a.max || a.c < b.min || a.c > b.max) continue
      covered.add(a)
      covered.add(b)
      placed.push({ members: [a, b], tracks: [Math.min(a.c, b.c), Math.max(a.c, b.c)], cur: [a.c, b.c] })
      break
    }
  }

  // ── 1b. familles de groupes reliés par des fils communs (les trois segments d'un même faisceau en Z) : on teste l'inversion
  // de l'ordre de chacun des groupes (2^n combinaisons, n ≤ 4), car la meilleure disposition les renverse souvent ensemble
  const fam = placed.map((_, i) => i)
  const famFind = (i: number): number => (fam[i] === i ? i : (fam[i] = famFind(fam[i])))
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      if (placed[i].members.some((m) => placed[j].members.some((o) => o.wire === m.wire))) fam[famFind(i)] = famFind(j)
    }
  }
  const families = new Map<number, number[]>()
  placed.forEach((_, i) => {
    const r = famFind(i)
    if (!families.has(r)) families.set(r, [])
    families.get(r)!.push(i)
  })
  for (const idxs of families.values()) {
    if (idxs.length < 2 || idxs.length > 4) continue
    const wiresIn = [...new Set(idxs.flatMap((gi) => placed[gi].members.map((m) => m.wire)))]
    const tracksFor = (gi: number, flip: boolean) => {
      const g = placed[gi]
      return g.members.map((_, i) => (flip ? g.tracks[g.tracks.length - 1 - g.tracks.indexOf(g.cur[i])] : g.cur[i]))
    }
    const apply = (mask: number) => idxs.forEach((gi, b) => tracksFor(gi, ((mask >> b) & 1) === 1).forEach((t, i) => setTrack(routes, placed[gi].members[i], t)))
    let bestMask = 0
    apply(0)
    let bestCost = crossCost(wiresIn, routes, info, ids)
    for (let mask = 1; mask < 1 << idxs.length; mask++) {
      apply(mask)
      const cost = crossCost(wiresIn, routes, info, ids)
      if (cost < bestCost) {
        bestCost = cost
        bestMask = mask
      }
    }
    apply(bestMask)
    idxs.forEach((gi, b) => {
      placed[gi].cur = tracksFor(gi, ((bestMask >> b) & 1) === 1)
    })
  }

  // ── 2. amélioration par échanges de couloirs : on garde un échange s'il réduit le nombre total de croisements
  for (let pass = 0; pass < MAX_SWAP_PASSES; pass++) {
    let improved = false
    for (const g of placed) {
      for (let i = 0; i < g.members.length; i++) {
        for (let j = i + 1; j < g.members.length; j++) {
          const wi = g.members[i].wire
          const wj = g.members[j].wire
          const touched = [wi, wj]
          const before = crossCost(touched, routes, info, ids)
          setTrack(routes, g.members[i], g.cur[j])
          setTrack(routes, g.members[j], g.cur[i])
          const after = crossCost(touched, routes, info, ids)
          if (after < before) {
            ;[g.cur[i], g.cur[j]] = [g.cur[j], g.cur[i]]
            improved = true
          } else {
            setTrack(routes, g.members[i], g.cur[i])
            setTrack(routes, g.members[j], g.cur[j])
          }
        }
      }
    }
    if (!improved) break
  }
  for (const id of ids) routes[id] = clean(routes[id])

  // ── 3. conflits restants (contre des amorces, des fils tracés à la main, ou faute de place) : décalage au plus près
  for (const id of ids) {
    if (!info[id]?.auto) continue
    for (const m of mobilesOf(id, routes[id])) {
      const conflicts = (c: number) => {
        const me = { h: m.h, c, lo: m.lo, hi: m.hi }
        for (const other of ids) {
          if (other === id || !near(routes[id], routes[other]) || shareNode(info[id], info[other])) continue
          for (const s of allSegs(routes[other])) {
            if (s.h === me.h && Math.abs(s.c - me.c) < TOL && overlapLen(s, me) > TOL) return true
          }
        }
        return false
      }
      if (!conflicts(m.c)) continue
      for (let step = 1; step <= 6; step++) {
        const pick = [m.c + step * GAP, m.c - step * GAP].find((c) => c >= m.min && c <= m.max && !conflicts(c))
        if (pick !== undefined) {
          setTrack(routes, m, pick)
          routes[id] = clean(routes[id])
          break
        }
      }
    }
  }
}

/** Tracé de tous les conducteurs, séparés en couloirs quand ils se superposeraient. Clé : identifiant du fil. */
export function routeAll(wires: Wire[], symbols: PlacedSymbol[]): Record<string, P[]> {
  const symById = new Map(symbols.map((s) => [s.id, s]))
  const routes: Record<string, P[]> = {}
  const info: Record<string, RouteInfo> = {}
  for (const w of wires) {
    const a = symById.get(w.from.symId)
    const b = symById.get(w.to.symId)
    const pa = a && portPos(a, w.from.portId)
    const pb = b && portPos(b, w.to.portId)
    if (!pa || !pb) continue
    routes[w.id] = routeVia(pa, pb, w.via ?? [])
    info[w.id] = { auto: !w.via?.length, ports: [portKey(w.from), portKey(w.to)] }
  }
  separateRoutes(routes, info)
  return routes
}

/**
 * Points de jonction : là où des fils qui partent de la même borne se séparent, on dessine un point (comme sur un schéma classique).
 * Les fils sont comparés deux à deux depuis la borne commune ; ils se séparent au dernier sommet commun, ou plus loin si l'un
 * des deux tourne sur un tronçon que l'autre poursuit tout droit.
 */
export function junctionPoints(routes: Record<string, P[]>, wires: Wire[]): P[] {
  const byPort = new Map<string, P[][]>()
  const add = (key: string, pts: P[]) => {
    if (!byPort.has(key)) byPort.set(key, [])
    byPort.get(key)!.push(pts)
  }
  for (const w of wires) {
    const r = routes[w.id]
    if (!r || r.length < 2) continue
    add(portKey(w.from), r)
    add(portKey(w.to), [...r].reverse())
  }
  const out: P[] = []
  const seen = new Set<string>()
  const push = (p: P) => {
    const k = p.x + ',' + p.y
    if (!seen.has(k)) {
      seen.add(k)
      out.push(p)
    }
  }
  const dir = (a: P, b: P) => ({ x: Math.sign(b.x - a.x), y: Math.sign(b.y - a.y) })
  for (const group of byPort.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i]
        const b = group[j]
        let k = 0
        while (k + 1 < a.length && k + 1 < b.length && a[k + 1].x === b[k + 1].x && a[k + 1].y === b[k + 1].y) k++
        const v = a[k]
        const na = a[k + 1]
        const nb = b[k + 1]
        if (!na || !nb) continue
        const da = dir(v, na)
        const db = dir(v, nb)
        if (da.x === db.x && da.y === db.y) {
          // même direction : le point de séparation est l'extrémité du plus court des deux tronçons
          const la = Math.abs(na.x - v.x) + Math.abs(na.y - v.y)
          const lb = Math.abs(nb.x - v.x) + Math.abs(nb.y - v.y)
          push(la <= lb ? na : nb)
        } else push(v)
      }
    }
  }
  return out
}
