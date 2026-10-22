import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { effectiveTerms } from './terminals'
import { routeAll } from './routing'
import type { Doc, Lang, PlacedSymbol, PortRef } from './types'
import { SYMBOL_MAP } from './symbols'
import {
  GRID, PAPER_SIZE, UNIT_MM, pointsAttr, portPos, route, routeVia, routeOpen, bestInsertIndex, rotCenter, snap, symBBox, uid,
} from './geometry'
import Sheet from './Sheet'
import { isOperable, type SimResult } from './sim/engine'
import type { SimModel } from './types'

/** Variables CSS --b{n} : rotation de chaque lame de contact selon l'état simulé (la transition CSS anime le mouvement). */
function bladeVars(id: string, model: SimModel | undefined, sim: SimResult | null): React.CSSProperties | undefined {
  if (!sim || model?.k !== 'switch' || !model.blades) return undefined
  const actuated = sim.closed[id]
  // état conducteur : un inverseur est « fermé » côté travail quand il est actionné ; un contact simple selon sa nature (NO/NF)
  const conducting = model.changeover?.length ? actuated : model.nc ? !actuated : actuated
  const vars: Record<string, string> = {}
  model.blades.forEach((b, n) => {
    vars['--b' + n] = (conducting === b.closed ? 0 : b.rot) + 'deg'
  })
  return vars as React.CSSProperties
}

/** Rotor : trois pales qui tournent dans le cercle du moteur. */
function Rotor({ cx, cy, r }: { cx: number; cy: number; r: number }) {
  const R = r * 0.78
  return (
    <g transform={`translate(${cx} ${cy})`} pointerEvents="none">
      <circle r={R + 1} fill="#fff" fillOpacity={0.82} stroke="none" />
      <g stroke="#1f8f3a" strokeWidth={1.8} strokeLinecap="round" fill="none">
        <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="0.8s" repeatCount="indefinite" />
        <path d={`M0 0L${R} 0M0 0L${-R / 2} ${R * 0.866}M0 0L${-R / 2} ${-R * 0.866}`} />
        <circle r={R} strokeOpacity={0.35} strokeWidth={1} />
      </g>
      <circle r={1.8} fill="#1f8f3a" stroke="none" />
    </g>
  )
}

const POT_COLOR: Record<string, string> = {
  L: '#d62728', L1: '#d62728', L2: '#e67e00', L3: '#2e9b2e', N: '#1f5fd1', '+': '#d62728', '-': '#1f5fd1',
}
const SECONDARY_COLORS = ['#8e24aa', '#00897b', '#6d4c41', '#ef6c00', '#3949ab', '#7cb342']
/** Couleur d'un fil selon son potentiel : réseau, source continue, ou n-ième borne du secondaire d'un transformateur. */
function potColor(pot: string): string {
  if (POT_COLOR[pot]) return POT_COLOR[pot]
  if (pot.startsWith('~')) return SECONDARY_COLORS[Number(pot.split(':')[1]) % SECONDARY_COLORS.length] ?? '#8e24aa'
  return '#d62728'
}
const GLOW: Record<string, string> = { lamp: '#ffd400', motor: '#35c759', valve: '#35c759', buzzer: '#ff9f0a', heater: '#ff6b35', coil: '#35c759' }

interface Props {
  doc: Doc
  lang: Lang
  sel: string[]
  setSel: (s: string[]) => void
  placing: string | null
  setPlacing: (id: string | null) => void
  commit: (fn: (d: Doc) => Doc) => void
  update: (fn: (d: Doc) => Doc) => void
  checkpoint: () => void
  contentRef: RefObject<SVGGElement>
  nextLabel: (doc: Doc, defId: string) => string
  onPlaced: (defId: string) => void
  /** borne mise en évidence (saisie d'un repère dans le panneau) */
  highlight?: { symId: string; portId: string } | null
  /** tracé d'un conducteur en cours (pour l'aide affichée) */
  onWiring?: (on: boolean) => void
  onContext: (x: number, y: number, target: string | null) => void
  /** simulation en cours (null : mode édition) */
  sim: SimResult | null
  onSimPress: (id: string, down: boolean) => void
  onSimToggle: (id: string) => void
  labels: { zoomIn: string; zoomOut: string; fit: string }
}

type Pt = { x: number; y: number }
type Wiring = { from: PortRef; via: Pt[] }

type Interaction =
  | { kind: 'none' }
  | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number; btn: number; target: string | null }
  | { kind: 'drag'; sx: number; sy: number; orig: Record<string, { x: number; y: number }>; vias: Record<string, Pt[]>; moved: boolean }
  | { kind: 'band'; x0: number; y0: number; add: boolean }
  | { kind: 'handle'; wireId: string; idx: number; moved: boolean; mid: boolean }

const portKey = (r: PortRef) => `${r.symId}:${r.portId}`

/** Alignements exacts (centres et bornes) entre symboles déplacés et les autres. */
function alignGuides(moving: PlacedSymbol[], others: PlacedSymbol[]) {
  const feat = (s: PlacedSymbol) => {
    const b = symBBox(s)
    const ps = SYMBOL_MAP[s.defId].ports.map((pt) => portPos(s, pt.id)!)
    return { xs: [(b.x1 + b.x2) / 2, ...ps.map((q) => q.x)], ys: [(b.y1 + b.y2) / 2, ...ps.map((q) => q.y)] }
  }
  const o = others.map(feat)
  const v = new Set<number>()
  const h = new Set<number>()
  for (const m of moving.map(feat)) {
    for (const x of m.xs) if (o.some((f) => f.xs.includes(x))) v.add(x)
    for (const y of m.ys) if (o.some((f) => f.ys.includes(y))) h.add(y)
  }
  return { v: [...v], h: [...h] }
}

export default function Canvas(p: Props) {
  const { doc, sel } = p
  const svgRef = useRef<SVGSVGElement>(null)
  const [view, setView] = useState({ x: 20, y: 20, k: 0.8 })
  const fit = (paper = doc.paper) => {
    const r = svgRef.current!.getBoundingClientRect()
    const s = PAPER_SIZE[paper]
    const k = Math.min((r.width - 40) / s.w, (r.height - 40) / s.h)
    setView({ k, x: (r.width - s.w * k) / 2, y: (r.height - s.h * k) / 2 })
  }
  const [mouse, setMouse] = useState({ x: 0, y: 0 })
  const [band, setBand] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const [hoverPort, setHoverPort] = useState<string | null>(null)
  const [guides, setGuides] = useState<{ v: number[]; h: number[] }>({ v: [], h: [] })
  const inter = useRef<Interaction>({ kind: 'none' })
  const [wiring, setWiringState] = useState<Wiring | null>(null)
  const wiringRef = useRef<Wiring | null>(null)
  const setWiring = (w: Wiring | null) => {
    wiringRef.current = w
    setWiringState(w)
    p.onWiring?.(!!w)
  }
  const space = useRef(false)
  const held = useRef<string | null>(null) // bouton-poussoir maintenu appuyé en simulation
  const [rot, setRot] = useState<0 | 90 | 180 | 270>(0)
  const fitRef = useRef<() => void>(() => {})
  const placingRef = useRef<string | null>(null)
  placingRef.current = p.placing

  const { w, h } = PAPER_SIZE[doc.paper]
  fitRef.current = () => fit()
  useEffect(() => { fit() }, [doc.paper])
  const symById = (id: string) => doc.symbols.find((s) => s.id === id)
  // repères de bornes affichés d'office : numérotation automatique, unique au sein d'un même appareil
  const terms = useMemo(() => effectiveTerms(doc.symbols, SYMBOL_MAP), [doc.symbols])
  // tracé de tous les conducteurs, séparés en couloirs quand ils se superposeraient
  const routes = useMemo(() => routeAll(doc.wires, doc.symbols), [doc.wires, doc.symbols])

  const toSheet = (e: { clientX: number; clientY: number }) => {
    const r = svgRef.current!.getBoundingClientRect()
    return { x: (e.clientX - r.left - view.x) / view.k, y: (e.clientY - r.top - view.y) / view.k }
  }

  // Zoom molette centré sur le curseur
  useEffect(() => {
    const el = svgRef.current!
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      const mx = e.clientX - r.left
      const my = e.clientY - r.top
      setView((v) => {
        const k = Math.min(4, Math.max(0.1, v.k * (e.deltaY < 0 ? 1.12 : 1 / 1.12)))
        return { k, x: mx - ((mx - v.x) / v.k) * k, y: my - ((my - v.y) / v.k) * k }
      })
    }
    const down = (e: KeyboardEvent) => {
      if (e.key === 'f' && !e.ctrlKey && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLSelectElement)) fitRef.current()
      if (e.key === 'Escape') { inter.current = { kind: 'none' }; setWiring(null); setBand(null); setRot(0) }
      if (e.key === 'Backspace' && wiringRef.current && wiringRef.current.via.length && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault()
        setWiring({ ...wiringRef.current, via: wiringRef.current.via.slice(0, -1) })
      }
      if (e.key.toLowerCase() === 'r' && !e.ctrlKey && placingRef.current && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) setRot((r) => (((r + 90) % 360) as 0 | 90 | 180 | 270))
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        space.current = true
        e.preventDefault()
      }
    }
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') space.current = false
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    fitRef.current()
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      el.removeEventListener('wheel', onWheel)
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  const portUnder = (target: EventTarget | null): PortRef | null => {
    const el = (target as Element | null)?.closest?.('[data-port]')
    if (!el) return null
    const [symId, portId] = el.getAttribute('data-port')!.split(':')
    return { symId, portId }
  }

  const onMouseDown = (e: React.MouseEvent) => {
    const pt = toSheet(e)
    if (e.button === 2 && wiringRef.current) {
      setWiring(null)
      e.preventDefault()
      return
    }
    if (e.button === 1 || e.button === 2 || space.current) {
      const hit = (e.target as Element).closest('[data-sym],[data-wire]')
      const target = hit ? (hit.getAttribute('data-sym') ?? hit.getAttribute('data-wire')) : null
      inter.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, btn: e.button, target }
      e.preventDefault()
      return
    }
    if (e.button !== 0) return
    if (p.sim) {
      // simulation : on manœuvre les organes de commande, on ne modifie pas le schéma
      const el = (e.target as Element).closest('[data-sym]')
      const s = el ? doc.symbols.find((x) => x.id === el.getAttribute('data-sym')) : undefined
      const kind = s ? isOperable(SYMBOL_MAP[s.defId].sim) : null
      if (s && kind === 'momentary') { held.current = s.id; p.onSimPress(s.id, true) }
      else if (s && kind === 'toggle') p.onSimToggle(s.id)
      return
    }
    if (wiringRef.current) return // tracé en cours : le coude ou la borne d'arrivée est pris au relâchement
    if (p.placing) {
      const def = SYMBOL_MAP[p.placing]
      const sym: PlacedSymbol = {
        id: uid(), defId: def.id, rot, desc: '',
        x: snap(pt.x - def.w / 2), y: snap(pt.y - def.h / 2),
        label: p.nextLabel(doc, def.id),
      }
      p.commit((d) => ({ ...d, symbols: [...d.symbols, sym] }))
      p.onPlaced(def.id)
      return
    }
    const handleEl = (e.target as Element).closest('[data-handle]')
    if (handleEl) {
      const [wireId, idx, kind] = handleEl.getAttribute('data-handle')!.split('|')
      inter.current = { kind: 'handle', wireId, idx: Number(idx), moved: false, mid: kind === 'mid' }
      return
    }
    const port = portUnder(e.target)
    if (port) {
      p.setSel([]) // la sélection ne doit pas être touchée par Retour arrière/Suppr pendant le tracé
      setWiring({ from: port, via: [] })
      return
    }
    const symEl = (e.target as Element).closest('[data-sym]')
    if (symEl) {
      const id = symEl.getAttribute('data-sym')!
      let ids = sel
      if (e.shiftKey) ids = sel.includes(id) ? sel.filter((s) => s !== id) : [...sel, id]
      else if (!sel.includes(id)) ids = [id]
      p.setSel(ids)
      const orig: Record<string, { x: number; y: number }> = {}
      for (const s of doc.symbols) if (ids.includes(s.id)) orig[s.id] = { x: s.x, y: s.y }
      const vias: Record<string, Pt[]> = {}
      for (const w of doc.wires) if (w.via?.length && orig[w.from.symId] && orig[w.to.symId]) vias[w.id] = w.via
      inter.current = { kind: 'drag', sx: pt.x, sy: pt.y, orig, vias, moved: false }
      return
    }
    const wireEl = (e.target as Element).closest('[data-wire]')
    if (wireEl) {
      const id = wireEl.getAttribute('data-wire')!
      p.setSel(e.shiftKey ? (sel.includes(id) ? sel.filter((s) => s !== id) : [...sel, id]) : [id])
      return
    }
    if (!e.shiftKey) p.setSel([])
    inter.current = { kind: 'band', x0: pt.x, y0: pt.y, add: e.shiftKey }
    setBand({ x0: pt.x, y0: pt.y, x1: pt.x, y1: pt.y })
  }

  const onMouseMove = (e: React.MouseEvent) => {
    const pt = toSheet(e)
    setMouse(pt)
    const it = inter.current
    if (it.kind === 'pan') {
      setView((v) => ({ ...v, x: it.vx + e.clientX - it.sx, y: it.vy + e.clientY - it.sy }))
    } else if (it.kind === 'drag') {
      const dx = snap(pt.x - it.sx)
      const dy = snap(pt.y - it.sy)
      if (!it.moved && (dx !== 0 || dy !== 0)) {
        it.moved = true
        p.checkpoint()
      }
      if (it.moved) {
        const moved = doc.symbols.filter((s) => it.orig[s.id]).map((s) => ({ ...s, x: it.orig[s.id].x + dx, y: it.orig[s.id].y + dy }))
        setGuides(alignGuides(moved, doc.symbols.filter((s) => !it.orig[s.id])))
        p.update((d) => ({
          ...d,
          symbols: d.symbols.map((s) => (it.orig[s.id] ? { ...s, x: it.orig[s.id].x + dx, y: it.orig[s.id].y + dy } : s)),
          wires: d.wires.map((w) => (it.vias[w.id] ? { ...w, via: it.vias[w.id].map((v) => ({ x: v.x + dx, y: v.y + dy })) } : w)),
        }))
      }
    } else if (it.kind === 'handle') {
      const wr = doc.wires.find((w) => w.id === it.wireId)
      const a = wr && symById(wr.from.symId)
      const b = wr && symById(wr.to.symId)
      const pa = a && wr && portPos(a, wr.from.portId)
      const pb = b && wr && portPos(b, wr.to.portId)
      if (!wr || !pa || !pb) return
      const q = { x: snap(pt.x), y: snap(pt.y) }
      const via = wr.via ?? []
      const setVia = (next: Pt[]) => p.update((d) => ({ ...d, wires: d.wires.map((w) => (w.id === it.wireId ? { ...w, via: next } : w)) }))
      if (it.mid) {
        // poignée du milieu d'un segment : on crée un nouveau coude, puis on le fait glisser
        const j = bestInsertIndex(pa, pb, via, q)
        p.checkpoint()
        it.moved = true
        it.mid = false
        it.idx = j
        setVia([...via.slice(0, j), q, ...via.slice(j)])
      } else if (via[it.idx] && (via[it.idx].x !== q.x || via[it.idx].y !== q.y)) {
        if (!it.moved) p.checkpoint()
        it.moved = true
        setVia(via.map((v, i) => (i === it.idx ? q : v)))
      }
    } else if (it.kind === 'band') {
      setBand({ x0: it.x0, y0: it.y0, x1: pt.x, y1: pt.y })
    }
  }

  const onMouseUp = (e: React.MouseEvent) => {
    const it = inter.current
    if (held.current) { p.onSimPress(held.current, false); held.current = null }
    setGuides((g) => (g.v.length || g.h.length ? { v: [], h: [] } : g))
    if (it.kind === 'pan' && it.btn === 2 && Math.hypot(e.clientX - it.sx, e.clientY - it.sy) < 4) {
      if (it.target && !sel.includes(it.target)) p.setSel([it.target])
      else if (!it.target) p.setSel([])
      p.onContext(e.clientX, e.clientY, it.target)
    }
    const w = wiringRef.current
    if (w && e.button === 0 && !p.sim) {
      const target = portUnder(e.target)
      if (target && portKey(target) === portKey(w.from)) {
        // clic sur la borne de départ : le tracé reste en cours, on clique ensuite les coudes puis la borne d'arrivée
      } else if (target) {
        const exists = doc.wires.some(
          (wr) =>
            (portKey(wr.from) === portKey(w.from) && portKey(wr.to) === portKey(target)) ||
            (portKey(wr.to) === portKey(w.from) && portKey(wr.from) === portKey(target)),
        )
        if (!exists) {
          p.commit((d) => ({
            ...d,
            wires: [...d.wires, { id: uid(), from: w.from, to: target, label: '', color: '#000000', section: '', ...(w.via.length ? { via: w.via } : {}) }],
          }))
        }
        setWiring(null)
      } else {
        // relâché sur le vide : coude imposé à cet endroit, le tracé continue
        const pt = toSheet(e)
        const q = { x: snap(pt.x), y: snap(pt.y) }
        const last = w.via[w.via.length - 1]
        if (!last || last.x !== q.x || last.y !== q.y) setWiring({ ...w, via: [...w.via, q] })
      }
    } else if (it.kind === 'band' && band) {
      const x1 = Math.min(band.x0, band.x1), x2 = Math.max(band.x0, band.x1)
      const y1 = Math.min(band.y0, band.y1), y2 = Math.max(band.y0, band.y1)
      const hit = doc.symbols
        .filter((s) => {
          const b = symBBox(s)
          return b.x1 >= x1 && b.x2 <= x2 && b.y1 >= y1 && b.y2 <= y2
        })
        .map((s) => s.id)
      p.setSel(it.add ? Array.from(new Set([...sel, ...hit])) : hit)
      setBand(null)
    }
    inter.current = { kind: 'none' }
  }

  const connected = new Set<string>()
  for (const wr of doc.wires) {
    connected.add(portKey(wr.from))
    connected.add(portKey(wr.to))
  }

  const ghost = p.placing ? SYMBOL_MAP[p.placing] : null

  const onDrop = (e: React.DragEvent) => {
    const id = e.dataTransfer.getData('text/x-albert-symbol')
    const def = SYMBOL_MAP[id]
    if (!def) return
    e.preventDefault()
    const pt = toSheet(e)
    const sym: PlacedSymbol = { id: uid(), defId: id, rot: 0, desc: '', x: snap(pt.x - def.w / 2), y: snap(pt.y - def.h / 2), label: p.nextLabel(doc, id) }
    p.commit((d) => ({ ...d, symbols: [...d.symbols, sym] }))
    p.setSel([sym.id])
    p.onPlaced(id)
  }
  const zoomBy = (f: number) => {
    const r = svgRef.current!.getBoundingClientRect()
    const mx = r.width / 2, my = r.height / 2
    setView((v) => { const k = Math.min(4, Math.max(0.1, v.k * f)); return { k, x: mx - ((mx - v.x) / v.k) * k, y: my - ((my - v.y) / v.k) * k } })
  }

  return (
    <>
    <svg
      ref={svgRef}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('text/x-albert-symbol')) e.preventDefault() }}
      onDrop={onDrop}
      className={'canvas' + (p.placing ? ' placing' : '') + (wiring ? ' wiring' : '') + (p.sim ? ' simulating' : '')}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={() => { inter.current = { kind: 'none' }; setBand(null); if (held.current) { p.onSimPress(held.current, false); held.current = null } }}
      onContextMenu={(e) => e.preventDefault()}
      onDoubleClick={(e) => {
        const el = (e.target as Element).closest('[data-handle]')
        if (!el || p.sim) return
        const [wireId, idx, kind] = el.getAttribute('data-handle')!.split('|')
        if (kind !== 'via') return
        p.commit((d) => ({ ...d, wires: d.wires.map((w) => (w.id === wireId ? { ...w, via: (w.via ?? []).filter((_, i) => i !== Number(idx)) } : w)) }))
      }}
    >
      <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
        <rect x={-4} y={-4} width={w + 8} height={h + 8} fill="#000" opacity={0.12} />
        <g ref={p.contentRef} color="#000" stroke="currentColor" fill="none" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" fontFamily="Arial, sans-serif">
          <Sheet paper={doc.paper} title={doc.title} lang={p.lang} />
          {doc.wires.map((wr) => {
            const a = symById(wr.from.symId), b = symById(wr.to.symId)
            if (!a || !b) return null
            const pa = portPos(a, wr.from.portId), pb = portPos(b, wr.to.portId)
            if (!pa || !pb) return null
            const pts = routes[wr.id] ?? routeVia(pa, pb, wr.via ?? [])
            const m = pts[Math.floor(pts.length / 2)]
            const n = pts[Math.floor(pts.length / 2) - 1] ?? m
            const mx = (m.x + n.x) / 2, my = (m.y + n.y) / 2
            const txt = [wr.label, wr.section && wr.section + ' mm²'].filter(Boolean).join(' ')
            const pot = p.sim ? p.sim.potentialOf[`${wr.from.symId}:${wr.from.portId}`] : null
            const stroke = p.sim ? (pot ? potColor(pot) : '#9aa0a8') : wr.color
            return (
              <g key={wr.id}>
                <polyline points={pointsAttr(pts)} stroke={stroke} strokeWidth={p.sim && pot ? 2.2 : 1.6} />
                {p.sim?.current[wr.id] && (
                  <polyline points={pointsAttr(pts)} stroke="#fff" strokeOpacity={0.95} strokeWidth={1.3} strokeDasharray="2 6" strokeLinecap="butt">
                    <animate attributeName="stroke-dashoffset" from="0" to={p.sim.current[wr.id] > 0 ? '-8' : '8'} dur="0.45s" repeatCount="indefinite" />
                  </polyline>
                )}
                {txt && <text x={mx + 4} y={my - 4} fontSize={7} fill={wr.color} stroke="none">{txt}</text>}
              </g>
            )
          })}
          {doc.symbols.map((s) => {
            const def = SYMBOL_MAP[s.defId]
            const { cx, cy } = rotCenter(def)
            const b = symBBox(s)
            const model = def.sim
            const lit = p.sim?.energized.has(s.id)
            const closedState = p.sim && model?.k === 'switch' && model.ctl !== 'fixed'
              ? (model.changeover?.length ? p.sim.closed[s.id] : model.nc ? !p.sim.closed[s.id] : p.sim.closed[s.id]) // contact conducteur
              : undefined
            return (
              <g key={s.id}>
                {lit && model && (model.k === 'coil' || model.k === 'load' || model.k === 'transformer') && (() => {
                  const bad = !!p.sim?.badVoltage[s.id]
                  const col = bad ? '#e53935' : model.k === 'transformer' ? '#7e57c2' : GLOW[model.k === 'coil' ? 'coil' : model.role]
                  return (
                    <rect x={b.x1 - 3} y={b.y1 - 3} width={b.x2 - b.x1 + 6} height={b.y2 - b.y1 + 6} rx={6} fill={col} fillOpacity={bad ? 0.3 : 0.4} stroke={col} strokeWidth={bad ? 2 : 1.2} strokeDasharray={bad ? '4 2' : undefined} />
                  )
                })()}
                {closedState !== undefined && (
                  <circle cx={b.x2 + 4} cy={b.y1 + 4} r={3} fill={closedState ? '#35c759' : '#fff'} stroke={closedState ? '#1f8f3a' : '#888'} strokeWidth={0.8} />
                )}
                <g transform={`translate(${s.x} ${s.y}) rotate(${s.rot} ${cx} ${cy})`} style={bladeVars(s.id, model, p.sim)}>
                  <g dangerouslySetInnerHTML={{ __html: def.svg.replace(/var\(--bg\)/g, '#fff') }} />
                  {lit && model?.k === 'load' && model.spin && <Rotor {...model.spin} />}
                </g>
                {def.ports.map((pt) => {
                  const text = terms[s.id]?.[pt.id] ?? pt.label
                  if (!text) return null
                  const pos = portPos(s, pt.id)!
                  const off = { up: [4, -3], down: [4, 9], left: [-4, -3], right: [4, -3] }[pos.dir]
                  return <text key={pt.id} x={pos.x + off[0]} y={pos.y + off[1]} fontSize={6} fill="currentColor" stroke="none" textAnchor={pos.dir === 'left' ? 'end' : 'start'}>{text}</text>
                })}
                {s.label && <text x={b.x2 + 6} y={(b.y1 + b.y2) / 2} fontSize={10} fontWeight={700} fill="currentColor" stroke="none">{s.label}</text>}
                {s.desc && <text x={b.x2 + 6} y={(b.y1 + b.y2) / 2 + 10} fontSize={7} fill="currentColor" stroke="none">{s.desc}</text>}
              </g>
            )
          })}
        </g>

        {/* Couche interface : hors export */}
        <g className="ui">
          {doc.wires.map((wr) => {
            const a = symById(wr.from.symId), b = symById(wr.to.symId)
            if (!a || !b) return null
            const pa = portPos(a, wr.from.portId), pb = portPos(b, wr.to.portId)
            if (!pa || !pb) return null
            const routed = routes[wr.id] ?? routeVia(pa, pb, wr.via ?? [])
            const pts = pointsAttr(routed)
            const handles = !p.sim && sel.length === 1 && sel[0] === wr.id
            return (
              <g key={wr.id} data-wire={wr.id} className="wire-hit">
                {sel.includes(wr.id) && <polyline points={pts} className="sel-wire" />}
                <polyline points={pts} className="hit" />
                {handles && (
                  <>
                    {routed.slice(0, -1).map((q, i) => {
                      const r = routed[i + 1]
                      const len = Math.abs(r.x - q.x) + Math.abs(r.y - q.y)
                      if (len < 30) return null // amorces près des bornes : pas de poignée
                      return <circle key={'m' + i} data-handle={`${wr.id}|${i}|mid`} cx={(q.x + r.x) / 2} cy={(q.y + r.y) / 2} r={3.5} className="mid-handle" />
                    })}
                    {(wr.via ?? []).map((v, i) => (
                      <rect key={'v' + i} data-handle={`${wr.id}|${i}|via`} x={v.x - 4} y={v.y - 4} width={8} height={8} className="via-handle" />
                    ))}
                  </>
                )}
              </g>
            )
          })}
          {doc.symbols.map((s) => {
            const def = SYMBOL_MAP[s.defId]
            const b = symBBox(s)
            const on = !p.sim && sel.includes(s.id)
            const op = p.sim && isOperable(def.sim)
            return (
              <g key={s.id} data-sym={s.id} className="sym-hit">
                <rect x={b.x1 - 4} y={b.y1 - 4} width={b.x2 - b.x1 + 8} height={b.y2 - b.y1 + 8} className={on ? 'sel-box' : 'hit-box' + (op ? ' op' : '')} />
                {def.ports.map((pt) => {
                  const pos = portPos(s, pt.id)!
                  const key = `${s.id}:${pt.id}`
                  return (
                    <circle key={pt.id} data-port={key} cx={pos.x} cy={pos.y} r={5}
                      className={'port' + (connected.has(key) ? ' used' : '') + (hoverPort === key ? ' hot' : '')}
                      onMouseEnter={() => setHoverPort(key)} onMouseLeave={() => setHoverPort(null)} />
                  )
                })}
              </g>
            )
          })}
          {p.highlight && (() => {
            const s = symById(p.highlight.symId)
            const pos = s && portPos(s, p.highlight.portId)
            return pos ? <circle cx={pos.x} cy={pos.y} r={8} className="port-ring" /> : null
          })()}
          {p.sim?.shorts.flatMap((sh) => sh.ports).map((k) => {
            const [sid, pid] = k.split(':')
            const s = symById(sid)
            const pos = s && portPos(s, pid)
            return pos ? <circle key={'short' + k} cx={pos.x} cy={pos.y} r={7} className="short" /> : null
          })}
          {wiring && (() => {
            const a = symById(wiring.from.symId)
            const pa = a && portPos(a, wiring.from.portId)
            if (!pa) return null
            const pts = routeOpen(pa, wiring.via, { x: snap(mouse.x), y: snap(mouse.y) })
            return (
              <>
                <polyline points={pointsAttr(pts)} className="preview" />
                {wiring.via.map((v, i) => <rect key={i} x={v.x - 3} y={v.y - 3} width={6} height={6} className="via-dot" />)}
              </>
            )
          })()}
          {ghost && (
            <g opacity={0.5} pointerEvents="none" color="#06c" stroke="currentColor" fill="none" strokeWidth={2}
              transform={`translate(${snap(mouse.x - ghost.w / 2)} ${snap(mouse.y - ghost.h / 2)}) rotate(${rot} ${rotCenter(ghost).cx} ${rotCenter(ghost).cy})`}
              dangerouslySetInnerHTML={{ __html: ghost.svg.replace(/var\(--bg\)/g, '#fff') }} />
          )}
          {guides.v.map((x) => <path key={'v' + x} d={`M${x} 0V${h}`} className="guide" />)}
          {guides.h.map((y) => <path key={'h' + y} d={`M0 ${y}H${w}`} className="guide" />)}
          {band && (
            <rect className="band" x={Math.min(band.x0, band.x1)} y={Math.min(band.y0, band.y1)}
              width={Math.abs(band.x1 - band.x0)} height={Math.abs(band.y1 - band.y0)} />
          )}
        </g>
      </g>
    </svg>
    <div className="zoombar">
      <button onClick={() => zoomBy(1 / 1.25)} title={p.labels.zoomOut} aria-label={p.labels.zoomOut}>−</button>
      <span>{Math.round(view.k * 100)} %</span>
      <button onClick={() => zoomBy(1.25)} title={p.labels.zoomIn} aria-label={p.labels.zoomIn}>+</button>
      <button onClick={() => fit()} title={p.labels.fit} aria-label={p.labels.fit}>⤢</button>
    </div>
    <div className="coords">{Math.round(mouse.x * UNIT_MM)} , {Math.round(mouse.y * UNIT_MM)} mm</div>
    </>
  )
}
