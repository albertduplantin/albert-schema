import type { SymbolDef } from '../../types'
import { ownElectrical } from './electrical'
import { ownFluidAll as ownFluid } from './fluid'
import type { Own } from './kit'

export type { Own }

/** Dessin propre d'un symbole de la bibliothèque, ou null s'il n'en a pas encore (il reste alors dans la bibliothèque étendue). */
export function ownDrawing(def: SymbolDef): Own | null {
  if (def.domain === 'electrical') return ownElectrical(def)
  return ownFluid(def)
}
