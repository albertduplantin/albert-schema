import { useEffect, useRef, useState, type RefObject } from 'react'
import type { Doc, Lang, PlacedSymbol, PortRef } from './types'
import { SYMBOL_MAP } from './symbols'
import {
  GRID, PAPER_SIZE, UNIT_MM, pointsAttr, portPos, route, rotCenter, snap, symBBox, uid,
} from './geometry'
import Sheet from './Sheet'

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
  onContext: (x: number, y: number, target: string | null) => void
  labels: { zoomIn: string; zoomOut: string; fit: string }
}

type Interaction =
  | { kind: 'none' }
  | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number; btn: number; target: string | null }
  | { kind: 'drag'; sx: number; sy: number; orig: Record<string, { x: number; y: number }>; moved: boolean }
  | { kind: 'band'; x0: number; y0: number; add: boolean }
  | { kind: 'wire'; from: PortRef }

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
  const [wiring, setWiring] = useState<PortRef | null>(null)
  const space = useRef(false)
  const [rot, setRot] = useState<0 | 90 | 180 | 270>(0)
  const fitRef = useRef<() => void>(() => {})
  const placingRef = useRef<string | null>(null)
  placingRef.current = p.placing

  const { w, h } = PAPER_SIZE[doc.paper]
  fitRef.current = () => fit()
  useEffect(() => { fit() }, [doc.paper])
  const symById = (id: string) => doc.symbols.find((s) => s.id === id)

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
    if (e.button === 1 || e.button === 2 || space.current) {
      const hit = (e.target as Element).closest('[data-sym],[data-wire]')
      const target = hit ? (hit.getAttribute('data-sym') ?? hit.getAttribute('data-wire')) : null
      inter.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, btn: e.button, target }
      e.preventDefault()
      return
    }
    if (e.button !== 0) return
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
    const port = portUnder(e.target)
    if (port) {
      inter.current = { kind: 'wire', from: port }
      setWiring(port)
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
      inter.current = { kind: 'drag', sx: pt.x, sy: pt.y, orig, moved: false }
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
        }))
      }
    } else if (it.kind === 'band') {
      setBand({ x0: it.x0, y0: it.y0, x1: pt.x, y1: pt.y })
    }
  }

  const onMouseUp = (e: React.MouseEvent) => {
    const it = inter.current
    setGuides((g) => (g.v.length || g.h.length ? { v: [], h: [] } : g))
    if (it.kind === 'pan' && it.btn === 2 && Math.hypot(e.clientX - it.sx, e.clientY - it.sy) < 4) {
      if (it.target && !sel.includes(it.target)) p.setSel([it.target])
      else if (!it.target) p.setSel([])
      p.onContext(e.clientX, e.clientY, it.target)
    }
    if (it.kind === 'wire') {
      const target = portUnder(e.target)
      if (target && portKey(target) !== portKey(it.from)) {
        const exists = doc.wires.some(
          (wr) =>
            (portKey(wr.from) === portKey(it.from) && portKey(wr.to) === portKey(target)) ||
            (portKey(wr.to) === portKey(it.from) && portKey(wr.from) === portKey(target)),
        )
        if (!exists) {
          p.commit((d) => ({
            ...d,
            wires: [...d.wires, { id: uid(), from: it.from, to: target, label: '', color: '#000000', section: '' }],
          }))
        }
      }
      setWiring(null)
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
      className={'canvas' + (p.placing ? ' placing' : '') + (wiring ? ' wiring' : '')}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={() => { inter.current = { kind: 'none' }; setWiring(null); setBand(null) }}
      onContextMenu={(e) => e.preventDefault()}
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
            const pts = route(pa, pb)
            const m = pts[Math.floor(pts.length / 2)]
            const n = pts[Math.floor(pts.length / 2) - 1] ?? m
            const mx = (m.x + n.x) / 2, my = (m.y + n.y) / 2
            const txt = [wr.label, wr.section && wr.section + ' mm²'].filter(Boolean).join(' ')
            return (
              <g key={wr.id}>
                <polyline points={pointsAttr(pts)} stroke={wr.color} strokeWidth={1.6} />
                {txt && <text x={mx + 4} y={my - 4} fontSize={7} fill={wr.color} stroke="none">{txt}</text>}
              </g>
            )
          })}
          {doc.symbols.map((s) => {
            const def = SYMBOL_MAP[s.defId]
            const { cx, cy } = rotCenter(def)
            const b = symBBox(s)
            return (
              <g key={s.id}>
                <g transform={`translate(${s.x} ${s.y}) rotate(${s.rot} ${cx} ${cy})`} dangerouslySetInnerHTML={{ __html: def.svg.replace(/var\(--bg\)/g, '#fff') }} />
                {def.ports.map((pt) => {
                  if (!pt.label) return null
                  const pos = portPos(s, pt.id)!
                  const off = { up: [4, -3], down: [4, 9], left: [-4, -3], right: [4, -3] }[pos.dir]
                  return <text key={pt.id} x={pos.x + off[0]} y={pos.y + off[1]} fontSize={6} fill="currentColor" stroke="none" textAnchor={pos.dir === 'left' ? 'end' : 'start'}>{pt.label}</text>
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
            const pts = pointsAttr(route(pa, pb))
            return (
              <g key={wr.id} data-wire={wr.id} className="wire-hit">
                {sel.includes(wr.id) && <polyline points={pts} className="sel-wire" />}
                <polyline points={pts} className="hit" />
              </g>
            )
          })}
          {doc.symbols.map((s) => {
            const def = SYMBOL_MAP[s.defId]
            const b = symBBox(s)
            const on = sel.includes(s.id)
            return (
              <g key={s.id} data-sym={s.id} className="sym-hit">
                <rect x={b.x1 - 4} y={b.y1 - 4} width={b.x2 - b.x1 + 8} height={b.y2 - b.y1 + 8} className={on ? 'sel-box' : 'hit-box'} />
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
          {wiring && (() => {
            const a = symById(wiring.symId)
            const pa = a && portPos(a, wiring.portId)
            if (!pa) return null
            return <path d={`M${pa.x} ${pa.y}L${snap(mouse.x)} ${snap(mouse.y)}`} className="preview" />
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
