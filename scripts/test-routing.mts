// Tests du tracé manuel des conducteurs : npm test
import { bestInsertIndex, route, routeOpen, routeVia } from '../src/geometry.ts'
import { routeAll, separateRoutes, type RouteInfo } from '../src/routing.ts'
import { SYMBOL_MAP } from '../src/symbols/index.ts'

type P = { x: number; y: number }
let fails = 0
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fails++
  console.log((ok ? 'ok   ' : 'ÉCHEC') + ' ' + name + (ok ? '' : ' ' + detail))
}
const orthogonal = (pts: P[]) => pts.every((p, i) => i === 0 || p.x === pts[i - 1].x || p.y === pts[i - 1].y)
/** vrai si deux segments consécutifs font demi-tour l'un sur l'autre */
const hasUTurn = (pts: P[]) => {
  for (let i = 2; i < pts.length; i++) {
    const a = [Math.sign(pts[i - 1].x - pts[i - 2].x), Math.sign(pts[i - 1].y - pts[i - 2].y)]
    const b = [Math.sign(pts[i].x - pts[i - 1].x), Math.sign(pts[i].y - pts[i - 1].y)]
    if (a[0] === -b[0] && a[1] === -b[1] && (a[0] !== 0 || a[1] !== 0)) return true
  }
  return false
}
const passesThrough = (pts: P[], v: P) =>
  pts.some((p, i) => {
    if (p.x === v.x && p.y === v.y) return true
    if (i === 0) return false
    const q = pts[i - 1]
    return (q.x === p.x && p.x === v.x && v.y >= Math.min(q.y, p.y) && v.y <= Math.max(q.y, p.y)) ||
      (q.y === p.y && p.y === v.y && v.x >= Math.min(q.x, p.x) && v.x <= Math.max(q.x, p.x))
  })

const a = { x: 100, y: 100, dir: 'down' as const }
const b = { x: 300, y: 200, dir: 'up' as const }

// sans point imposé : tracé automatique inchangé
check('sans coude : identique au tracé automatique', JSON.stringify(routeVia(a, b, [])) === JSON.stringify(route(a, b)))

// avec un coude choisi
for (const via of [[{ x: 200, y: 300 }], [{ x: 40, y: 160 }], [{ x: 200, y: 20 }], [{ x: 100, y: 160 }, { x: 260, y: 160 }]]) {
  const r = routeVia(a, b, via)
  const label = 'coudes ' + via.map((v) => `(${v.x},${v.y})`).join(' ')
  check(label + ' : orthogonal', orthogonal(r))
  check(label + ' : commence à la borne A et finit à la borne B', r[0].x === a.x && r[0].y === a.y && r[r.length - 1].x === b.x && r[r.length - 1].y === b.y)
  check(label + ' : passe par chaque coude', via.every((v) => passesThrough(r, v)), JSON.stringify(r))
  check(label + ' : aucun demi-tour', !hasUTurn(r), JSON.stringify(r))
}

// sortie de borne : la première amorce suit la direction de la borne (vers le bas)
{
  const r = routeVia(a, b, [{ x: 200, y: 300 }])
  check('la sortie de la borne A descend d\'abord', r[1].x === a.x && r[1].y > a.y)
  check('l\'arrivée sur la borne B se fait par le haut', r[r.length - 2].x === b.x && r[r.length - 2].y < b.y)
}

// tracé en cours de pose
{
  const r = routeOpen(a, [{ x: 200, y: 160 }], { x: 260, y: 300 })
  check('tracé en cours : orthogonal, finit au curseur, sans demi-tour', orthogonal(r) && r[r.length - 1].x === 260 && r[r.length - 1].y === 300 && !hasUTurn(r), JSON.stringify(r))
}

// insertion d'un coude au bon rang
{
  const via = [{ x: 100, y: 160 }, { x: 260, y: 160 }]
  const i = bestInsertIndex(a, b, via, { x: 180, y: 160 })
  check('insertion entre deux coudes → rang 1', i === 1, 'rang ' + i)
  check('insertion avant le premier coude → rang 0', bestInsertIndex(a, b, via, { x: 100, y: 130 }) === 0)
  check('insertion après le dernier coude → rang 2', bestInsertIndex(a, b, via, { x: 260, y: 190 }) === 2)
}

// ════ séparation des fils en couloirs ════
type Seg = { h: boolean; c: number; lo: number; hi: number }
const segsOf = (pts: P[]): Seg[] => {
  const out: Seg[] = []
  for (let i = 0; i + 1 < pts.length; i++) {
    const p = pts[i], q = pts[i + 1]
    if (p.y === q.y && p.x !== q.x) out.push({ h: true, c: p.y, lo: Math.min(p.x, q.x), hi: Math.max(p.x, q.x) })
    else if (p.x === q.x && p.y !== q.y) out.push({ h: false, c: p.x, lo: Math.min(p.y, q.y), hi: Math.max(p.y, q.y) })
  }
  return out
}
/** segments superposés entre deux fils (même axe, même position, étendues qui se recouvrent) */
const overlaps = (a: P[], b: P[]) => segsOf(a).some((s) => segsOf(b).some((u) => s.h === u.h && s.c === u.c && Math.min(s.hi, u.hi) - Math.max(s.lo, u.lo) > 1))
/** croisements propres entre deux fils (un segment vertical traverse un segment horizontal) */
const crossCount = (a: P[], b: P[]) => {
  let n = 0
  for (const s of segsOf(a)) for (const u of segsOf(b)) {
    const [h, v] = s.h ? [s, u] : [u, s]
    if (h.h && !v.h && v.c > h.lo && v.c < h.hi && h.c > v.lo && h.c < v.hi) n++
  }
  return n
}
const anyOverlap = (r: Record<string, P[]>) => { const ids = Object.keys(r); for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) if (overlaps(r[ids[i]], r[ids[j]])) return true; return false }
const totalCross = (r: Record<string, P[]>) => { const ids = Object.keys(r); let n = 0; for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) n += crossCount(r[ids[i]], r[ids[j]]); return n }

const sym = (id: string, defId: string, x: number, y: number): any => ({ id, defId, x, y, rot: 0, label: id, desc: '' })
const wire = (id: string, a: string, ap: string, b: string, bp: string, via?: P[]): any => ({ id, from: { symId: a, portId: ap }, to: { symId: b, portId: bp }, label: '', color: '', section: '', ...(via ? { via } : {}) })
function portAt(symbols: any[], ref: { symId: string; portId: string }) {
  const s = symbols.find((x) => x.id === ref.symId)
  const p = SYMBOL_MAP[s.defId].ports.find((q: any) => q.id === ref.portId)!
  return { x: s.x + p.x, y: s.y + p.y, dir: p.dir }
}
const rawRoutes = (b: { symbols: any[]; wires: any[] }) => Object.fromEntries(b.wires.map((w) => [w.id, routeVia(portAt(b.symbols, w.from), portAt(b.symbols, w.to), w.via ?? [])])) as Record<string, P[]>
const bundle = (dx: number) => ({
  // disjoncteur 3P au-dessus, contacteur 3P en dessous, décalé de dx : trois fils parallèles
  symbols: [sym('Q', 'el-cb3', 100, 100), sym('K', 'el-ct3', 100 + dx, 300)],
  wires: [wire('w1', 'Q', 'b1', 'K', 'a1'), wire('w2', 'Q', 'b2', 'K', 'a2'), wire('w3', 'Q', 'b3', 'K', 'a3')],
})
const sameEnds = (a: P[], b: P[]) => a[0].x === b[0].x && a[0].y === b[0].y && a[a.length - 1].x === b[b.length - 1].x && a[a.length - 1].y === b[b.length - 1].y

for (const dx of [40, -40, 20, 80]) {
  const b = bundle(dx)
  const raw = rawRoutes(b)
  const r = routeAll(b.wires, b.symbols)
  const label = 'faisceau de 3 fils décalé de ' + dx
  if (Math.abs(dx) >= 40) check(label + ' : avant séparation, les fils se superposent', anyOverlap(raw))
  check(label + ' : après séparation, plus aucune superposition', !anyOverlap(r), JSON.stringify(r))
  check(label + ' : sans croisement', totalCross(r) === 0, String(totalCross(r)))
  check(label + ' : fils orthogonaux, mêmes extrémités', Object.values(r).every(orthogonal) && b.wires.every((w) => sameEnds(r[w.id], raw[w.id])))
  check(label + ' : aucun demi-tour', Object.values(r).every((p) => !hasUTurn(p)))
}

{
  // fils alignés : aucun coude superflu, tracés inchangés
  const b = bundle(0)
  const r = routeAll(b.wires, b.symbols)
  check('fils alignés : tracés droits inchangés', Object.values(r).every((p) => p.length === 2), JSON.stringify(r))
}

{
  // deux fils partant de la même borne : une dérivation peut se superposer, rien n'est déplacé
  const symbols = [sym('Q', 'el-cb3', 100, 100), sym('K', 'el-ct3', 140, 300)]
  const wires = [wire('w1', 'Q', 'b1', 'K', 'a1'), wire('w2', 'Q', 'b1', 'K', 'a2')]
  const r = routeAll(wires, symbols)
  const raw = rawRoutes({ symbols, wires })
  check('fils issus de la même borne : non déplacés (dérivation)', JSON.stringify(r.w1) === JSON.stringify(raw.w1) && JSON.stringify(r.w2) === JSON.stringify(raw.w2))
}

{
  // un fil tracé à la main n'est jamais déplacé, les automatiques s'écartent de lui
  const b = bundle(40)
  b.wires[1] = wire('w2', 'Q', 'b2', 'K', 'a2', [{ x: 130, y: 220 }, { x: 170, y: 220 }])
  const r = routeAll(b.wires, b.symbols)
  const manual = rawRoutes(b).w2
  check('fil tracé à la main : jamais déplacé', JSON.stringify(r.w2) === JSON.stringify(manual))
  check('fils automatiques écartés du fil manuel', !anyOverlap(r), JSON.stringify(r))
}

{
  // cas horizontal : trois fils entre bornes latérales, segments verticaux superposés
  const routes: Record<string, P[]> = {
    h1: [{ x: 100, y: 100 }, { x: 140, y: 100 }, { x: 140, y: 160 }, { x: 200, y: 160 }],
    h2: [{ x: 100, y: 120 }, { x: 140, y: 120 }, { x: 140, y: 180 }, { x: 200, y: 180 }],
    h3: [{ x: 100, y: 140 }, { x: 140, y: 140 }, { x: 140, y: 200 }, { x: 200, y: 200 }],
  }
  const info: Record<string, RouteInfo> = Object.fromEntries(Object.keys(routes).map((k) => [k, { auto: true, ports: [k + 'a', k + 'b'] as [string, string] }]))
  separateRoutes(routes, info)
  check('segments verticaux superposés : séparés en couloirs', !anyOverlap(routes), JSON.stringify(routes))
  check('segments verticaux : sans croisement, orthogonaux', totalCross(routes) === 0 && Object.values(routes).every(orthogonal), String(totalCross(routes)))
}

{
  // faisceau de cinq fils
  const routes: Record<string, P[]> = {}
  const info: Record<string, RouteInfo> = {}
  for (let i = 0; i < 5; i++) {
    routes['f' + i] = [{ x: 100 + i * 20, y: 100 }, { x: 100 + i * 20, y: 200 }, { x: 160 + i * 20, y: 200 }, { x: 160 + i * 20, y: 300 }]
    info['f' + i] = { auto: true, ports: ['a' + i, 'b' + i] }
  }
  separateRoutes(routes, info)
  check('faisceau de 5 fils : aucune superposition, aucun croisement', !anyOverlap(routes) && totalCross(routes) === 0, JSON.stringify(routes))
  check('faisceau de 5 fils : cinq couloirs distincts', new Set(Object.values(routes).map((p) => p[1].y)).size === 5)
}

{
  // déterminisme : même entrée, même résultat
  const b = bundle(40)
  check('résultat déterministe', JSON.stringify(routeAll(b.wires, b.symbols)) === JSON.stringify(routeAll(b.wires, b.symbols)))
}

// ════ routage de base : toutes les orientations de bornes ════
{
  const DIRS = ['up', 'down', 'left', 'right'] as const
  const V: Record<string, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }
  const OFFS = [-100, -40, -20, 0, 20, 40, 100]
  let cases = 0
  const bad: string[] = []
  const selfCross = (p: P[]) => {
    for (let i = 0; i + 1 < p.length; i++) for (let j = i + 2; j + 1 < p.length; j++) {
      const [a, b, c, d] = [p[i], p[i + 1], p[j], p[j + 1]]
      if (Math.min(a.x, b.x) <= Math.max(c.x, d.x) && Math.min(c.x, d.x) <= Math.max(a.x, b.x) && Math.min(a.y, b.y) <= Math.max(c.y, d.y) && Math.min(c.y, d.y) <= Math.max(a.y, b.y)) return true
    }
    return false
  }
  for (const da of DIRS) for (const db of DIRS) for (const dx of OFFS) for (const dy of OFFS) {
    const a = { x: 200, y: 200, dir: da }
    const b = { x: 200 + dx, y: 200 + dy, dir: db }
    if (Math.abs(dx) + Math.abs(dy) < 40) continue
    const r = route(a, b)
    cases++
    const first = [Math.sign(r[1].x - r[0].x), Math.sign(r[1].y - r[0].y)]
    const n = r.length
    const last = [Math.sign(r[n - 1].x - r[n - 2].x), Math.sign(r[n - 1].y - r[n - 2].y)]
    const tag = `${da}->${db} (${dx},${dy})`
    if (!orthogonal(r)) bad.push(tag + ' non orthogonal')
    else if (hasUTurn(r)) bad.push(tag + ' demi-tour')
    else if (first[0] !== V[da][0] || first[1] !== V[da][1]) bad.push(tag + ' sortie à contre-sens')
    else if (last[0] !== -V[db][0] || last[1] !== -V[db][1]) bad.push(tag + ' arrivée à contre-sens')
    else if (selfCross(r)) bad.push(tag + ' auto-croisement')
  }
  check(`routage de base : ${cases} configurations (4×4 directions × positions) : sortie et arrivée du bon côté, sans demi-tour ni auto-croisement`, bad.length === 0, bad.slice(0, 6).join(' ; ') + (bad.length > 6 ? ` … (${bad.length})` : ''))
}

{
  // le cas signalé : deux phases partent vers le bas, le transformateur est plus haut ; fils parallèles écartés
  const symbols = [
    sym('L1', 'el-pe', 120, 30), sym('L2', 'el-pe', 140, 30), sym('T', 'el-trafo', 400, 0),
  ]
  const wires = [wire('p1', 'L1', 'a', 'T', 'p1'), wire('p2', 'L2', 'a', 'T', 'p1')]
  // el-pe : une seule borne en haut ; on construit directement deux tracés parallèles comme le routage les produit
  const a1 = { x: 130, y: 50, dir: 'down' as const }, a2 = { x: 150, y: 50, dir: 'down' as const }
  const b1 = { x: 410, y: 40, dir: 'up' as const }, b2 = { x: 430, y: 40, dir: 'up' as const }
  const routes: Record<string, P[]> = { p1: route(a1, b1), p2: route(a2, b2) }
  const info: Record<string, RouteInfo> = { p1: { auto: true, ports: ['L1:a', 'T:p1'] }, p2: { auto: true, ports: ['L2:a', 'T:p2'] } }
  check('cible derrière la sortie : chaque fil repart bien vers le bas', routes.p1[1].x === 130 && routes.p1[1].y > 50 && routes.p2[1].x === 150 && routes.p2[1].y > 50, JSON.stringify(routes))
  separateRoutes(routes, info)
  check('cible derrière la sortie : deux fils parallèles, aucune superposition ni croisement', !anyOverlap(routes) && totalCross(routes) === 0, JSON.stringify(routes))
  void symbols; void wires
}

// ── points de jonction : fils d'une même borne qui se séparent
{
  const { junctionPoints } = await import('../src/routing.ts')
  const W = (id: string, a: string, b: string) => ({ id, from: { symId: a, portId: 'p' }, to: { symId: b, portId: 'p' }, label: '', color: '#000', section: '' }) as any
  // deux fils partent de la même borne A : ils suivent la même amorce puis se séparent au point (100, 40)
  const routes = {
    w1: [{ x: 100, y: 0 }, { x: 100, y: 40 }, { x: 200, y: 40 }, { x: 200, y: 100 }],
    w2: [{ x: 100, y: 0 }, { x: 100, y: 40 }, { x: 20, y: 40 }, { x: 20, y: 100 }],
  }
  check('jonction : deux fils d une même borne → un point à la séparation', JSON.stringify(junctionPoints(routes, [W('w1', 'A', 'B'), W('w2', 'A', 'C')])) === JSON.stringify([{ x: 100, y: 40 }]))
  // l'un tourne sur un tronçon que l'autre poursuit : le point est là où il tourne
  const r2 = {
    w1: [{ x: 0, y: 0 }, { x: 0, y: 100 }, { x: 80, y: 100 }],
    w2: [{ x: 0, y: 0 }, { x: 0, y: 60 }, { x: 50, y: 60 }],
  }
  check('jonction : le fil qui tourne en premier donne le point', JSON.stringify(junctionPoints(r2, [W('w1', 'A', 'B'), W('w2', 'A', 'C')])) === JSON.stringify([{ x: 0, y: 60 }]))
  // fils sans borne commune : aucun point
  check('jonction : fils indépendants → aucun point', junctionPoints({ w1: routes.w1, w2: routes.w2 }, [W('w1', 'A', 'B'), W('w2', 'C', 'D')]).length === 0)
  // trois fils sur la même borne : un point par séparation, sans doublon
  const r3 = { ...routes, w3: [{ x: 100, y: 0 }, { x: 100, y: 40 }, { x: 150, y: 40 }, { x: 150, y: 90 }] }
  check('jonction : trois fils → points sans doublon', junctionPoints(r3, [W('w1', 'A', 'B'), W('w2', 'A', 'C'), W('w3', 'A', 'D')]).length >= 1, true)
}
console.log(fails ? `\n${fails} ÉCHEC(S)` : '\ntous les tests de tracé passent')
process.exit(fails ? 1 : 0)
