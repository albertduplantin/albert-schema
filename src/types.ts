export type Domain = 'electrical' | 'pneumatic' | 'hydraulic'
export type Dir = 'up' | 'down' | 'left' | 'right'
export type Lang = 'fr' | 'en'

export interface PortDef {
  id: string
  x: number
  y: number
  dir: Dir
  label?: string
}

export interface SymbolDef {
  id: string
  domain: Domain
  /** Prefix du repère (IEC 81346 / EN 61346), ex. K, Q, S */
  prefix: string
  name: { fr: string; en: string }
  /** Norme de référence du symbole */
  std: string
  w: number
  h: number
  /** Contenu SVG interne (trait = currentColor) */
  svg: string
  ports: PortDef[]
}

export interface PlacedSymbol {
  id: string
  defId: string
  x: number
  y: number
  rot: 0 | 90 | 180 | 270
  label: string
  desc: string
}

export interface PortRef {
  symId: string
  portId: string
}

export interface Wire {
  id: string
  from: PortRef
  to: PortRef
  label: string
  color: string
  section: string
}

export interface TitleBlock {
  title: string
  author: string
  company: string
  date: string
  revision: string
  sheet: string
}

export type Paper = 'A4' | 'A3' | 'A2' | 'A1'

export interface Doc {
  version: 1
  paper: Paper
  title: TitleBlock
  symbols: PlacedSymbol[]
  wires: Wire[]
}
