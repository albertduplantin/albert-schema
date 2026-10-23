/**
 * Valeurs de référence des catalogues de constructeurs (gammes courantes) utilisées pour conseiller les réglages.
 * Ce sont des ordres de grandeur de pré-étude : vérifiez toujours la référence exacte dans le catalogue du constructeur.
 */

/** Puissances de moteurs asynchrones triphasés 400 V (kW) et courant nominal typique à pleine charge (A), 4 pôles. */
export const MOTOR_TYPICAL: [number, number][] = [
  [0.18, 0.6], [0.25, 0.8], [0.37, 1.1], [0.55, 1.5], [0.75, 1.9], [1.1, 2.6], [1.5, 3.5], [2.2, 4.9], [3, 6.4], [4, 8.4],
  [5.5, 11.3], [7.5, 15], [11, 21.5], [15, 28.5], [18.5, 35], [22, 41], [30, 56], [37, 68], [45, 82],
]

/** Courant nominal typique d'un moteur 400 V de puissance `kw` (interpolation entre les valeurs du tableau). */
export function typicalMotorCurrent(kw: number): number | undefined {
  if (!(kw > 0)) return undefined
  const t = MOTOR_TYPICAL
  if (kw <= t[0][0]) return Math.round(((t[0][1] * kw) / t[0][0]) * 10) / 10
  for (let i = 1; i < t.length; i++) {
    if (kw <= t[i][0]) {
      const [k0, a0] = t[i - 1]
      const [k1, a1] = t[i]
      return Math.round((a0 + ((a1 - a0) * (kw - k0)) / (k1 - k0)) * 10) / 10
    }
  }
  return undefined
}

/** Plages de réglage normalisées des disjoncteurs-moteurs et relais thermiques (A) : 0,1–0,16 … 24–32. */
export const SETTING_RANGES: [number, number][] = [
  [0.1, 0.16], [0.16, 0.25], [0.25, 0.4], [0.4, 0.63], [0.63, 1], [1, 1.6], [1.6, 2.5], [2.5, 4], [4, 6.3], [6, 10], [9, 14], [13, 18], [17, 23], [20, 25], [24, 32],
  [30, 40], [37, 50], [48, 65], [55, 70], [63, 80], [80, 104],
]

/** Plage dont le milieu élargi contient le courant `i` : de préférence la plus étroite qui le contient avec une marge de 5 %. */
export function rangeFor(i: number): [number, number] | undefined {
  return SETTING_RANGES.find(([lo, hi]) => i >= lo && i <= hi * 0.98) ?? SETTING_RANGES.find(([lo, hi]) => i >= lo && i <= hi)
}

/** Courants assignés AC-3 (A, 400 V) des gammes de contacteurs courantes, avec la puissance moteur correspondante (kW). */
export const CONTACTOR_AC3: [number, number][] = [[9, 4], [12, 5.5], [18, 7.5], [25, 11], [32, 15], [38, 18.5], [40, 18.5], [50, 22], [65, 30], [80, 37], [95, 45]]

export const contactorFor = (amps: number): [number, number] | undefined => CONTACTOR_AC3.find(([a]) => a >= amps)

/** Puissances normalisées (VA) des transformateurs de commande monophasés. */
export const TRAFO_VA = [40, 63, 100, 160, 250, 400, 630, 1000, 1600, 2500, 4000]

/** Courant d'appel d'une bobine de contacteur par rapport à sa puissance de maintien (ordre de grandeur : 10). */
export const COIL_INRUSH_FACTOR = 10
