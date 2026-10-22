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

/** Comportement électrique pour la simulation (voir src/sim/engine.ts) */
/** Temporisation : à la montée (`on`), à la retombée (`off`) ou les deux */
export type TimerKind = 'on' | 'off' | 'both'

export type SimModel =
  | { k: 'source'; pot: Record<string, string> }
  | {
      k: 'switch'
      poles: [string, string][]
      /** inverseurs : [commun, repos (NF), travail (NO)] */
      changeover?: [string, string, string][]
      ctl: 'coil' | 'momentary' | 'toggle' | 'fixed'
      nc: boolean
      /** contact temporisé */
      delay?: TimerKind
      /** lames animables : angle de bascule (degrés) et état dessiné (fermé = touche le contact fixe) */
      blades?: { rot: number; closed: boolean }[]
    }
  | { k: 'coil'; ports: string[]; timer?: TimerKind }
  | { k: 'load'; ports: string[]; role: 'lamp' | 'motor' | 'valve' | 'buzzer' | 'heater'; spin?: { cx: number; cy: number; r: number } }

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
  /** Catégorie et sous-groupe (bibliothèque QElectroTech) */
  cat?: string
  group?: { fr: string; en: string } | null
  /** Ancien symbole dessiné à la main, masqué de la palette */
  legacy?: boolean
  /** Modèle de simulation (absent : symbole non simulé) */
  sim?: SimModel
  /** Symbole purement décoratif : ne compte pas parmi les « non simulés » */
  decor?: boolean
  /** Fréquence d'usage estimée (0-100) sur les machines actuelles ; `top` = affiché dans « Les plus utilisés » */
  score?: number
  top?: boolean
}

export interface PlacedSymbol {
  id: string
  defId: string
  x: number
  y: number
  rot: 0 | 90 | 180 | 270
  label: string
  desc: string
  /** temporisation en secondes (bobines et contacts temporisés) */
  delay?: number
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
