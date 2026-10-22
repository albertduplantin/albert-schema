import { electrical } from './electrical'
import { pneumatic, hydraulic } from './fluid'
import type { SymbolDef } from '../types'

export const SYMBOLS: SymbolDef[] = [...electrical, ...pneumatic, ...hydraulic]
export const SYMBOL_MAP: Record<string, SymbolDef> = Object.fromEntries(SYMBOLS.map((s) => [s.id, s]))
