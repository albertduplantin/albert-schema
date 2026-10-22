// Tests du tracé manuel des conducteurs : npm test
import { bestInsertIndex, route, routeOpen, routeVia } from '../src/geometry.ts'

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

console.log(fails ? `\n${fails} ÉCHEC(S)` : '\ntous les tests de tracé passent')
process.exit(fails ? 1 : 0)
