import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Doc, Note, Domain, Lang, Paper, PlacedSymbol, Wire } from './types'
import { CATEGORIES, loadLibrary, SYMBOLS, SYMBOL_MAP } from './symbols'
import { tr, type Key } from './i18n'
import { symBBox, uid } from './geometry'
import Canvas from './Canvas'
import Feedback from './Feedback'
import { bomRows, exportCsv, exportPng, exportSvg, printProject, printSheet, saveJson, sheetSvg, wireRows } from './exporters'
import { delayedCascade, motorStarter, motorStarterTransformer, pneumaticAuto, pneumaticCylinder, pneumaticElectric, reversingStarter, startLamps, timerOnDelay } from './templates'
import { duplicateTerms, editTerm, effectiveTerms, ensureUnique, othersTerms, termGroups } from './terminals'
import { DEFAULT_DELAY_S, isOperableDef, simulate, type SimInputs, type SimMemory } from './sim/engine'
import Chrono, { type TraceRow } from './Chrono'
import { checkDoc } from './check'
import { netLabels } from './nets'
import { pagesOf as pagesOfDoc } from './pages'
import { addPage, deletePage, mergedDoc, pageCount, pageOfSymbols, renamePage, switchPage } from './pages'
import { BUILTIN_META } from './galleryMeta'
import { EXERCISES, runExercise, type StepResult } from './exercises'
import { decodeDoc, encodeDoc, fragmentFromHash, shareUrl } from './share'
import { adaptiveScore, hasUsage, recordUse, resetUsage, usageCount } from './usage'
import { getShare, globalShare, loadGlobalUsage, setShare, shareUse, type ShareChoice } from './globalUsage'

const STORE = 'albertschema.doc'
/** Entreprise et auteur saisis la dernière fois : repris pour chaque nouveau schéma. */
function titleDefaults(): { author: string; company: string } {
  try {
    const d = JSON.parse(localStorage.getItem('albertschema.titleDefaults') || '{}')
    return { author: String(d.author ?? ''), company: String(d.company ?? '') }
  } catch {
    return { author: '', company: '' }
  }
}

const emptyDoc = (): Doc => ({
  version: 1,
  paper: 'A3',
  title: { title: '', ...titleDefaults(), date: new Date().toISOString().slice(0, 10), revision: 'A', sheet: '1/1' },
  symbols: [],
  wires: [],
})

/** Retire les symboles dont la définition n'existe plus et les conducteurs orphelins. */
function sanitize(d: Doc): Doc {
  const clean = <T extends { symbols: PlacedSymbol[]; wires: Wire[] }>(x: T): T => {
    const symbols = x.symbols.filter((s) => SYMBOL_MAP[s.defId])
    const ok = new Set(symbols.map((s) => s.id))
    return { ...x, symbols, wires: x.wires.filter((w) => ok.has(w.from.symId) && ok.has(w.to.symId)) }
  }
  const cur = clean(d)
  return d.pages ? { ...cur, pages: d.pages.map(clean) } : cur
}

function loadDoc(): Doc {
  try {
    const raw = localStorage.getItem(STORE)
    if (raw) return sanitize(JSON.parse(raw) as Doc)
  } catch { /* stockage indisponible : on repart d'une feuille vierge */ }
  return emptyDoc()
}

function loadRecent(): string[] {
  try {
    return (JSON.parse(localStorage.getItem('albertschema.recent') || '[]') as string[]).filter((id) => SYMBOL_MAP[id])
  } catch {
    return []
  }
}

const nextLabel = (doc: Doc, defId: string) => {
  const def = SYMBOL_MAP[defId]
  const prefix = def.prefix
  if (!prefix) return ''
  // un contact commandé par bobine reprend le repère de la dernière bobine posée (même relais)
  if (def.sim?.k === 'switch' && def.sim.ctl === 'coil') {
    for (let i = doc.symbols.length - 1; i >= 0; i--) {
      const s = doc.symbols[i]
      if (SYMBOL_MAP[s.defId]?.sim?.k === 'coil' && s.label) return s.label
    }
  }
  const re = new RegExp('^' + prefix + '(\\d+)$')
  let max = 0
  for (const s of doc.symbols) {
    const m = re.exec(s.label)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return prefix + (max + 1)
}

const TEMPLATE_FN: Record<string, (b: Doc) => Doc> = {
  tplMotor: motorStarter, tplLamps: startLamps, tplTimer: timerOnDelay, tplTrafo: motorStarterTransformer, tplCascade: delayedCascade,
  tplReversing: reversingStarter, tplPneu: pneumaticCylinder, tplPneuElec: pneumaticElectric, tplPneuAuto: pneumaticAuto,
}
const GALLERY = BUILTIN_META.map((m) => ({ ...m, fn: TEMPLATE_FN[m.key] }))
/** Exemple publié par l'administrateur (le schéma est téléchargé à l'ouverture). */
interface RemoteExample { id: string; title: { fr: string; en: string }; about: { fr: string; en: string }; level: 1 | 2 | 3; order: number; n?: number }

const TOP = '__top'
const DOMAINS: Domain[] = ['electrical', 'pneumatic', 'hydraulic']
const WIRE_COLORS = ['#000000', '#0050c8', '#c80000', '#008000', '#8a5a00', '#7a7a7a', '#e08000', '#6a00a0']

const SHORTCUTS: Record<Lang, [string, string][]> = {
  fr: [
    ['Clic sur un symbole, puis clic', 'Poser un symbole (répétable)'],
    ['Glisser depuis la bibliothèque', 'Poser un symbole à l’endroit voulu'],
    ['Glisser ou cliquer depuis une borne', 'Tracer un conducteur (les clics sur le vide posent des coudes)'],
    ['Retour arrière (pendant un tracé)', 'Retirer le dernier coude'],
    ['Poignées d’un conducteur sélectionné', 'Créer, déplacer ou retirer (double-clic) un coude'],
    ['R', 'Pivoter (symbole sélectionné ou en cours de pose)'],
    ['Flèches (+ Maj)', 'Déplacer la sélection (pas de grille ×5)'],
    ['Ctrl + A / Ctrl + D', 'Tout sélectionner / dupliquer'],
    ['Ctrl + C / Ctrl + V', 'Copier / coller'],
    ['Ctrl + Z / Ctrl + Y', 'Annuler / rétablir'],
    ['Suppr', 'Supprimer la sélection'],
    ['Échap', 'Annuler l’action en cours / désélectionner'],
    ['Molette', 'Zoom centré sur le curseur'],
    ['Glisser avec le clic droit, ou Espace + glisser', 'Déplacer la vue'],
    ['Clic droit (sans bouger)', 'Menu contextuel'],
    ['F', 'Ajuster la feuille à la fenêtre'],
    ['Ctrl + S', 'Enregistrer le fichier'],
    ['?', 'Afficher cette aide'],
  ],
  en: [
    ['Click a symbol, then click', 'Place a symbol (repeatable)'],
    ['Drag from the library', 'Drop a symbol where you want it'],
    ['Drag or click from a terminal', 'Draw a conductor (clicks on empty space add bends)'],
    ['Backspace (while drawing)', 'Remove the last bend'],
    ['Handles of a selected conductor', 'Create, move or remove (double-click) a bend'],
    ['R', 'Rotate (selected symbol or while placing)'],
    ['Arrows (+ Shift)', 'Move the selection (grid step ×5)'],
    ['Ctrl + A / Ctrl + D', 'Select all / duplicate'],
    ['Ctrl + C / Ctrl + V', 'Copy / paste'],
    ['Ctrl + Z / Ctrl + Y', 'Undo / redo'],
    ['Del', 'Delete the selection'],
    ['Esc', 'Cancel the current action / deselect'],
    ['Wheel', 'Zoom around the cursor'],
    ['Right-drag, or Space + drag', 'Pan the view'],
    ['Right-click (no movement)', 'Context menu'],
    ['F', 'Fit the sheet to the window'],
    ['Ctrl + S', 'Save the file'],
    ['?', 'Show this help'],
  ],
}

function Editor() {
  const [lang, setLang] = useState<Lang>(() => (localStorage.getItem('albertschema.lang') as Lang) || 'fr')
  const [h, setH] = useState(() => ({ doc: loadDoc(), past: [] as Doc[], future: [] as Doc[] }))
  const [sel, setSel] = useState<string[]>([])
  const [placing, setPlacing] = useState<string | null>(null)
  const [domain, setDomain] = useState<Domain>('electrical')
  const [query, setQuery] = useState('')
  const [catByDomain, setCatByDomain] = useState<Record<Domain, string>>({ electrical: '', pneumatic: '', hydraulic: '' })
  const [showCredits, setShowCredits] = useState(false)
  const [showFeedback, setShowFeedback] = useState(false)
  const [usageTick, setUsageTick] = useState(0) // relance le classement après chaque pose
  const [share, setShareState] = useState<ShareChoice>(getShare)
  const [askShare, setAskShare] = useState(false)
  const chooseShare = (v: 'yes' | 'no') => { setShare(v); setShareState(v); setAskShare(false) }

  useEffect(() => {
    // classement commun : chargé en arrière-plan, puis le classement est recalculé
    loadGlobalUsage().then(() => setUsageTick((n) => n + 1))
  }, [])
  const toggleTheme = () => {
    const root = document.documentElement
    const dark = root.dataset.theme ? root.dataset.theme === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches
    root.dataset.theme = dark ? 'light' : 'dark'
    try { localStorage.setItem('albertschema.theme', root.dataset.theme) } catch { /* ignoré */ }
  }
  const [recent, setRecent] = useState<string[]>(loadRecent)
  const [showBom, setShowBom] = useState(false)
  const [showKeys, setShowKeys] = useState(false)
  const [showGallery, setShowGallery] = useState(false)
  const [remoteEx, setRemoteEx] = useState<{ items: RemoteExample[]; hidden: string[] }>({ items: [], hidden: [] })
  useEffect(() => {
    // exemples publiés par l'administrateur : chargés à l'ouverture de la galerie ; sans réseau, seuls les exemples intégrés restent
    if (!showGallery) return
    fetch(import.meta.env.BASE_URL + 'api/examples')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d && Array.isArray(d.items)) setRemoteEx({ items: d.items, hidden: Array.isArray(d.hidden) ? d.hidden : [] }) })
      .catch(() => undefined)
  }, [showGallery])
  const openRemote = (ex: RemoteExample) => {
    if (doc.symbols.length && !window.confirm(tr(lang, 'galleryReplace'))) return
    fetch(import.meta.env.BASE_URL + 'api/examples?id=' + encodeURIComponent(ex.id))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('http'))))
      .then((d: Doc) => {
        if (d.version !== 1 || !Array.isArray(d.symbols)) throw new Error('format')
        commit(() => sanitize(d))
        setSel([])
        setShowGallery(false)
      })
      .catch(() => say(tr(lang, 'toastInvalid')))
  }
  const [exResult, setExResult] = useState<Record<string, { ok: boolean; steps: StepResult[]; missing: string[] }>>({})
  const [toast, setToast] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; target: string | null } | null>(null)
  const contentRef = useRef<SVGGElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const exportRef = useRef<HTMLDetailsElement>(null)
  // blocs personnels : groupes de symboles câblés, enregistrés sur cet appareil
  interface Block { id: string; name: string; symbols: PlacedSymbol[]; wires: Wire[] }
  const [blocks, setBlocks] = useState<Block[]>(() => {
    try { return JSON.parse(localStorage.getItem('albertschema.blocks') || '[]') } catch { return [] }
  })
  const storeBlocks = (next: Block[]) => {
    setBlocks(next)
    try { localStorage.setItem('albertschema.blocks', JSON.stringify(next)) } catch { /* stockage plein ou refusé */ }
  }
  const clip = useRef<{ symbols: PlacedSymbol[]; wires: Wire[] } | null>(null)
  const toastTimer = useRef<number>()
  const doc = h.doc
  const t = (k: Key) => tr(lang, k)

  // ── simulation
  const [wiringOn, setWiringOn] = useState(false)
  const [hiPort, setHiPort] = useState<{ symId: string; portId: string } | null>(null)
  const [simMode, setSimMode] = useState(false)
  const [simIn, setSimIn] = useState<SimInputs>({ pressed: new Set(), toggled: new Set(), cut: new Set() })
  const coilMemory = useRef<SimMemory>({})
  const [simTick, setSimTick] = useState(0) // relance le calcul à l'échéance d'une temporisation
  // horloge simulée : vitesse réglable, pause et avance au pas
  const clock = useRef({ v: Date.now(), r: Date.now(), speed: 1, paused: false })
  const [clockUi, setClockUi] = useState({ speed: 1, paused: false })
  const vnow = () => (clock.current.paused ? clock.current.v : clock.current.v + (Date.now() - clock.current.r) * clock.current.speed)
  const rebase = (patch: Partial<typeof clock.current>) => {
    clock.current = { ...clock.current, v: vnow(), r: Date.now(), ...patch }
    setClockUi({ speed: clock.current.speed, paused: clock.current.paused })
    setSimTick((n) => n + 1)
  }
  // le projet entier (toutes les feuilles) : la simulation, le contrôle et la nomenclature le traitent d'un bloc
  const all = useMemo(() => mergedDoc(doc), [doc])
  const sim = useMemo(() => (simMode ? simulate(all, SYMBOL_MAP, coilMemory.current, simIn, vnow()) : null), [simMode, all, simIn, simTick]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!sim) return
    coilMemory.current = sim.state
    if (sim.pendingMs === null || clock.current.paused) return
    const id = window.setTimeout(() => setSimTick((n) => n + 1), sim.pendingMs / clock.current.speed + 15)
    return () => window.clearTimeout(id)
  }, [sim])
  // chronogramme : on note chaque changement d'état des appareils repérés
  const trace = useRef<{ t0: number; rows: TraceRow[] }>({ t0: 0, rows: [] })
  const [chronoNow, setChronoNow] = useState(0)
  const signalNames = useMemo(() => {
    const names: string[] = []
    for (const s of all.symbols) {
      const m = SYMBOL_MAP[s.defId]?.sim
      if (s.label && (m?.k === 'coil' || m?.k === 'load' || SYMBOL_MAP[s.defId]?.fluid?.k === 'cyl' || isOperableDef(SYMBOL_MAP[s.defId])) && !names.includes(s.label)) names.push(s.label)
    }
    return names
  }, [all.symbols])
  useEffect(() => {
    if (!sim) return
    const v: Record<string, boolean> = {}
    for (const s of all.symbols) {
      const m = SYMBOL_MAP[s.defId]?.sim
      if (!s.label) continue
      if (m?.k === 'coil' || m?.k === 'load') v[s.label] = v[s.label] || sim.energized.has(s.id)
      else if (SYMBOL_MAP[s.defId]?.fluid?.k === 'cyl') v[s.label] = v[s.label] || (sim.cylPos[s.id] ?? 0) > 0.5
      else if (isOperableDef(SYMBOL_MAP[s.defId])) v[s.label] = v[s.label] || simIn.pressed.has(s.id) || simIn.toggled.has(s.id)
    }
    const last = trace.current.rows[trace.current.rows.length - 1]
    if (!last || signalNames.some((n) => !!last.v[n] !== !!v[n])) trace.current.rows.push({ t: vnow() - trace.current.t0, v })
    setChronoNow(vnow() - trace.current.t0)
  }, [sim]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!simMode || clockUi.paused) return
    const id = window.setInterval(() => setChronoNow(vnow() - trace.current.t0), 250)
    return () => window.clearInterval(id)
  }, [simMode, clockUi.paused, clockUi.speed]) // eslint-disable-line react-hooks/exhaustive-deps
  const [showCheck, setShowCheck] = useState(false)
  const issues = useMemo(() => (showCheck ? checkDoc(all, SYMBOL_MAP, lang) : []), [showCheck, all, lang])
  const startSim = () => {
    coilMemory.current = {}
    clock.current = { v: Date.now(), r: Date.now(), speed: clock.current.speed, paused: false }
    setClockUi({ speed: clock.current.speed, paused: false })
    trace.current = { t0: clock.current.v, rows: [] }
    setSimIn({ pressed: new Set(), toggled: new Set(), cut: new Set() })
    setPlacing(null)
    setSel([])
    setSimMode(true)
  }
  const onSimPress = useCallback((id: string, down: boolean) => {
    setSimIn((s) => {
      const pressed = new Set(s.pressed)
      if (down) pressed.add(id)
      else pressed.delete(id)
      return { ...s, pressed }
    })
  }, [])
  const onSimFault = useCallback((id: string) => {
    setSimIn((s) => {
      const cut = new Set(s.cut)
      if (cut.has(id)) cut.delete(id)
      else cut.add(id)
      return { ...s, cut }
    })
  }, [])
  const onSimToggle = useCallback((id: string) => {
    setSimIn((s) => {
      const toggled = new Set(s.toggled)
      if (toggled.has(id)) toggled.delete(id)
      else toggled.add(id)
      return { ...s, toggled }
    })
  }, [])
  const coilLabels = useMemo(
    () => [...new Set(all.symbols.filter((s) => SYMBOL_MAP[s.defId]?.sim?.k === 'coil' && s.label).map((s) => s.label))],
    [all.symbols],
  )

  const say = useCallback((msg: string) => {
    setToast(msg)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 1800)
  }, [])

  const checkpoint = useCallback(() => setH((s) => ({ ...s, past: [...s.past.slice(-99), s.doc], future: [] })), [])
  const update = useCallback((fn: (d: Doc) => Doc) => setH((s) => ({ ...s, doc: fn(s.doc) })), [])
  const commit = useCallback(
    (fn: (d: Doc) => Doc) => setH((s) => ({ doc: fn(s.doc), past: [...s.past.slice(-99), s.doc], future: [] })),
    [],
  )
  const undo = useCallback(() => setH((s) => (s.past.length ? { doc: s.past[s.past.length - 1], past: s.past.slice(0, -1), future: [s.doc, ...s.future] } : s)), [])
  const redo = useCallback(() => setH((s) => (s.future.length ? { doc: s.future[0], past: [...s.past, s.doc], future: s.future.slice(1) } : s)), [])

  // schéma reçu par lien : lecture et simulation, rien n'est enregistré tant qu'on n'en garde pas une copie
  const [viewOnly, setViewOnly] = useState(() => !!fragmentFromHash(location.hash))
  useEffect(() => {
    const frag = fragmentFromHash(location.hash)
    if (!frag) return
    decodeDoc(frag)
      .then((d) => {
        setH({ doc: sanitize(d), past: [], future: [] })
        coilMemory.current = {}
        setSimMode(true)
      })
      .catch(() => { setViewOnly(false); say(tr(lang, 'toastInvalid')) })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (viewOnly) return
    try { localStorage.setItem(STORE, JSON.stringify(doc)) } catch { /* quota ou mode privé */ }
  }, [doc, viewOnly])
  const keepCopy = () => {
    if (!window.confirm(tr(lang, 'shareKeepConfirm'))) return
    history.replaceState(null, '', location.pathname + location.search)
    setViewOnly(false)
    setSimMode(false)
  }
  const copyShareLink = async () => {
    try {
      const url = shareUrl(await encodeDoc(doc))
      await navigator.clipboard.writeText(url)
      say(tr(lang, 'shareCopied'))
    } catch { say(tr(lang, 'shareFailed')) }
    if (exportRef.current) exportRef.current.open = false
  }
  useEffect(() => {
    try { localStorage.setItem('albertschema.lang', lang) } catch { /* ignoré */ }
    document.documentElement.lang = lang
  }, [lang])

  const onPlaced = useCallback((defId: string) => {
    recordUse(defId)
    shareUse(defId)
    if (getShare() === null) setAskShare(true)
    setUsageTick((n) => n + 1)
    setRecent((r) => {
      const next = [defId, ...r.filter((x) => x !== defId)].slice(0, 6)
      try { localStorage.setItem('albertschema.recent', JSON.stringify(next)) } catch { /* ignoré */ }
      return next
    })
  }, [])

  const deleteSel = useCallback(() => {
    if (!sel.length) return
    commit((d) => {
      const gone = new Set(sel)
      return {
        ...d,
        symbols: d.symbols.filter((s) => !gone.has(s.id)),
        wires: d.wires.filter((w) => !gone.has(w.id) && !gone.has(w.from.symId) && !gone.has(w.to.symId)),
        notes: (d.notes ?? []).filter((n) => !gone.has(n.id)),
      }
    })
    setSel([])
  }, [sel, commit])

  const rotateSel = useCallback(() => {
    if (!sel.length) return
    commit((d) => ({ ...d, symbols: d.symbols.map((s) => (sel.includes(s.id) ? { ...s, rot: (((s.rot + 90) % 360) as PlacedSymbol['rot']) } : s)) }))
  }, [sel, commit])

  const copySel = useCallback(() => {
    const syms = doc.symbols.filter((s) => sel.includes(s.id))
    const ids = new Set(syms.map((s) => s.id))
    clip.current = { symbols: syms, wires: doc.wires.filter((w) => ids.has(w.from.symId) && ids.has(w.to.symId)) }
    if (syms.length) say(tr(lang, 'toastCopied'))
  }, [doc, sel, say, lang])

  const paste = useCallback(() => {
    const c = clip.current
    if (!c || !c.symbols.length) return
    // identifiants créés avant la mise à jour : la sélection du collage en dépend
    const map = new Map<string, string>(c.symbols.map((s) => [s.id, uid()]))
    commit((d) => {
      const added: PlacedSymbol[] = []
      for (const s of c.symbols) {
        const m = SYMBOL_MAP[s.defId]?.sim
        const sameDevice = m?.k === 'switch' && m.ctl === 'coil' // un contact dupliqué reste sur le même appareil (même repère)
        const ns: PlacedSymbol = { ...s, id: map.get(s.id)!, x: s.x + 20, y: s.y + 20, label: sameDevice ? s.label : '', terms: undefined }
        if (!sameDevice) ns.label = nextLabel({ ...d, symbols: [...d.symbols, ...added] }, s.defId)
        added.push(ns)
      }
      const wires = c.wires.map((w) => ({
        ...w, id: uid(),
        from: { ...w.from, symId: map.get(w.from.symId)! },
        to: { ...w.to, symId: map.get(w.to.symId)! },
        ...(w.via?.length ? { via: w.via.map((v) => ({ x: v.x + 20, y: v.y + 20 })) } : {}),
      }))
      return { ...d, symbols: [...d.symbols, ...added], wires: [...d.wires, ...wires] }
    })
    setSel(Array.from(map.values()))
  }, [commit])

  /** aligne ou répartit les symboles sélectionnés (au moins deux ; trois pour répartir) */
  const alignSel = useCallback((kind: 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom' | 'distH' | 'distV') => {
    const items = doc.symbols.filter((s) => sel.includes(s.id)).map((s) => ({ s, b: symBBox(s) }))
    if (items.length < 2) return
    const delta = new Map<string, { dx: number; dy: number }>()
    const minX = Math.min(...items.map((i) => i.b.x1)), maxX = Math.max(...items.map((i) => i.b.x2))
    const minY = Math.min(...items.map((i) => i.b.y1)), maxY = Math.max(...items.map((i) => i.b.y2))
    if (kind === 'distH' || kind === 'distV') {
      if (items.length < 3) return
      const h = kind === 'distH'
      const sorted = [...items].sort((a, b) => (h ? a.b.x1 - b.b.x1 : a.b.y1 - b.b.y1))
      const size = sorted.reduce((t, i) => t + (h ? i.b.x2 - i.b.x1 : i.b.y2 - i.b.y1), 0)
      const gap = ((h ? maxX - minX : maxY - minY) - size) / (sorted.length - 1)
      let pos = h ? minX : minY
      for (const i of sorted) {
        const cur = h ? i.b.x1 : i.b.y1
        const d = Math.round((pos - cur) / 10) * 10
        delta.set(i.s.id, h ? { dx: d, dy: 0 } : { dx: 0, dy: d })
        pos += (h ? i.b.x2 - i.b.x1 : i.b.y2 - i.b.y1) + gap
      }
    } else {
      for (const i of items) {
        const cx = (i.b.x1 + i.b.x2) / 2, cy = (i.b.y1 + i.b.y2) / 2
        const dx = kind === 'left' ? minX - i.b.x1 : kind === 'right' ? maxX - i.b.x2 : kind === 'hcenter' ? (minX + maxX) / 2 - cx : 0
        const dy = kind === 'top' ? minY - i.b.y1 : kind === 'bottom' ? maxY - i.b.y2 : kind === 'vcenter' ? (minY + maxY) / 2 - cy : 0
        delta.set(i.s.id, { dx: Math.round(dx / 10) * 10, dy: Math.round(dy / 10) * 10 })
      }
    }
    commit((d) => ({ ...d, symbols: d.symbols.map((s) => { const m = delta.get(s.id); return m ? { ...s, x: s.x + m.dx, y: s.y + m.dy } : s }) }))
  }, [doc.symbols, sel, commit])

  const saveBlock = () => {
    const syms = doc.symbols.filter((s) => sel.includes(s.id))
    if (!syms.length) return
    const name = window.prompt(tr(lang, 'blockName'), '')?.trim()
    if (!name) return
    const b = syms.map((s) => symBBox(s))
    const ox = Math.min(...b.map((i) => i.x1)), oy = Math.min(...b.map((i) => i.y1))
    const ids = new Set(syms.map((s) => s.id))
    storeBlocks([...blocks, {
      id: uid(), name,
      symbols: syms.map((s) => ({ ...s, x: s.x - ox, y: s.y - oy })),
      wires: doc.wires.filter((w) => ids.has(w.from.symId) && ids.has(w.to.symId)).map((w) => ({ ...w, via: w.via?.map((v) => ({ x: v.x - ox, y: v.y - oy })) })),
    }])
    say(tr(lang, 'blockSaved'))
  }
  const insertBlock = (blk: Block) => {
    const map = new Map<string, string>(blk.symbols.map((s) => [s.id, uid()]))
    // un repère par appareil : tous les symboles d'un même repère (bobine et contacts) en reçoivent un nouveau, ensemble
    commit((d) => {
      const relabel = new Map<string, string>()
      const added: PlacedSymbol[] = []
      const groups = new Map<string, PlacedSymbol[]>()
      for (const s of blk.symbols) if (s.label) groups.set(s.label, [...(groups.get(s.label) ?? []), s])
      const work: Doc = { ...d, symbols: [...d.symbols] }
      for (const [label, members] of groups) {
        const rep = members.find((m) => SYMBOL_MAP[m.defId]?.sim?.k === 'coil') ?? members[0]
        // on garde le préfixe d'origine (KM, KT, S…) avec le premier numéro libre
        const pre = /^([A-Za-z]+)\d*$/.exec(label)?.[1]
        let nl = nextLabel(work, rep.defId)
        if (pre) {
          const re = new RegExp('^' + pre + '(\\d+)$')
          nl = pre + (1 + Math.max(0, ...work.symbols.map((x) => Number(re.exec(x.label)?.[1] ?? 0))))
        }
        relabel.set(label, nl)
        work.symbols.push({ ...rep, id: '_', label: nl })
      }
      const ox = 120, oy = 120
      for (const s of blk.symbols) added.push({ ...s, id: map.get(s.id)!, x: s.x + ox, y: s.y + oy, label: s.label ? relabel.get(s.label)! : '', terms: undefined })
      const wires = blk.wires.map((w) => ({
        ...w, id: uid(),
        from: { ...w.from, symId: map.get(w.from.symId)! },
        to: { ...w.to, symId: map.get(w.to.symId)! },
        ...(w.via?.length ? { via: w.via.map((v) => ({ x: v.x + ox, y: v.y + oy })) } : {}),
      }))
      return { ...d, symbols: [...d.symbols, ...added], wires: [...d.wires, ...wires] }
    })
    setSel(Array.from(map.values()))
    setDomain('electrical')
  }

  const duplicate = useCallback(() => { copySel(); paste() }, [copySel, paste])

  const nudge = useCallback((dx: number, dy: number) => {
    if (!sel.length) return
    commit((d) => ({
      ...d,
      symbols: d.symbols.map((s) => (sel.includes(s.id) ? { ...s, x: s.x + dx, y: s.y + dy } : s)),
      wires: d.wires.map((w) => (w.via?.length && sel.includes(w.from.symId) && sel.includes(w.to.symId) ? { ...w, via: w.via.map((v) => ({ x: v.x + dx, y: v.y + dy })) } : w)),
    }))
  }, [sel, commit])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (wiringOn && (e.key === 'Backspace' || e.key === 'Delete')) return // pendant un tracé, Retour arrière retire seulement le dernier coude
      const ctrl = e.ctrlKey || e.metaKey
      const k = e.key.toLowerCase()
      const step = e.shiftKey ? 50 : 10
      if (e.key === 'Escape') { setMenu(null); setPlacing(null); setSel([]); setShowKeys(false); setShowBom(false); setShowFeedback(false); setShowCredits(false) }
      else if (e.key === 'Delete' || e.key === 'Backspace') deleteSel()
      else if (k === 'r' && !ctrl) { if (!placing) rotateSel() }
      else if (e.key === '?') setShowKeys((v) => !v)
      else if (e.key === 'ArrowLeft') { e.preventDefault(); nudge(-step, 0) }
      else if (e.key === 'ArrowRight') { e.preventDefault(); nudge(step, 0) }
      else if (e.key === 'ArrowUp') { e.preventDefault(); nudge(0, -step) }
      else if (e.key === 'ArrowDown') { e.preventDefault(); nudge(0, step) }
      else if (ctrl && k === 'a') { e.preventDefault(); setSel([...doc.symbols.map((s) => s.id), ...doc.wires.map((w) => w.id)]) }
      else if (ctrl && k === 'd') { e.preventDefault(); duplicate() }
      else if (ctrl && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo() }
      else if (ctrl && k === 'y') { e.preventDefault(); redo() }
      else if (ctrl && k === 'c') copySel()
      else if (ctrl && k === 'v') paste()
      else if (ctrl && k === 's') { e.preventDefault(); saveJson(doc); say(tr(lang, 'toastSaved')) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [deleteSel, rotateSel, undo, redo, copySel, paste, duplicate, nudge, doc, placing, say, lang, simMode, wiringOn])

  const autoLabel = () => {
    commit((d) => {
      const counters: Record<string, number> = {}
      const order = [...d.symbols].sort((a, b) => a.x - b.x || a.y - b.y)
      const labels = new Map<string, string>()
      for (const s of order) {
        const p = SYMBOL_MAP[s.defId].prefix
        counters[p] = (counters[p] ?? 0) + 1
        labels.set(s.id, p + counters[p])
      }
      return { ...d, symbols: d.symbols.map((s) => ({ ...s, label: labels.get(s.id)! })) }
    })
    say(t('toastNumbered'))
  }

  const autoWire = () => {
    const labels = netLabels(all, SYMBOL_MAP)
    commit((d) => ({ ...d, wires: d.wires.map((w) => ({ ...w, label: labels[w.id] ?? w.label })) }))
    say(t('toastWires'))
  }

  const openFile = (f: File) => {
    f.text().then((txt) => {
      try {
        const d = JSON.parse(txt) as Doc
        if (d.version !== 1 || !Array.isArray(d.symbols)) throw new Error('format')
        commit(() => sanitize(d))
        setSel([])
      } catch {
        say(t('toastInvalid'))
      }
    })
  }

  const startTemplate = (fn: (b: Doc) => Doc) => {
    commit((d) => fn(d))
    setSel([])
  }

  const cat = catByDomain[domain] || TOP
  const list = useMemo(() => {
    const q = query.trim().toLowerCase()
    const now = Date.now()
    const sc = new Map<string, number>() // score adaptatif calculé une seule fois par symbole
    const score = (s: (typeof SYMBOLS)[number]) => {
      let v = sc.get(s.id)
      if (v === undefined) sc.set(s.id, (v = adaptiveScore(s, now)))
      return v
    }
    const found = SYMBOLS.filter(
      (s) =>
        !s.legacy && s.domain === domain &&
        (q
          ? s.name[lang].toLowerCase().includes(q) || s.name.en.toLowerCase().includes(q) || s.prefix.toLowerCase() === q
          : cat === TOP ? s.top || usageCount(s.id, now) >= 1 || globalShare(s.id) >= 30 : s.cat === cat),
    )
    if (q || cat === TOP) {
      // recherche et « les plus utilisés » : par score adaptatif (a priori + usage de l'utilisateur)
      found.sort((a, b) => score(b) - score(a))
      return found.slice(0, q ? 80 : 36)
    }
    // catégorie : groupes du plus au moins utilisé, puis symboles par score
    const gk = (s: (typeof SYMBOLS)[number]) => s.group?.fr ?? ''
    const gmax = new Map<string, number>()
    for (const s of found) gmax.set(gk(s), Math.max(gmax.get(gk(s)) ?? 0, score(s)))
    return found.sort((a, b) => gmax.get(gk(b))! - gmax.get(gk(a))! || gk(a).localeCompare(gk(b)) || score(b) - score(a))
  }, [domain, query, lang, cat, usageTick])
  const recents = useMemo(() => recent.map((id) => SYMBOL_MAP[id]).filter((s) => s && !s.legacy && s.domain === domain), [recent, domain])

  const selSym = sel.length === 1 ? doc.symbols.find((s) => s.id === sel[0]) : undefined
  const selNote = sel.length === 1 ? (doc.notes ?? []).find((n) => n.id === sel[0]) : undefined
  const patchNote = (patch: Partial<Note>) => update((d) => ({ ...d, notes: (d.notes ?? []).map((n) => (n.id === sel[0] ? { ...n, ...patch } : n)) }))
  const addNote = () => {
    const id = uid()
    commit((d) => ({ ...d, notes: [...(d.notes ?? []), { id, x: 160 + 10 * (d.notes?.length ?? 0), y: 120 + 10 * (d.notes?.length ?? 0), text: tr(lang, 'noteDefault'), size: 12 }] }))
    setSel([id])
  }
  const selWire = sel.length === 1 ? doc.wires.find((w) => w.id === sel[0]) : undefined
  const patchSym = (patch: Partial<PlacedSymbol>) =>
    update((d) => ({ ...d, symbols: d.symbols.map((s) => (s.id === sel[0] ? { ...s, ...patch } : s)) }))
  const patchWire = (patch: Partial<Wire>) =>
    update((d) => ({ ...d, wires: d.wires.map((w) => (w.id === sel[0] ? { ...w, ...patch } : w)) }))
  const patchTitle = (k: keyof Doc['title'], v: string) => {
    update((d) => ({ ...d, title: { ...d.title, [k]: v } }))
    if (k === 'author' || k === 'company') {
      try { localStorage.setItem('albertschema.titleDefaults', JSON.stringify({ ...titleDefaults(), [k]: v })) } catch { /* ignoré */ }
    }
  }
  const TB_FIELDS: (keyof Doc['title'])[] = ['title', 'project', 'docNumber', 'company', 'author', 'approver', 'date', 'revision', 'sheet']
  const [showTitleBlock, setShowTitleBlock] = useState(false)

  /** impression de toutes les feuilles : on affiche chaque page à son tour pour en capturer le dessin, puis on revient à la page d'origine */
  const printAllPages = async () => {
    if (exportRef.current) exportRef.current.open = false
    const start = doc.page ?? 0
    const svgs: string[] = []
    for (let i = 0; i < pageCount(doc); i++) {
      setH((s) => ({ ...s, doc: switchPage(s.doc, i) }))
      await new Promise((r) => setTimeout(r, 250))
      if (contentRef.current) svgs.push(sheetSvg(doc, contentRef.current))
    }
    setH((s) => ({ ...s, doc: switchPage(s.doc, start) }))
    printProject(doc, svgs, bomRows(all, lang), lang)
  }
  const pageTabs = pagesOfDoc(doc)
  const extraSyms = useMemo(() => pagesOfDoc(doc).filter((_, i) => i !== (doc.page ?? 0)).flatMap((pg) => pg.symbols), [doc])
  const pageOf = useMemo(() => pageOfSymbols(doc), [doc])
  const goPage = (i: number) => { if (i !== (doc.page ?? 0)) { commit((d) => switchPage(d, i)); setSel([]) } }
  const withContent = (fn: (c: SVGGElement) => void) => () => {
    if (exportRef.current) exportRef.current.open = false
    if (contentRef.current) fn(contentRef.current)
  }

  const hint = simMode ? t('simHint') : wiringOn ? t('hintWiring') : placing ? t('hintPlace') : sel.length ? t('hintSel') : t('hintIdle')

  const symButton = (s: (typeof SYMBOLS)[number]) => (
    <button key={s.id} className={'symbtn' + (placing === s.id ? ' on' : '') + (usageCount(s.id) >= 2 ? ' used' : '')} title={`${s.name[lang]} — ${s.std}`}
      draggable
      onDragStart={(e) => { e.dataTransfer.setData('text/x-albert-symbol', s.id); e.dataTransfer.effectAllowed = 'copy'; setPlacing(null) }}
      onClick={() => { setPlacing(placing === s.id ? null : s.id); setSel([]) }}>
      <svg viewBox={`-6 -6 ${s.w + 12} ${s.h + 12}`} stroke="currentColor" fill="none" strokeWidth={Math.max(2, Math.max(s.w, s.h) / 28)} strokeLinecap="round" strokeLinejoin="round"
        dangerouslySetInnerHTML={{ __html: s.svg.replace(/var\(--bg\)/g, 'transparent') }} />
      <span>{s.name[lang]}</span>
    </button>
  )

  return (
    <div className={'app' + (simMode ? ' simmode' : '')}>
      <header className="toolbar" role="toolbar">
        <span className="brand"><span className="vis" aria-hidden="true" />Albert<b>Schema</b></span>
        <div className="group">
          <button onClick={() => { if (!doc.symbols.length || confirm(t('newConfirm'))) { commit(() => emptyDoc()); setSel([]) } }}>{t('new')}</button>
          <button onClick={() => fileRef.current?.click()}>{t('open')}</button>
          <button onClick={() => { saveJson(doc); say(t('toastSaved')) }} title="Ctrl+S">{t('save')}</button>
        </div>
        <input ref={fileRef} type="file" accept=".json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) openFile(f); e.target.value = '' }} />
        <div className="group editonly">
          <button className="icon" onClick={undo} disabled={!h.past.length} title={`${t('undo')} (Ctrl+Z)`} aria-label={t('undo')}>↶</button>
          <button className="icon" onClick={redo} disabled={!h.future.length} title={`${t('redo')} (Ctrl+Y)`} aria-label={t('redo')}>↷</button>
        </div>
        <div className="group editonly">
          <button className="icon" onClick={rotateSel} disabled={!sel.length} title={`${t('rotate')} (R)`} aria-label={t('rotate')}>⟳</button>
          <button className="icon" onClick={duplicate} disabled={!sel.length} title={`${t('duplicate')} (Ctrl+D)`} aria-label={t('duplicate')}>⧉</button>
          <details className="menu">
            <summary className={sel.length < 2 ? 'dis' : ''} title={t('align')}>⇔ {t('align')} ▾</summary>
            {sel.length >= 2 && (
              <div className="menu-list" onClick={(e) => (e.currentTarget.parentElement as HTMLDetailsElement).removeAttribute('open')}>
                <button onClick={() => alignSel('left')}>{t('alignLeft')}</button>
                <button onClick={() => alignSel('hcenter')}>{t('alignHCenter')}</button>
                <button onClick={() => alignSel('right')}>{t('alignRight')}</button>
                <button onClick={() => alignSel('top')}>{t('alignTop')}</button>
                <button onClick={() => alignSel('vcenter')}>{t('alignVCenter')}</button>
                <button onClick={() => alignSel('bottom')}>{t('alignBottom')}</button>
                <button onClick={() => alignSel('distH')} disabled={sel.length < 3}>{t('distH')}</button>
                <button onClick={() => alignSel('distV')} disabled={sel.length < 3}>{t('distV')}</button>
              </div>
            )}
          </details>
          <button className="icon danger" onClick={deleteSel} disabled={!sel.length} title={`${t('delete')} (Suppr)`} aria-label={t('delete')}>🗑</button>
        </div>
        <div className="group editonly">
          <button onClick={autoLabel}>{t('autoLabel')}</button>
          <button onClick={autoWire}>{t('autoWire')}</button>
          <button onClick={() => setShowBom(true)}>{t('bom')}</button>
          <button onClick={() => setShowCheck(true)}>{t('check')}</button>
          <button onClick={() => setShowGallery(true)}>{t('gallery')}</button>
          <button onClick={addNote} title={t('note')}>T {t('note')}</button>
          <details className="menu">
            <summary>▦ {t('blocks')} ▾</summary>
            <div className="menu-list" onClick={(e) => { if ((e.target as HTMLElement).closest('.del')) return; (e.currentTarget.parentElement as HTMLDetailsElement).removeAttribute('open') }}>
              <button onClick={saveBlock} disabled={!sel.length}>{t('blockSave')}</button>
              {blocks.length === 0 && <p className="muted" style={{ margin: '6px 10px', fontSize: 11 }}>{t('blockNone')}</p>}
              {blocks.map((blk) => (
                <div key={blk.id} style={{ display: 'flex' }}>
                  <button style={{ flex: 1 }} onClick={() => insertBlock(blk)}>{blk.name} <span className="muted">({blk.symbols.length})</span></button>
                  <button className="del" title={t('delete')} aria-label={t('delete')} onClick={() => storeBlocks(blocks.filter((x) => x.id !== blk.id))}>×</button>
                </div>
              ))}
            </div>
          </details>
        </div>
        <div className="group">
          <button className={'simbtn' + (simMode ? ' on' : '')} onClick={() => (simMode ? setSimMode(false) : startSim())} title={t('simTitle')}>
            {simMode ? '■ ' + t('simStop') : '▶ ' + t('simStart')}
          </button>
          {simMode && (
            <>
              <button onClick={() => rebase({ paused: !clock.current.paused })}>{clockUi.paused ? '▶ ' + t('resume') : '⏸ ' + t('pause')}</button>
              {clockUi.paused && <button onClick={() => { clock.current = { ...clock.current, v: clock.current.v + (sim?.pendingMs ?? 500) + 15 }; setSimTick((n) => n + 1) }}>⏭ {t('step')}</button>}
              <select aria-label={t('speed')} title={t('speed')} value={clockUi.speed} onChange={(e) => rebase({ speed: Number(e.target.value) })}>
                {[0.5, 1, 2, 5, 10].map((v) => <option key={v} value={v}>× {v}</option>)}
              </select>
            </>
          )}
        </div>
        <details className="menu" ref={exportRef}>
          <summary>{t('export')} ▾</summary>
          <div className="menu-list">
            <button onClick={withContent((c) => exportSvg(doc, c))}>{t('exportSvg')}</button>
            <button onClick={withContent((c) => exportPng(doc, c))}>{t('exportPng')}</button>
            <button onClick={withContent((c) => printSheet(doc, c))}>{t('print')}</button>
            {pageCount(doc) > 1 && <button onClick={printAllPages}>{t('printAll')}</button>}
            <button onClick={() => { if (exportRef.current) exportRef.current.open = false; exportCsv(all, lang) }}>{t('exportCsv')}</button>
            <button onClick={copyShareLink}>{t('shareLink')}</button>
          </div>
        </details>
        <span className="grow" />
        <span className="saved" aria-live="polite">✓ {t('saved')}</span>
        <button className="feedback-btn" onClick={() => setShowFeedback(true)} title={t('feedbackHelp')}>💬 <span>{t('feedback')}</span></button>
        <button className="icon" onClick={() => setShowKeys(true)} title={`${t('shortcuts')} (?)`} aria-label={t('shortcuts')}>?</button>
        <div className="group">
          <button className="icon" onClick={toggleTheme} title={t('theme')} aria-label={t('theme')}>◐</button>
          <button className={lang === 'fr' ? 'on' : ''} onClick={() => setLang('fr')}>FR</button>
          <button className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')}>EN</button>
        </div>
      </header>

      <aside className="palette">
        <div className="tabs" role="tablist">
          {DOMAINS.map((d) => (
            <button key={d} role="tab" aria-selected={d === domain} className={d === domain ? 'on' : ''} onClick={() => setDomain(d)}>{t(d)}</button>
          ))}
        </div>
        <input className="search" placeholder={t('search')} aria-label={t('search')} value={query} onChange={(e) => setQuery(e.target.value)} />
        {!query && (
          <select aria-label={t('category')} value={cat} onChange={(e) => setCatByDomain((c) => ({ ...c, [domain]: e.target.value }))}>
            <option value={TOP}>★ {t('mostUsed')}</option>
            {CATEGORIES[domain].map((c) => <option key={c.id} value={c.id}>{c.name[lang]}</option>)}
          </select>
        )}
        <div className="symscroll">
          {!query && recents.length > 0 && (
            <>
              <div className="section">{t('recent')}</div>
              <div className="symlist">{recents.map(symButton)}</div>
              <div className="section">{t(domain)}</div>
            </>
          )}
          {list.map((s, i) => {
            const g = s.group?.[lang] ?? ''
            const prev = i > 0 ? (list[i - 1].group?.[lang] ?? '') : null
            return (
              <div key={s.id} className="symrow">
                {!query && cat !== TOP && g && g !== prev && <div className="section wide">{g}</div>}
                {symButton(s)}
              </div>
            )
          })}
        </div>
        <p className="note">{t('adaptive')} {hasUsage() && <button className="link" onClick={() => { if (confirm(t('resetConfirm'))) { resetUsage(); setUsageTick((n) => n + 1) } }}>{t('resetUsage')}</button>}</p>
        <label className="share" title={t('shareText')}>
          <input type="checkbox" checked={share === 'yes'} onChange={(e) => chooseShare(e.target.checked ? 'yes' : 'no')} />
          <span>{t('shareLabel')}</span>
        </label>
        <p className="note">{t('warn')} <button className="link" onClick={() => setShowCredits(true)}>{t('credits')}</button></p>
      </aside>

      <main className="stage">
        <Canvas doc={doc} lang={lang} sel={sel} setSel={setSel} placing={placing} setPlacing={setPlacing}
          commit={commit} update={update} checkpoint={checkpoint} contentRef={contentRef} nextLabel={nextLabel}
          onPlaced={onPlaced} onContext={(x, y, target) => setMenu({ x, y, target })} onWiring={setWiringOn} highlight={hiPort} sim={sim} onSimPress={onSimPress} onSimToggle={onSimToggle} faults={simIn.cut} onSimFault={onSimFault} onEditTitle={() => setShowTitleBlock(true)} extra={extraSyms} pageOf={pageOf} sheetLabel={pageCount(doc) > 1 ? `${(doc.page ?? 0) + 1}/${pageCount(doc)}` : undefined} labels={{ zoomIn: t('zoomIn'), zoomOut: t('zoomOut'), fit: t('fit'), grid: t('grid') }} />
        <div className="pagebar" role="tablist" aria-label={t('pages')}>
          {pageTabs.map((pg, i) => (
            <button key={i} role="tab" aria-selected={i === (doc.page ?? 0)} className={i === (doc.page ?? 0) ? 'on' : ''}
              onClick={() => goPage(i)}
              onDoubleClick={() => { const n = window.prompt(tr(lang, 'pageRename'), pg.name)?.trim(); if (n) update((d) => renamePage(d, i, n)) }}
              title={t('pageRenameHint')}>{pg.name || i + 1}</button>
          ))}
          <button className="add" onClick={() => { commit((d) => addPage(d)); setSel([]) }} title={t('pageAdd')} aria-label={t('pageAdd')}>＋</button>
          {pageTabs.length > 1 && (
            <button className="add" onClick={() => { if (window.confirm(tr(lang, 'pageDeleteConfirm'))) { commit((d) => deletePage(d, d.page ?? 0)); setSel([]) } }} title={t('pageDelete')} aria-label={t('pageDelete')}>🗑</button>
          )}
        </div>
        {viewOnly && (
          <div className="viewbanner" role="status">
            <span>👁 {t('shareView')}</span>
            <button onClick={keepCopy}>{t('shareKeep')}</button>
          </div>
        )}
        {sim && signalNames.length > 0 && (
          <Chrono rows={trace.current.rows} names={signalNames} now={chronoNow} lang={lang}
            onClear={() => { trace.current = { t0: vnow(), rows: [] }; setChronoNow(0) }} />
        )}
        {!doc.symbols.length && !placing && (
          <div className="empty">
            <h2>{t('emptyTitle')}</h2>
            <p>{t('emptyText')}</p>
            <div className="tpls">
              <button onClick={() => startTemplate(motorStarter)}>{t('tplMotor')}</button>
              <button onClick={() => startTemplate(motorStarterTransformer)}>{t('tplTrafo')}</button>
              <button onClick={() => startTemplate(reversingStarter)}>{t('tplReversing')}</button>
              <button onClick={() => startTemplate(timerOnDelay)}>{t('tplTimer')}</button>
              <button onClick={() => startTemplate(startLamps)}>{t('tplLamps')}</button>
              <button onClick={() => startTemplate(delayedCascade)}>{t('tplCascade')}</button>
              <button onClick={() => startTemplate(pneumaticCylinder)}>{t('tplPneu')}</button>
              <button onClick={() => startTemplate(pneumaticElectric)}>{t('tplPneuElec')}</button>
              <button onClick={() => startTemplate(pneumaticAuto)}>{t('tplPneuAuto')}</button>
            </div>
          </div>
        )}
        {askShare && share === null && (
          <div className="ask" role="dialog" aria-label={t('shareTitle')}>
            <strong>{t('shareTitle')}</strong>
            <p>{t('shareText')}</p>
            <div className="actions">
              <button onClick={() => chooseShare('no')}>{t('shareNo')}</button>
              <button className="on" onClick={() => chooseShare('yes')}>{t('shareYes')}</button>
            </div>
          </div>
        )}
        <div className="status">{hint}</div>
        {toast && <div className="toast" role="status">{toast}</div>}
      </main>

      <aside className="props">
        {sim && !sel.length ? (
          <>
            <h3>{t('simTitle')}</h3>
            {sim.shorts.length > 0 && (
              <div className="alert" role="alert">⚠ {t('simShort')} {[...new Set(sim.shorts.flatMap((s) => s.potentials))].join(' / ')}</div>
            )}
            {Object.entries(sim.badVoltage).map(([id, v]) => {
              const s = all.symbols.find((x) => x.id === id)
              return <div key={id} className="alert" role="alert">⚠ {s?.label || SYMBOL_MAP[s?.defId ?? '']?.name[lang]} : {v.applied} V {t('simApplied')}, {v.rated} V {t('simRated')}</div>
            })}
            {sim.thermalTrip && <div className="alert" role="alert">🔥 {t('simThermal')}</div>}
            {sim.unstable && <div className="alert warn">{t('simUnstable')}</div>}
            {sim.pendingMs !== null && <div className="alert info">⏱ {t('simTiming')}</div>}
            <div className="simlist">
              <div className="section">{t('simEnergized')}</div>
              {all.symbols.filter((s) => sim.energized.has(s.id)).map((s) => (
                <div key={s.id} className="simrowitem">● <strong>{s.label || '·'}</strong> {SYMBOL_MAP[s.defId].name[lang]}{sim.volts[s.id] ? ` · ${sim.volts[s.id]} V` : ''}</div>
              ))}
              {!sim.energized.size && <p className="muted">{t('simNone')}</p>}
              {sim.unsupported.length > 0 && (
                <>
                  <div className="section">{t('simUnsupported')} ({sim.unsupported.length})</div>
                  <p className="muted">{t('simUnsupportedHelp')}</p>
                  {all.symbols.filter((s) => sim.unsupported.includes(s.id)).slice(0, 8).map((s) => (
                    <div key={s.id} className="simrowitem dim">○ <strong>{s.label || '·'}</strong> {SYMBOL_MAP[s.defId].name[lang]}</div>
                  ))}
                </>
              )}
              <div className="section">{t('simLegendTitle')}</div>
              <p className="muted">{t('simLegend')}</p>
              <p className="muted">⚡ {t('simFaultHelp')}</p>
              <p className="muted">💨 {t('simFluidHelp')}</p>
            </div>
          </>
        ) : (<>
        {sim && (
          <div className="alert info" role="status">▶ {t('simEditing')}{sim.shorts.length > 0 ? ' · ⚠ ' + t('simShort') : ''}{sim.thermalTrip ? ' · 🔥' : ''}</div>
        )}
        <h3>{t('properties')}</h3>
        {selSym ? (
          <div className="form" onFocus={checkpoint}>
            <div className="kind">{SYMBOL_MAP[selSym.defId].name[lang]} <small>({SYMBOL_MAP[selSym.defId].std})</small></div>
            <label>{t('label')}<input value={selSym.label} onChange={(e) => patchSym({ label: e.target.value })} /></label>
            <label>{t('description')}<input value={selSym.desc} onChange={(e) => patchSym({ desc: e.target.value })} /></label>
            {(() => { const m = SYMBOL_MAP[selSym.defId].sim; return m?.k === 'transformer' || m?.k === 'coil' || m?.k === 'load' })() && (
              <label>{SYMBOL_MAP[selSym.defId].sim?.k === 'transformer' ? t('voltsSecondary') : t('voltsRated')}
                <input type="number" min={0} list="volts-list" placeholder={SYMBOL_MAP[selSym.defId].sim?.k === 'transformer' ? '24' : '—'}
                  value={selSym.volts ?? ''} onChange={(e) => patchSym({ volts: Number(e.target.value) > 0 ? Number(e.target.value) : undefined })} />
                <datalist id="volts-list">{[12, 24, 48, 110, 230, 400].map((v) => <option key={v} value={v} />)}</datalist>
              </label>
            )}
            {(() => { const m = SYMBOL_MAP[selSym.defId].sim; return (m?.k === 'coil' && !!m.timer) || (m?.k === 'switch' && !!m.delay) })() && (
              <label>{t('delay')}
                <input type="number" min={0} step={0.5} value={selSym.delay ?? DEFAULT_DELAY_S} onChange={(e) => patchSym({ delay: Math.max(0, Number(e.target.value) || 0) })} />
              </label>
            )}
            {(() => {
              const def = SYMBOL_MAP[selSym.defId]
              const groups = termGroups(def)
              if (!groups.length || def.ports.length > 16) return null
              // repères affichés : saisie, sinon numérotation automatique (unique au sein de l'appareil)
              const eff = effectiveTerms(all.symbols, SYMBOL_MAP)
              const defaults = effectiveTerms(all.symbols, SYMBOL_MAP, selSym.id)[selSym.id] ?? {}
              const dups = duplicateTerms(all.symbols, eff)
              const others = othersTerms(all.symbols, eff, selSym.id)
              const title = (g: (typeof groups)[number], n: number) =>
                g.kind === 'pole' ? `${t('termPole')} ${g.index + 1}` : g.kind === 'changeover' ? `${t('termChangeover')} ${g.index + 1}` : g.kind === 'winding' ? `${t('termWinding')} ${n + 1}` : `${t('termPort')} ${n + 1}`
              const sideHint = (id: string) => {
                const p = def.ports.find((x) => x.id === id)
                return p ? ({ up: '↑', down: '↓', left: '←', right: '→' } as const)[p.dir] : ''
              }
              const store = (next: Record<string, string> | undefined) => patchSym({ terms: next && Object.keys(next).length ? next : undefined })
              const device = selSym.label || ''
              return (
                <div className="terms">
                  <div className="terms-head">
                    <span>{t('terminals')}</span>
                    {selSym.terms && Object.keys(selSym.terms).length > 0 && <button className="mini" title={t('termResetHelp')} onClick={() => store(undefined)}>{t('termReset')}</button>}
                  </div>
                  {groups.map((g, gi) => (
                    <div key={gi} className="term-row">
                      <span className="term-title">{title(g, gi)}</span>
                      <span className="term-inputs">
                        {g.ports.map((pid) => {
                          const explicit = selSym.terms?.[pid]
                          const dup = dups.has(`${selSym.id}:${pid}`)
                          return (
                            <input key={pid} className={'term-in' + (explicit === undefined ? ' auto' : '') + (dup ? ' dup' : '')} maxLength={6}
                              aria-label={`${title(g, gi)} ${sideHint(pid)}`} value={explicit ?? eff[selSym.id]?.[pid] ?? ''} placeholder={sideHint(pid)}
                              title={dup ? t('termDup') : t('termHelp')}
                              onFocus={() => setHiPort({ symId: selSym.id, portId: pid })}
                              onBlur={() => { setHiPort(null); store(ensureUnique(def, selSym.terms, others)) }}
                              onChange={(e) => store(editTerm(def, selSym.terms, pid, e.target.value, defaults))} />
                          )
                        })}
                      </span>
                    </div>
                  ))}
                  <p className="muted small">{device ? `${t('termDevice')} ${device} · ` : ''}{t('termHelp')}</p>
                </div>
              )
            })()}
            {(() => { const m = SYMBOL_MAP[selSym.defId].sim; return m?.k === 'switch' && m.ctl === 'coil' })() && (
              <label>{t('drivenBy')}
                <select value={coilLabels.includes(selSym.label) ? selSym.label : ''} onChange={(e) => e.target.value && patchSym({ label: e.target.value })}>
                  <option value="">—</option>
                  {coilLabels.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </label>
            )}
          </div>
        ) : selNote ? (
          <div className="form" onFocus={checkpoint}>
            <h3>{t('note')}</h3>
            <label>{t('noteText')}<textarea rows={4} value={selNote.text} onChange={(e) => patchNote({ text: e.target.value })} /></label>
            <label>{t('noteSize')}
              <select value={selNote.size} onChange={(e) => patchNote({ size: Number(e.target.value) })}>
                {[8, 10, 12, 16, 20, 28].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
          </div>
        ) : selWire ? (
          <div className="form" onFocus={checkpoint}>
            <div className="kind">{t('wire')}</div>
            <label>{t('label')}<input value={selWire.label} onChange={(e) => patchWire({ label: e.target.value })} /></label>
            <label>{t('section')}<input value={selWire.section} onChange={(e) => patchWire({ section: e.target.value })} /></label>
            {selWire.via?.length ? (
              <button onClick={() => commit((d) => ({ ...d, wires: d.wires.map((w) => (w.id === selWire.id ? { ...w, via: undefined } : w)) }))}>{t('autoRoute')}</button>
            ) : (
              <p className="muted">{t('routeHelp')}</p>
            )}
            <div className="colors">
              {WIRE_COLORS.map((c) => (
                <button key={c} className={'swatch' + (selWire.color === c ? ' on' : '')} style={{ background: c }} title={t('color')} aria-label={c}
                  onClick={() => commit((d) => ({ ...d, wires: d.wires.map((w) => (w.id === selWire.id ? { ...w, color: c } : w)) }))} />
              ))}
            </div>
          </div>
        ) : (
          <p className="muted">{sel.length > 1 ? `${sel.length} ${t('sym')}` : t('nothingSelected')}</p>
        )}

        <h3>{t('sheet')}</h3>
        <div className="form" onFocus={checkpoint}>
          <label>{t('paper')}
            <select value={doc.paper} onChange={(e) => commit((d) => ({ ...d, paper: e.target.value as Paper }))}>
              {['A4', 'A3', 'A2', 'A1'].map((p) => <option key={p}>{p}</option>)}
            </select>
          </label>
          {TB_FIELDS.map((k) => (
            <label key={k}>{t(k === 'sheet' ? 'sheetNo' : k)}<input value={doc.title[k] ?? ''} onChange={(e) => patchTitle(k, e.target.value)} /></label>
          ))}
          <button onClick={() => setShowTitleBlock(true)}>{t('tbEdit')}</button>
        </div>
        </>)}
      </aside>

      {menu && (
        <div className="ctx-back" onMouseDown={() => setMenu(null)} onContextMenu={(e) => e.preventDefault()}>
          <div className="ctx" style={{ left: Math.min(menu.x, window.innerWidth - 200), top: Math.min(menu.y, window.innerHeight - 220) }} onMouseDown={(e) => e.stopPropagation()}>
            {menu.target ? (
              <>
                {doc.symbols.some((s) => s.id === menu.target) && (
                  <>
                    <button onClick={() => { rotateSel(); setMenu(null) }}><span>{t('rotate')}</span><kbd>R</kbd></button>
                    <button onClick={() => { duplicate(); setMenu(null) }}><span>{t('duplicate')}</span><kbd>Ctrl+D</kbd></button>
                    <button onClick={() => { copySel(); setMenu(null) }}><span>{t('copy')}</span><kbd>Ctrl+C</kbd></button>
                    <hr />
                  </>
                )}
                <button className="danger" onClick={() => { deleteSel(); setMenu(null) }}><span>{t('delete')}</span><kbd>Suppr</kbd></button>
              </>
            ) : (
              <>
                <button disabled={!clip.current} onClick={() => { paste(); setMenu(null) }}><span>{t('paste')}</span><kbd>Ctrl+V</kbd></button>
                <button onClick={() => { setSel([...doc.symbols.map((s) => s.id), ...doc.wires.map((w) => w.id)]); setMenu(null) }}><span>{t('selectAll')}</span><kbd>Ctrl+A</kbd></button>
                <button onClick={() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f' })); setMenu(null) }}><span>{t('fitShort')}</span><kbd>F</kbd></button>
              </>
            )}
          </div>
        </div>
      )}

      {showFeedback && <Feedback doc={doc} lang={lang} onClose={() => setShowFeedback(false)} />}

      {showCredits && (
        <div className="modal" onClick={() => setShowCredits(false)}>
          <div className="dialog" role="dialog" aria-label={t('creditsTitle')} onClick={(e) => e.stopPropagation()}>
            <h3>{t('creditsTitle')}</h3>
            <p>{t('creditsText')}</p>
            <h3>{t('privacyTitle')}</h3>
            <p>{t('privacyText')}</p>
            <h3>{t('legalTitle')}</h3>
            <p>{t('legalText')}</p>
            <p><a href="https://github.com/albertduplantin/albert-schema" target="_blank" rel="noreferrer">{t('sourceCode')}</a> · <button className="link" onClick={() => { setShowCredits(false); setShowFeedback(true) }}>{t('contact')}</button></p>
            <p><a href="https://qelectrotech.org" target="_blank" rel="noreferrer">qelectrotech.org</a> · <a href="https://creativecommons.org/licenses/by/3.0/" target="_blank" rel="noreferrer">CC BY 3.0</a> · <a href="https://github.com/qelectrotech/qelectrotech-elements" target="_blank" rel="noreferrer">qelectrotech-elements</a></p>
            <div className="actions"><button onClick={() => setShowCredits(false)}>{t('close')}</button></div>
          </div>
        </div>
      )}

      {showGallery && (
        <div className="modal" onClick={() => setShowGallery(false)}>
          <div className="dialog gallery" role="dialog" aria-label={t('gallery')} onClick={(e) => e.stopPropagation()}>
            <h3>{t('galleryExamples')}</h3>
            <div className="cards">
              {GALLERY.filter((g) => !remoteEx.hidden.includes(g.key)).map((g) => (
                <div key={g.key} className="card">
                  <strong>{t(g.key)}</strong>
                  <span className="lvl">{'★'.repeat(g.level)}{'☆'.repeat(3 - g.level)} {t(('level' + g.level) as Key)}</span>
                  <p className="muted">{g.about[lang]}</p>
                  <button onClick={() => { if (!doc.symbols.length || window.confirm(tr(lang, 'galleryReplace'))) { startTemplate(g.fn); setShowGallery(false) } }}>{t('galleryLoad')}</button>
                </div>
              ))}
              {remoteEx.items.map((ex) => (
                <div key={ex.id} className="card">
                  <strong>{ex.title[lang] || ex.title.fr}</strong>
                  <span className="lvl">{'★'.repeat(ex.level)}{'☆'.repeat(3 - ex.level)} {t(('level' + ex.level) as Key)}</span>
                  <p className="muted">{ex.about[lang] || ex.about.fr}</p>
                  <button onClick={() => openRemote(ex)}>{t('galleryLoad')}</button>
                </div>
              ))}
            </div>
            <h3>{t('galleryExercises')}</h3>
            <p className="muted">{t('exerciseHelp')}</p>
            <div className="cards">
              {EXERCISES.map((ex) => {
                const r = exResult[ex.id]
                return (
                  <div key={ex.id} className="card wide">
                    <strong>{ex.title[lang]}</strong>
                    <span className="lvl">{'★'.repeat(ex.level)}{'☆'.repeat(3 - ex.level)} {t(('level' + ex.level) as Key)}</span>
                    <p>{ex.statement[lang]}</p>
                    <p className="muted">{t('exerciseLabels')} : {ex.labels.join(', ')}</p>
                    <button onClick={() => setExResult((m) => ({ ...m, [ex.id]: runExercise(ex, doc, SYMBOL_MAP, lang) }))}>{t('exerciseCheck')}</button>
                    {r && (
                      <div className={'exres ' + (r.ok ? 'ok' : 'ko')}>
                        <strong>{r.ok ? '✓ ' + t('exerciseOk') : '✗ ' + t('exerciseKo')}</strong>
                        {r.missing.length > 0 && <div>{t('exerciseMissing')} : {r.missing.join(', ')}</div>}
                        <ul>{r.steps.map((st, i) => <li key={i}>{st.ok ? '✓' : '✗'} {st.text}{st.detail ? ` — ${st.detail}` : ''}</li>)}</ul>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            <div className="actions"><button onClick={() => setShowGallery(false)}>{t('close')}</button></div>
          </div>
        </div>
      )}

      {showKeys && (
        <div className="modal" onClick={() => setShowKeys(false)}>
          <div className="dialog" role="dialog" aria-label={t('shortcutsTitle')} onClick={(e) => e.stopPropagation()}>
            <h3>{t('shortcutsTitle')}</h3>
            <table><tbody>{SHORTCUTS[lang].map(([k, d]) => <tr key={k}><td><kbd>{k}</kbd></td><td>{d}</td></tr>)}</tbody></table>
            <div className="actions"><button onClick={() => setShowKeys(false)}>{t('close')}</button></div>
          </div>
        </div>
      )}

      {showTitleBlock && (
        <div className="modal" onClick={() => setShowTitleBlock(false)}>
          <div className="dialog" role="dialog" aria-label={t('tbTitle')} onClick={(e) => e.stopPropagation()} onFocus={checkpoint}>
            <h3>{t('tbTitle')}</h3>
            <p className="muted">{t('tbHelp')}</p>
            <div className="form">
              {TB_FIELDS.map((k) => (
                <label key={k}>{t(k === 'sheet' ? 'sheetNo' : k)}<input autoFocus={k === 'title'} value={doc.title[k] ?? ''} onChange={(e) => patchTitle(k, e.target.value)} /></label>
              ))}
            </div>
            <p className="muted small">{t('tbRemember')}</p>
            <div className="actions"><button onClick={() => setShowTitleBlock(false)}>{t('close')}</button></div>
          </div>
        </div>
      )}

      {showCheck && (
        <div className="modal" onClick={() => setShowCheck(false)}>
          <div className="dialog" role="dialog" aria-label={t('checkTitle')} onClick={(e) => e.stopPropagation()}>
            <h3>{t('checkTitle')}</h3>
            {issues.length === 0 ? <p>✓ {t('checkOk')}</p> : (
              <>
                <p className="muted">{t('checkHelp')}</p>
                <ul className="issues">
                  {issues.map((i, n) => (
                    <li key={n} className={i.level}>
                      <button className="link" disabled={!i.symId} onClick={() => { if (i.symId) { setSel([i.symId]); setShowCheck(false) } }}>
                        {i.level === 'error' ? '⛔' : '⚠'} {i.text}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <div className="actions"><button onClick={() => setShowCheck(false)}>{t('close')}</button></div>
          </div>
        </div>
      )}

      {showBom && (
        <div className="modal" onClick={() => setShowBom(false)}>
          <div className="dialog" role="dialog" aria-label={t('bom')} onClick={(e) => e.stopPropagation()}>
            <h3>{t('bom')}</h3>
            <table>
              <thead><tr><th>{t('label')}</th><th>{t('component')}</th><th>{t('description')}</th><th>{t('standard')}</th></tr></thead>
              <tbody>{bomRows(all, lang).map((r, i) => <tr key={i}><td>{r.label}</td><td>{r.name}</td><td>{r.desc}</td><td>{r.std}</td></tr>)}</tbody>
            </table>
            <h3>{t('wires')}</h3>
            <table>
              <thead><tr><th>{t('label')}</th><th>{t('from')}</th><th>{t('to')}</th><th>{t('section')}</th></tr></thead>
              <tbody>{wireRows(all).map((r, i) => <tr key={i}><td>{r.label}</td><td>{r.from}</td><td>{r.to}</td><td>{r.section}</td></tr>)}</tbody>
            </table>
            <div className="actions">
              <button onClick={() => exportCsv(all, lang)}>{t('csv')}</button>
              <button onClick={() => setShowBom(false)}>{t('close')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function App() {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const lang = (localStorage.getItem('albertschema.lang') as Lang) || 'fr'
  useEffect(() => {
    loadLibrary().then(() => setState('ready'), () => setState('error'))
  }, [])
  if (state === 'ready') return <Editor />
  return (
    <div className="splash" role="status">
      {state === 'loading' ? tr(lang, 'loading') : tr(lang, 'loadError')}
    </div>
  )
}
