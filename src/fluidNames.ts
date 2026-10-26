import type { Doc, PlacedSymbol, SymbolDef } from './types'

/**
 * Repérage normalisé des composants pneumatiques et hydrauliques (ISO 1219-2 / EN 81346-2, usage Festo Didactic et enseignement français) :
 *   repère = n° de circuit + code du composant + n° du composant, par exemple 1A1, 1V1, 1V2, 2S1, 0Z1
 *   0 = alimentation commune (groupe de conditionnement 0Z1, vanne d'arrêt 0V1, pressostat 0S1, pompe 0P1, bâche 0Z1)
 *   1, 2… = chaîne de commande d'un actionneur : 1A1 est son vérin, 1V1 son distributeur, 1V2 son régulateur de débit, 1S1 et 1S2 ses détecteurs de position
 * Les bobines d'un électrodistributeur 1V1 se repèrent 1V1+ (côté gauche, commande A) et 1V1− (côté droit, commande B) ; la forme 1Y1 / 1Y2 est aussi reconnue.
 */
export interface IsoCode { code: string; zero: boolean }

/** Code lettre du composant et appartenance à l'alimentation commune (circuit 0) ; null = pas de repère (raccords, silencieux, sources). */
export function isoCode(def: SymbolDef | undefined): IsoCode | null {
  const f = def?.fluid
  if (!def || !f) return null
  switch (f.k) {
    case 'cyl': return { code: 'A', zero: false }
    case 'fmotor': return { code: 'M', zero: false }
    case 'fsink': return def.domain === 'hydraulic' ? { code: 'Z', zero: true } : null // bâche ; un silencieux n'est pas repéré
    case 'fpump': return { code: 'P', zero: true }
    case 'fpress': return { code: 'S', zero: true }
    case 'fgauge': return { code: 'P', zero: true }
    case 'flink': return /501011_tank|501012_treatment|501013_control|501014_filter|81_filters|71_exchangers|21_tanks/.test(def.id) ? { code: 'Z', zero: true } : null
    case 'valve': return f.a === 'man' && f.b === 'none' && f.manual === 'toggle' && def.ports.length === 2 ? { code: 'V', zero: true } : { code: 'V', zero: false } // vanne d'arrêt : 0V1
    case 'check': case 'logic': case 'fthrottle': return { code: 'V', zero: false }
    default: return null
  }
}

const re = /^(\d+)([A-Z])(\d*)$/
/** Lit un repère : « 1A1 », ou « 1A » (écriture des sujets d'examen français quand il n'y a qu'un vérin par circuit, numéro 1 sous-entendu). */
export const parseIso = (label: string): { n: number; code: string; k: number } | null => {
  const m = re.exec(label.trim().toUpperCase())
  return m ? { n: Number(m[1]), code: m[2], k: m[3] ? Number(m[3]) : 1 } : null
}

/** Numéro du circuit courant : celui du dernier actionneur posé, 1 s'il n'y en a pas encore. */
function currentCircuit(doc: Doc, defs: Record<string, SymbolDef>): number {
  let n = 0
  for (const s of doc.symbols) {
    const iso = isoCode(defs[s.defId])
    const p = parseIso(s.label)
    if (iso?.code === 'A' && p) n = Math.max(n, p.n)
  }
  return Math.max(1, n)
}

/**
 * Repère suivant pour un composant fluide : un nouvel actionneur ouvre le circuit suivant (1A1, 2A1…), les autres composants prennent le circuit en cours
 * et le premier numéro libre pour leur code (1V1, 1V2…). Retourne null si le composant n'est pas concerné (électrique ou sans repère).
 */
export function nextFluidLabel(doc: Doc, def: SymbolDef, defs: Record<string, SymbolDef>): string | null {
  if (def.domain === 'electrical' || !def.fluid) return null
  const iso = isoCode(def)
  if (!iso) return ''
  let circuit = iso.zero ? 0 : currentCircuit(doc, defs)
  if (iso.code === 'A' || iso.code === 'M') {
    circuit = 1 + Math.max(0, ...doc.symbols.map((s) => (isoCode(defs[s.defId])?.code === 'A' || isoCode(defs[s.defId])?.code === 'M' ? parseIso(s.label)?.n ?? 0 : 0)))
  }
  let k = 0
  for (const s of doc.symbols) {
    const p = parseIso(s.label)
    if (p && p.n === circuit && p.code === iso.code) k = Math.max(k, p.k)
  }
  return `${circuit}${iso.code}${k + 1}`
}

type Valve = Extract<NonNullable<SymbolDef['fluid']>, { k: 'valve' }>

/**
 * Numéros normalisés des orifices d'un distributeur (ISO 5599) d'après la place des orifices sur le symbole :
 * 1 alimentation ; 2 et 4 utilisations (2 à droite, 4 à gauche) ; 3 et 5 échappements. En hydraulique : P, T, A, B.
 */
export function portNumbers(def: SymbolDef): Record<string, string> {
  const out: Record<string, string> = {}
  if (def.fluid?.k !== 'valve') return out
  const fp = def.ports.filter((p) => p.dir === 'up' || p.dir === 'down')
  const up = fp.filter((p) => p.dir === 'up').sort((a, b) => a.x - b.x)
  const down = fp.filter((p) => p.dir === 'down').sort((a, b) => a.x - b.x)
  const hyd = def.domain === 'hydraulic'
  const set = (list: typeof up, names: string[]) => list.forEach((p, i) => { out[p.id] = names[i] })
  if (up.length === 1 && down.length === 1) { set(up, [hyd ? 'A' : '2']); set(down, [hyd ? 'P' : '1']) }
  else if (up.length === 1 && down.length === 2) { set(up, [hyd ? 'A' : '2']); set(down, hyd ? ['P', 'T'] : ['1', '3']) }
  else if (up.length === 2 && down.length === 2) { set(up, hyd ? ['A', 'B'] : ['4', '2']); set(down, hyd ? ['P', 'T'] : ['1', '3']) }
  else if (up.length === 2 && down.length === 3) { set(up, hyd ? ['A', 'B'] : ['4', '2']); set(down, hyd ? ['T', 'P', 'T'] : ['5', '1', '3']) }
  return out
}

/**
 * Numéro de commande de chaque côté d'un distributeur : 14 quand la commande relie l'orifice 1 à l'orifice 4, 12 quand elle le relie à 2,
 * 10 quand elle coupe l'alimentation. [commande de gauche (A), commande de droite (B)].
 */
export function pilotNumbers(def: SymbolDef): [string | undefined, string | undefined] {
  const f = def.fluid
  if (f?.k !== 'valve' || def.domain === 'hydraulic') return f?.k === 'valve' ? ['14', '12'] : [undefined, undefined]
  const nums = portNumbers(def)
  const id1 = Object.keys(nums).find((k) => nums[k] === '1')
  const code = (links: [string, string][]): string => {
    const l = links.find(([a, b]) => a === id1 || b === id1)
    const other = l ? (l[0] === id1 ? l[1] : l[0]) : undefined
    const n = other ? nums[other] : undefined
    return n === '2' ? '12' : n === '4' ? '14' : '10'
  }
  const f2 = f as Valve
  const a = code(f2.act)
  const b = f2.b === 'elec' || f2.b === 'pneu' ? code(f2.three ? f2.actB ?? [] : f2.rest) : undefined
  return [a, b]
}

/**
 * Noms des bobines qui commandent un distributeur : [côté A (gauche), côté B (droite)].
 * Distributeur « 1V1 » : bobine 1YV14 (elle relie 1 à 4 quand elle est alimentée) et 1YV12 (1 à 2) ; 1V1+ / 1V1−, 1Y1 / 1Y2 sont aussi reconnus.
 * Au-delà du premier distributeur d'un circuit, le numéro du distributeur est glissé devant : 1YV214.
 * « YV1/YV2 » (ancien usage) désigne directement les deux bobines.
 */
export function solenoidNames(label: string, pilots?: [string | undefined, string | undefined]): [string[], string[]] {
  const norm = (v: string) => v.replace(/\s+/g, '').toUpperCase().replace(/−/g, '-')
  const parts = label.split(/[\s/,;]+/).filter(Boolean)
  if (parts.length >= 2) return [[norm(parts[0])], [norm(parts[1])]]
  const one = norm(label)
  if (!one) return [[], []]
  const m = /^(\d*)V(\d+)$/.exec(one)
  if (m) {
    const k = Number(m[2])
    const yv = (p: string | undefined, dflt: string) => `${m[1]}YV${k > 1 ? k : ''}${p ?? dflt}`
    const [pa, pb] = pilots ?? [undefined, undefined]
    return [
      [yv(pa, '14'), one + '+', `${m[1]}Y${2 * k - 1}`, `${m[1]}YV${k}4`, `${m[1]}YV${k}`],
      [yv(pb, '12'), one + '-', `${m[1]}Y${2 * k}`, `${m[1]}YV${k}2`],
    ]
  }
  return [[one, one + '+'], [one + '-']]
}

/** Renumérote tous les composants fluides d'après le câblage : chaque actionneur ouvre un circuit, ses distributeurs et régulateurs le suivent, l'alimentation est le circuit 0. */
export function renumberFluid(doc: Doc, defs: Record<string, SymbolDef>): Doc {
  const by = new Map(doc.symbols.map((s) => [s.id, s]))
  const adj = new Map<string, Set<string>>()
  for (const w of doc.wires) {
    for (const [a, b] of [[w.from.symId, w.to.symId], [w.to.symId, w.from.symId]]) (adj.get(a) ?? adj.set(a, new Set()).get(a)!).add(b)
  }
  const isoOf = (s: PlacedSymbol) => isoCode(defs[s.defId])
  const actuators = doc.symbols.filter((s) => { const c = isoOf(s)?.code; return c === 'A' || c === 'M' }).sort((a, b) => a.y - b.y || a.x - b.x)
  const circuitOf = new Map<string, number>()
  actuators.forEach((a, i) => circuitOf.set(a.id, i + 1))
  // les composants de commande héritent du circuit de l'actionneur le plus proche (en nombre de liaisons), sans traverser l'alimentation
  const queue = [...actuators.map((a) => a.id)]
  while (queue.length) {
    const id = queue.shift()!
    const n = circuitOf.get(id)!
    for (const nb of adj.get(id) ?? []) {
      const s = by.get(nb)
      if (!s || circuitOf.has(nb)) continue
      const iso = isoOf(s)
      if (!iso || iso.zero || iso.code === 'A') continue
      circuitOf.set(nb, n)
      queue.push(nb)
    }
  }
  const counters = new Map<string, number>()
  const labels = new Map<string, string>()
  const order = [...doc.symbols].sort((a, b) => a.y - b.y || a.x - b.x)
  for (const s of order) {
    const iso = isoOf(s)
    if (!iso) continue
    const n = iso.zero ? 0 : circuitOf.get(s.id) ?? currentCircuit({ ...doc, symbols: doc.symbols.filter((x) => labels.has(x.id)).map((x) => ({ ...x, label: labels.get(x.id)! })) }, defs)
    const key = `${n}${iso.code}`
    const k = (counters.get(key) ?? 0) + 1
    counters.set(key, k)
    labels.set(s.id, `${key}${k}`)
  }
  return { ...doc, symbols: doc.symbols.map((s) => (labels.has(s.id) ? { ...s, label: labels.get(s.id)! } : s)) }
}

/** Orifices d'échappement (3, 5) d'un distributeur pneumatique : ils portent un silencieux et sont à l'air libre même s'ils ne sont reliés à rien. */
export const exhaustPortIds = (def: SymbolDef): string[] =>
  def.domain === 'pneumatic' ? Object.entries(portNumbers(def)).filter(([, t]) => t === '3' || t === '5').map(([id]) => id) : []
