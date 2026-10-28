import type { Doc, PlacedSymbol, Ratings, SymbolDef } from '../types'

/**
 * Hydraulique quantitative : pressions (bar) et débits (L/min) en régime établi, pour les circuits de type banc d'essai.
 * Chaque appareil est un élément qui relie des nœuds (conduites reliées entre elles par les cases des distributeurs) par une loi débit / pression :
 * pompe (débit imposé, ou régulé en pression), limiteur et réducteur de pression, limiteur de débit (orifice en √ΔP, régulateur compensé),
 * clapet, moteur (débit = k·(ΔP − charge)), vérin (deux chambres de sections différentes). Les pressions des nœuds sont obtenues par balayages
 * successifs : à chaque nœud, la somme des débits est annulée par dichotomie (toutes les lois sont croissantes avec la pression du nœud).
 */
const key = (symId: string, portId: string) => `${symId}:${portId}`

class UF {
  private p = new Map<string, string>()
  find(x: string): string {
    if (!this.p.has(x)) this.p.set(x, x)
    let r = x
    while (this.p.get(r) !== r) r = this.p.get(r)!
    this.p.set(x, r)
    return r
  }
  union(a: string, b: string) {
    const ra = this.find(a), rb = this.find(b)
    if (ra !== rb) this.p.set(ra, rb)
  }
}

export interface HydIn {
  doc: Doc
  defs: Record<string, SymbolDef>
  valveA: Record<string, boolean>
  valveB: Record<string, boolean>
  /** position d'un vérin : 0 = rentré, 1 = sorti */
  cylPos: (symId: string) => number
}

export interface HydOut {
  /** pression (bar) à un orifice, ou undefined si le circuit n'est pas hydraulique */
  bar: (symId: string, portId: string) => number | undefined
  /** débit entrant dans la chambre de fond de chaque vérin (L/min, signé) et vitesse de sa tige (cm/s, signée) */
  cylX: Record<string, number>
  cylV: Record<string, number>
  /** vitesse de rotation des moteurs (tr/min, valeur absolue) et sens (+1 : de a vers b) */
  rpm: Record<string, number>
  dir: Record<string, 1 | -1>
  /** texte de mesure affiché sous chaque appareil */
  info: Record<string, string>
}

/** Constantes du modèle (ordres de grandeur d'un banc didactique 100 bar / 30 L/min). */
const PMAX = 350
const K_RELIEF = 8 // L/min par bar au-delà du tarage
const K_REDUCER = 10
const C_ORIFICE = 14 // L/min sous 1 bar, ouverture 100 %
const C_FREE = 40 // retour libre d'un limiteur unidirectionnel et clapets (L/min par bar)
const K_MOTOR = 2 // L/min par bar au-delà de la charge
const K_CYL = 3

const dflt = (v: number | undefined, d: number) => (v === undefined || !Number.isFinite(v) ? d : v)

interface El {
  sym: string
  kind: string
  nodes: number[]
  /** débits quittant chaque nœud de l'élément (positif : vers l'élément) */
  out: (p: Float64Array) => number[]
}

/** Sections d'un vérin (cm²) : fond, annulaire. */
export function cylAreas(r: Ratings | undefined): { cap: number; ann: number; strokeCm: number } {
  const bore = dflt(r?.bore, 50), rod = dflt(r?.rod, 30)
  const cap = (Math.PI * (bore / 10) ** 2) / 4
  return { cap, ann: cap - (Math.PI * (rod / 10) ** 2) / 4, strokeCm: dflt(r?.stroke, 350) / 10 }
}

export function solveHyd(inp: HydIn): HydOut | null {
  const { doc, defs } = inp
  const hydSyms = doc.symbols.filter((s) => defs[s.defId]?.domain === 'hydraulic')
  if (!hydSyms.some((s) => ['fpump', 'relief', 'reducer'].includes(defs[s.defId].fluid?.k ?? ''))) return null

  // ── nœuds : conduites et liaisons internes (cases actives des distributeurs, filtres, pièces fixes)
  const uf = new UF()
  for (const w of doc.wires) uf.union(key(w.from.symId, w.from.portId), key(w.to.symId, w.to.portId))
  for (const s of hydSyms) {
    const f = defs[s.defId].fluid
    if (!f) continue
    if (f.k === 'valve' && f.prop) continue
    if (f.k === 'valve') for (const [a, b] of f.three ? (inp.valveA[s.id] ? f.act : inp.valveB[s.id] ? f.actB ?? f.rest : f.rest) : inp.valveA[s.id] ? f.act : f.rest) uf.union(key(s.id, a), key(s.id, b))
    else if (f.k === 'flink') for (const q of f.ports.slice(1)) uf.union(key(s.id, f.ports[0]), key(s.id, q))
    else if (f.k === 'fnet') for (const [a, b] of f.links) uf.union(key(s.id, a), key(s.id, b))
  }
  const index = new Map<string, number>()
  const node = (symId: string, portId: string): number => {
    const r = uf.find(key(symId, portId))
    if (!index.has(r)) index.set(r, index.size)
    return index.get(r)!
  }
  const tank = new Set<number>()
  for (const s of hydSyms) {
    const f = defs[s.defId].fluid
    if (f?.k === 'fsink') for (const q of f.ports) tank.add(node(s.id, q))
  }

  // ── éléments
  const els: El[] = []
  const meta: Record<string, { Vd?: number; Aca?: number; Aann?: number; strokeCm?: number }> = {}
  for (const s of hydSyms) {
    const f = defs[s.defId].fluid
    if (!f) continue
    const r = s.rated ?? {}
    switch (f.k) {
      case 'fpump': {
        const outN = node(s.id, f.out), inN = node(s.id, f.in), lsN = f.ls ? node(s.id, f.ls) : -1
        const Qn = (dflt(r.disp, 18) * dflt(r.rpm, 1500)) / 1000
        const variable = f.variable || /variable/i.test(defs[s.defId].name.fr)
        const pset = dflt(r.set, 100)
        const on = tank.has(inN)
        // Load Sensing : la pompe règle son débit pour garder 14 bar de plus que la pression de charge, sans dépasser sa pression maximale
        const Q = (pp: number, pls: number) => {
          const target = lsN >= 0 ? Math.min(pset, pls + 14) : pset
          return on ? Math.max(0, Qn * (1 - 0.0007 * pp) * (variable || lsN >= 0 ? Math.min(1, Math.max(0, (target + 3 - pp) / 6)) : 1)) : 0
        }
        els.push({ sym: s.id, kind: 'pump', nodes: lsN >= 0 ? [outN, inN, lsN] : [outN, inN], out: (p) => { const q = Q(p[outN], lsN >= 0 ? p[lsN] : 0); return lsN >= 0 ? [-q, q, 0] : [-q, q] } })
        break
      }
      case 'relief': {
        const pN = node(s.id, f.p), tN = node(s.id, f.t)
        const pset = dflt(r.set, 100)
        els.push({ sym: s.id, kind: 'relief', nodes: [pN, tN], out: (p) => { const q = K_RELIEF * Math.max(0, p[pN] - p[tN] - pset); return [q, -q] } })
        break
      }
      case 'reducer': {
        const pN = node(s.id, f.p), aN = node(s.id, f.a)
        const pset = dflt(r.set, 50)
        els.push({ sym: s.id, kind: 'reducer', nodes: [pN, aN], out: (p) => { const q = K_REDUCER * Math.max(0, Math.min(p[pN] - p[aN], pset - p[aN])); return [q, -q] } })
        break
      }
      case 'fthrottle': {
        const aN = node(s.id, f.a), bN = node(s.id, f.b)
        const open = Math.min(1, Math.max(0.02, dflt(r.open, 50) / 100))
        const comp = !!f.comp
        els.push({
          sym: s.id, kind: 'throttle', nodes: [aN, bN],
          out: (p) => {
            const d = p[aN] - p[bN]
            let q: number
            if (d >= 0) q = comp ? 30 * open * Math.min(1, d / 4) : C_ORIFICE * open * Math.sqrt(d)
            else q = f.oneWay ? C_FREE * d : -(comp ? 30 * open * Math.min(1, -d / 4) : C_ORIFICE * open * Math.sqrt(-d))
            return [q, -q]
          },
        })
        break
      }
      case 'check': {
        const fN = node(s.id, f.from), tN = node(s.id, f.to), pilN = f.pilot ? node(s.id, f.pilot) : -1
        els.push({
          sym: s.id, kind: 'check', nodes: pilN >= 0 ? [fN, tN, pilN] : [fN, tN],
          out: (p) => {
            const d = p[fN] - p[tN]
            const piloted = pilN >= 0 && p[pilN] > 8
            const q = piloted ? C_FREE * d : C_FREE * Math.max(0, d - 0.5)
            return pilN >= 0 ? [q, -q, 0] : [q, -q]
          },
        })
        break
      }
      case 'logic': {
        // sélecteur de circuit : la sortie est alimentée par l'entrée la plus haute
        if (f.op !== 'or') break
        const [i1, i2] = f.ins.map((q) => node(s.id, q)), oN = node(s.id, f.out)
        els.push({
          sym: s.id, kind: 'shuttle', nodes: [i1, i2, oN],
          out: (p) => { const q1 = C_FREE * Math.max(0, p[i1] - p[oN] - 0.3), q2 = C_FREE * Math.max(0, p[i2] - p[oN] - 0.3); return [q1, q2, -q1 - q2] },
        })
        break
      }
      case 'fmotor': {
        if (!f.b) break
        const aN = node(s.id, f.a), bN = node(s.id, f.b)
        const load = dflt(r.load, 5)
        meta[s.id] = { Vd: dflt(r.disp, 100) }
        els.push({
          sym: s.id, kind: 'motor', nodes: [aN, bN],
          out: (p) => { const d = p[aN] - p[bN]; const q = d > load ? K_MOTOR * (d - load) : d < -load ? K_MOTOR * (d + load) : 0; return [q, -q] },
        })
        break
      }
      case 'cyl': {
        const A = cylAreas(r)
        const aN = node(s.id, f.cap), bN = f.rod ? node(s.id, f.rod) : -1
        const ratio = f.rod ? A.ann / A.cap : 0
        const pl = 2 + dflt(r.load, 0) / A.cap // frottement + charge (daN / cm² = bar)
        meta[s.id] = { Aca: A.cap, Aann: A.ann, strokeCm: A.strokeCm }
        const pos = () => inp.cylPos(s.id)
        els.push({
          sym: s.id, kind: 'cyl', nodes: bN >= 0 ? [aN, bN] : [aN],
          out: (p) => {
            const eff = p[aN] - ratio * (bN >= 0 ? p[bN] : 0)
            let x = eff > pl ? K_CYL * (eff - pl) : eff < -pl && bN >= 0 ? K_CYL * (eff + pl) : 0
            const ps = pos()
            if (ps >= 0.999) x = Math.min(x, 0)
            if (ps <= 0.001) x = Math.max(x, 0)
            return bN >= 0 ? [x, -ratio * x] : [x]
          },
        })
        break
      }
      case 'valve': {
        if (!f.prop) break
        const joy = Math.max(-100, Math.min(100, dflt(r.joy, 0)))
        const open = Math.abs(joy) / 100
        if (open < 0.02) break
        const links = joy < 0 ? f.act : f.actB ?? []
        for (const [a, b] of links) {
          const aN = node(s.id, a), bN = node(s.id, b)
          els.push({ sym: s.id, kind: 'prop', nodes: [aN, bN], out: (p) => { const d = p[aN] - p[bN]; const q = Math.sign(d) * C_ORIFICE * 0.9 * open * Math.sqrt(Math.abs(d)); return [q, -q] } })
        }
        break
      }
      case 'fflow': {
        const aN = node(s.id, f.a), bN = node(s.id, f.b)
        els.push({ sym: s.id, kind: 'meter', nodes: [aN, bN], out: (p) => { const q = 100 * (p[aN] - p[bN]); return [q, -q] } })
        break
      }
    }
  }

  // ── résolution
  const N = index.size
  const p = new Float64Array(N)
  const adj: El[][] = Array.from({ length: N }, () => [])
  for (const e of els) for (const n of new Set(e.nodes)) adj[n].push(e)
  const net = (i: number, pi: number): number => {
    p[i] = pi
    let sum = 0
    for (const e of adj[i]) {
      const o = e.out(p)
      e.nodes.forEach((n, k) => { if (n === i) sum += o[k] })
    }
    return sum
  }
  for (let sweep = 0; sweep < 600; sweep++) {
    let moved = 0
    for (let i = 0; i < N; i++) {
      if (tank.has(i) || !adj[i].length) { p[i] = 0; continue }
      const before = p[i]
      let v: number
      if (net(i, 0) >= -1e-9) v = 0
      else if (net(i, PMAX) <= 0) v = PMAX
      else {
        let lo = 0, hi = PMAX
        for (let it = 0; it < 28; it++) { const mid = (lo + hi) / 2; if (net(i, mid) > 0) hi = mid; else lo = mid }
        v = (lo + hi) / 2
      }
      moved = Math.max(moved, Math.abs(v - before))
      p[i] = v
    }
    if (moved < 0.004) break
  }

  // ── résultats
  const out: HydOut = { bar: (symId, portId) => { const k = uf.find(key(symId, portId)); return index.has(k) ? p[index.get(k)!] : undefined }, cylX: {}, cylV: {}, rpm: {}, dir: {}, info: {} }
  const fmt = (v: number, d = 1) => (Math.round(v * 10 ** d) / 10 ** d).toString().replace('.', ',')
  for (const e of els) {
    const o = e.out(p)
    const q = o[0]
    if (e.kind === 'pump') out.info[e.sym] = `Q = ${fmt(-q)} L/min`
    else if (e.kind === 'relief') out.info[e.sym] = q > 0.15 ? `ouvert · ${fmt(q)} L/min` : 'fermé'
    else if (e.kind === 'prop') out.info[e.sym] = 'joystick ' + fmt(Math.abs(dflt(doc.symbols.find((x) => x.id === e.sym)?.rated?.joy, 0)), 0) + ' %'
    else if (e.kind === 'throttle' || e.kind === 'meter') out.info[e.sym] = `Q = ${fmt(Math.abs(q))} L/min`
    else if (e.kind === 'motor') {
      const rpm = (Math.abs(q) * 1000) / (meta[e.sym]?.Vd ?? 100)
      out.rpm[e.sym] = rpm
      out.dir[e.sym] = q >= 0 ? 1 : -1
      out.info[e.sym] = `n = ${fmt(rpm, 0)} tr/min`
    } else if (e.kind === 'cyl') {
      const m = meta[e.sym]
      out.cylX[e.sym] = q
      const v = ((q * 1000) / 60) / (m?.Aca ?? 19.6)
      out.cylV[e.sym] = v
      out.info[e.sym] = Math.abs(v) > 0.05 ? `v = ${fmt(Math.abs(v))} cm/s` : ''
    }
  }
  for (const s of hydSyms) {
    const f = defs[s.defId].fluid
    if (f?.k === 'fgauge' && f.ports[0]) { const v = out.bar(s.id, f.ports[0]); if (v !== undefined) out.info[s.id] = `${fmt(v, 0)} bar` }
  }
  return out
}

/** Pression indiquée par un symbole : valeur nominale d'un réglage, pour les notices. */
export const dfltRatings = (s: PlacedSymbol): Ratings => s.rated ?? {}
