import { FluidShape } from './FluidShape'
import { isDynamic } from './symbols/fluidDraw'
import { kindOf } from './ratings'
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { termsWithTopology } from './transformer'
import { junctionPoints, routeAll } from './routing'
import { autoConnect } from './splice'
import { fontCss } from './fonts'
import InstrumentView from './InstrumentView'
import { jawPoint, pickAt, probesOf, readCurrent, readPressure, readSpeed, readVoltage, stepRange, type PickContext } from './instruments'
import { ShapeView, arcPath, dashArray, insideOf, polyPoints, resizeRotated, shapeBox, shapeHandles, snapTargets, snapTo, straighten } from './shapes'
import type { Doc, Instrument, Lang, PlacedSymbol, PortRef, Shape } from './types'
import { SYMBOL_MAP } from './symbols'
import {
  GRID, MARGIN, PAPER_SIZE, TB_H, TB_W, UNIT_MM, pointsAttr, portPos, route, routeVia, routeOpen, bestInsertIndex, rotCenter, snap, symBBox, uid,
} from './geometry'
import Sheet from './Sheet'
import { isSourceBlock, sourceCaption, sourcePots } from './sim/potentials'
import { devKey, isOperableDef, type SimResult } from './sim/engine'
import type { SimModel } from './types'
import { PLC_BLADE_ROT, PLC_GEOM } from './symbols/plc'

/** Texte sur plusieurs lignes : une ligne par retour à la ligne, alignées sur `x`. */
const lines = (t: string, x: number, lh: number) => t.split('\n').map((l, i) => <tspan key={i} x={x} dy={i === 0 ? 0 : lh}>{l || ' '}</tspan>)

/** Variables CSS --b{n} : rotation de chaque lame de contact selon l'état simulé (la transition CSS anime le mouvement). */
function bladeVars(id: string, model: SimModel | undefined, sim: SimResult | null): React.CSSProperties | undefined {
  if (sim && model?.k === 'plc') {
    // contacts de sortie de l'automate : la lame se ferme quand le programme commande la sortie
    const out = sim.plc[id]?.out
    const v: Record<string, string> = {}
    for (let i = 0; i < 8; i++) v['--b' + i] = (out?.[i] ? PLC_BLADE_ROT : 0) + 'deg'
    return v as React.CSSProperties
  }
  if (!sim || model?.k !== 'switch' || !model.blades) return undefined
  const actuated = sim.closed[id]
  // état conducteur : un inverseur est « fermé » côté travail quand il est actionné ; un contact simple selon sa nature (NO/NF)
  const conducting = model.changeover?.length ? actuated : model.nc ? !actuated : actuated
  const vars: Record<string, string> = { '--hs': actuated ? '1' : '0' }
  model.blades.forEach((b, n) => {
    vars['--b' + n] = (conducting === b.closed ? 0 : b.rot) + 'deg'
  })
  return vars as React.CSSProperties
}

/** Rotor : trois pales qui tournent dans le cercle du moteur. */
function Rotor({ cx, cy, r, dir = 1, dur = 0.8 }: { cx: number; cy: number; r: number; dir?: 1 | -1; dur?: number }) {
  const R = r * 0.78
  return (
    <g transform={`translate(${cx} ${cy})`} pointerEvents="none">
      <circle r={R + 1} fill="#fff" fillOpacity={0.82} stroke="none" />
      <g stroke="#1f8f3a" strokeWidth={1.8} strokeLinecap="round" fill="none">
        <animateTransform attributeName="transform" type="rotate" from={dir === 1 ? '0' : '360'} to={dir === 1 ? '360' : '0'} dur={`${dur}s`} repeatCount="indefinite" />
        <path d={`M0 0L${R} 0M0 0L${-R / 2} ${R * 0.866}M0 0L${-R / 2} ${-R * 0.866}`} />
        <circle r={R} strokeOpacity={0.35} strokeWidth={1} />
      </g>
      <circle r={1.8} fill="#1f8f3a" stroke="none" />
    </g>
  )
}

const POT_COLOR: Record<string, string> = {
  L: '#d62728', L1: '#d62728', L2: '#e67e00', L3: '#2e9b2e', N: '#1f5fd1', LI: '#d62728', NI: '#1f5fd1', '+': '#d62728', '-': '#1f5fd1',
  // fluide : pression (P), échappement (R), fuite (X)
  P: '#e53935', R: '#1e88e5', X: '#fb8c00',
}
const SECONDARY_COLORS = ['#8e24aa', '#00897b', '#6d4c41', '#ef6c00', '#3949ab', '#7cb342']
/** Couleur d'un fil selon son potentiel : réseau, source continue, ou n-ième borne du secondaire d'un transformateur. */
function potColor(potRaw: string): string {
  const pot = potRaw.split('@')[0]
  if (POT_COLOR[pot]) return POT_COLOR[pot]
  if (pot.startsWith('~')) return SECONDARY_COLORS[Number(pot.split(':')[1]) % SECONDARY_COLORS.length] ?? '#8e24aa'
  return '#d62728'
}
const GLOW: Record<string, string> = { lamp: '#ffd400', motor: '#35c759', valve: '#35c759', buzzer: '#ff9f0a', heater: '#ff6b35', brake: '#8e24aa', coil: '#35c759' }

interface Props {
  doc: Doc
  lang: Lang
  /** vitesse du temps simulé (× 0,5 à × 10) : accélère aussi les animations */
  simSpeed?: number
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
  /** réglage d'un limiteur de débit (ouverture, %) ou d'un limiteur / réducteur de pression (tarage, bar) pendant la simulation */
  onAdjust?: (id: string, key: 'open' | 'set' | 'torque' | 'load', delta: number) => void
  /** défauts injectés (fils coupés, appareils ouverts) et bascule d'un défaut */
  faults?: ReadonlySet<string>
  /** projet à plusieurs feuilles : symboles des autres feuilles, feuille de chaque symbole, et repère « n/N » de la feuille affichée */
  extra?: PlacedSymbol[]
  pageOf?: Record<string, number>
  sheetLabel?: string
  /** double-clic sur le cartouche */
  onEditTitle?: () => void
  /** double-clic sur un symbole : ouvre ses propriétés */
  onEditSymbol?: (id: string, x: number, y: number) => void
  /** double-clic sur un texte (annotation, nom de composant, repère) : édition sur place */
  onEditText?: (kind: 'note' | 'name' | 'label' | 'tag', id: string, x: number, y: number) => void
  onSimFault?: (id: string) => void
  /** outil de dessin actif (rectangle, ellipse, ligne), style des nouvelles formes, et fin de l'outil après le tracé */
  dark?: boolean
  tool?: Shape['kind'] | null
  /** détecteurs posés sur les vérins, par repère de vérin normalisé */
  detectors?: Record<string, { id: string; label: string; at: number; nc: boolean }[]>
  /** outil de mesure : deux clics donnent la distance et les écarts en mm (papier) */
  measure?: boolean
  toolStyle?: Partial<Shape>
  onToolDone?: () => void
  labels: { zoomIn: string; zoomOut: string; fit: string; grid: string }
}

type Pt = { x: number; y: number }
type Wiring = { from: PortRef; via: Pt[] }

type Interaction =
  | { kind: 'none' }
  | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number; btn: number; target: string | null }
  | { kind: 'drag'; sx: number; sy: number; orig: Record<string, { x: number; y: number }>; so: Record<string, { x: number; y: number }>; no: Record<string, { x: number; y: number }>; vias: Record<string, Pt[]>; moved: boolean }
  | { kind: 'draw'; x0: number; y0: number }
  | { kind: 'sresize'; id: string; code: string; orig: Shape; moved: boolean }
  | { kind: 'tag'; id: string; key: string; rot: number; sx: number; sy: number; ox: number; oy: number; moved: boolean }
  | { kind: 'label'; id: string; part: 'labelOff' | 'nameOff'; sx: number; sy: number; ox: number; oy: number; moved: boolean }
  | { kind: 'note'; id: string; sx: number; sy: number; ox: number; oy: number; moved: boolean }
  | { kind: 'instr'; id: string; sx: number; sy: number; ox: number; oy: number; moved: boolean }
  | { kind: 'probe'; id: string; i: 0 | 1; dx: number; dy: number; moved: boolean }
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
  const spd = p.simSpeed && p.simSpeed > 0 ? p.simSpeed : 1
  const ls = doc.labelScale ?? 1
  const svgRef = useRef<SVGSVGElement>(null)
  const [view, setView] = useState({ x: 20, y: 20, k: 0.8 })
  const fit = (paper = doc.paper) => {
    const r = svgRef.current!.getBoundingClientRect()
    const s = PAPER_SIZE[paper]
    const k = Math.min((r.width - 40) / s.w, (r.height - 40) / s.h)
    setView({ k, x: (r.width - s.w * k) / 2, y: (r.height - s.h * k) / 2 })
  }
  const [mouse, setMouse] = useState({ x: 0, y: 0 })
  const [drawing, setDrawing] = useState<Shape | null>(null)
  // polyligne en cours : un clic ajoute un sommet ; double-clic ou Entrée termine, un clic sur le premier sommet ferme
  const [poly, setPoly] = useState<Pt[] | null>(null)
  const polyRef = useRef<Pt[] | null>(null)
  const finishPolyRef = useRef<(closed: boolean) => void>(() => {})
  const shapesOn = !doc.hideShapes
  const shapesLocked = !!doc.lockShapes
  const targets = (skip?: string) => snapTargets(doc.symbols, doc.shapes ?? [], skip)
  const [band, setBand] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const [showGrid, setShowGrid] = useState(() => { try { return localStorage.getItem('albertschema.grid') === '1' } catch { return false } })
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
  const terms = useMemo(() => termsWithTopology({ ...doc, symbols: [...doc.symbols, ...(p.extra ?? [])] }, SYMBOL_MAP), [doc.symbols, doc.wires, p.extra]) // eslint-disable-line react-hooks/exhaustive-deps
  // renvois : sous chaque bobine, la liste de ses contacts (nature, bornes, zone de la feuille), comme dans CADe SIMU
  const crossRefs = useMemo(() => {
    const out: Record<string, string[]> = {}
    const everyone = [...doc.symbols, ...(p.extra ?? [])]
    const multi = (p.extra?.length ?? 0) > 0
    const { w, h } = PAPER_SIZE[doc.paper]
    const cols = Math.floor((w - 2 * MARGIN) / 80), rows = Math.floor((h - 2 * MARGIN) / 80)
    const zone = (s: PlacedSymbol) => {
      const b = symBBox(s)
      const c = Math.min(cols, Math.max(1, Math.floor(((b.x1 + b.x2) / 2 - MARGIN) / ((w - 2 * MARGIN) / cols)) + 1))
      const r = Math.min(rows, Math.max(1, Math.floor(((b.y1 + b.y2) / 2 - MARGIN) / ((h - 2 * MARGIN) / rows)) + 1))
      return (multi ? (p.pageOf?.[s.id] ?? 0) + 1 + ':' : '') + c + String.fromCharCode(64 + r)
    }
    for (const c of everyone) {
      if (SYMBOL_MAP[c.defId]?.sim?.k !== 'coil' || !c.label) continue
      const rows2: string[] = []
      for (const k of everyone) {
        const m = SYMBOL_MAP[k.defId]?.sim
        if (m?.k !== 'switch' || m.ctl !== 'coil' || !k.label || devKey(k.label) !== devKey(c.label)) continue
        const t = (id: string) => terms[k.id]?.[id] ?? ''
        const nums = m.changeover?.length ? m.changeover.map((co) => co.map(t).join('-')) : m.poles.map((pl) => pl.map(t).join('-'))
        const kind = m.changeover?.length ? 'CO' : m.nc ? 'NC' : 'NO'
        rows2.push(`${kind} ${nums.join(' ')} · ${zone(k)}`)
      }
      out[c.id] = rows2.sort()
    }
    // renvois de feuille : pour chaque renvoi, où se poursuit le conducteur (feuille et zone)
    for (const r of everyone) {
      if (r.defId !== 'sim-ref' || !r.label.trim()) continue
      const others = everyone.filter((x) => x.defId === 'sim-ref' && x.id !== r.id && x.label.trim().toUpperCase() === r.label.trim().toUpperCase())
      out[r.id] = others.length ? others.map((o) => `→ ${zone(o)}`) : ['→ ?']
    }
    // renvoi inverse : près de chaque contact, la bobine qui le commande
    for (const k of everyone) {
      const m = SYMBOL_MAP[k.defId]?.sim
      if (m?.k !== 'switch' || m.ctl !== 'coil' || !k.label) continue
      const c = everyone.find((x) => SYMBOL_MAP[x.defId]?.sim?.k === 'coil' && x.label && devKey(x.label) === devKey(k.label))
      if (c) out[k.id] = [`⇐ ${c.label} · ${zone(c)}`]
    }
    return out
  }, [doc.symbols, doc.paper, terms, p.extra, p.pageOf])
  // tracé de tous les conducteurs, séparés en couloirs quand ils se superposeraient
  const routes = useMemo(() => routeAll(doc.wires, doc.symbols), [doc.wires, doc.symbols])
  // points de jonction : fils d'une même borne qui se séparent
  const junctions = useMemo(() => junctionPoints(routes, doc.wires), [routes, doc.wires])

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
      if (e.key === 'Escape') { inter.current = { kind: 'none' }; setWiring(null); setBand(null); setRot(0); polyRef.current = null; setPoly(null) }
      if (e.key === 'Enter' && polyRef.current && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) { e.preventDefault(); finishPolyRef.current(false) }
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
    // écran tactile : un doigt = souris (clic, glisser), deux doigts = zoom par pincement et déplacement de la vue
    let pinch: { d: number; cx: number; cy: number } | null = null
    const fire = (type: string, t: Touch, target: EventTarget | null) =>
      (target ?? el).dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: t.clientX, clientY: t.clientY, button: 0, buttons: type === 'mouseup' ? 0 : 1 }))
    const dist = (a: Touch, b: Touch) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
    const onTouchStart = (e: TouchEvent) => {
      e.preventDefault()
      if (e.touches.length === 2) {
        fire('mouseup', e.touches[0], el) // abandonne le geste à un doigt en cours
        pinch = { d: dist(e.touches[0], e.touches[1]), cx: (e.touches[0].clientX + e.touches[1].clientX) / 2, cy: (e.touches[0].clientY + e.touches[1].clientY) / 2 }
      } else if (e.touches.length === 1) fire('mousedown', e.touches[0], e.target)
    }
    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault()
      if (e.touches.length === 2 && pinch) {
        const [a, b] = [e.touches[0], e.touches[1]]
        const d = dist(a, b), cx = (a.clientX + b.clientX) / 2, cy = (a.clientY + b.clientY) / 2
        const r = el.getBoundingClientRect()
        const prev = pinch
        setView((v) => {
          const k = Math.min(4, Math.max(0.1, v.k * (d / prev.d)))
          const mx = cx - r.left, my = cy - r.top
          return { k, x: mx - ((mx - v.x) / v.k) * k + (cx - prev.cx), y: my - ((my - v.y) / v.k) * k + (cy - prev.cy) }
        })
        pinch = { d, cx, cy }
      } else if (e.touches.length === 1 && !pinch) fire('mousemove', e.touches[0], el)
    }
    const onTouchEnd = (e: TouchEvent) => {
      e.preventDefault()
      if (pinch) { if (e.touches.length < 2) pinch = null; return }
      const t = e.changedTouches[0]
      if (t) fire('mouseup', t, document.elementFromPoint(t.clientX, t.clientY) ?? el)
    }
    el.addEventListener('touchstart', onTouchStart, { passive: false })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd, { passive: false })
    el.addEventListener('touchcancel', onTouchEnd, { passive: false })
    el.addEventListener('wheel', onWheel, { passive: false })
    fitRef.current()
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
      el.removeEventListener('touchcancel', onTouchEnd)
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

  finishPolyRef.current = (closed: boolean) => {
    const pts = polyRef.current
    polyRef.current = null
    setPoly(null)
    if (pts && pts.length >= 2) {
      const made: Shape = { id: uid(), kind: 'poly', x: pts[0].x, y: pts[0].y, w: 0, h: 0, pts: pts.slice(1).map((q) => ({ x: q.x - pts[0].x, y: q.y - pts[0].y })), closed: closed || undefined, stroke: 'solid', width: 1.6, color: '#000000', ...p.toolStyle }
      p.commit((d) => ({ ...d, shapes: [...(d.shapes ?? []), made] }))
      p.setSel([made.id])
    }
    p.onToolDone?.()
  }
  useEffect(() => { if (!p.tool) { polyRef.current = null; setPoly(null); setDrawing(null) } }, [p.tool])

  const [ruler, setRuler] = useState<{ a: { x: number; y: number }; b: { x: number; y: number } | null } | null>(null)
  useEffect(() => { if (!p.measure) setRuler(null) }, [p.measure])
  const onMouseDown = (e: React.MouseEvent) => {
    const pt = toSheet(e)
    if (p.measure && e.button === 0 && !space.current) {
      // 1er clic : départ ; 2e clic : arrivée (la mesure reste affichée) ; 3e clic : nouvelle mesure
      setRuler((r) => (!r || r.b ? { a: pt, b: null } : { a: r.a, b: pt }))
      return
    }
    if (e.button === 2 && wiringRef.current) {
      setWiring(null)
      e.preventDefault()
      return
    }
    if (e.button === 1 || e.button === 2 || space.current) {
      const hit = (e.target as Element).closest('[data-sym],[data-wire],[data-shape]')
      const target = hit ? (hit.getAttribute('data-sym') ?? hit.getAttribute('data-wire') ?? hit.getAttribute('data-shape')) : null
      inter.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, btn: e.button, target }
      e.preventDefault()
      return
    }
    if (e.button !== 0) return
    {
      const t = e.target as Element
      const ir = t.closest('[data-ir]')
      const is = t.closest('[data-is]')
      const ix = t.closest('[data-ix]')
      const pr = t.closest('[data-probe]')
      const ib = t.closest('[data-ib]')
      const edit = (id: string, fn: (i: Instrument) => Instrument | null) => p.commit((d) => ({ ...d, instruments: (d.instruments ?? []).flatMap((i) => (i.id === id ? (fn(i) ? [fn(i) as Instrument] : []) : [i])) }))
      if (ir) {
        const [id, dir] = ir.getAttribute('data-ir')!.split('|')
        edit(id, (i) => ({ ...i, range: stepRange(i, Number(dir) > 0 ? 1 : -1) }))
        return
      }
      if (is) { edit(is.getAttribute('data-is')!, (i) => ({ ...i, style: i.style === 'needle' ? 'digital' : 'needle' })); return }
      if (ix) { edit(ix.getAttribute('data-ix')!, () => null); return }
      if (pr) {
        const [id, k] = pr.getAttribute('data-probe')!.split('|')
        p.checkpoint()
        // on garde l'écart entre le point saisi et la pointe : la pointe ne saute pas sous le curseur
        const ins = (doc.instruments ?? []).find((x) => x.id === id)
        const tip = ins ? probesOf(ins)[Number(k)] : pt
        inter.current = { kind: 'probe', id, i: Number(k) as 0 | 1, dx: tip.x - pt.x, dy: tip.y - pt.y, moved: false }
        return
      }
      if (ib) {
        const id = ib.getAttribute('data-ib')!
        const ins = (doc.instruments ?? []).find((i) => i.id === id)
        if (ins) { inter.current = { kind: 'instr', id, sx: pt.x, sy: pt.y, ox: ins.x, oy: ins.y, moved: false }; return }
      }
    }
    const adj = p.sim ? (e.target as Element).closest('[data-adj]') : null
    if (adj) {
      const [id, k, d] = adj.getAttribute('data-adj')!.split('|')
      p.onAdjust?.(id, k as 'open' | 'set' | 'torque' | 'load', Number(d))
      return
    }
    // une électrovanne de distributeur reste cliquable même sous l'étiquette d'un repère
    const stack = p.sim ? document.elementsFromPoint(e.clientX, e.clientY) : []
    const solUnder = stack.find((el) => el.hasAttribute('data-sol'))
    if (p.sim && !e.shiftKey && !wiringRef.current && !p.placing && (solUnder || !(e.target as Element).closest('[data-port],[data-handle],[data-lbl],[data-nm],[data-note]'))) {
      // simulation : un clic manœuvre l'organe visé (bouton, interrupteur, défaut). Tout le reste, et Maj + clic, édite le schéma.
      const el = (e.target as Element).closest('[data-sym]')
      const symId = el?.getAttribute('data-sym') ?? solUnder?.closest('[data-solof]')?.getAttribute('data-solof')
      const s = symId ? doc.symbols.find((x) => x.id === symId) : undefined
      const kind = s ? isOperableDef(SYMBOL_MAP[s.defId]) : null
      const m = s ? SYMBOL_MAP[s.defId].sim : undefined
      let handled = true
      if (s && p.sim?.tripped.has(s.id) && !e.altKey) p.onSimToggle(s.id) // protection déclenchée : un clic la réarme
      else if (s && e.altKey && (m?.k === 'switch' || m?.k === 'load' || m?.k === 'coil')) p.onSimFault?.((m.k === 'switch' ? 'stuck:' : 'short:') + s.id)
      else if (s && (SYMBOL_MAP[s.defId].fluid as { k: string; a?: string } | undefined)?.k === 'valve' && ((SYMBOL_MAP[s.defId].fluid as { a?: string }).a === 'elec' || ((SYMBOL_MAP[s.defId].fluid as { a?: string; b?: string }).a === 'man' && (SYMBOL_MAP[s.defId].fluid as { b?: string }).b === 'man'))) {
        // électrodistributeur : on maintient le clic sur une électrovanne ; à droite ou à gauche selon la bobine visée (un monostable revient au lâcher, un bistable reste en place)
        const side = (solUnder ?? (e.target as Element)).closest('[data-sol]')?.getAttribute('data-sol')
        const f = SYMBOL_MAP[s.defId].fluid as { b?: string }
        const twoSided = f.b === 'elec' || f.b === 'man'
        const k = side === 'b' && twoSided ? s.id + ':B' : side === 'b' || (twoSided && !side) ? null : s.id
        if (k) { held.current = k; p.onSimPress(k, true) } else handled = false
      }
      else if (s && kind === 'momentary') { held.current = s.id; p.onSimPress(s.id, true) }
      else if (s && kind === 'toggle') p.onSimToggle(s.id)
      else if (s && m?.k === 'switch' && m.ctl === 'fixed') p.onSimFault?.(s.id)
      else if (s && m?.k === 'load' && m.role === 'motor') p.onSimFault?.('ovl:' + s.id)
      else if (!s) {
        const we = (e.target as Element).closest('[data-wire]')
        if (we) p.onSimFault?.(we.getAttribute('data-wire')!)
        else handled = false
      } else handled = false
      if (handled) return
    }
    if (wiringRef.current) return // tracé en cours : le coude ou la borne d'arrivée est pris au relâchement
    if (p.tool && e.button === 0 && !p.sim) {
      const tg = targets()
      const q = { x: snapTo(pt.x, snap, tg.xs), y: snapTo(pt.y, snap, tg.ys) }
      if (p.tool === 'poly') {
        const d = polyRef.current
        if (!d) { polyRef.current = [q]; setPoly([q]); return }
        if (d.length >= 3 && Math.hypot(q.x - d[0].x, q.y - d[0].y) < 8) { finishPolyRef.current(true); return }
        const last = d[d.length - 1]
        if (last.x !== q.x || last.y !== q.y) { const next = [...d, q]; polyRef.current = next; setPoly(next) }
        return
      }
      inter.current = { kind: 'draw', x0: q.x, y0: q.y }
      setDrawing({ id: 'draft', kind: p.tool, x: q.x, y: q.y, w: 0, h: 0, stroke: 'solid', width: 1.6, color: '#000000', ...p.toolStyle })
      return
    }
    const shHandle = (e.target as Element).closest('[data-shandle]')
    if (shHandle) {
      const [id, code] = shHandle.getAttribute('data-shandle')!.split('|')
      const o = (doc.shapes ?? []).find((x) => x.id === id)
      if (o) { inter.current = { kind: 'sresize', id, code, orig: o, moved: false }; return }
    }
    if (p.placing) {
      const def = SYMBOL_MAP[p.placing]
      const sym: PlacedSymbol = {
        id: uid(), defId: def.id, rot, desc: '',
        x: snap(pt.x - def.w / 2), y: snap(pt.y - def.h / 2),
        label: p.nextLabel(doc, def.id),
      }
      p.commit((d) => autoConnect({ ...d, symbols: [...d.symbols, sym] }, [sym.id]))
      p.onPlaced(def.id)
      return
    }
    const noteEl = (e.target as Element).closest('[data-note]')
    if (noteEl) {
      const id = noteEl.getAttribute('data-note')!
      const n = (doc.notes ?? []).find((x) => x.id === id)
      if (n) {
        p.setSel([id])
        inter.current = { kind: 'note', id, sx: pt.x, sy: pt.y, ox: n.x, oy: n.y, moved: false }
        return
      }
    }
    // texte dessiné dans un symbole (lettre d'orifice, repère d'électroaimant…) : on le déplace à la souris
    // les lettres d'orifices touchent les orifices : le texte prime sur la zone de câblage qui le recouvre
    const tagEl = !p.sim ? (document.elementsFromPoint(e.clientX, e.clientY).find((el) => el.hasAttribute('data-tag')) ?? null) : null
    if (tagEl) {
      const sy = doc.symbols.find((x) => x.id === (tagEl.closest('[data-solof]')?.getAttribute('data-solof') ?? tagEl.getAttribute('data-tagof')))
      if (sy) {
        p.setSel([sy.id])
        const key = tagEl.getAttribute('data-tag')!
        inter.current = { kind: 'tag', id: sy.id, key, rot: sy.rot, sx: pt.x, sy: pt.y, ox: sy.tagOff?.[key]?.x ?? 0, oy: sy.tagOff?.[key]?.y ?? 0, moved: false }
        return
      }
    }
    const lblEl = (e.target as Element).closest('[data-lbl]')
    if (lblEl) {
      const id = lblEl.getAttribute('data-lbl')!
      const sy = doc.symbols.find((x) => x.id === id)
      if (sy) {
        p.setSel([id])
        inter.current = { kind: 'label', id, part: 'labelOff', sx: pt.x, sy: pt.y, ox: sy.labelOff?.x ?? 0, oy: sy.labelOff?.y ?? 0, moved: false }
        return
      }
    }
    const nmEl = (e.target as Element).closest('[data-nm]')
    if (nmEl) {
      const id = nmEl.getAttribute('data-nm')!
      const sy = doc.symbols.find((x) => x.id === id)
      if (sy) {
        p.setSel([id])
        inter.current = { kind: 'label', id, part: 'nameOff', sx: pt.x, sy: pt.y, ox: sy.nameOff?.x ?? 0, oy: sy.nameOff?.y ?? 0, moved: false }
        return
      }
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
    const shEl = (e.target as Element).closest('[data-shape]')
    if (shEl && !(e.target as Element).closest('[data-sym]')) {
      const id = shEl.getAttribute('data-shape')!
      let ids = sel
      if (e.shiftKey) ids = sel.includes(id) ? sel.filter((s) => s !== id) : [...sel, id]
      else if (!sel.includes(id)) ids = [id]
      p.setSel(ids)
      const orig: Record<string, { x: number; y: number }> = {}
      const so: Record<string, { x: number; y: number }> = {}
      const no: Record<string, { x: number; y: number }> = {}
      const add = (list: string[], kind: 's' | 'h' | 'n') => {
        for (const sid of list) {
          if (kind === 's') { const s = symById(sid); if (s) orig[sid] = { x: s.x, y: s.y } }
          else if (kind === 'h') { const s = (doc.shapes ?? []).find((x) => x.id === sid); if (s) so[sid] = { x: s.x, y: s.y } }
          else { const n = (doc.notes ?? []).find((x) => x.id === sid); if (n) no[sid] = { x: n.x, y: n.y } }
        }
      }
      add(ids, 's'); add(ids, 'h')
      // un cadre qui « emporte son contenu » entraîne les symboles, textes et formes qu'il contient
      for (const sid of ids) {
        const fr = (doc.shapes ?? []).find((x) => x.id === sid)
        if (fr?.carry) { const c = insideOf(fr, doc.symbols, doc.shapes ?? [], doc.notes ?? []); add(c.symbols, 's'); add(c.shapes, 'h'); add(c.notes, 'n') }
      }
      const vias: Record<string, Pt[]> = {}
      for (const w of doc.wires) if (w.via?.length && orig[w.from.symId] && orig[w.to.symId]) vias[w.id] = w.via
      inter.current = { kind: 'drag', sx: pt.x, sy: pt.y, orig, so, no, vias, moved: false }
      return
    }
    const symEl = (e.target as Element).closest('[data-sym]')
    if (symEl) {
      const id = symEl.getAttribute('data-sym')!
      let ids = sel
      const withGroup = (list: string[]) => {
        const groups = new Set(doc.symbols.filter((s) => list.includes(s.id) && s.group).map((s) => s.group))
        return groups.size ? Array.from(new Set([...list, ...doc.symbols.filter((s) => s.group && groups.has(s.group)).map((s) => s.id)])) : list
      }
      if (e.shiftKey) ids = sel.includes(id) ? sel.filter((s) => s !== id) : withGroup([...sel, id])
      else if (!sel.includes(id)) ids = withGroup([id])
      p.setSel(ids)
      const orig: Record<string, { x: number; y: number }> = {}
      for (const s of doc.symbols) if (ids.includes(s.id) && !s.locked) orig[s.id] = { x: s.x, y: s.y }
      const vias: Record<string, Pt[]> = {}
      for (const w of doc.wires) if (w.via?.length && orig[w.from.symId] && orig[w.to.symId]) vias[w.id] = w.via
      const so: Record<string, { x: number; y: number }> = {}
      for (const s of doc.shapes ?? []) if (ids.includes(s.id)) so[s.id] = { x: s.x, y: s.y }
      inter.current = { kind: 'drag', sx: pt.x, sy: pt.y, orig, so, no: {}, vias, moved: false }
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
        const g = alignGuides(moved, doc.symbols.filter((s) => !it.orig[s.id]))
        // formes déplacées : leurs bords et leur centre s'alignent sur les bords et centres des symboles et des autres formes
        const movedShapes = (doc.shapes ?? []).filter((s) => it.so[s.id]).map((s) => ({ ...s, x: it.so[s.id].x + dx, y: it.so[s.id].y + dy }))
        if (movedShapes.length) {
          const tg = snapTargets(doc.symbols.filter((s) => !it.orig[s.id]), (doc.shapes ?? []).filter((s) => !it.so[s.id]))
          for (const s of movedShapes) {
            const b = shapeBox(s)
            for (const x of [b.x1, (b.x1 + b.x2) / 2, b.x2]) if (tg.xs.includes(x)) g.v.push(x)
            for (const y of [b.y1, (b.y1 + b.y2) / 2, b.y2]) if (tg.ys.includes(y)) g.h.push(y)
          }
        }
        setGuides({ v: [...new Set(g.v)], h: [...new Set(g.h)] })
        p.update((d) => ({
          ...d,
          symbols: d.symbols.map((s) => (it.orig[s.id] ? { ...s, x: it.orig[s.id].x + dx, y: it.orig[s.id].y + dy } : s)),
          wires: d.wires.map((w) => (it.vias[w.id] ? { ...w, via: it.vias[w.id].map((v) => ({ x: v.x + dx, y: v.y + dy })) } : w)),
          ...(d.shapes ? { shapes: d.shapes.map((s) => (it.so[s.id] ? { ...s, x: it.so[s.id].x + dx, y: it.so[s.id].y + dy } : s)) } : {}),
          ...(d.notes ? { notes: d.notes.map((n) => (it.no[n.id] ? { ...n, x: it.no[n.id].x + dx, y: it.no[n.id].y + dy } : n)) } : {}),
        }))
      }
    } else if (it.kind === 'draw') {
      const tg = targets()
      const q = { x: snapTo(pt.x, snap, tg.xs), y: snapTo(pt.y, snap, tg.ys) }
      setDrawing((s) => {
        if (!s) return s
        if (s.kind === 'line') { const f = straighten(q.x - it.x0, q.y - it.y0); return { ...s, x: it.x0, y: it.y0, w: f.dx, h: f.dy } }
        return { ...s, x: Math.min(it.x0, q.x), y: Math.min(it.y0, q.y), w: Math.abs(q.x - it.x0), h: Math.abs(q.y - it.y0) }
      })
    } else if (it.kind === 'sresize') {
      const tg = targets(it.id)
      const next = resizeRotated(it.orig, it.code, { x: snapTo(pt.x, snap, tg.xs), y: snapTo(pt.y, snap, tg.ys) })
      if (!it.moved && (next.x !== it.orig.x || next.y !== it.orig.y || next.w !== it.orig.w || next.h !== it.orig.h)) { it.moved = true; p.checkpoint() }
      if (it.moved) p.update((d) => ({ ...d, shapes: (d.shapes ?? []).map((s) => (s.id === it.id ? next : s)) }))
    } else if (it.kind === 'note') {
      const nx = snap(it.ox + pt.x - it.sx), ny = snap(it.oy + pt.y - it.sy)
      if (!it.moved && (nx !== it.ox || ny !== it.oy)) {
        it.moved = true
        p.checkpoint()
      }
      if (it.moved) p.update((d) => ({ ...d, notes: (d.notes ?? []).map((n) => (n.id === it.id ? { ...n, x: nx, y: ny } : n)) }))
    } else if (it.kind === 'probe') {
      const q = { x: Math.round((pt.x + it.dx) * 2) / 2, y: Math.round((pt.y + it.dy) * 2) / 2 }
      p.update((d) => ({ ...d, instruments: (d.instruments ?? []).map((i) => (i.id === it.id ? { ...i, probes: (probesOf(i).map((o, k) => (k === it.i ? q : o)) as unknown) as Instrument['probes'] } : i)) }))
    } else if (it.kind === 'instr') {
      const nx = Math.round(it.ox + pt.x - it.sx)
      const ny = Math.round(it.oy + pt.y - it.sy)
      if (!it.moved && (Math.abs(nx - it.ox) > 1 || Math.abs(ny - it.oy) > 1)) {
        it.moved = true
        p.checkpoint()
      }
      if (it.moved) p.update((d) => ({ ...d, instruments: (d.instruments ?? []).map((i) => (i.id === it.id ? { ...i, x: nx, y: ny } : i)) }))
    } else if (it.kind === 'tag') {
      // le texte est dans le repère du symbole : le déplacement est ramené dans ce repère (rotation inverse)
      const a = (-it.rot * Math.PI) / 180, dx = pt.x - it.sx, dy = pt.y - it.sy
      const off = { x: it.ox + Math.round(dx * Math.round(Math.cos(a)) - dy * Math.round(Math.sin(a))), y: it.oy + Math.round(dx * Math.round(Math.sin(a)) + dy * Math.round(Math.cos(a))) }
      if (!it.moved && (off.x !== it.ox || off.y !== it.oy)) {
        it.moved = true
        p.checkpoint()
      }
      if (it.moved) p.update((d) => ({ ...d, symbols: d.symbols.map((s) => {
        if (s.id !== it.id) return s
        const t = { ...(s.tagOff ?? {}) }
        if (off.x || off.y) t[it.key] = off; else delete t[it.key]
        return { ...s, tagOff: Object.keys(t).length ? t : undefined }
      }) }))
    } else if (it.kind === 'label') {
      const off = { x: it.ox + Math.round(pt.x - it.sx), y: it.oy + Math.round(pt.y - it.sy) }
      if (!it.moved && (off.x !== it.ox || off.y !== it.oy)) {
        it.moved = true
        p.checkpoint()
      }
      if (it.moved) p.update((d) => ({ ...d, symbols: d.symbols.map((s) => (s.id === it.id ? { ...s, [it.part]: off.x || off.y ? off : undefined } : s)) }))
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
    if (it.kind === 'draw' && drawing) {
      let s = drawing
      const tiny = s.kind === 'line' ? Math.hypot(s.w, s.h) < 8 : s.w < 8 && s.h < 8
      if (tiny && s.kind !== 'line') s = { ...s, w: 160, h: 100 } // simple clic : forme de taille usuelle
      if (!(tiny && s.kind === 'line')) {
        const made: Shape = { ...s, id: uid() }
        p.commit((d) => ({ ...d, shapes: [...(d.shapes ?? []), made] }))
        p.setSel([made.id])
      }
      setDrawing(null)
      p.onToolDone?.()
      inter.current = { kind: 'none' }
      return
    }
    const w = wiringRef.current
    if (w && e.button === 0) {
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
      const hitShapes = (shapesOn && !shapesLocked ? doc.shapes ?? [] : []).filter((s) => { const b = shapeBox(s); return b.x1 >= x1 && b.x2 <= x2 && b.y1 >= y1 && b.y2 <= y2 }).map((s) => s.id)
      const all = [...hit, ...hitShapes]
      p.setSel(it.add ? Array.from(new Set([...sel, ...all])) : all)
      setBand(null)
    } else if (it.kind === 'drag' && it.moved) {
      // symboles déplacés sans fil : s'ils tombent sur des fils ou contre d'autres bornes, ils se raccordent
      const free = Object.keys(it.orig).filter((id) => !doc.wires.some((w) => w.from.symId === id || w.to.symId === id))
      if (free.length) p.update((d) => autoConnect(d, free))
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
    p.commit((d) => autoConnect({ ...d, symbols: [...d.symbols, sym] }, [sym.id]))
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
      className={'canvas' + (p.dark ? ' dark-sheet' : '') + (p.placing || p.tool ? ' placing' : '') + (wiring ? ' wiring' : '') + (p.sim ? ' simulating' : '')}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={() => { inter.current = { kind: 'none' }; setBand(null); setDrawing(null); if (held.current) { p.onSimPress(held.current, false); held.current = null } }}
      onContextMenu={(e) => e.preventDefault()}
      onDoubleClick={(e) => {
        if (polyRef.current) { finishPolyRef.current(false); return }
        if ((e.target as Element).closest('[data-titleblock]')) { p.onEditTitle?.(); return }
        const tgt = e.target as Element
        const tagD = !p.sim ? (document.elementsFromPoint(e.clientX, e.clientY).find((el) => el.hasAttribute('data-tag')) ?? null) : null
        if (tagD) { const sid = tagD.closest('[data-solof]')?.getAttribute('data-solof') ?? tagD.getAttribute('data-tagof'); if (sid) { p.onEditText?.('tag', sid + '|' + tagD.getAttribute('data-tag'), e.clientX, e.clientY); return } }
        const txt = tgt.closest('[data-note]') ? (['note', tgt.closest('[data-note]')!.getAttribute('data-note')!] as const) : tgt.closest('[data-nm]') ? (['name', tgt.closest('[data-nm]')!.getAttribute('data-nm')!] as const) : tgt.closest('[data-lbl]') ? (['label', tgt.closest('[data-lbl]')!.getAttribute('data-lbl')!] as const) : null
        if (txt) { p.onEditText?.(txt[0], txt[1], e.clientX, e.clientY); return }
        const symEl = (e.target as Element).closest('[data-sym]')
        if (symEl && !(e.target as Element).closest('[data-port],[data-handle],[data-lbl],[data-nm]')) {
          const sy = doc.symbols.find((x) => x.id === symEl.getAttribute('data-sym'))
          // en simulation, un double-clic sur un organe de commande le manœuvre : on n'ouvre alors pas la fenêtre
          if (sy && !(p.sim && isOperableDef(SYMBOL_MAP[sy.defId]))) { p.onEditSymbol?.(sy.id, e.clientX, e.clientY); return }
        }
        const el = (e.target as Element).closest('[data-handle]')
        if (!el) return
        const [wireId, idx, kind] = el.getAttribute('data-handle')!.split('|')
        if (kind !== 'via') return
        p.commit((d) => ({ ...d, wires: d.wires.map((w) => (w.id === wireId ? { ...w, via: (w.via ?? []).filter((_, i) => i !== Number(idx)) } : w)) }))
      }}
    >
      <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
        <rect x={-4} y={-4} width={w + 8} height={h + 8} fill="#000" opacity={0.12} />
        <g ref={p.contentRef} color="#000" stroke="currentColor" fill="none" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" fontFamily="Arial, sans-serif">
          <Sheet paper={doc.paper} title={p.sheetLabel ? { ...doc.title, sheet: p.sheetLabel } : doc.title} lang={p.lang} />
          {shapesOn && (doc.shapes ?? []).map((s) => <ShapeView key={s.id} s={s} />)}
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
            const stroke = p.sim ? (pot ? potColor(pot) : '#9aa0a8') : wr.color === 'gnye' ? '#2e9b2e' : wr.color
            return (
              <g key={wr.id}>
                <polyline points={pointsAttr(pts)} stroke={p.faults?.has(wr.id) ? '#e53935' : stroke} strokeWidth={p.sim && pot ? Math.max(2.2, wr.width ?? 0) : wr.width ?? 1.6} strokeDasharray={p.faults?.has(wr.id) ? '3 5' : dashArray(wr.dash ?? 'solid', wr.width ?? 1.6)} />
                {wr.color === 'gnye' && !p.sim && <polyline points={pointsAttr(pts)} stroke="#f0d800" strokeWidth={wr.width ?? 1.6} strokeDasharray="5 5" strokeLinecap="butt" />}
                {p.faults?.has(wr.id) && <text x={mx - 4} y={my + 4} fontSize={12} fill="#e53935" stroke="none">✂</text>}
                {p.sim?.current[wr.id] && (
                  <polyline points={pointsAttr(pts)} stroke="#fff" strokeOpacity={0.95} strokeWidth={1.3} strokeDasharray="2 6" strokeLinecap="butt">
                    <animate attributeName="stroke-dashoffset" from="0" to={p.sim.current[wr.id] > 0 ? '-8' : '8'} dur={`${0.45 / spd}s`} repeatCount="indefinite" />
                  </polyline>
                )}
                {Math.abs(p.sim?.oilWire?.[wr.id] ?? 0) > 0.15 && (
                  <polyline points={pointsAttr(pts)} fill="none" stroke="#fff" strokeOpacity={0.95} strokeWidth={1.5} strokeLinecap="round" strokeDasharray="0.5 6" pointerEvents="none">
                    <animate attributeName="stroke-dashoffset" from="0" to={(p.sim!.oilWire[wr.id] ?? 0) > 0 ? '-13' : '13'} dur={`${Math.max(0.25, Math.min(3, 16 / Math.abs(p.sim!.oilWire[wr.id] ?? 1))) / spd}s`} repeatCount="indefinite" />
                  </polyline>
                )}
                {txt && <text x={mx + 4} y={my - 4} fontSize={7} fill={wr.color === 'gnye' ? '#2e9b2e' : wr.color} stroke="none">{txt}</text>}
              </g>
            )
          })}
          {junctions.map((j) => <circle key={j.x + ',' + j.y} cx={j.x} cy={j.y} r={2.8} fill="currentColor" stroke="none" />)}
          {(doc.notes ?? []).map((n) => (
            <g key={n.id} transform={n.rot ? `rotate(${n.rot} ${n.x} ${n.y})` : undefined}>
              {n.text.split('\n').map((line, i) => (
                <text key={i} x={n.x} y={n.y + n.size + i * n.size * 1.2} fontSize={n.size} fontFamily={fontCss(n.font)} fontWeight={n.bold ? 700 : 400} fontStyle={n.italic ? 'italic' : 'normal'} fill="currentColor" stroke="none">{line}</text>
              ))}
            </g>
          ))}
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
                {def.fluid?.k === 'fthrottle' && !p.sim && <text x={b.x1 + (b.x2 - b.x1) / 2} y={b.y1 - 2} textAnchor="middle" fontSize={8} stroke="none" fill="#555" pointerEvents="none">{s.rated?.open ?? 50} %</text>}
                {p.sim && (() => {
                  // réglages accessibles pendant la simulation : − et + autour de la valeur
                  const k = def.fluid?.k
                  const hyd = def.domain === 'hydraulic'
                  const spec = k === 'fthrottle' ? { key: 'open', val: s.rated?.open ?? 50, unit: '%', step: 5, below: false, fr: 'Régler l’ouverture du limiteur de débit', en: 'Adjust the flow limiter opening' }
                    : k === 'relief' || k === 'reducer' ? { key: 'set', val: s.rated?.set ?? (k === 'relief' ? 100 : 50), unit: 'bar', step: 5, below: false, fr: 'Régler le tarage (bar)', en: 'Adjust the setting (bar)' }
                    : k === 'fmotor' && hyd ? { key: 'torque', val: s.rated?.torque ?? 5, unit: 'N·m', step: 5, below: true, fr: 'Faire varier la charge : couple résistant sur l’arbre (N·m)', en: 'Vary the load: resisting torque on the shaft (N·m)' }
                    : k === 'cyl' && hyd ? { key: 'load', val: s.rated?.load ?? 0, unit: 'daN', step: 50, below: true, fr: 'Faire varier la charge : effort résistant sur la tige (daN)', en: 'Vary the load: resisting force on the rod (daN)' }
                    : null
                  if (!spec) return null
                  const cx = (b.x1 + b.x2) / 2, cy = spec.below ? b.y2 + (p.sim.fluidInfo?.[s.id] ? 26 : 12) + 8 : b.y1 - 5
                  const btn = (dx: number, sign: number) => (
                    <g data-adj={`${s.id}|${spec.key}|${sign * spec.step}`} style={{ cursor: 'pointer' }}>
                      <rect x={cx + dx - 5} y={cy - 8} width={10} height={10} rx={2} fill="#e8f0fe" stroke="#1565c0" strokeWidth={0.8} />
                      <text x={cx + dx} y={cy - 0.5} textAnchor="middle" fontSize={10} fontWeight={700} fill="#1565c0" stroke="none" pointerEvents="none">{sign > 0 ? '+' : '−'}</text>
                      <title>{p.lang === 'fr' ? spec.fr : spec.en}</title>
                    </g>
                  )
                  const label = `${spec.below ? (p.lang === 'fr' ? 'charge ' : 'load ') : ''}${spec.val} ${spec.unit}`
                  const w = 12 + label.length * 2.3
                  return (
                    <g>
                      {btn(-w, -1)}
                      <text x={cx} y={cy - 0.5} textAnchor="middle" fontSize={8} fontWeight={700} fill="#0d47a1" stroke="#fff" strokeWidth={2.2} paintOrder="stroke" pointerEvents="none">{label}</text>
                      {btn(w, 1)}
                    </g>
                  )
                })()}
                {p.sim?.tripped.has(s.id) && <text x={b.x2 + 3} y={b.y1 + 9} fontSize={9} stroke="none" fill="#e53935" fontWeight={700} pointerEvents="none">{kindOf(def) === 'fuse' ? p.lang === 'fr' ? 'FONDU' : 'BLOWN' : p.lang === 'fr' ? 'DÉCLENCHÉ' : 'TRIPPED'}</text>}
                {p.sim && model === undefined && def.fluid?.k === 'valve' && !isDynamic(def) && (
                  <circle cx={b.x2 + 4} cy={b.y1 + 4} r={3} fill={p.sim.valveA[s.id] ? '#35c759' : '#fff'} stroke={p.sim.valveA[s.id] ? '#1f8f3a' : '#888'} strokeWidth={0.8} />
                )}
                {p.sim && def.fluid?.k === 'valve' && def.fluid.three && p.sim.valveB[s.id] && !isDynamic(def) && (
                  <circle cx={b.x1 - 4} cy={b.y1 + 4} r={3} fill="#ff9800" stroke="#e65100" strokeWidth={0.8} />
                )}
                {p.sim && !p.sim.fluidInfo?.[s.id] && (def.fluid?.k === 'fgauge' || def.fluid?.k === 'fpress') && (() => {
                  const port = def.fluid.k === 'fpress' ? def.fluid.port : def.fluid.ports[0]
                  const pot = p.sim.potentialOf[`${s.id}:${port}`]
                  if (pot !== 'P' && pot !== 'R') return null
                  return <text x={b.x2 + 3} y={b.y1 + 9} fontSize={8} stroke="none" fill={pot === 'P' ? '#1565c0' : '#777'} fontWeight={700} pointerEvents="none">{pot === 'P' ? (def.domain === 'hydraulic' ? '160 bar' : '6 bar') : '0 bar'}</text>
                })()}
                {p.sim && def.fluid?.k === 'fmotor' && (p.sim.fluidMotor[s.id] ?? 0) !== 0 && (
                  <text x={b.x2 + 3} y={b.y1 + 9} fontSize={11} stroke="none" fill="#1565c0" fontWeight={700} pointerEvents="none">{p.sim.fluidMotor[s.id] === 1 ? '↻' : '↺'}</text>
                )}
                {p.sim && def.fluid?.k === 'cyl' && !isDynamic(def) && p.sim.cylPos[s.id] !== undefined && (() => {
                  const f = def.fluid
                  const c = portPos(s, f.cap)
                  const r = f.rod ? portPos(s, f.rod) : null
                  if (!c) return null
                  const end = r ?? { x: c.x < (b.x1 + b.x2) / 2 ? b.x2 : b.x1, y: c.y }
                  const pos = p.sim.cylPos[s.id]
                  const horiz = Math.abs(end.x - c.x) >= Math.abs(end.y - c.y)
                  const off = horiz ? { x: 0, y: 12 } : { x: 12, y: 0 }
                  const a = { x: c.x + off.x, y: c.y + off.y }, z = { x: end.x + off.x, y: end.y + off.y }
                  const m = { x: a.x + (z.x - a.x) * pos, y: a.y + (z.y - a.y) * pos }
                  return (
                    <g pointerEvents="none">
                      <line x1={a.x} y1={a.y} x2={z.x} y2={z.y} stroke="#b0bec5" strokeWidth={3} strokeLinecap="round" />
                      <line x1={a.x} y1={a.y} x2={m.x} y2={m.y} stroke="#1e88e5" strokeWidth={3} strokeLinecap="round" />
                      <circle cx={m.x} cy={m.y} r={3.2} fill="#fff" stroke="#1e88e5" strokeWidth={1.4} />
                      <text x={(a.x + z.x) / 2} y={a.y + (horiz ? 11 : 0)} fontSize={6.5} textAnchor="middle" fill="currentColor" stroke="none">{Math.round(pos * 100)} %</text>
                    </g>
                  )
                })()}
                {p.faults?.has('ovl:' + s.id) && <text x={b.x1} y={b.y2 + 12} fontSize={8} fill="#e53935" stroke="none" fontWeight={700}>⚠ {p.lang === 'fr' ? 'SURCHARGE' : 'OVERLOAD'}</text>}
                {s.locked && !p.sim && <text x={b.x2 - 6} y={b.y1 + 8} fontSize={9} stroke="none" fill="#666">🔒</text>}
                {p.faults?.has('stuck:' + s.id) && <text x={b.x1} y={b.y2 + 12} fontSize={8} fill="#e53935" stroke="none" fontWeight={700}>⚠ {p.lang === 'fr' ? 'COLLÉ' : 'STUCK'}</text>}
                {p.faults?.has('short:' + s.id) && <text x={b.x1} y={b.y2 + 12} fontSize={8} fill="#e53935" stroke="none" fontWeight={700}>⚡ {p.lang === 'fr' ? 'COURT-CIRCUIT' : 'SHORT'}</text>}
                {p.faults?.has(s.id) && <text x={b.x2 + 2} y={b.y1 + 10} fontSize={14} fill="#e53935" stroke="none" fontWeight={700}>✕</text>}
                {closedState !== undefined && (
                  <circle cx={b.x2 + 4} cy={b.y1 + 4} r={3} fill={closedState ? '#35c759' : '#fff'} stroke={closedState ? '#1f8f3a' : '#888'} strokeWidth={0.8} />
                )}
                <g transform={`translate(${s.x} ${s.y}) rotate(${s.rot} ${cx} ${cy})`} style={{ ...({ '--ls': String(ls) } as React.CSSProperties), ...(bladeVars(s.id, model, p.sim) ?? {}), ...(p.sim && (def.fluid?.k === 'fthrottle') ? ({ '--nd': (1 - (p.sim.needle?.[s.id] ?? 0)) * 32 + 'deg' } as React.CSSProperties) : {}), ...(p.sim && def.fluid?.k === 'relief' ? ({ '--ro': String(p.sim.needle?.[s.id] ?? 0) } as React.CSSProperties) : {}), ...(p.sim && def.fluid?.k === 'reducer' ? ({ '--rc': String(p.sim.needle?.[s.id] ?? 0) } as React.CSSProperties) : {}) }}>
                  {isDynamic(def) ? <FluidShape s={s} def={def} sim={p.sim ?? null} detectors={s.label ? p.detectors?.[s.label.replace(/\s+/g, '').toUpperCase()]?.map((d) => ({ label: d.label, at: d.at, on: !!p.sim?.closed[d.id] })) : undefined} /> : <g dangerouslySetInnerHTML={{ __html: def.svg.replace(/var\(--bg\)/g, '#fff') }} />}
                  {def.domain === 'hydraulic' && (() => {
                    // lettres normalisées des orifices des appareils hydrauliques (P pression, T réservoir, A et B utilisations, S aspiration)
                    const f = def.fluid
                    const m: Record<string, string> = f?.k === 'relief' ? { [f.p]: 'P', [f.t]: 'T' } : f?.k === 'reducer' ? { [f.p]: 'P', [f.a]: 'A' }
                      : f?.k === 'cyl' ? { [f.cap]: 'A', ...(f.rod ? { [f.rod]: 'B' } : {}) } : f?.k === 'fmotor' ? { [f.a]: 'A', ...(f.b ? { [f.b]: 'B' } : {}) }
                      : f?.k === 'fpump' ? { [f.out]: 'P', [f.in]: 'S' } : f?.k === 'fthrottle' || f?.k === 'fflow' ? { [f.a]: 'A', [f.b]: 'B' }
                      : f?.k === 'check' ? { [f.from]: 'A', [f.to]: 'B' } : null as unknown as Record<string, string>
                    if (!m) return null
                    return (
                      <g fontSize={6 * ls} fill="currentColor" stroke="none">
                        {def.ports.filter((q) => m[q.id]).map((q) => {
                          const h = q.dir === 'left' || q.dir === 'right'
                          const key = 'p:' + q.id, o = s.tagOff?.[key], c = s.tagText?.[key] ?? m[q.id]
                          return c ? <text key={q.id} data-tag={key} data-tagof={s.id} style={{ pointerEvents: p.sim ? 'none' : 'all', cursor: p.sim ? undefined : 'move' }} stroke="rgba(0,0,0,0)" strokeWidth={3} transform={o ? `translate(${o.x} ${o.y})` : undefined} x={h ? q.x + (q.dir === 'left' ? 2 : -2) : q.x + 2.5} y={h ? q.y - 2.5 : q.y + (q.dir === 'up' ? 7 : -3)} textAnchor={h && q.dir === 'right' ? 'end' : 'start'}>{c}</text> : null
                        })}
                      </g>
                    )
                  })()}
                  {model?.k === 'plc' && p.sim && (() => {
                    const st = p.sim.plc[s.id]
                    return (
                      <g pointerEvents="none" stroke="#666" strokeWidth={0.5}>
                        {def.ports.filter((q) => /^i\d$/.test(q.id)).map((q) => {
                          const on = st?.inputs[Number(q.id[1])]
                          return <circle key={q.id} cx={q.x} cy={33} r={2.6} fill={on ? '#35c759' : '#e0e0e0'} />
                        })}
                        {(() => {
                          // trajet du courant à l'intérieur : du commun jusqu'à chaque sortie dont le contact est fermé
                          const g = PLC_GEOM, comPort = model.outputs[0].com
                          const pot = p.sim!.potentialOf[`${s.id}:${comPort}`]
                          if (!pot || !st) return null
                          const y0 = comPort === 'com' ? g.H : 14
                          const bus = `${g.COM_X},${y0} ${g.COM_X},${g.BUS} ${g.X0 + 7 * g.STEP},${g.BUS}`
                          const live = [
                            <polyline key="bus" points={bus} fill="none" stroke={potColor(pot)} strokeWidth={1.8} strokeOpacity={0.9} />,
                            ...st.out.slice(0, 8).map((on, i) => {
                            if (!on) return null
                            const x = g.X0 + i * g.STEP
                            const pts = `${g.COM_X},${y0} ${g.COM_X},${g.BUS} ${x},${g.BUS} ${x},${g.H}`
                            return (
                              <g key={'cur' + i} fill="none" strokeLinecap="butt">
                                <polyline points={pts} stroke={potColor(pot)} strokeWidth={1.8} strokeOpacity={0.9} />
                                <polyline points={pts} stroke="#fff" strokeWidth={1} strokeDasharray="2 6"><animate attributeName="stroke-dashoffset" from="0" to={comPort === 'com' ? '8' : '-8'} dur={`${0.45 / spd}s`} repeatCount="indefinite" /></polyline>
                              </g>
                            )
                          }),
                          ]
                          return live
                        })()}
                        <text x={def.w - 6} y={46} fontSize={6.5} textAnchor="end" stroke="none" fontWeight={700} fill={st ? '#1f8f3a' : '#999'}>{st ? 'RUN' : 'STOP'}</text>
                      </g>
                    )
                  })()}
                  {p.sim && def.fluid && def.domain === 'hydraulic' && (() => {
                    const f = def.fluid
                    const q = p.sim.oilFlow?.[s.id]
                    const pair: [string, string] | null = f.k === 'fthrottle' ? [f.a, f.b] : f.k === 'check' ? [f.from, f.to] : f.k === 'relief' ? [f.p, f.t] : f.k === 'reducer' ? [f.p, f.a] : f.k === 'fflow' ? [f.a, f.b] : f.k === 'fpump' ? [f.in, f.out] : null
                    const out: React.ReactNode[] = []
                    if (pair && q !== undefined && Math.abs(q) > 0.15) {
                      const A = def.ports.find((x) => x.id === pair[0]), B = def.ports.find((x) => x.id === pair[1])
                      // limiteur de débit unidirectionnel : le retour libre passe par la dérivation du clapet, sous l'étrangleur
                      const bypass = f.k === 'fthrottle' && f.oneWay && q < 0 && A && B
                      const pts = bypass
                        ? (() => { const cxm = (A!.x + B!.x) / 2, dxl = A!.x < B!.x ? 1 : -1; return `${cxm + 19 * dxl},${A!.y} ${cxm + 19 * dxl},${A!.y + 22} ${cxm - 19 * dxl},${A!.y + 22} ${cxm - 19 * dxl},${A!.y}` })()
                        : A && B ? `${A.x},${A.y} ${B.x},${B.y}` : ''
                      if (A && B) out.push(
                        <polyline key="oil" points={pts} fill="none" stroke="#fff" strokeWidth={1.4} strokeLinecap="round" strokeDasharray="0.5 5" pointerEvents="none">
                          <animate attributeName="stroke-dashoffset" from="0" to={bypass || q > 0 ? '-11' : '11'} dur={`${Math.max(0.25, Math.min(3, 14 / Math.abs(q))) / spd}s`} repeatCount="indefinite" />
                        </polyline>,
                      )
                    }
                    if (f.k === 'fmotor') {
                      const rpm = p.sim.motorRpm?.[s.id] ?? 0
                      if (rpm > 0.5) {
                        const vertical = def.ports.some((x) => x.dir === 'up' || x.dir === 'down')
                        const mc = vertical ? { x: def.ports[0].x, y: def.h / 2 } : { x: def.w / 2, y: def.h / 2 }
                        out.push(<Rotor key="rot" cx={mc.x} cy={mc.y} r={17} dir={(p.sim.fluidMotor[s.id] ?? 1) >= 0 ? 1 : -1} dur={Math.max(0.35, Math.min(6, 200 / rpm)) / spd} />)
                      }
                    }
                    return out.length ? <g pointerEvents="none">{out}</g> : null
                  })()}
                  {model?.k === 'source' && isSourceBlock(def.id) && (
                    <g stroke="none" fill="currentColor" pointerEvents="none">
                      <text x={def.w / 2} y={11} fontSize={8} textAnchor="middle" fontWeight={700}>{sourceCaption(s, def)}</text>
                      {Object.entries(sourcePots(s, def)).map(([pid, pot]) => {
                        const port = def.ports.find((q) => q.id === pid)
                        return port ? <text key={pid} x={port.x} y={21} fontSize={5.5} textAnchor="middle">{pot === '-' ? '−' : pot === 'LI' ? 'L' : pot === 'NI' ? 'N' : pot}</text> : null
                      })}
                    </g>
                  )}
                  {model?.k === 'switch' && (model.pos3 || model.sel) && p.sim && <text x={def.w + 3} y={9} fontSize={9} stroke="none" fill="#e53935" fontWeight={700} pointerEvents="none">{model.sel ? String(p.sim.pos3?.[s.id] ?? 1) : ['0', '1', '2'][p.sim.pos3?.[s.id] ?? 0]}</text>}
                  {model?.k === 'source' && !isSourceBlock(def.id) && s.volts ? <text x={def.w / 2} y={def.h + 8} fontSize={6.5} textAnchor="middle" stroke="none" fill="currentColor" pointerEvents="none">{s.volts} V</text> : null}
                  {lit && model?.k === 'load' && model.spin && <Rotor {...model.spin} dir={p.sim?.rotation?.[s.id] ?? 1} />}
                  {lit && model?.k === 'load' && model.role === 'motor' && p.sim?.rotation?.[s.id] && <text x={def.w + 3} y={def.h / 2} fontSize={11} stroke="none" fill="#1f8f3a" fontWeight={700} pointerEvents="none">{p.sim.rotation[s.id] === 1 ? '↻' : '↺'}</text>}
                </g>
                {def.ports.map((pt) => {
                  const text = terms[s.id]?.[pt.id] ?? pt.label
                  if (!text) return null
                  const pos = portPos(s, pt.id)!
                  const off = { up: [4, -3], down: [4, 9], left: [-4, -3], right: [4, -3] }[pos.dir]
                  return <text key={pt.id} x={pos.x + off[0]} y={pos.y + off[1]} fontSize={6} fill="currentColor" stroke="none" textAnchor={pos.dir === 'left' ? 'end' : 'start'}>{text}</text>
                })}
                {doc.showNames && def.cat !== 'sim' && (
                  <text transform={`translate(${s.nameOff?.x ?? 0} ${s.nameOff?.y ?? 0})`} x={(b.x1 + b.x2) / 2} y={b.y2 + 4 + (doc.nameStyle?.size ?? 7)} fontSize={doc.nameStyle?.size ?? 7} fontFamily={fontCss(doc.nameStyle?.font)} fontWeight={doc.nameStyle?.bold ? 700 : 400} fontStyle={doc.nameStyle?.italic ? 'italic' : 'normal'} textAnchor="middle" fill="#555" stroke="none">{lines(s.nameText || def.name[p.lang], (b.x1 + b.x2) / 2, (doc.nameStyle?.size ?? 7) * 1.15)}</text>
                )}
                {p.sim?.fluidInfo?.[s.id] && (
                  <text x={(b.x1 + b.x2) / 2} y={b.y2 + 11} fontSize={8} fontWeight={700} textAnchor="middle" fill="#0d47a1" stroke="#fff" strokeWidth={2.5} paintOrder="stroke" pointerEvents="none">{lines(p.sim.fluidInfo[s.id], (b.x1 + b.x2) / 2, 8.5)}</text>
                )}
                {(s.label || s.desc || crossRefs[s.id]?.length) && (
                  <g transform={`translate(${s.labelOff?.x ?? 0} ${s.labelOff?.y ?? 0})`}>
                    {s.label && <text x={b.x2 + 6} y={(b.y1 + b.y2) / 2} fontSize={10 * ls} fontWeight={700} fill="currentColor" stroke="none">{s.label}</text>}
                    {s.desc && <text x={b.x2 + 6} y={(b.y1 + b.y2) / 2 + 10 * ls} fontSize={7 * ls} fill="currentColor" stroke="none">{lines(s.desc, b.x2 + 6, 8.5 * ls)}</text>}
                    {crossRefs[s.id]?.map((r, i) => (
                      <text key={i} x={b.x2 + 6} y={(b.y1 + b.y2) / 2 + ((s.desc ? 12 + 8.5 * s.desc.split('\n').length : 10) + i * 8) * ls} fontSize={6.5 * ls} fill="#444" stroke="none">{r}</text>
                    ))}
                  </g>
                )}
              </g>
            )
          })}
        </g>

        {/* Couche interface : hors export */}
        <g className="ui">
          <rect data-titleblock="1" className="tb-hit" x={PAPER_SIZE[doc.paper].w - MARGIN - TB_W} y={PAPER_SIZE[doc.paper].h - MARGIN - TB_H} width={TB_W} height={TB_H} />
          {showGrid && (
            <>
              <defs><pattern id="grid-dots" width={GRID} height={GRID} patternUnits="userSpaceOnUse"><circle cx={0} cy={0} r={0.7} fill="#7a8696" fillOpacity={0.55} /></pattern></defs>
              <rect x={MARGIN} y={MARGIN} width={PAPER_SIZE[doc.paper].w - 2 * MARGIN} height={PAPER_SIZE[doc.paper].h - 2 * MARGIN} fill="url(#grid-dots)" pointerEvents="none" />
            </>
          )}
          {shapesOn && !shapesLocked && (doc.shapes ?? []).map((s) => {
            const b = shapeBox(s)
            const on = sel.includes(s.id)
            const boxed = s.kind === 'rect' || s.kind === 'ellipse' || s.kind === 'image' || s.kind === 'arc'
            return (
              <g key={s.id} data-shape={s.id} className={'shape-hit' + (s.kind === 'image' ? ' solid' : '')} transform={s.rot ? `rotate(${s.rot} ${(b.x1 + b.x2) / 2} ${(b.y1 + b.y2) / 2})` : undefined}>
                {s.kind === 'line'
                  ? <line x1={s.x} y1={s.y} x2={s.x + s.w} y2={s.y + s.h} />
                  : s.kind === 'ellipse'
                    ? <ellipse cx={(b.x1 + b.x2) / 2} cy={(b.y1 + b.y2) / 2} rx={(b.x2 - b.x1) / 2} ry={(b.y2 - b.y1) / 2} />
                    : s.kind === 'arc'
                      ? <path d={arcPath(s)} />
                      : s.kind === 'poly'
                        ? (s.closed ? <polygon points={[{ x: s.x, y: s.y }, ...polyPoints(s)].map((q) => `${q.x},${q.y}`).join(' ')} /> : <polyline points={[{ x: s.x, y: s.y }, ...polyPoints(s)].map((q) => `${q.x},${q.y}`).join(' ')} />)
                        : <rect x={b.x1} y={b.y1} width={b.x2 - b.x1} height={b.y2 - b.y1} />}
                {s.label && s.kind === 'rect' && <rect x={b.x1 + 4} y={b.y1 + 2} width={s.label.length * 6 + 8} height={14} className="shape-label-hit" />}
                {on && sel.length === 1 && boxed && <rect x={b.x1} y={b.y1} width={b.x2 - b.x1} height={b.y2 - b.y1} className="shape-sel" />}
                {on && sel.length === 1 && shapeHandles(s).map((hd) => <rect key={hd.code} data-shandle={s.id + '|' + hd.code} className="shandle" x={hd.x - 4} y={hd.y - 4} width={8} height={8} />)}
              </g>
            )
          })}
          {drawing && <g pointerEvents="none" opacity={0.75}><ShapeView s={drawing} /></g>}
          {poly && (
            <g pointerEvents="none" opacity={0.85}>
              <ShapeView s={{ id: 'draft', kind: 'poly', x: poly[0].x, y: poly[0].y, w: 0, h: 0, pts: poly.slice(1).map((q) => ({ x: q.x - poly[0].x, y: q.y - poly[0].y })), stroke: 'solid', width: 1.6, color: '#000000', ...p.toolStyle }} />
              <line x1={poly[poly.length - 1].x} y1={poly[poly.length - 1].y} x2={snap(mouse.x)} y2={snap(mouse.y)} stroke="#0b6bcb" strokeWidth={1.2} strokeDasharray="4 3" />
              {poly.map((q, i) => <rect key={i} x={q.x - 3} y={q.y - 3} width={6} height={6} className="via-dot" />)}
            </g>
          )}
          {doc.wires.map((wr) => {
            const a = symById(wr.from.symId), b = symById(wr.to.symId)
            if (!a || !b) return null
            const pa = portPos(a, wr.from.portId), pb = portPos(b, wr.to.portId)
            if (!pa || !pb) return null
            const routed = routes[wr.id] ?? routeVia(pa, pb, wr.via ?? [])
            const pts = pointsAttr(routed)
            const handles = sel.length === 1 && sel[0] === wr.id
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
            const on = sel.includes(s.id)
            const op = p.sim && isOperableDef(def)
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
                {(s.label || s.desc) && (() => {
                  const w = (Math.max((s.label?.length ?? 0) * 6.5, ...(s.desc ?? '').split('\n').map((l) => l.length * 4)) + 6) * ls
                  const h = ((s.label ? 12 : 0) + (s.desc ? 8.5 * s.desc.split('\n').length + 1 : 0) + 2) * ls
                  return <rect data-lbl={s.id} className="lbl-hit" x={b.x2 + 3 + (s.labelOff?.x ?? 0)} y={(b.y1 + b.y2) / 2 - 10 * ls + (s.labelOff?.y ?? 0)} width={w} height={h} />
                })()}
              </g>
            )
          })}
          {doc.showNames && doc.symbols.map((s) => {
            const def = SYMBOL_MAP[s.defId]
            if (def.cat === 'sim') return null
            const b = symBBox(s)
            const fs = doc.nameStyle?.size ?? 7
            const nl = (s.nameText || def.name[p.lang]).split('\n')
            const w = Math.max(...nl.map((l) => l.length)) * fs * (doc.nameStyle?.bold ? 0.62 : 0.55) + 6
            return <rect key={'nm' + s.id} data-nm={s.id} className="lbl-hit" x={(b.x1 + b.x2) / 2 - w / 2 + (s.nameOff?.x ?? 0)} y={b.y2 + 2 + (s.nameOff?.y ?? 0)} width={w} height={fs * 1.15 * nl.length + 5} />
          })}
          {(doc.notes ?? []).map((n) => {
            const lines = n.text.split('\n')
            const w = Math.max(...lines.map((l) => l.length)) * n.size * 0.6 + 6
            return <rect key={n.id} data-note={n.id} className={sel.includes(n.id) ? 'sel-box lbl-hit' : 'lbl-hit'} x={n.x - 3} y={n.y - 1} width={w} height={lines.length * n.size * 1.2 + 4} transform={n.rot ? `rotate(${n.rot} ${n.x} ${n.y})` : undefined} />
          })}
          {(doc.instruments ?? []).map((ins) => {
            const simDoc = { ...doc, symbols: [...doc.symbols, ...(p.extra ?? [])] }
            const ctx: PickContext = { symbols: doc.symbols, defs: SYMBOL_MAP, routes, wires: doc.wires }
            let value: number | null | undefined
            let touching: boolean[] = [false, false]
            if (ins.kind === 'voltmeter') {
              const [a, b] = probesOf(ins)
              touching = [!!pickAt(a, ctx).node, !!pickAt(b, ctx).node]
              value = p.sim ? readVoltage(ins, ctx, p.sim, simDoc, SYMBOL_MAP) : undefined
            } else if (ins.kind === 'pressure') {
              touching = [!!pickAt(probesOf(ins)[0], ctx).node]
              value = p.sim ? readPressure(ins, ctx, p.sim).bar : undefined
            } else if (ins.kind === 'tacho') {
              const r = p.sim ? readSpeed(ins, doc.symbols, SYMBOL_MAP, p.sim) : undefined
              touching = [!!r?.found]
              value = r ? r.rpm : undefined
            } else {
              const c = p.sim ? readCurrent(ins, ctx, p.sim) : undefined
              touching = [!!pickAt(jawPoint(ins), ctx, 9).wire]
              value = c ? c.amps : undefined
            }
            return <InstrumentView key={ins.id} instr={ins} value={value} touching={touching} lang={p.lang} />
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
          {ruler && (() => {
            const b = ruler.b ?? mouse
            if (!b) return null
            const dx = Math.abs(b.x - ruler.a.x) * UNIT_MM, dy = Math.abs(b.y - ruler.a.y) * UNIT_MM, d = Math.hypot(dx, dy)
            const mx = (ruler.a.x + b.x) / 2, my = (ruler.a.y + b.y) / 2
            const txt = `${d.toFixed(1)} mm  (Δx ${dx.toFixed(1)} · Δy ${dy.toFixed(1)})`
            return (
              <g pointerEvents="none">
                <path d={`M${ruler.a.x} ${ruler.a.y}L${b.x} ${b.y}`} stroke="#e53935" strokeWidth={1} strokeDasharray="4 2" fill="none" />
                <circle cx={ruler.a.x} cy={ruler.a.y} r={2.5} fill="#e53935" /><circle cx={b.x} cy={b.y} r={2.5} fill="#e53935" />
                <rect x={mx - txt.length * 2.6} y={my - 13} width={txt.length * 5.2} height={12} rx={3} fill="#fff" stroke="#e53935" strokeWidth={0.6} />
                <text x={mx} y={my - 4} textAnchor="middle" fontSize={8} fill="#c62828" stroke="none" fontWeight={700}>{txt}</text>
              </g>
            )
          })()}
          {band && (
            <rect className="band" x={Math.min(band.x0, band.x1)} y={Math.min(band.y0, band.y1)}
              width={Math.abs(band.x1 - band.x0)} height={Math.abs(band.y1 - band.y0)} />
          )}
        </g>
      </g>
    </svg>
    <div className="zoombar">
      <button className={showGrid ? 'on' : ''} onClick={() => { setShowGrid(!showGrid); try { localStorage.setItem('albertschema.grid', showGrid ? '0' : '1') } catch { /* ignoré */ } }} title={p.labels.grid} aria-label={p.labels.grid} aria-pressed={showGrid}>⋮⋮</button>
      <button onClick={() => zoomBy(1 / 1.25)} title={p.labels.zoomOut} aria-label={p.labels.zoomOut}>−</button>
      <span>{Math.round(view.k * 100)} %</span>
      <button onClick={() => zoomBy(1.25)} title={p.labels.zoomIn} aria-label={p.labels.zoomIn}>+</button>
      <button onClick={() => fit()} title={p.labels.fit} aria-label={p.labels.fit}>⤢</button>
    </div>
    <div className="coords">{Math.round(mouse.x * UNIT_MM)} , {Math.round(mouse.y * UNIT_MM)} mm</div>
    </>
  )
}
