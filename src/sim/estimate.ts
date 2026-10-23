import type { PlacedSymbol, SymbolDef } from '../types'

/** Courant nominal d'un moteur : valeur de plaque, sinon estimé d'après la puissance (rendement 0,88, cos φ 0,85 par défaut). */
export function motorCurrent(s: PlacedSymbol, def: SymbolDef): { value: number; estimated: boolean } | undefined {
  const r = s.rated
  if (r?.ie && r.ie > 0) return { value: r.ie, estimated: false }
  if (r?.kw && r.kw > 0) {
    const threePhase = (def.sim?.k === 'load' ? def.sim.ports.length : 0) >= 3
    const u = s.volts && s.volts > 0 ? s.volts : threePhase ? 400 : 230
    const cos = r.cos && r.cos > 0 ? r.cos : 0.85
    const i = (r.kw * 1000) / ((threePhase ? Math.sqrt(3) : 1) * u * cos * 0.88)
    return { value: Math.round(i * 10) / 10, estimated: true }
  }
  return undefined
}

/** Puissance absorbée par défaut (W ou VA) d'un récepteur dont on n'a pas renseigné la puissance. */
export const DEFAULT_WATTS: Record<string, number> = { coil: 8, lamp: 3, buzzer: 3, valve: 8, heater: 500 }
