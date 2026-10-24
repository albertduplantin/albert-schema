import type { Doc, SymbolDef } from '../types'
import { kindOf } from '../ratings'
import type { SimMemory, SimResult } from './engine'

/** Seuil de déclenchement instantané (multiple du calibre) selon la courbe d'un disjoncteur ou le type d'un fusible. */
const INSTANT: Record<string, number> = { B: 5, C: 10, D: 20, K: 12, Z: 3, GG: 8, AM: 12 }
/** Temps de déclenchement (s) d'une protection traversée par `r` fois son calibre : courbe à temps inverse. */
export const tripTime = (r: number) => 5 / (r * r - 1)

/**
 * Examine les protections (fusibles, disjoncteurs) d'un résultat de simulation et note dans la mémoire celles qui déclenchent :
 * court-circuit directement en aval, ou surcharge soutenue. Retourne vrai si une protection vient de déclencher
 * (le calcul doit être refait) et le délai avant la prochaine échéance.
 */
export function detectTrips(doc: Doc, defs: Record<string, SymbolDef>, res: SimResult, memory: SimMemory, now: number): { changed: boolean; pendingMs: number | null } {
  let changed = false
  let pendingMs: number | null = null
  // bornes câblées dont le réseau est en conflit de potentiels (court-circuit) : seules les protections de plus petit calibre déclenchent (sélectivité)
  const wired = new Set(doc.wires.flatMap((w) => [`${w.from.symId}:${w.from.portId}`, `${w.to.symId}:${w.to.portId}`]))
  const inShortNet = (symId: string, ports: string[]) => res.shorts.length > 0 && ports.some((p) => wired.has(`${symId}:${p}`) && !res.potentialOf[`${symId}:${p}`])
  const calibre = (s: Doc['symbols'][number], k: string) => (k === 'motorBreaker' ? s.rated?.set : undefined) ?? s.rated?.in ?? Infinity
  let minShort = Infinity
  for (const s of doc.symbols) {
    const k = kindOf(defs[s.defId]), m = defs[s.defId]?.sim
    if ((k === 'fuse' || k === 'breaker' || k === 'motorBreaker') && m?.k === 'switch' && !memory['§TRIP:' + s.id]?.on && inShortNet(s.id, m.poles.flat())) minShort = Math.min(minShort, calibre(s, k))
  }
  const wireAmps = new Map<string, number>()
  for (const w of doc.wires) {
    const a = res.amps[w.id]
    if (!a) continue
    for (const e of [w.from, w.to]) { const k = `${e.symId}:${e.portId}`; wireAmps.set(k, (wireAmps.get(k) ?? 0) + a) }
  }
  for (const s of doc.symbols) {
    const def = defs[s.defId]
    const k = kindOf(def)
    if (k !== 'fuse' && k !== 'breaker' && k !== 'motorBreaker') continue
    const m = def.sim
    if (m?.k !== 'switch' || memory['§TRIP:' + s.id]?.on) continue
    const ports = m.poles.flat()
    const inShort = inShortNet(s.id, ports) && calibre(s, k) <= minShort
    const I = Math.max(0, ...ports.map((p) => wireAmps.get(`${s.id}:${p}`) ?? 0))
    const rating = (k === 'motorBreaker' ? s.rated?.set : undefined) ?? s.rated?.in
    const mult = INSTANT[(s.rated?.curve ?? (k === 'fuse' ? 'gG' : 'C')).toUpperCase()] ?? 10
    if (inShort || (rating && I >= mult * rating)) {
      memory['§TRIP:' + s.id] = { on: true, since: now }
      delete memory['§OVL:' + s.id]
      changed = true
      continue
    }
    if (rating && I > 1.13 * rating) {
      const t = tripTime(I / rating) * 1000
      const o = memory['§OVL:' + s.id]
      const since = o?.on ? o.since : now
      if (!o?.on) memory['§OVL:' + s.id] = { on: true, since: now }
      if (now - since >= t) { memory['§TRIP:' + s.id] = { on: true, since: now }; delete memory['§OVL:' + s.id]; changed = true }
      else pendingMs = Math.min(pendingMs ?? Infinity, Math.max(1, t - (now - since)))
    } else delete memory['§OVL:' + s.id]
  }
  return { changed, pendingMs }
}
