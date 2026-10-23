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
  /** transformateur : le secondaire devient une source quand le primaire est alimenté */
  | { k: 'transformer'; primary: string[]; secondary: string[] }
  | { k: 'load'; ports: string[]; role: 'lamp' | 'motor' | 'valve' | 'buzzer' | 'heater'; spin?: { cx: number; cy: number; r: number } }

/** Comportement fluidique (pneumatique) : voir scripts/fluid-classify.mjs */
export type FluidModel =
  | { k: 'fsource'; ports: string[] }
  | { k: 'fsink'; ports: string[] }
  | { k: 'flink'; ports: string[] }
  | { k: 'cyl'; cap: string; rod?: string; single?: 'push' | 'pull' }
  | {
      k: 'valve'
      /** liaisons entre orifices : case de repos / case actionnée (côté commande A) */
      rest: [string, string][]
      act: [string, string][]
      /** commande A (gauche) et B (droite) : électrique, pneumatique, manuelle, ressort ou aucune */
      a: 'elec' | 'pneu' | 'man'
      b: 'elec' | 'pneu' | 'spring' | 'none'
      pilotA?: string
      pilotB?: string
      manual?: 'momentary' | 'toggle'
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
  /** Catégorie et sous-groupe (bibliothèque QElectroTech) */
  cat?: string
  group?: { fr: string; en: string } | null
  /** Ancien symbole dessiné à la main, masqué de la palette */
  legacy?: boolean
  /** Modèle de simulation (absent : symbole non simulé) */
  sim?: SimModel
  /** Modèle fluidique (distributeurs, vérins, sources d'air…) */
  fluid?: FluidModel
  /** Symbole purement décoratif : ne compte pas parmi les « non simulés » */
  decor?: boolean
  /** Fréquence d'usage estimée (0-100) sur les machines actuelles ; `top` = affiché dans « Les plus utilisés » */
  score?: number
  top?: boolean
}

/** Caractéristiques assignées d'un appareil (selon sa famille : voir ratings.ts). */
export interface Ratings {
  /** calibre (fusible, disjoncteur) ou courant assigné AC-3 (contacteur), en A */
  in?: number
  /** courbe de déclenchement (B, C, D…), type de fusible (gG, aM) ou classe de déclenchement */
  curve?: string
  /** pouvoir de coupure (kA) */
  icu?: number
  /** sensibilité différentielle IΔn (mA) */
  idn?: number
  /** réglage thermique (A) et plage de réglage (A) */
  set?: number
  min?: number
  max?: number
  /** moteur : puissance utile (kW), courant nominal de plaque (A), cos φ, rapport Id/In */
  kw?: number
  ie?: number
  cos?: number
  ratio?: number
  /** récepteurs : puissance absorbée (W ou VA) */
  watts?: number
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
  /** tension nominale en volts (récepteurs) ou tension du secondaire (transformateurs) */
  volts?: number
  /** transformateurs : tension assignée du primaire (V) et puissance (VA) */
  voltsPrimary?: number
  power?: number
  /** caractéristiques assignées (calibre, courbe, réglages, puissance…) */
  rated?: Ratings
  /** décalage du nom du composant (affiché quand l'option « noms » est cochée) */
  nameOff?: { x: number; y: number }
  /** nom affiché à la place du nom du type de composant */
  nameText?: string
  /** numéros de bornes personnalisés : identifiant de borne → repère (remplace celui du symbole) */
  terms?: Record<string, string>
  /** décalage du repère et de la description par rapport à leur position par défaut (déplacés à la souris) */
  labelOff?: { x: number; y: number }
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
  /** points de passage imposés par l'utilisateur (tracé manuel) ; absent = tracé automatique */
  via?: { x: number; y: number }[]
  /** épaisseur et type de trait (câble multiconducteur, liaison optionnelle…) ; par défaut 1,6 et continu */
  width?: number
  dash?: StrokeStyle
}

export interface TitleBlock {
  title: string
  author: string
  company: string
  date: string
  revision: string
  sheet: string
  /** champs complémentaires (ISO 7200) : approbateur, numéro de document, affaire / installation */
  approver?: string
  docNumber?: string
  project?: string
}

export type Paper = 'A4' | 'A3' | 'A2' | 'A1'

/** Appareil de mesure posé sur la feuille : voltmètre (deux pointes de touche) ou pince ampèremétrique. */
export interface Instrument {
  id: string
  kind: 'voltmeter' | 'clamp'
  /** affichage : aiguille ou numérique */
  style: 'needle' | 'digital'
  x: number
  y: number
  /** calibre : volts (voltmètre) ou ampères (pince) */
  range: number
  /** voltmètre : position des deux pointes de touche (COM, V) ; par défaut sous le boîtier */
  probes?: [{ x: number; y: number }, { x: number; y: number }]
}

/** Annotation libre posée sur la feuille. */
export interface Note {
  id: string
  x: number
  y: number
  text: string
  size: number
  font?: string
  bold?: boolean
  italic?: boolean
}

/** Trait d'une forme : continu, tirets, pointillés ou trait-point. */
export type StrokeStyle = 'solid' | 'dashed' | 'dotted' | 'dashdot'

/**
 * Forme de dessin posée sous le schéma : cadre (coffret, armoire, pupitre), ellipse, ligne ou flèche.
 * Rectangle et ellipse : (x, y) coin haut gauche, (w, h) dimensions ≥ 0. Ligne : de (x, y) à (x + w, y + h), w et h pouvant être négatifs.
 */
export interface Shape {
  id: string
  kind: 'rect' | 'ellipse' | 'line' | 'poly' | 'arc' | 'image'
  x: number
  y: number
  w: number
  h: number
  stroke: StrokeStyle
  width: number
  color: string
  /** couleur de remplissage (absent : transparent) */
  fill?: string
  /** titre du cadre, affiché en haut à gauche, sur le trait */
  label?: string
  /** angles arrondis (rectangle) */
  rounded?: boolean
  /** flèche à l'extrémité (ligne) : à l'arrivée, ou aux deux bouts */
  arrow?: 'end' | 'both'
  /** polyligne : sommets relatifs à (x, y) ; fermée, elle devient un polygone */
  pts?: { x: number; y: number }[]
  closed?: boolean
  /** arc d'ellipse inscrit dans le rectangle (x, y, w, h) : angles de départ et d'arrivée en degrés, sens horaire depuis l'est */
  a0?: number
  a1?: number
  /** image (logo, photo) : adresse de données, redimensionnée à l'import */
  href?: string
  /** cadre qui emporte avec lui les symboles, textes et formes qu'il contient quand on le déplace */
  carry?: boolean
}

/** Style des noms de composants affichés sous les symboles (option « Noms des composants »). */
export interface NameStyle {
  font?: string
  size?: number
  bold?: boolean
  italic?: boolean
}

/** Une feuille d'un projet à plusieurs pages. */
export interface Page {
  name: string
  symbols: PlacedSymbol[]
  wires: Wire[]
  notes?: Note[]
  shapes?: Shape[]
  instruments?: Instrument[]
}

export interface Doc {
  version: 1
  paper: Paper
  title: TitleBlock
  symbols: PlacedSymbol[]
  wires: Wire[]
  notes?: Note[]
  shapes?: Shape[]
  instruments?: Instrument[]
  /** projet à plusieurs feuilles : le contenu de la feuille active est dans symbols/wires/notes */
  pages?: Page[]
  page?: number
  /** afficher le nom (type) de chaque composant sous son symbole */
  showNames?: boolean
  nameStyle?: NameStyle
  /** calque des formes de dessin : masqué, ou verrouillé (non sélectionnable) */
  hideShapes?: boolean
  lockShapes?: boolean
}
