import type { Lang, PlacedSymbol, Ratings, SymbolDef } from './types'
import { RATINGS } from './transformer'
import { motorCurrent as motorCurrentImpl } from './sim/estimate'

/** Famille d'appareil, qui détermine les caractéristiques que l'on peut renseigner. */
export type Kind = 'fuse' | 'breaker' | 'motorBreaker' | 'thermal' | 'contactor' | 'motor' | 'consumer' | 'rcd'

export function kindOf(def: SymbolDef | undefined): Kind | null {
  if (!def) return null
  const m = def.sim
  const id = def.id
  if (m?.k === 'switch') {
    if (/10_fuses/.test(id)) return 'fuse'
    if (/30_thermal_relays/.test(id)) return 'thermal'
    if (/50_residual_current_circuit_breaker/.test(id)) return /^Interrupteur/i.test(def.name.fr) ? 'rcd' : 'breaker'
    if (/12_magneto|11_circuit_breakers/.test(id)) return /moteur|motor|GV/i.test(def.name.fr + ' ' + def.name.en) ? 'motorBreaker' : 'breaker'
    if (/02_power_contacts/.test(id)) return 'contactor'
    return null
  }
  if (m?.k === 'load') return m.role === 'motor' ? 'motor' : 'consumer'
  if (m?.k === 'coil') return 'consumer'
  return null
}

export interface FieldDef {
  key: keyof Ratings
  label: { fr: string; en: string }
  /** valeurs proposées */
  list?: (number | string)[]
  /** champ texte (courbe, type) plutôt que numérique */
  text?: boolean
  step?: number
}

const IN_LIST = RATINGS
const F = {
  calibre: { key: 'in', label: { fr: 'Calibre (A)', en: 'Rating (A)' }, list: IN_LIST } as FieldDef,
  ac3: { key: 'in', label: { fr: 'Courant assigné AC-3 (A)', en: 'Rated current AC-3 (A)' }, list: [6, 9, 12, 18, 25, 32, 40, 50, 65, 80, 95] } as FieldDef,
  curveB: { key: 'curve', label: { fr: 'Courbe de déclenchement', en: 'Trip curve' }, list: ['B', 'C', 'D', 'K', 'Z'], text: true } as FieldDef,
  fuseType: { key: 'curve', label: { fr: 'Type de fusible', en: 'Fuse type' }, list: ['gG', 'aM', 'gR'], text: true } as FieldDef,
  trip: { key: 'curve', label: { fr: 'Classe de déclenchement', en: 'Trip class' }, list: ['10A', '10', '20', '30'], text: true } as FieldDef,
  idn: { key: 'idn', label: { fr: 'Sensibilité différentielle IΔn (mA)', en: 'Residual current rating IΔn (mA)' }, list: [10, 30, 100, 300, 500] } as FieldDef,
  icu: { key: 'icu', label: { fr: 'Pouvoir de coupure (kA)', en: 'Breaking capacity (kA)' }, list: [3, 4.5, 6, 10, 15, 25, 50], step: 0.5 } as FieldDef,
  set: { key: 'set', label: { fr: 'Réglage thermique (A)', en: 'Thermal setting (A)' }, step: 0.1 } as FieldDef,
  min: { key: 'min', label: { fr: 'Plage de réglage : minimum (A)', en: 'Setting range: minimum (A)' }, step: 0.1 } as FieldDef,
  max: { key: 'max', label: { fr: 'Plage de réglage : maximum (A)', en: 'Setting range: maximum (A)' }, step: 0.1 } as FieldDef,
  kw: { key: 'kw', label: { fr: 'Puissance utile (kW)', en: 'Rated power (kW)' }, list: [0.18, 0.37, 0.55, 0.75, 1.1, 1.5, 2.2, 3, 4, 5.5, 7.5, 11, 15, 18.5, 22], step: 0.01 } as FieldDef,
  ie: { key: 'ie', label: { fr: 'Courant nominal (A) — plaque', en: 'Rated current (A) — nameplate' }, step: 0.1 } as FieldDef,
  cos: { key: 'cos', label: { fr: 'cos φ', en: 'Power factor cos φ' }, list: [0.7, 0.75, 0.8, 0.85, 0.9], step: 0.01 } as FieldDef,
  ratio: { key: 'ratio', label: { fr: 'Courant de démarrage Id / In', en: 'Starting current Id / In' }, list: [5, 6, 7, 8], step: 0.5 } as FieldDef,
  watts: { key: 'watts', label: { fr: 'Puissance absorbée (W ou VA)', en: 'Power consumption (W or VA)' }, list: [1, 2, 3, 5, 10, 15, 25], step: 0.5 } as FieldDef,
}

export const FIELDS: Record<Kind, FieldDef[]> = {
  fuse: [F.calibre, F.fuseType, F.icu],
  breaker: [F.calibre, F.curveB, F.icu],
  motorBreaker: [F.min, F.max, F.set, F.icu],
  thermal: [F.min, F.max, F.set, F.trip],
  contactor: [F.ac3],
  motor: [F.kw, F.ie, F.cos, F.ratio],
  consumer: [F.watts],
  rcd: [F.calibre, F.idn],
}

/** Champs d'un appareil : ceux de sa famille, plus la sensibilité différentielle pour un disjoncteur différentiel. */
export function fieldsFor(def: SymbolDef | undefined): FieldDef[] {
  const k = kindOf(def)
  if (!k) return []
  const f = FIELDS[k]
  return k === 'breaker' && def && /50_residual_current_circuit_breaker/.test(def.id) ? [...f, F.idn] : f
}

export const motorCurrent = motorCurrentImpl

/**
 * Calibre maximal usuel de la protection d'un conducteur en cuivre isolé PVC, par section (mm²) : la règle de base est
 * Ib ≤ In ≤ Iz. Valeurs courantes en installation (NF C 15-100) : 1,5 mm² → 16 A, 2,5 mm² → 20 A, 6 mm² → 32 A…
 * Repères de pré-étude : à confirmer avec le mode de pose, la température et le regroupement des câbles.
 */
export const CABLE_MAX_PROTECTION: [number, number][] = [[0.75, 6], [1, 10], [1.5, 16], [2.5, 20], [4, 25], [6, 32], [10, 50], [16, 63], [25, 80], [35, 100], [50, 125]]

export function maxProtection(section: number): number | undefined {
  if (!(section > 0)) return undefined
  let best: number | undefined
  for (const [s, a] of CABLE_MAX_PROTECTION) if (s <= section + 1e-9) best = a
  return best
}

export const parseSection = (v: string | undefined): number | undefined => {
  const n = parseFloat(String(v ?? '').replace(',', '.'))
  return n > 0 ? n : undefined
}

export const fieldLabel = (f: FieldDef, lang: Lang) => f.label[lang]
