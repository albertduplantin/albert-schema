import type { Doc, PlacedSymbol, Wire } from './types'
import { portPos, uid } from './geometry'
import { routeAll } from './routing'
import { SYMBOL_MAP } from './symbols'

type P = { x: number; y: number }
const TOL = 0.6

/** Distance le long du tracé jusqu'au point `q`, ou null s'il n'est pas sur le tracé. */
function along(path: P[], q: P): number | null {
  let acc = 0
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i]
    const b = path[i + 1]
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    if (len > 0) {
      const t = ((q.x - a.x) * (b.x - a.x) + (q.y - a.y) * (b.y - a.y)) / (len * len)
      if (t >= -TOL / len && t <= 1 + TOL / len) {
        const px = a.x + t * (b.x - a.x)
        const py = a.y + t * (b.y - a.y)
        if (Math.hypot(q.x - px, q.y - py) <= TOL) return acc + Math.max(0, Math.min(1, t)) * len
      }
    }
    acc += len
  }
  return null
}

const totalLength = (path: P[]) => path.reduce((s, p, i) => (i ? s + Math.hypot(p.x - path[i - 1].x, p.y - path[i - 1].y) : 0), 0)
const key = (symId: string, portId: string) => `${symId}:${portId}`

/**
 * Insère les symboles `ids` dans les fils qu'ils recouvrent : quand deux bornes d'un symbole se trouvent sur le tracé d'un même
 * fil, celui-ci est coupé en deux et raccordé à ces bornes (disjoncteur posé sur trois fils, bornier, lampe, contact…).
 * Les coudes imposés du fil d'origine sont répartis de part et d'autre.
 */
export function spliceSymbols(doc: Doc, ids: string[]): Doc {
  const syms = new Map(doc.symbols.map((s) => [s.id, s]))
  let wires = doc.wires
  const routes = routeAll(wires, doc.symbols)
  const used = new Set(wires.flatMap((w) => [key(w.from.symId, w.from.portId), key(w.to.symId, w.to.portId)]))
  let changed = false
  for (const id of ids) {
    const sym = syms.get(id)
    const def = sym && SYMBOL_MAP[sym.defId]
    if (!sym || !def) continue
    const ports = def.ports
      .map((p) => ({ id: p.id, pos: portPos(sym, p.id) }))
      .filter((p): p is { id: string; pos: NonNullable<ReturnType<typeof portPos>> } => !!p.pos && !used.has(key(id, p.id)))
    if (ports.length < 2) continue
    for (const w of [...wires]) {
      if (w.from.symId === id || w.to.symId === id) continue
      const path = routes[w.id]
      if (!path || path.length < 2) continue
      const len = totalLength(path)
      const hits = ports
        .map((p) => ({ ...p, d: along(path, p.pos) }))
        .filter((p) => p.d !== null && p.d > 1 && p.d < len - 1 && !used.has(key(id, p.id)))
        .sort((a, b) => (a.d as number) - (b.d as number))
      if (hits.length < 2) continue
      const [first, second] = hits
      if ((second.d as number) - (first.d as number) < 1) continue
      const via = w.via ?? []
      const v1 = via.filter((v) => (along(path, v) ?? Infinity) < (first.d as number))
      const v2 = via.filter((v) => (along(path, v) ?? -Infinity) > (second.d as number))
      const w1: Wire = { ...w, to: { symId: id, portId: first.id } }
      const w2: Wire = { ...w, id: uid(), from: { symId: id, portId: second.id } }
      if (v1.length) w1.via = v1
      else delete w1.via
      if (v2.length) w2.via = v2
      else delete w2.via
      wires = wires.flatMap((x) => (x.id === w.id ? [w1, w2] : [x]))
      used.add(key(id, first.id))
      used.add(key(id, second.id))
      changed = true
    }
  }
  return changed ? { ...doc, wires } : doc
}

/** Raccorde directement les bornes d'un symbole qui tombent exactement sur celles d'un autre symbole (appareils posés bout à bout). */
export function connectCoincident(doc: Doc, ids: string[]): Doc {
  const used = new Set(doc.wires.flatMap((w) => [key(w.from.symId, w.from.portId), key(w.to.symId, w.to.portId)]))
  const added: Wire[] = []
  const all: PlacedSymbol[] = doc.symbols
  for (const id of ids) {
    const sym = all.find((s) => s.id === id)
    const def = sym && SYMBOL_MAP[sym.defId]
    if (!sym || !def) continue
    for (const p of def.ports) {
      if (used.has(key(id, p.id))) continue
      const a = portPos(sym, p.id)
      if (!a) continue
      for (const o of all) {
        if (o.id === id) continue
        const od = SYMBOL_MAP[o.defId]
        const hit = od?.ports.find((q) => {
          if (used.has(key(o.id, q.id))) return false
          const b = portPos(o, q.id)
          return !!b && Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1
        })
        if (hit) {
          added.push({ id: uid(), from: { symId: id, portId: p.id }, to: { symId: o.id, portId: hit.id }, label: '', color: '#000000', section: '' })
          used.add(key(id, p.id))
          used.add(key(o.id, hit.id))
          break
        }
      }
    }
  }
  return added.length ? { ...doc, wires: [...doc.wires, ...added] } : doc
}

/** Raccordements automatiques d'un symbole qu'on vient de poser : insertion dans les fils, puis bornes qui se touchent. */
export function autoConnect(doc: Doc, ids: string[]): Doc {
  return connectCoincident(spliceSymbols(doc, ids), ids)
}
