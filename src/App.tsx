import { matchesQuery } from './searchTerms'
import { nextFluidLabel, renumberFluid, solenoidNames } from './fluidNames'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { addVersion, loadVersions, removeVersion, type Version } from './versions'
import Combo from './Combo'
import { GuidedList, GuidedPanel } from './GuidedPanel'
import { GUIDED, guidedById } from './guidedData'
import PlcEditor from './PlcEditor'
import { usePlcWin } from './PlcWindow'
import { customExercise, type CustomExo } from './customEx'
import type { GExercise } from './guided'
import { defaultVolts, sourcePots } from './sim/potentials'
import { isTerminal, stripOf, terminalRows } from './strips'
import { SHAPE_COLORS, SHAPE_FILLS, SHAPE_WIDTHS, STROKES, dashArray } from './shapes'
import type { Doc, Instrument, Note, Shape, StrokeStyle, Ratings, Domain, Lang, Paper, PlacedSymbol, Wire } from './types'
import { CATEGORIES, loadLibrary, SYMBOLS, SYMBOL_MAP } from './symbols'
import { tr, type Key } from './i18n'
import { PAPER_SIZE, symBBox, uid } from './geometry'
import { defaultInstrument } from './instruments'
import Canvas from './Canvas'
import Feedback from './Feedback'
import { bomRows, exportCsv, exportDxf, exportWiringCsv, exportPng, setMonochrome, exportSvg, printProject, printSheet, saveJson, sheetSvg, wireRows, fileBase } from './exporters'
import { relay24V, delayedCascade, motorStarter, motorStarterTransformer, pneumaticAuto, pneumaticPlc, pneumaticCylinder, pneumaticElectric, reversingStarter, startLamps, timerOnDelay } from './templates'
import { duplicateTerms, editTerm, ensureUnique, othersTerms, termGroups } from './terminals'
import { describeInfo, transformerInfo, transformerTopology, termsWithTopology } from './transformer'
import { fieldLabel, fieldsFor, kindOf, motorCurrent } from './ratings'
import { FONTS } from './fonts'
import { settingsAdvice, wireAdvice as computeWireAdvice, type Suggestion } from './settings'
import { DEFAULT_DELAY_S, isOperableDef, simulate, type SimInputs, type SimMemory } from './sim/engine'
import Chrono, { type TraceRow } from './Chrono'
import { checkDoc, type Issue } from './check'
import { applyFixToDoc, type Fix } from './advice'
import { netLabels } from './nets'
import { pagesOf as pagesOfDoc } from './pages'
import { addPage, deletePage, mergedDoc, pageCount, pageOfSymbols, renamePage, switchPage } from './pages'
import { BUILTIN_META } from './galleryMeta'
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

/** Bornier en cours : celui de la dernière borne posée ou renommée à la main (X1, puis X2 si l'on saisit X2.1…). */
let activeStrip = ''
export const setActiveStrip = (label: string) => { if (label.trim()) activeStrip = stripOf(label.trim()) }
function nextTerminalLabel(doc: Doc): string {
  const terms = doc.symbols.filter((s) => isTerminal(s.defId) && s.label)
  let strip = activeStrip
  if (!strip || !terms.some((s) => stripOf(s.label) === strip)) strip = terms.length ? stripOf(terms[terms.length - 1].label) : activeStrip || 'X1'
  let max = 0
  for (const s of terms) {
    const m = /^(.*?)\.(\d+)$/.exec(s.label)
    if (m && m[1] === strip) max = Math.max(max, Number(m[2]))
  }
  return `${strip}.${max + 1}`
}

const nextLabel = (doc: Doc, defId: string) => {
  const def = SYMBOL_MAP[defId]
  const prefix = def.prefix
  const iso = nextFluidLabel(doc, def, SYMBOL_MAP) // composants pneumatiques et hydrauliques : repérage ISO 1219-2 (1A1, 1V1, 0Z1…)
  if (iso !== null) return iso
  if (!prefix) return ''
  if (isTerminal(defId)) return nextTerminalLabel(doc)
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
  tplMotor: motorStarter, tplLamps: startLamps, tplTimer: timerOnDelay, tplTrafo: motorStarterTransformer, tplCascade: delayedCascade, tplRelay24: relay24V,
  tplReversing: reversingStarter, tplPneu: pneumaticCylinder, tplPneuElec: pneumaticElectric, tplPneuAuto: pneumaticAuto, tplPneuPlc: pneumaticPlc,
}
const GALLERY = BUILTIN_META.map((m) => ({ ...m, fn: TEMPLATE_FN[m.key] }))
/** Exemple publié par l'administrateur (le schéma est téléchargé à l'ouverture). */
interface RemoteExample { id: string; title: { fr: string; en: string }; about: { fr: string; en: string }; level: 1 | 2 | 3; order: number; n?: number }

const TOP = '__top'
const DOMAINS: Domain[] = ['electrical', 'pneumatic', 'hydraulic']
const WIRE_COLORS = ['#000000', '#c80000', '#0050c8', '#4fc3f7', 'gnye', '#008000', '#8a5a00', '#7a7a7a', '#e08000', '#6a00a0']

const SHORTCUTS: Record<Lang, [string, string][]> = {
  fr: [
    ['Clic sur un symbole, puis clic', 'Poser un symbole (répétable)'],
    ['Glisser depuis la bibliothèque', 'Poser un symbole à l’endroit voulu'],
    ['Glisser ou cliquer depuis une borne', 'Tracer un conducteur (les clics sur le vide posent des coudes)'],
    ['Retour arrière (pendant un tracé)', 'Retirer le dernier coude'],
    ['Poignées d’un conducteur sélectionné', 'Créer, déplacer ou retirer (double-clic) un coude'],
    ['Double-clic, Entrée ou clic droit › Propriétés', 'Ouvrir les propriétés du symbole (repère, caractéristiques, réglages, bornes)'],
    ['R', 'Pivoter (symbole sélectionné ou en cours de pose)'],
    ['Flèches (+ Maj)', 'Déplacer la sélection (pas de grille ×5)'],
    ['Ctrl + A / Ctrl + D', 'Tout sélectionner / dupliquer'],
    ['Ctrl + G / Ctrl + Maj + G', 'Grouper / dégrouper la sélection'],
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
    ['Double-click, Enter or right-click › Properties', 'Open the symbol properties (tag, ratings, settings, terminals)'],
    ['R', 'Rotate (selected symbol or while placing)'],
    ['Arrows (+ Shift)', 'Move the selection (grid step ×5)'],
    ['Ctrl + A / Ctrl + D', 'Select all / duplicate'],
    ['Ctrl + G / Ctrl + Shift + G', 'Group / ungroup the selection'],
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
  // fenêtre « feuille vide » : fermable ; elle réapparaît si la feuille est vidée plus tard
  const [emptyClosed, setEmptyClosed] = useState(false)
  // exercices guidés : liste, exercice en cours, exercices réussis (conservés sur cet appareil)
  const [showGuided, setShowGuided] = useState(false)
  const [guidedId, setGuidedId] = useState<string | null>(() => { try { return localStorage.getItem('albertschema.guided') } catch { return null } })
  const [guidedDone, setGuidedDone] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('albertschema.guidedDone') || '[]') } catch { return [] } })
  // exercices publiés par l'administrateur : récupérés une fois, convertis en exercices guidés
  const [customRaw, setCustomRaw] = useState<CustomExo[]>([])
  useEffect(() => {
    fetch('/api/exos').then((r) => (r.ok ? r.json() : { items: [] })).then((d: { items?: CustomExo[] }) => setCustomRaw(Array.isArray(d.items) ? d.items : [])).catch(() => { /* hors ligne ou développement : aucun exercice publié */ })
  }, [])
  const customs = useMemo(() => customRaw.flatMap((x) => { try { return [customExercise(x)] } catch { return [] } }), [customRaw])
  const allGuided = useMemo(() => [...GUIDED, ...customs], [customs])
  const guidedEx = guidedId ? allGuided.find((g) => g.id === guidedId) : undefined
  const chooseGuided = (id: string | null) => { setGuidedId(id); try { if (id) localStorage.setItem('albertschema.guided', id); else localStorage.removeItem('albertschema.guided') } catch { /* ignoré */ } }
  // visite guidée : proposée une seule fois, sur une feuille vierge, et relançable depuis l'aide (?)
  const [tourStep, setTourStep] = useState<number | null>(() => {
    try { return localStorage.getItem('albertschema.tour') === '1' || loadDoc().symbols.length ? null : 0 } catch { return null }
  })
  const endTour = () => { setTourStep(null); try { localStorage.setItem('albertschema.tour', '1') } catch { /* ignoré */ } }
  // historique des versions : une version automatique toutes les 5 minutes si le schéma a changé, et des versions nommées à la demande
  const [showVersions, setShowVersions] = useState(false)
  const [versions, setVersions] = useState<Version[]>(() => loadVersions())
  const lastSnap = useRef('')
  const [darkSheet, setDarkSheet] = useState(() => { try { return localStorage.getItem('albertschema.darksheet') === '1' } catch { return false } })
  useEffect(() => { try { localStorage.setItem('albertschema.darksheet', darkSheet ? '1' : '0') } catch { /* ignoré */ } }, [darkSheet])
  const [bw, setBw] = useState(() => { try { return localStorage.getItem('albertschema.bw') === '1' } catch { return false } })
  useEffect(() => { setMonochrome(bw); try { localStorage.setItem('albertschema.bw', bw ? '1' : '0') } catch { /* ignoré */ } }, [bw])
  const [showKeys, setShowKeys] = useState(false)
  const [showGallery, setShowGallery] = useState(false)
  const [remoteEx, setRemoteEx] = useState<{ items: RemoteExample[]; hidden: string[] }>({ items: [], hidden: [] })
  useEffect(() => {
    // exemples publiés par l'administrateur : chargés au démarrage et à chaque ouverture de la galerie ; sans réseau, seuls les exemples intégrés restent
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
  const clip = useRef<{ symbols: PlacedSymbol[]; wires: Wire[]; shapes?: Shape[] } | null>(null)
  const toastTimer = useRef<number>()
  const doc = h.doc
  const docRef = useRef(doc)
  docRef.current = doc
  useEffect(() => { if (doc.symbols.length) setEmptyClosed(false) }, [doc.symbols.length])
  useEffect(() => {
    const id = window.setInterval(() => {
      const d = docRef.current
      const sig = JSON.stringify(d)
      if (!d.symbols.length || sig === lastSnap.current) return
      lastSnap.current = sig
      setVersions(addVersion(d, '', true, uid()))
    }, 5 * 60 * 1000)
    return () => window.clearInterval(id)
  }, [])
  const saveVersion = () => {
    const name = window.prompt(tr(lang, 'versionName'), '')?.trim()
    if (name === undefined) return
    setVersions(addVersion(doc, name || new Date().toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-GB'), false, uid()))
    say(tr(lang, 'versionSaved'))
  }
  const t = (k: Key) => tr(lang, k)
  // infobulles des propriétés : texte plus grand que celui du navigateur, affiché dès le survol (ou la prise de focus) de la case
  const [tooltip, setTooltip] = useState<{ text: string; x: number; y: number; above: boolean } | null>(null)
  useEffect(() => {
    const show = (e: Event) => {
      // sur un champ à liste de valeurs (ou sa liste ouverte), pas d'infobulle : elle cacherait les choix
      if ((e.target as Element | null)?.closest?.('.combo')) { setTooltip(null); return }
      const el = (e.target as Element | null)?.closest?.('[data-tip]') as HTMLElement | null
      if (!el) return
      const r = el.getBoundingClientRect()
      const above = r.bottom > window.innerHeight - 140
      setTooltip({ text: el.dataset.tip ?? '', x: Math.max(8, Math.min(r.left, window.innerWidth - 348)), y: above ? r.top - 8 : r.bottom + 8, above })
    }
    const hide = (e: Event) => {
      const el = (e.target as Element | null)?.closest?.('[data-tip]')
      const rel = (e as MouseEvent).relatedTarget as Node | null
      if (el && rel && el.contains(rel)) return
      setTooltip(null)
    }
    const drop = () => setTooltip(null)
    document.addEventListener('dragstart', drop)
    document.addEventListener('mouseover', show)
    document.addEventListener('mouseout', hide)
    document.addEventListener('focusin', show)
    document.addEventListener('focusout', hide)
    return () => {
      document.removeEventListener('dragstart', drop)
      document.removeEventListener('mouseover', show)
      document.removeEventListener('mouseout', hide)
      document.removeEventListener('focusin', show)
      document.removeEventListener('focusout', hide)
    }
  }, [])
  /** pastille « ? » : l'explication s'affiche au survol (et se lit avec un lecteur d'écran) */
  const tip = (k: Key) => <span className="tip" data-tip={t(k)} aria-label={t(k)}>?</span>

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
  // exercice guidé : les étapes se cochent d'après le schéma (recalcul un instant après la dernière modification)
  const [stepsDone, setStepsDone] = useState<boolean[]>([])
  const [stepsMissing, setStepsMissing] = useState<string[][]>([])
  useEffect(() => {
    if (!guidedEx) { setStepsDone([]); setStepsMissing([]); return }
    const id = window.setTimeout(() => {
      const ctx = { doc: all, defs: SYMBOL_MAP, lang, simMode }
      setStepsDone(guidedEx.steps.map((st) => { try { return st.done(ctx) } catch { return false } }))
      setStepsMissing(guidedEx.steps.map((st) => { try { return st.missing?.(ctx) ?? [] } catch { return [] } }))
    }, 150)
    return () => window.clearTimeout(id)
  }, [guidedEx, all, lang, simMode])
  useEffect(() => {
    if (!guidedEx || !stepsDone.length || !stepsDone.every(Boolean) || guidedDone.includes(guidedEx.id)) return
    const next = [...guidedDone, guidedEx.id]
    setGuidedDone(next)
    try { localStorage.setItem('albertschema.guidedDone', JSON.stringify(next)) } catch { /* ignoré */ }
  }, [stepsDone, guidedEx, guidedDone])
  // suivi de classe : un code partagé et un pseudonyme ; chaque exercice terminé est signalé au serveur
  const [classInfo, setClassInfo] = useState<{ code: string; pseudo: string }>(() => { try { return JSON.parse(localStorage.getItem('albertschema.class') || '{"code":"","pseudo":""}') } catch { return { code: '', pseudo: '' } } })
  const setClass = (code: string, pseudo: string) => { setClassInfo({ code, pseudo }); try { localStorage.setItem('albertschema.class', JSON.stringify({ code, pseudo })) } catch { /* ignoré */ } }
  const reported = useRef<Set<string>>(new Set())
  const pendingExo = useRef<string | null>(null)
  useEffect(() => {
    if (!guidedEx || !stepsDone.length || !stepsDone.every(Boolean) || !classInfo.code || !classInfo.pseudo || reported.current.has(guidedEx.id)) return
    reported.current.add(guidedEx.id)
    fetch('/api/classroom', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: classInfo.code, pseudo: classInfo.pseudo, exercise: guidedEx.id }) }).catch(() => { /* hors ligne : ignoré */ })
  }, [stepsDone, guidedEx, classInfo])
  const copyExerciseLink = async () => {
    if (!guidedEx) return
    const q = new URLSearchParams({ exo: guidedEx.id })
    if (classInfo.code) q.set('classe', classInfo.code)
    try { await navigator.clipboard.writeText(`${location.origin}${location.pathname}?${q}`); say(lang === 'fr' ? 'Lien de l’exercice copié.' : 'Exercise link copied.') } catch { say(tr(lang, 'shareFailed')) }
  }
  const startGuided = (ex: GExercise) => {
    if (doc.symbols.length && !window.confirm(tr(lang, 'guidedReplace'))) return
    if (simMode) setSimMode(false)
    commit(() => (ex.start ?? ((b: Doc) => b))(emptyDoc()))
    setSel([])
    chooseGuided(ex.id)
    setShowGuided(false)
  }
  const guidedSolution = () => {
    if (!guidedEx || !window.confirm(tr(lang, 'guidedSolutionConfirm'))) return
    commit(() => guidedEx.solution(emptyDoc()))
    setSel([])
  }
  const guidedRestart = () => {
    if (!guidedEx || !window.confirm(tr(lang, 'guidedReplace'))) return
    if (simMode) setSimMode(false)
    commit(() => (guidedEx.start ?? ((b: Doc) => b))(emptyDoc()))
    setSel([])
  }

  // lien d'exercice (?exo=… et éventuellement &classe=…) : ouvre l'exercice et rejoint la classe
  useEffect(() => {
    const q = new URLSearchParams(location.search)
    const exo = q.get('exo'), code = q.get('classe')
    if (!exo && !code) return
    if (code && /^[A-Za-z0-9-]{3,24}$/.test(code)) setClass(code, classInfo.pseudo)
    const ex = exo ? guidedById(exo) : undefined
    history.replaceState(null, '', location.pathname + location.hash)
    if (ex) startGuided(ex)
    else if (exo?.startsWith('u-')) pendingExo.current = exo // exercice publié : on attend sa réception
    else if (code) setShowGuided(true)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const id = pendingExo.current
    const ex = id ? customs.find((g) => g.id === id) : undefined
    if (ex) { pendingExo.current = null; startGuided(ex) }
  }, [customs]) // eslint-disable-line react-hooks/exhaustive-deps

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
  /** applique une correction proposée par le Contrôle (calibre, réglage…) aux caractéristiques d'un appareil */
  const applyFix = (fix: Fix) => {
    commit((d) => applyFixToDoc(d, fix, SYMBOL_MAP))
    say(tr(lang, 'fixApplied'))
  }
  /** applique d'un coup toutes les corrections proposées (erreurs et avertissements d'abord) */
  const applyAllFixes = (list: Issue[]) => {
    const fixes = list.filter((i) => i.fix && !i.resolved && i.level !== 'info').map((i) => i.fix!)
    if (!fixes.length) return
    commit((d) => fixes.reduce((acc, f) => applyFixToDoc(acc, f, SYMBOL_MAP), d))
    say(tr(lang, 'fixesApplied'))
  }
  const issues = useMemo(() => (showCheck ? checkDoc(all, SYMBOL_MAP, lang) : []), [showCheck, all, lang])
  // pastille du bouton Contrôle : nombre d'erreurs et d'avertissements, recalculé un instant après la dernière modification
  const [issueCount, setIssueCount] = useState({ e: 0, w: 0 })
  useEffect(() => {
    if (!all.symbols.length) { setIssueCount({ e: 0, w: 0 }); return }
    const id = window.setTimeout(() => {
      try {
        const l = checkDoc(all, SYMBOL_MAP, lang)
        setIssueCount({ e: l.filter((i) => i.level === 'error').length, w: l.filter((i) => i.level === 'warn').length })
      } catch { /* schéma incomplet */ }
    }, 600)
    return () => window.clearTimeout(id)
  }, [all, lang])
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
    const sym = all.symbols.find((x) => x.id === id)
    const m = sym && SYMBOL_MAP[sym.defId]?.sim
    if (coilMemory.current['§TRIP:' + id]?.on) {
      // réarmement d'un disjoncteur déclenché ou remplacement d'un fusible fondu
      const mem = { ...coilMemory.current }
      delete mem['§TRIP:' + id]
      coilMemory.current = mem
      setSimIn((s) => ({ ...s }))
      return
    }
    const three = m?.k === 'switch' && m.pos3
    const nSel = m?.k === 'switch' && m.sel ? m.sel.outs.length : 0
    setSimIn((s) => {
      const toggled = new Set(s.toggled)
      if (nSel) {
        // sélecteur à N positions : 1 → 2 → … → N → 1
        const key = (k: number) => (k === 2 ? id : id + ':' + (k - 1))
        let cur = 1
        for (let k = nSel; k >= 2; k--) if (toggled.has(key(k))) { cur = k; break }
        if (cur > 1) toggled.delete(key(cur))
        const next = (cur % nSel) + 1
        if (next > 1) toggled.add(key(next))
      } else if (three) {
        // sélecteur 1-0-2 : centre → position 1 → position 2 → centre
        if (toggled.has(id)) { toggled.delete(id); toggled.add(id + ':2') }
        else if (toggled.has(id + ':2')) toggled.delete(id + ':2')
        else toggled.add(id)
      } else if (toggled.has(id)) toggled.delete(id)
      else toggled.add(id)
      return { ...s, toggled }
    })
  }, [all])
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
        ...(d.shapes ? { shapes: d.shapes.filter((s) => !gone.has(s.id)) } : {}),
      }
    })
    setSel([])
  }, [sel, commit])

  /** regroupe les symboles sélectionnés (ils se sélectionnent et se déplacent ensemble) ; dégroupe si `on` est faux */
  const groupSel = (on: boolean) => {
    const g = uid()
    commit((d) => ({ ...d, symbols: d.symbols.map((s) => (sel.includes(s.id) ? { ...s, group: on ? g : undefined } : s)) }))
  }
  const lockSel = (on: boolean) => commit((d) => ({ ...d, symbols: d.symbols.map((s) => (sel.includes(s.id) ? { ...s, locked: on || undefined } : s)) }))

  const rotateSel = useCallback(() => {
    if (!sel.length) return
    commit((d) => ({
      ...d,
      symbols: d.symbols.map((s) => (sel.includes(s.id) ? { ...s, rot: (((s.rot + 90) % 360) as PlacedSymbol['rot']) } : s)),
      ...(d.shapes ? { shapes: d.shapes.map((s) => (sel.includes(s.id) ? { ...s, rot: ((s.rot ?? 0) + 90) % 360 || undefined } : s)) } : {}),
      ...(d.notes ? { notes: d.notes.map((n) => (sel.includes(n.id) ? { ...n, rot: ((n.rot ?? 0) + 90) % 360 || undefined } : n)) } : {}),
    }))
  }, [sel, commit])

  const copySel = useCallback(() => {
    const syms = doc.symbols.filter((s) => sel.includes(s.id))
    const ids = new Set(syms.map((s) => s.id))
    const shapes = (doc.shapes ?? []).filter((s) => sel.includes(s.id))
    clip.current = { symbols: syms, wires: doc.wires.filter((w) => ids.has(w.from.symId) && ids.has(w.to.symId)), shapes }
    if (syms.length || shapes.length) say(tr(lang, 'toastCopied'))
  }, [doc, sel, say, lang])

  const paste = useCallback(() => {
    const c = clip.current
    if (!c || (!c.symbols.length && !c.shapes?.length)) return
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
      const shapes = (c.shapes ?? []).map((s) => { const id = uid(); map.set(s.id, id); return { ...s, id, x: s.x + 20, y: s.y + 20 } })
      return { ...d, symbols: [...d.symbols, ...added], wires: [...d.wires, ...wires], ...(shapes.length ? { shapes: [...(d.shapes ?? []), ...shapes] } : {}) }
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

  /** pose un appareil de mesure en haut à droite de la feuille (à déplacer ensuite, ainsi que ses pointes) */
  const addInstrument = (kind: Instrument['kind'], style: Instrument['style']) => {
    commit((d) => {
      const n = (d.instruments ?? []).length
      const paper = PAPER_SIZE[d.paper]
      const ins = defaultInstrument(kind, style, paper.w - 14 - 150 - (n % 4) * 125, 40 + Math.floor(n / 4) * 30)
      return { ...d, instruments: [...(d.instruments ?? []), ins] }
    })
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
      if (e.key === 'Escape') { setMeasure(false); setMenu(null); setPlacing(null); setTool(null); setSel([]); setShowKeys(false); setShowBom(false); setShowFeedback(false); setShowCredits(false) }
      else if (e.key === 'Delete' || e.key === 'Backspace') deleteSel()
      else if (k === 'r' && !ctrl) { if (!placing) rotateSel() }
      else if (e.key === 'Enter' && !ctrl && sel.length === 1 && doc.symbols.some((x) => x.id === sel[0])) { e.preventDefault(); openProps(sel[0]) }
      else if (e.key === '?') setShowKeys((v) => !v)
      else if (e.key === 'ArrowLeft') { e.preventDefault(); nudge(-step, 0) }
      else if (e.key === 'ArrowRight') { e.preventDefault(); nudge(step, 0) }
      else if (e.key === 'ArrowUp') { e.preventDefault(); nudge(0, -step) }
      else if (e.key === 'ArrowDown') { e.preventDefault(); nudge(0, step) }
      else if (ctrl && k === 'a') { e.preventDefault(); setSel([...doc.symbols.map((s) => s.id), ...doc.wires.map((w) => w.id)]) }
      else if (ctrl && k === 'g') { e.preventDefault(); groupSel(!e.shiftKey) }
      else if (ctrl && k === 'd') { e.preventDefault(); duplicate() }
      else if (ctrl && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo() }
      else if (ctrl && k === 'y') { e.preventDefault(); redo() }
      else if (ctrl && e.shiftKey && k === 'c') { e.preventDefault(); copyStyle() }
      else if (ctrl && e.shiftKey && k === 'v') { e.preventDefault(); pasteStyle() }
      else if (ctrl && k === 'c') copySel()
      else if (ctrl && k === 'v') paste()
      else if (ctrl && k === 's') { e.preventDefault(); saveJson(doc); say(tr(lang, 'toastSaved')) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [deleteSel, rotateSel, undo, redo, copySel, paste, duplicate, nudge, doc, placing, say, lang, simMode, wiringOn, sel]) // eslint-disable-line react-hooks/exhaustive-deps

  const autoLabel = () => {
    commit((d) => {
      const counters: Record<string, number> = {}
      const order = [...d.symbols].sort((a, b) => a.x - b.x || a.y - b.y)
      const labels = new Map<string, string>()
      for (const s of order) {
        if (SYMBOL_MAP[s.defId]?.domain !== 'electrical' && SYMBOL_MAP[s.defId]?.fluid) continue // composants fluides : repérés plus bas d'après le câblage
        if (isTerminal(s.defId)) {
          // une borne garde son bornier (X1, X2…) et se renumérote à l'intérieur : X1.1, X1.2…
          const strip = s.label ? stripOf(s.label) : 'X1'
          counters['#' + strip] = (counters['#' + strip] ?? 0) + 1
          labels.set(s.id, `${strip}.${counters['#' + strip]}`)
          continue
        }
        const p = SYMBOL_MAP[s.defId].prefix
        counters[p] = (counters[p] ?? 0) + 1
        labels.set(s.id, p + counters[p])
      }
      return renumberFluid({ ...d, symbols: d.symbols.map((s) => (labels.has(s.id) ? { ...s, label: labels.get(s.id)! } : s)) }, SYMBOL_MAP)
    })
    say(t('toastNumbered'))
  }

  /** colore tous les conducteurs selon la norme EN 60204-1 (puissance noir, commande rouge ou bleu, neutre bleu clair, terre vert-jaune) */
  const autoColors = () => {
    const colors: Record<string, string> = {}
    for (const w of doc.wires) { const c = computeWireAdvice(w, all, SYMBOL_MAP, lang).color; if (c) colors[w.id] = c.value }
    commit((d) => ({ ...d, wires: d.wires.map((w) => (colors[w.id] ? { ...w, color: colors[w.id] } : w)) }))
    say(tr(lang, 'toastColors'))
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
          ? matchesQuery(s, q)
          : cat === TOP ? s.top || usageCount(s.id, now) >= 1 || globalShare(s.id) >= 30 : (s.menu ?? s.cat) === cat),
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
  // outils de dessin : cadres, ellipse, lignes, flèches
  const [tool, setTool] = useState<Shape['kind'] | null>(null)
  const [measure, setMeasure] = useState(false)
  const [toolStyle, setToolStyle] = useState<Partial<Shape>>({})
  const startTool = (kind: Shape['kind'], style: Partial<Shape> = {}) => {
    if (doc.hideShapes || doc.lockShapes) update((d) => ({ ...d, hideShapes: undefined, lockShapes: undefined }))
    setTool(kind); setToolStyle(style); setPlacing(null); setSel([])
  }
  const imageRef = useRef<HTMLInputElement>(null)
  const blocksRef = useRef<HTMLInputElement>(null)
  /** blocs réutilisables : sauvegarde en fichier et import (partage entre postes ou entre collègues) */
  const exportBlocks = () => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([JSON.stringify({ albertBlocks: 1, blocks }, null, 2)], { type: 'application/json' }))
    a.download = 'blocs.albert-blocs.json'
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }
  const importBlocks = (f: File) => {
    const rd = new FileReader()
    rd.onload = () => {
      try {
        const j = JSON.parse(String(rd.result))
        const list = (Array.isArray(j?.blocks) ? j.blocks : []).filter((b: { name?: unknown; symbols?: unknown }) => typeof b?.name === 'string' && Array.isArray(b?.symbols))
        if (!list.length) throw new Error('vide')
        storeBlocks([...blocks, ...list.map((b: { id: string }) => ({ ...b, id: uid() }))])
        say(tr(lang, 'blocksImported'))
      } catch { say(tr(lang, 'blocksInvalid')) }
    }
    rd.readAsText(f)
  }
  /** insère une image (logo, photo) : réduite à 600 px au plus pour garder le schéma léger */
  const addImage = (f: File) => {
    const rd = new FileReader()
    rd.onload = () => {
      const img = new Image()
      img.onload = () => {
        const k = Math.min(1, 600 / Math.max(img.width, img.height))
        const cv = document.createElement('canvas')
        cv.width = Math.max(1, Math.round(img.width * k)); cv.height = Math.max(1, Math.round(img.height * k))
        const ctx = cv.getContext('2d')
        if (!ctx) return
        const png = /png|gif|svg|webp/.test(f.type)
        if (!png) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height) }
        ctx.drawImage(img, 0, 0, cv.width, cv.height)
        const w = 120, h = Math.max(10, Math.round((w * img.height) / img.width))
        const made: Shape = { id: uid(), kind: 'image', x: 160, y: 120, w, h, stroke: 'solid', width: 1, color: '#000000', href: cv.toDataURL(png ? 'image/png' : 'image/jpeg', 0.8) }
        commit((d) => ({ ...d, hideShapes: undefined, lockShapes: undefined, shapes: [...(d.shapes ?? []), made] }))
        setSel([made.id])
      }
      img.src = String(rd.result)
    }
    rd.readAsDataURL(f)
  }
  const selShape = sel.length === 1 ? (doc.shapes ?? []).find((s) => s.id === sel[0]) : undefined
  const patchShape = (patch: Partial<Shape>) => update((d) => ({ ...d, shapes: (d.shapes ?? []).map((s) => (s.id === sel[0] ? { ...s, ...patch } : s)) }))
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
  // fenêtre « Propriétés » flottante d'un symbole (clic droit, double-clic ou Entrée) : repère, tensions, caractéristiques, réglages, bornes
  // édition d'un texte sur place (double-clic sur une annotation, un nom de composant ou un repère)
  const [textEdit, setTextEdit] = useState<{ kind: 'note' | 'name' | 'label'; id: string; x: number; y: number } | null>(null)
  const textDone = useRef(false) // évite une double validation (Entrée puis perte de focus)
  const textEditValue = (te: { kind: 'note' | 'name' | 'label'; id: string }) => {
    if (te.kind === 'note') return (doc.notes ?? []).find((n) => n.id === te.id)?.text ?? ''
    const s = doc.symbols.find((x) => x.id === te.id)
    if (!s) return ''
    return te.kind === 'label' ? s.label : s.nameText || SYMBOL_MAP[s.defId].name[lang]
  }
  const commitText = (te: { kind: 'note' | 'name' | 'label'; id: string }, value: string) => {
    const v = te.kind === 'note' ? value : value.trim()
    const cur = textEditValue(te)
    if (v === cur) return
    if (te.kind === 'note') commit((d) => ({ ...d, notes: (d.notes ?? []).map((n) => (n.id === te.id ? { ...n, text: v } : n)) }))
    else if (te.kind === 'label') { if (isTerminal(doc.symbols.find((s) => s.id === te.id)?.defId ?? '')) setActiveStrip(v); commit((d) => ({ ...d, symbols: d.symbols.map((s) => (s.id === te.id ? { ...s, label: v } : s)) })) }
    else commit((d) => ({ ...d, symbols: d.symbols.map((s) => (s.id === te.id ? { ...s, nameText: v && v !== SYMBOL_MAP[s.defId].name[lang] ? v : undefined } : s)) }))
  }
  const [propsId, setPropsId] = useState<string | null>(null)
  const [propsPos, setPropsPos] = useState({ x: 380, y: 90 })
  const openProps = (id: string, x?: number, y?: number) => {
    setSel([id])
    setPropsId(id)
    if (x !== undefined && y !== undefined) setPropsPos({ x: Math.max(8, Math.min(x + 12, window.innerWidth - 350)), y: Math.max(8, Math.min(y - 20, window.innerHeight - 260)) })
  }
  useEffect(() => { if (propsId && sel[0] !== propsId) setPropsId(null) }, [sel, propsId])
  const dragProps = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return
    const dx = e.clientX - propsPos.x
    const dy = e.clientY - propsPos.y
    const move = (ev: MouseEvent) => setPropsPos({ x: Math.max(0, Math.min(ev.clientX - dx, window.innerWidth - 120)), y: Math.max(0, Math.min(ev.clientY - dy, window.innerHeight - 60)) })
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  /** impression de toutes les feuilles : on affiche chaque page à son tour pour en capturer le dessin, puis on revient à la page d'origine */
  const pdfAll = async (allPages: boolean) => {
    if (exportRef.current) exportRef.current.open = false
    const start = doc.page ?? 0
    const svgs: string[] = []
    if (!allPages || pageCount(doc) < 2) { if (contentRef.current) svgs.push(sheetSvg(doc, contentRef.current)) }
    else {
      for (let i = 0; i < pageCount(doc); i++) {
        setH((s) => ({ ...s, doc: switchPage(s.doc, i) }))
        await new Promise((r) => setTimeout(r, 250))
        if (contentRef.current) svgs.push(sheetSvg(doc, contentRef.current))
      }
      setH((s) => ({ ...s, doc: switchPage(s.doc, start) }))
    }
    if (svgs.length) { const { exportPdf } = await import('./pdf'); await exportPdf(doc, svgs, fileBase(doc) + '.pdf') }
  }
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

  // conseils de réglage de l'appareil sélectionné (d'après le circuit dessiné et les gammes des constructeurs)
  const adv = useMemo(() => (selSym ? settingsAdvice(selSym, all, SYMBOL_MAP, lang) : {}), [selSym, all, lang]) as Record<string, Suggestion | undefined>
  const advLine = (k: string, current: unknown) => {
    const a = adv[k]
    if (!a || String(current ?? '') === String(a.value)) return null
    const apply = () => {
      if (k === 'volts' || k === 'power' || k === 'voltsPrimary') patchSym({ [k]: a.value } as Partial<PlacedSymbol>)
      else patchSym({ rated: { ...(selSym?.rated ?? {}), [k]: a.value, ...(a.also ?? {}) } })
    }
    return (
      <span className="advice">
        💡 {a.text}
        <button type="button" className="mini" onClick={(e) => { e.preventDefault(); apply() }}>{t('applyAdvice')} {typeof a.value === 'number' || String(a.value).length < 8 ? String(a.value).replace('.', lang === 'fr' ? ',' : '.') : ''}</button>
      </span>
    )
  }
  /** enregistrement automatique dans un fichier du disque (API File System Access : Chrome, Edge) */
  const fileHandle = useRef<{ name: string; createWritable: () => Promise<{ write: (d: string) => Promise<void>; close: () => Promise<void> }> } | null>(null)
  const [autoFile, setAutoFile] = useState<string | null>(null)
  const canAutoFile = typeof window !== 'undefined' && 'showSaveFilePicker' in window
  const chooseAutoFile = async () => {
    try {
      const h = await (window as unknown as { showSaveFilePicker: (o: unknown) => Promise<typeof fileHandle.current> }).showSaveFilePicker({
        suggestedName: (doc.title.title || 'schema').replace(/[^\w\-]+/g, '_') + '.albert.json',
        types: [{ description: 'Albert Schema', accept: { 'application/json': ['.json'] } }],
      })
      fileHandle.current = h
      setAutoFile(h!.name)
      say(lang === 'fr' ? 'Enregistrement automatique activé : ' + h!.name : 'Autosave enabled: ' + h!.name)
    } catch { /* annulé */ }
  }
  useEffect(() => {
    const h = fileHandle.current
    if (!h) return
    const id = window.setTimeout(async () => {
      try { const w = await h.createWritable(); await w.write(JSON.stringify(doc, null, 2)); await w.close() }
      catch { fileHandle.current = null; setAutoFile(null) }
    }, 1500)
    return () => window.clearTimeout(id)
  }, [doc, autoFile])
  /** pinceau de style : copie le style (trait, couleur, police) d'un objet et l'applique aux objets sélectionnés du même genre */
  const painter = useRef<{ kind: 'shape' | 'wire' | 'note'; style: Record<string, unknown> } | null>(null)
  const copyStyle = () => {
    const sh = (doc.shapes ?? []).find((x) => sel.includes(x.id)), w = doc.wires.find((x) => sel.includes(x.id)), n = (doc.notes ?? []).find((x) => sel.includes(x.id))
    if (sh) painter.current = { kind: 'shape', style: { stroke: sh.stroke, width: sh.width, color: sh.color, fill: sh.fill, arrow: sh.arrow } }
    else if (w) painter.current = { kind: 'wire', style: { color: w.color, width: w.width, dash: w.dash } }
    else if (n) painter.current = { kind: 'note', style: { size: n.size, font: n.font, bold: n.bold, italic: n.italic } }
    else return
    say(lang === 'fr' ? 'Style copié : Ctrl+Maj+V pour l’appliquer à la sélection.' : 'Style copied: Ctrl+Shift+V applies it to the selection.')
  }
  const pasteStyle = () => {
    const pt = painter.current
    if (!pt || !sel.length) return
    commit((d) => ({
      ...d,
      shapes: pt.kind === 'shape' ? (d.shapes ?? []).map((x) => (sel.includes(x.id) ? { ...x, ...pt.style } : x)) : d.shapes,
      wires: pt.kind === 'wire' ? d.wires.map((x) => (sel.includes(x.id) ? { ...x, ...pt.style } : x)) : d.wires,
      notes: pt.kind === 'note' ? (d.notes ?? []).map((x) => (sel.includes(x.id) ? { ...x, ...pt.style } : x)) : d.notes,
    }))
  }
  /** modification groupée : plusieurs symboles sélectionnés, les champs communs s'appliquent à tous */
  const msyms = sel.length > 1 ? doc.symbols.filter((x) => sel.includes(x.id)) : []
  const patchMany = (fn: (s: PlacedSymbol) => Partial<PlacedSymbol>) =>
    update((d) => ({ ...d, symbols: d.symbols.map((s) => (sel.includes(s.id) ? { ...s, ...fn(s) } : s)) }))
  const common = <T,>(get: (s: PlacedSymbol) => T): T | undefined => (msyms.every((s) => get(s) === get(msyms[0])) ? get(msyms[0]) : undefined)
  const multiForm = (() => {
    if (msyms.length < 2) return null
    const fr = lang === 'fr'
    const kinds = new Set(msyms.map((s) => kindOf(SYMBOL_MAP[s.defId])))
    const kind = kinds.size === 1 ? [...kinds][0] : null
    const def0 = SYMBOL_MAP[msyms[0].defId]
    const hasVolts = msyms.every((s) => { const m = SYMBOL_MAP[s.defId].sim; return m?.k === 'coil' || m?.k === 'load' || m?.k === 'transformer' })
    const setR = (key: string, raw: string, text?: boolean) =>
      patchMany((s) => {
        const next = { ...(s.rated ?? {}) } as Record<string, unknown>
        if (text ? raw.trim() === '' : !(Number(raw) > 0)) delete next[key]
        else next[key] = text ? raw.trim() : Number(raw)
        return { rated: Object.keys(next).length ? (next as Ratings) : undefined }
      })
    return (
      <div className="form" onFocus={checkpoint}>
        <div className="kind">{msyms.length} {t('sym')} — {fr ? 'modification groupée' : 'bulk edit'}</div>
        <label>{t('description')}<input value={common((s) => s.desc) ?? ''} placeholder={common((s) => s.desc) === undefined ? (fr ? '— valeurs différentes —' : '— different values —') : ''} onChange={(e) => patchMany(() => ({ desc: e.target.value }))} /></label>
        {hasVolts && (
          <label>{t('voltsRated')}
            <Combo options={[12, 24, 48, 110, 230, 400]} type="number" min={0} placeholder={common((s) => s.volts) === undefined ? (fr ? 'différentes' : 'different') : '—'} value={common((s) => s.volts) ?? ''}
              onChange={(e) => patchMany(() => ({ volts: Number(e.target.value) > 0 ? Number(e.target.value) : undefined }))} />
          </label>
        )}
        {kind && (
          <fieldset className="ratings">
            <legend>{t('ratings')}</legend>
            {fieldsFor(def0).map((f) => {
              const v = common((s) => String(s.rated?.[f.key] ?? ''))
              return (
                <label key={f.key}>{fieldLabel(f, lang)}
                  <Combo options={f.list ?? []} type={f.text ? 'text' : 'number'} min={0} step={f.step ?? 'any'} placeholder={v === undefined ? (fr ? 'différentes' : 'different') : undefined}
                    value={v ?? ''} onChange={(e) => setR(f.key, e.target.value, f.text)} />
                </label>
              )
            })}
          </fieldset>
        )}
      </div>
    )
  })()
  /** bobines possibles pour les électrodistributeurs du schéma : 1V1+, 1V1−… (proposées dans le champ « repère » d'une bobine) */
  const solenoidChoices = useMemo(() => {
    const out: string[] = []
    for (const s of all.symbols) {
      const f = SYMBOL_MAP[s.defId]?.fluid
      if (f?.k !== 'valve' || !s.label) continue
      const [a, b] = solenoidNames(s.label)
      if (f.a === 'elec' && a[0]) out.push(a[0])
      if (f.b === 'elec' && b[0]) out.push(b[0])
    }
    return out
  }, [all])
  /** détecteurs de position posés sur les vérins (par repère de vérin normalisé), dessinés sur le vérin */
  const detectors = useMemo(() => {
    const out: Record<string, { id: string; label: string; at: number; nc: boolean }[]> = {}
    for (const s of all.symbols) {
      if (!s.det?.cyl) continue
      const m = SYMBOL_MAP[s.defId]?.sim
      ;(out[s.det.cyl.replace(/\s+/g, '').toUpperCase()] ??= []).push({ id: s.id, label: s.label, at: s.det.at, nc: m?.k === 'switch' && m.nc })
    }
    return out
  }, [all])
  const cylinderLabels = useMemo(() => [...new Set(all.symbols.filter((s) => SYMBOL_MAP[s.defId]?.fluid?.k === 'cyl' && s.label).map((s) => s.label))], [all])
  // automate : panneau de programmation (Grafcet et langage à contacts)
  const [plcEdit, setPlcEdit] = useState<string | null>(null)
  const [plcWin, setPlcWin] = usePlcWin()
  const plcSym = plcEdit ? doc.symbols.find((x) => x.id === plcEdit) : undefined
  const wireAdvice = useMemo(() => (selWire ? computeWireAdvice(selWire, all, SYMBOL_MAP, lang) : undefined), [selWire, all, lang])
  const symForm = selSym ? (
          <div className="form" onFocus={checkpoint}>
            <div className="kind">{SYMBOL_MAP[selSym.defId].name[lang]} <small>({SYMBOL_MAP[selSym.defId].std})</small></div>
            <label data-tip={t('helpLabel')}>{t('label')}{tip('helpLabel')}<Combo options={SYMBOL_MAP[selSym.defId].sim?.k === 'coil' ? solenoidChoices : []} value={selSym.label} onChange={(e) => { if (isTerminal(selSym.defId)) setActiveStrip(e.target.value); patchSym({ label: e.target.value }) }} />{isTerminal(selSym.defId) && <span className="advice">💡 {t('stripHint')}</span>}</label>
            <label data-tip={t('helpDesc')}>{t('description')}{tip('helpDesc')}<input value={selSym.desc} onChange={(e) => patchSym({ desc: e.target.value })} /></label>
            {SYMBOL_MAP[selSym.defId].sim?.k === 'transformer' && (() => {
              const def = SYMBOL_MAP[selSym.defId]
              const info = transformerInfo(selSym, def)
              const topo = transformerTopology(all, SYMBOL_MAP)
              const sec = def.sim?.k === 'transformer' ? def.sim.secondary.length : 0
              return (
                <>
                  <label data-tip={t('helpVoltsPrimary')}>{t('voltsPrimary')}{tip('helpVoltsPrimary')}
                    <Combo options={[230, 400, 690]} type="number" min={0} placeholder="230" value={selSym.voltsPrimary ?? ''}
                      onChange={(e) => patchSym({ voltsPrimary: Number(e.target.value) > 0 ? Number(e.target.value) : undefined })} />
                    {advLine('voltsPrimary', selSym.voltsPrimary)}
                  </label>
                  <label data-tip={t('helpPower')}>{t('power')}{tip('helpPower')}
                    <Combo options={[40, 63, 100, 160, 250, 400, 630, 1000, 1600, 2500]} type="number" min={0} placeholder="100" value={selSym.power ?? ''}
                      onChange={(e) => patchSym({ power: Number(e.target.value) > 0 ? Number(e.target.value) : undefined })} />
                    {advLine('power', selSym.power)}
                  </label>
                  {describeInfo(info, lang).map((line, i) => <p key={i} className="muted small">⚡ {line}</p>)}
                  {!selSym.power && <p className="muted small">💡 {t('trafoPowerHint')}</p>}
                  {sec === 2 && <p className="muted small">{topo.earthed[selSym.id] ? '⏚ ' + t('trafoEarthed') : '◌ ' + t('trafoIsolated')}</p>}
                </>
              )
            })()}
            {(() => {
              const def = SYMBOL_MAP[selSym.defId]
              const kind = kindOf(def)
              if (!kind) return null
              const setR = (key: string, raw: string, text?: boolean) => {
                const next = { ...(selSym.rated ?? {}) } as Record<string, unknown>
                const v = text ? raw.trim() : Number(raw)
                if (text ? v === '' : !(Number(raw) > 0)) delete next[key]
                else next[key] = v
                patchSym({ rated: Object.keys(next).length ? (next as Ratings) : undefined })
              }
              const mc = kind === 'motor' ? motorCurrent(selSym, def) : undefined
              return (
                <fieldset className="ratings" data-tip={t('helpRatings')}>
                  <legend>{t('ratings')} {tip('helpRatings')}</legend>
                  {(() => {
                    const keys = fieldsFor(def).map((f) => f.key).filter((k) => adv[k] && String(selSym.rated?.[k] ?? '') !== String(adv[k]!.value))
                    return keys.length > 1 ? (
                      <button type="button" className="mini applyall" onClick={() => patchSym({ rated: { ...(selSym.rated ?? {}), ...Object.fromEntries(keys.flatMap((k) => [[k, adv[k]!.value], ...Object.entries(adv[k]!.also ?? {})])) } as Ratings })}>
                        💡 {t('applyAll')} ({keys.length})
                      </button>
                    ) : null
                  })()}
                  {fieldsFor(def).map((f) => (
                    <label key={f.key} data-tip={f.help[lang]}>{fieldLabel(f, lang)}<span className="tip" data-tip={f.help[lang]} aria-label={f.help[lang]}>?</span>
                      <Combo options={f.list ?? []} type={f.text ? 'text' : 'number'} min={0} step={f.step ?? 'any'}
                        placeholder={f.key === 'ie' && mc?.estimated ? String(mc.value) : undefined}
                        value={String(selSym.rated?.[f.key] ?? '')} onChange={(e) => setR(f.key, e.target.value, f.text)} />
                      {advLine(f.key, selSym.rated?.[f.key])}
                    </label>
                  ))}
                  {mc?.estimated && <p className="muted small">⚡ {t('motorEstimated')} {String(mc.value).replace('.', lang === 'fr' ? ',' : '.')} A</p>}
                  {kind === 'consumer' && <p className="muted small">{t('wattsHint')}</p>}
                </fieldset>
              )
            })()}
            {(() => { const d = SYMBOL_MAP[selSym.defId]; return d.sim?.k === 'source' && defaultVolts(Object.values(sourcePots(selSym, d))) !== undefined })() && (() => {
              const d = SYMBOL_MAP[selSym.defId]
              const pots = Object.values(sourcePots(selSym, d))
              const dv = defaultVolts(pots)!
              const list = pots.includes('+') ? [12, 24, 48, 110] : pots.some((p) => /^L[123]$/.test(p)) ? [230, 400, 690] : [12, 24, 48, 110, 230]
              return (
                <>
                  {d.id === 'sim-src1' && (
                    <label data-tip={t('helpSourceNature')}>{t('sourceNature')}{tip('helpSourceNature')}
                      <select value={selSym.dc ? 'dc' : 'ac'} onChange={(e) => patchSym({ dc: e.target.value === 'dc' || undefined, volts: undefined })}>
                        <option value="ac">{t('natureAc')}</option>
                        <option value="dc">{t('natureDc')}</option>
                      </select>
                    </label>
                  )}
                  <label data-tip={t('helpSourceVolts')}>{t(pots.some((p) => /^L[123]$/.test(p)) ? 'sourceVoltsTri' : 'sourceVolts')}{tip('helpSourceVolts')}
                    <Combo options={list} type="number" min={0} placeholder={String(dv)} value={selSym.volts ?? ''} onChange={(e) => patchSym({ volts: Number(e.target.value) > 0 ? Number(e.target.value) : undefined })} />
                  </label>
                </>
              )
            })()}
            {(() => { const m = SYMBOL_MAP[selSym.defId].sim; return m?.k === 'transformer' || m?.k === 'coil' || m?.k === 'load' })() && (
              <label data-tip={SYMBOL_MAP[selSym.defId].sim?.k === 'transformer' ? t('helpVoltsSecondary') : t('helpVoltsRated')}>{SYMBOL_MAP[selSym.defId].sim?.k === 'transformer' ? t('voltsSecondary') : t('voltsRated')}{tip(SYMBOL_MAP[selSym.defId].sim?.k === 'transformer' ? 'helpVoltsSecondary' : 'helpVoltsRated')}
                <Combo options={[12, 24, 48, 110, 230, 400]} type="number" min={0} placeholder={SYMBOL_MAP[selSym.defId].sim?.k === 'transformer' ? '24' : '—'}
                  value={selSym.volts ?? ''} onChange={(e) => patchSym({ volts: Number(e.target.value) > 0 ? Number(e.target.value) : undefined })} />
                {advLine('volts', selSym.volts)}
              </label>
            )}
            {SYMBOL_MAP[selSym.defId].sim?.k === 'plc' && (
              <fieldset className="ratings">
                <legend>{lang === 'fr' ? 'Programme' : 'Program'}</legend>
                <button type="button" onClick={() => setPlcEdit(selSym.id)}>{lang === 'fr' ? 'Programmer l’automate…' : 'Program the controller…'}</button>
                <p className="muted small">{lang === 'fr' ? `${selSym.plc?.steps.length ?? 0} étape(s) Grafcet · ${selSym.plc?.ladder.length ?? 0} réseau(x) Ladder. Alimentez L+ et M (24 V) pour que l’automate démarre.` : `${selSym.plc?.steps.length ?? 0} Grafcet step(s) · ${selSym.plc?.ladder.length ?? 0} ladder rung(s). Power L+ and M (24 V) to start the controller.`}</p>
              </fieldset>
            )}
            {(() => { const d = SYMBOL_MAP[selSym.defId]; return d.sim?.k === 'switch' && d.sim.ctl === 'toggle' && /390_sensors_instruments|41_limit_switches/.test(d.id) })() && (
              <fieldset className="ratings" data-tip={lang === 'fr' ? 'Pose ce capteur sur un vérin pneumatique ou hydraulique : le contact se ferme quand le piston atteint la position réglée. Un repère sur le vérin montre où il est placé.' : 'Mounts this sensor on a pneumatic or hydraulic cylinder: the contact closes when the piston reaches the set position. A mark on the cylinder shows where it sits.'}>
                <legend>{lang === 'fr' ? 'Détecteur de vérin' : 'Cylinder sensor'}</legend>
                <label>{lang === 'fr' ? 'Vérin détecté (repère)' : 'Cylinder (tag)'}
                  <Combo options={cylinderLabels} value={selSym.det?.cyl ?? ''} placeholder="1A1" onChange={(e) => patchSym({ det: e.target.value.trim() ? { cyl: e.target.value, at: selSym.det?.at ?? 0 } : undefined })} />
                </label>
                {selSym.det && (
                  <label>{lang === 'fr' ? 'Position le long de la course (%) — 0 = rentré, 100 = sorti' : 'Position along the stroke (%) — 0 = retracted, 100 = extended'}
                    <input type="range" min={0} max={100} step={5} value={Math.round(selSym.det.at * 100)} onChange={(e) => patchSym({ det: { ...selSym.det!, at: Number(e.target.value) / 100 } })} /> {Math.round(selSym.det.at * 100)} %
                  </label>
                )}
              </fieldset>
            )}
            {(() => { const m = SYMBOL_MAP[selSym.defId].sim; return (m?.k === 'coil' && !!m.timer) || (m?.k === 'switch' && !!m.delay) })() && (
              <label data-tip={t('helpDelay')}>{t('delay')}{tip('helpDelay')}
                <input type="number" min={0} step={0.5} value={selSym.delay ?? DEFAULT_DELAY_S} onChange={(e) => patchSym({ delay: Math.max(0, Number(e.target.value) || 0) })} />
              </label>
            )}
            {(() => {
              const def = SYMBOL_MAP[selSym.defId]
              const groups = termGroups(def)
              if (!groups.length || def.ports.length > 16) return null
              // repères affichés : saisie, sinon numérotation automatique (unique au sein de l'appareil)
              const eff = termsWithTopology(all, SYMBOL_MAP)
              const defaults = termsWithTopology(all, SYMBOL_MAP, selSym.id)[selSym.id] ?? {}
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
                    <span data-tip={t('helpTerms')}>{t('terminals')}{tip('helpTerms')}</span>
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
                              data-tip={dup ? t('termDup') : t('termHelp')}
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
              <label data-tip={t('helpDrivenBy')}>{t('drivenBy')}{tip('helpDrivenBy')}
                <select value={coilLabels.includes(selSym.label) ? selSym.label : ''} onChange={(e) => e.target.value && patchSym({ label: e.target.value })}>
                  <option value="">—</option>
                  {coilLabels.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </label>
            )}
          </div>
  ) : null

  /** ferme le menu après le clic sur une commande (les champs et les boutons « .keep » le laissent ouvert) */
  const closeMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button:not(.keep)')) (e.currentTarget.parentElement as HTMLDetailsElement).removeAttribute('open')
  }
  useEffect(() => {
    // un clic en dehors d'un menu ouvert le referme
    const onDown = (e: MouseEvent) => document.querySelectorAll('details.menu[open]').forEach((d) => { if (!d.contains(e.target as Node)) d.removeAttribute('open') })
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  const hint = simMode ? t('simHint') : tool ? t('hintTool') : wiringOn ? t('hintWiring') : placing ? t('hintPlace') : sel.length ? t('hintSel') : t('hintIdle')

  const symButton = (s: (typeof SYMBOLS)[number]) => (
    <button key={s.id} className={'symbtn' + (placing === s.id ? ' on' : '') + (usageCount(s.id) >= 2 ? ' used' : '')} title={`${s.name[lang]} — ${s.std}`}
      draggable
      onDragStart={(e) => { e.dataTransfer.setData('text/x-albert-symbol', s.id); e.dataTransfer.effectAllowed = 'copy'; setPlacing(null) }}
      onClick={() => { setPlacing(placing === s.id ? null : s.id); setTool(null); setSel([]) }}>
      <svg viewBox={`-6 -6 ${s.w + 12} ${s.h + 12}`} stroke="currentColor" fill="none" strokeWidth={Math.max(2, Math.max(s.w, s.h) / 28)} strokeLinecap="round" strokeLinejoin="round"
        dangerouslySetInnerHTML={{ __html: s.svg.replace(/var\(--bg\)/g, 'transparent') }} />
      <span>{s.name[lang]}</span>
    </button>
  )

  return (
    <div className={'app' + (simMode ? ' simmode' : '')}>
      <header className="toolbar" role="toolbar">
        <span className="brand"><span className="vis" aria-hidden="true" />Albert<b>Schema</b><span className="studio"> Studio</span></span>

        {/* Fichier : ouvrir, enregistrer, exporter, exemples, nomenclature */}
        <details className="menu" ref={exportRef}>
          <summary>{t('file')} ▾</summary>
          <div className="menu-list" onClick={closeMenu}>
            <button onClick={() => { if (!doc.symbols.length || confirm(t('newConfirm'))) { commit(() => emptyDoc()); setSel([]) } }}>{t('new')}</button>
            <button onClick={() => fileRef.current?.click()}>{t('open')}</button>
            <button onClick={() => { saveJson(doc); say(t('toastSaved')) }}><span>{t('save')}</span><kbd>Ctrl+S</kbd></button>
            {canAutoFile && (autoFile
              ? <button onClick={() => { fileHandle.current = null; setAutoFile(null) }}>{lang === 'fr' ? 'Arrêter l’enregistrement auto' : 'Stop autosave'} ({autoFile})</button>
              : <button onClick={chooseAutoFile}>{lang === 'fr' ? 'Enregistrement auto dans un fichier…' : 'Autosave to a file…'}</button>)}
            <button onClick={() => setShowGallery(true)}>{t('gallery')}</button>
            <button onClick={() => setShowBom(true)}>{t('bom')}</button>
            <button onClick={() => { setVersions(loadVersions()); setShowVersions(true) }}>{t('versions')}</button>
            <p className="menu-title">{t('export')}</p>
            <button onClick={withContent((c) => exportSvg(doc, c))}>{t('exportSvg')}</button>
            <button onClick={withContent((c) => exportPng(doc, c))}>{t('exportPng')}</button>
            <button onClick={withContent((c) => printSheet(doc, c))}>{t('print')}</button>
            <button onClick={() => pdfAll(false)}>{lang === 'fr' ? 'Télécharger en PDF (cette feuille)' : 'Download PDF (this sheet)'}</button>
            {pageCount(doc) > 1 && <button onClick={() => pdfAll(true)}>{lang === 'fr' ? 'Télécharger en PDF (toutes les feuilles)' : 'Download PDF (all sheets)'}</button>}
            {pageCount(doc) > 1 && <button onClick={printAllPages}>{t('printAll')}</button>}
            <button onClick={() => exportDxf(doc)}>{t('exportDxf')}</button>
            <button onClick={() => exportCsv(all, lang)}>{t('exportCsv')}</button>
            <button onClick={() => exportWiringCsv(all, lang)}>{lang === 'fr' ? 'Liste de câblage (CSV)' : 'Wiring list (CSV)'}</button>
            <button onClick={copyShareLink}>{t('shareLink')}</button>
            <label className="chk keep" title={t('bwHelp')}><input type="checkbox" checked={bw} onChange={(e) => setBw(e.target.checked)} /> {t('bw')}</label>
          </div>
        </details>
        <input ref={blocksRef} type="file" accept=".json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) importBlocks(f); e.target.value = '' }} />
        <input ref={imageRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) addImage(f); e.target.value = '' }} />
        <input ref={fileRef} type="file" accept=".json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) openFile(f); e.target.value = '' }} />

        <div className="group editonly">
          <button className="icon" onClick={undo} disabled={!h.past.length} title={`${t('undo')} (Ctrl+Z)`} aria-label={t('undo')}>↶</button>
          <button className="icon" onClick={redo} disabled={!h.future.length} title={`${t('redo')} (Ctrl+Y)`} aria-label={t('redo')}>↷</button>
          <button className="icon" onClick={rotateSel} disabled={!sel.length} title={`${t('rotate')} (R)`} aria-label={t('rotate')}>⟳</button>
          <button className="icon" onClick={duplicate} disabled={!sel.length} title={`${t('duplicate')} (Ctrl+D)`} aria-label={t('duplicate')}>⧉</button>
          <button className="icon danger" onClick={deleteSel} disabled={!sel.length} title={`${t('delete')} (Suppr)`} aria-label={t('delete')}>🗑</button>
        </div>

        {/* Dessin : disposition, numérotation, annotations, blocs, affichage des noms */}
        <details className="menu editonly">
          <summary>✎ {t('draw')} ▾</summary>
          <div className="menu-list wide" onClick={closeMenu}>
            <p className="menu-title">{t('align')}{sel.length < 2 ? ` — ${t('alignHint')}` : ''}</p>
            <div className="menu-grid">
              <button disabled={sel.length < 2} onClick={() => alignSel('left')}>{t('alignLeft')}</button>
              <button disabled={sel.length < 2} onClick={() => alignSel('hcenter')}>{t('alignHCenter')}</button>
              <button disabled={sel.length < 2} onClick={() => alignSel('right')}>{t('alignRight')}</button>
              <button disabled={sel.length < 2} onClick={() => alignSel('top')}>{t('alignTop')}</button>
              <button disabled={sel.length < 2} onClick={() => alignSel('vcenter')}>{t('alignVCenter')}</button>
              <button disabled={sel.length < 2} onClick={() => alignSel('bottom')}>{t('alignBottom')}</button>
              <button disabled={sel.length < 3} onClick={() => alignSel('distH')}>{t('distH')}</button>
              <button disabled={sel.length < 3} onClick={() => alignSel('distV')}>{t('distV')}</button>
            </div>
            <p className="menu-title">{t('numbering')}</p>
            <button onClick={autoLabel}>{t('autoLabel')}</button>
            <button onClick={autoWire}>{t('autoWire')}</button>
            <button onClick={autoColors} title={t('autoColorsHelp')}>{t('autoColors')}</button>
            <p className="menu-title">{t('annotate')}</p>
            <button onClick={addNote} title={t('note')}>T {t('note')}</button>
            <button onClick={copyStyle} disabled={!sel.length}>🖌 {lang === 'fr' ? 'Copier le style' : 'Copy style'}<kbd>Ctrl+Maj+C</kbd></button>
            <button onClick={pasteStyle} disabled={!sel.length}>🖌 {lang === 'fr' ? 'Appliquer le style' : 'Apply style'}<kbd>Ctrl+Maj+V</kbd></button>
            <button onClick={saveBlock} disabled={!sel.length}>{t('blockSave')}</button>
            {blocks.length === 0 && <p className="muted small menu-note">{t('blockNone')}</p>}
            <button className="keep" onClick={() => blocksRef.current?.click()}>{t('blocksImport')}</button>
            {blocks.length > 0 && <button className="keep" onClick={exportBlocks}>{t('blocksExport')}</button>}
            {blocks.map((blk) => (
              <div key={blk.id} style={{ display: 'flex' }}>
                <button style={{ flex: 1 }} onClick={() => insertBlock(blk)}>▦ {blk.name} <span className="muted">({blk.symbols.length})</span></button>
                <button className="keep" title={t('delete')} aria-label={t('delete')} onClick={() => storeBlocks(blocks.filter((x) => x.id !== blk.id))}>×</button>
              </div>
            ))}
            <p className="menu-title">{t('organize')}</p>
            <button disabled={sel.length < 2} onClick={() => groupSel(true)}><span>{t('group')}</span><kbd>Ctrl+G</kbd></button>
            <button disabled={!doc.symbols.some((s) => sel.includes(s.id) && s.group)} onClick={() => groupSel(false)}><span>{t('ungroup')}</span><kbd>Ctrl+Maj+G</kbd></button>
            <button disabled={!sel.length} onClick={() => lockSel(!doc.symbols.some((s) => sel.includes(s.id) && s.locked))}>{doc.symbols.some((s) => sel.includes(s.id) && s.locked) ? t('unlock') : t('lock')}</button>
            <p className="menu-title">{t('shapes')}</p>
            <button onClick={() => startTool('rect', { stroke: 'solid' })}>▭ {t('shapeRect')}</button>
            <button onClick={() => startTool('rect', { stroke: 'dashed', width: 1.2 })}>▭ {t('shapeRectDashed')}</button>
            <button onClick={() => startTool('rect', { stroke: 'dashdot', width: 1.2 })}>▭ {t('shapeRectDashDot')}</button>
            <button onClick={() => startTool('ellipse', { stroke: 'solid' })}>◯ {t('shapeEllipse')}</button>
            <button onClick={() => startTool('line', { stroke: 'solid' })}>╱ {t('shapeLine')}</button>
            <button onClick={() => startTool('line', { stroke: 'solid', arrow: 'end' })}>→ {t('shapeArrow')}</button>
            <button onClick={() => startTool('poly', { stroke: 'solid' })}>⌇ {t('shapePoly')}</button>
            <button onClick={() => startTool('arc', { stroke: 'solid' })}>◠ {t('shapeArc')}</button>
            <button onClick={() => { setMeasure((v) => !v); setTool(null); setPlacing(null) }}>📏 {lang === 'fr' ? (measure ? 'Quitter la mesure' : 'Mesurer une distance') : measure ? 'Stop measuring' : 'Measure a distance'}</button>
            <button onClick={() => imageRef.current?.click()}>🖼 {t('shapeImage')}</button>
            <label className="chk keep"><input type="checkbox" checked={!!doc.hideShapes} onChange={() => commit((d) => ({ ...d, hideShapes: d.hideShapes ? undefined : true }))} /> {t('shapesHide')}</label>
            <label className="chk keep"><input type="checkbox" checked={!!doc.lockShapes} onChange={() => commit((d) => ({ ...d, lockShapes: d.lockShapes ? undefined : true }))} /> {t('shapesLock')}</label>
            <p className="menu-title">{t('display')}</p>
            <label className="chk keep" title={t('darkSheetHelp')}><input type="checkbox" checked={darkSheet} onChange={(e) => setDarkSheet(e.target.checked)} /> {t('darkSheet')}</label>
            <label className="chk keep" title={t('showNamesHelp')}><input type="checkbox" checked={!!doc.showNames} onChange={() => commit((d) => ({ ...d, showNames: !d.showNames }))} /> {t('showNames')}</label>
            {doc.showNames && (
              <div className="namestyle">
                <label>{t('font')}
                  <select value={doc.nameStyle?.font ?? 'arial'} onChange={(e) => commit((d) => ({ ...d, nameStyle: { ...d.nameStyle, font: e.target.value } }))}>
                    {FONTS.map((f) => <option key={f.id} value={f.id} style={{ fontFamily: f.css }}>{f.label}</option>)}
                  </select>
                </label>
                <label>{t('noteSize')}
                  <input type="number" min={4} max={24} step={0.5} value={doc.nameStyle?.size ?? 7} onChange={(e) => commit((d) => ({ ...d, nameStyle: { ...d.nameStyle, size: Math.max(4, Math.min(24, Number(e.target.value) || 7)) } }))} />
                </label>
                <div className="row">
                  <button className={'keep' + (doc.nameStyle?.bold ? ' on' : '')} onClick={() => commit((d) => ({ ...d, nameStyle: { ...d.nameStyle, bold: !d.nameStyle?.bold } }))}><b>B</b></button>
                  <button className={'keep' + (doc.nameStyle?.italic ? ' on' : '')} onClick={() => commit((d) => ({ ...d, nameStyle: { ...d.nameStyle, italic: !d.nameStyle?.italic } }))}><i>I</i></button>
                </div>
                <p className="muted small">{t('fontExportHint')}</p>
              </div>
            )}
          </div>
        </details>

        {/* Mesures */}
        <details className="menu">
          <summary>⏲ {t('measure')} ▾</summary>
          <div className="menu-list" onClick={closeMenu}>
            <button onClick={() => addInstrument('voltmeter', 'needle')}>{t('mVoltNeedle')}</button>
            <button onClick={() => addInstrument('voltmeter', 'digital')}>{t('mVoltDigital')}</button>
            <button onClick={() => addInstrument('clamp', 'needle')}>{t('mClampNeedle')}</button>
            <button onClick={() => addInstrument('clamp', 'digital')}>{t('mClampDigital')}</button>
            <p className="muted small menu-note">{t('measureHelp')}</p>
          </div>
        </details>

        <button onClick={() => setShowGuided(true)} title={t('guidedTitle')}>🎓 {t('exercises')}</button>
        <button className="editonly" onClick={() => setShowCheck(true)} title={t('checkTitle')}>{t('check')}{issueCount.e > 0 && <span className="pill err"> ⛔{issueCount.e}</span>}{issueCount.w > 0 && <span className="pill warn"> ⚠{issueCount.w}</span>}</button>

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

        <span className="grow" />
        <span className="saved" aria-live="polite" title={t('saved')}>✓</span>
        <button className="icon feedback-btn" onClick={() => setShowFeedback(true)} title={`${t('feedback')} — ${t('feedbackHelp')}`} aria-label={t('feedback')}>💬</button>
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

      <main className="stage" data-plcdock={plcSym && !plcWin.max && !plcWin.min && plcWin.dock !== 'float' ? plcWin.dock : undefined} style={{ ['--plc-w' as string]: plcWin.w + 'px', ['--plc-h' as string]: plcWin.h + 'px' }}>
        <Canvas doc={doc} lang={lang} sel={sel} setSel={setSel} placing={placing} setPlacing={setPlacing} dark={darkSheet} tool={tool} measure={measure} toolStyle={toolStyle} onToolDone={() => setTool(null)}
          commit={commit} update={update} checkpoint={checkpoint} contentRef={contentRef} nextLabel={nextLabel} detectors={detectors}
          onPlaced={onPlaced} onContext={(x, y, target) => setMenu({ x, y, target })} onWiring={setWiringOn} highlight={hiPort} sim={sim} onSimPress={onSimPress} onSimToggle={onSimToggle} faults={simIn.cut} onSimFault={onSimFault} onEditTitle={() => setShowTitleBlock(true)} onEditSymbol={openProps} onEditText={(kind, id, x, y) => { textDone.current = false; setTextEdit({ kind, id, x, y }) }} extra={extraSyms} pageOf={pageOf} sheetLabel={pageCount(doc) > 1 ? `${(doc.page ?? 0) + 1}/${pageCount(doc)}` : undefined} labels={{ zoomIn: t('zoomIn'), zoomOut: t('zoomOut'), fit: t('fit'), grid: t('grid') }} />
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
        {plcSym && (
          <PlcEditor win={plcWin} setWin={setPlcWin} title={`${plcSym.label || 'A1'} — ${lang === 'fr' ? 'programme de l’automate' : 'controller program'}`} lang={lang} program={plcSym.plc} live={sim?.plc[plcSym.id]}
            onFocus={checkpoint} onClose={() => setPlcEdit(null)}
            onChange={(p, discrete) => { const fn = (d: Doc): Doc => ({ ...d, symbols: d.symbols.map((x) => (x.id === plcSym.id ? { ...x, plc: p } : x)) }); if (discrete) commit(fn); else update(fn) }} />
        )}
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
        {!doc.symbols.length && !placing && !emptyClosed && (
          <div className="empty">
            <button className="icon empty-x" onClick={() => setEmptyClosed(true)} aria-label={t('close')} title={t('close')}>✕</button>
            <h2>{t('emptyTitle')}</h2>
            <p>{t('emptyText')}</p>
            <div className="tpls">
              {remoteEx.items.map((ex) => (
                <button key={ex.id} onClick={() => openRemote(ex)}>{ex.title[lang] || ex.title.fr}</button>
              ))}
              {GALLERY.filter((g) => !remoteEx.hidden.includes(g.key)).map((g) => (
                <button key={g.key} onClick={() => startTemplate(g.fn)}>{t(g.key)}</button>
              ))}
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
        {guidedEx && <GuidedPanel ex={guidedEx} done={guidedEx.steps.map((_, i) => !!stepsDone[i])} missing={guidedEx.steps.map((_, i) => stepsMissing[i] ?? [])} lang={lang} onClose={() => chooseGuided(null)} onSolution={guidedSolution} onRestart={guidedRestart} onList={() => setShowGuided(true)} onLink={copyExerciseLink} />}
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
          symForm
        ) : selShape ? (
          <div className="form" onFocus={checkpoint}>
            <div className="kind">{t(selShape.kind === 'rect' ? 'shapeFrame' : selShape.kind === 'ellipse' ? 'shapeEllipse' : selShape.kind === 'line' ? 'shapeLine' : selShape.kind === 'poly' ? 'shapePoly' : selShape.kind === 'arc' ? 'shapeArc' : 'shapeImage')}</div>
            {selShape.kind !== 'image' && (
              <>
                <label data-tip={t('helpStroke')}>{t('strokeStyle')}{tip('helpStroke')}
                  <select value={selShape.stroke} onChange={(e) => patchShape({ stroke: e.target.value as StrokeStyle })}>
                    {STROKES.map((k) => <option key={k} value={k}>{t(k === 'solid' ? 'strokeSolid' : k === 'dashed' ? 'strokeDashed' : k === 'dotted' ? 'strokeDotted' : 'strokeDashDot')}</option>)}
                  </select>
                </label>
                <label data-tip={t('helpStrokeWidth')}>{t('strokeWidth')}{tip('helpStrokeWidth')}
                  <select value={selShape.width} onChange={(e) => patchShape({ width: Number(e.target.value) })}>
                    {[...new Set([...SHAPE_WIDTHS, selShape.width])].sort((x, y) => x - y).map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </label>
                <div className="colors" data-tip={t('helpShapeColor')}>
                  <span className="colors-title">{t('shapeColor')}</span>
                  {SHAPE_COLORS.map((c) => <button key={c} className={'swatch' + (selShape.color === c ? ' on' : '')} style={{ background: c }} aria-label={c} onClick={() => patchShape({ color: c })} />)}
                </div>
              </>
            )}
            {(selShape.kind === 'rect' || selShape.kind === 'ellipse' || (selShape.kind === 'poly' && selShape.closed)) && (
              <div className="colors" data-tip={t('helpShapeFill')}>
                <span className="colors-title">{t('shapeFill')}</span>
                <button className={'swatch' + (!selShape.fill ? ' on' : '')} style={{ background: 'repeating-linear-gradient(45deg,#fff 0 3px,#ccc 3px 6px)' }} aria-label={t('shapeFillNone')} title={t('shapeFillNone')} onClick={() => patchShape({ fill: undefined })} />
                {SHAPE_FILLS.map((c) => <button key={c} className={'swatch' + (selShape.fill === c ? ' on' : '')} style={{ background: c + '40' }} aria-label={c} onClick={() => patchShape({ fill: c })} />)}
              </div>
            )}
            {selShape.kind === 'rect' && (
              <label data-tip={t('helpShapeLabel')}>{t('shapeLabel')}{tip('helpShapeLabel')}<input value={selShape.label ?? ''} onChange={(e) => patchShape({ label: e.target.value || undefined })} /></label>
            )}
            {selShape.kind === 'rect' && (
              <label className="chk row-chk"><input type="checkbox" checked={!!selShape.rounded} onChange={(e) => patchShape({ rounded: e.target.checked || undefined })} /> {t('shapeRounded')}</label>
            )}
            {selShape.kind === 'rect' && (
              <label className="chk row-chk" data-tip={t('helpCarry')}><input type="checkbox" checked={!!selShape.carry} onChange={(e) => patchShape({ carry: e.target.checked || undefined })} /> {t('shapeCarry')}{tip('helpCarry')}</label>
            )}
            {selShape.kind === 'poly' && (
              <label className="chk row-chk"><input type="checkbox" checked={!!selShape.closed} onChange={(e) => patchShape({ closed: e.target.checked || undefined })} /> {t('shapeClosed')}</label>
            )}
            {selShape.kind === 'arc' && (
              <div className="row2">
                <label data-tip={t('helpArc')}>{t('arcStart')}<input type="number" step={15} value={selShape.a0 ?? 180} onChange={(e) => patchShape({ a0: Number(e.target.value) })} /></label>
                <label data-tip={t('helpArc')}>{t('arcEnd')}<input type="number" step={15} value={selShape.a1 ?? 360} onChange={(e) => patchShape({ a1: Number(e.target.value) })} /></label>
              </div>
            )}
            {selShape.kind === 'line' && (
              <label>{t('shapeArrowHead')}
                <select value={selShape.arrow ?? ''} onChange={(e) => patchShape({ arrow: (e.target.value || undefined) as Shape['arrow'] })}>
                  <option value="">{t('arrowNone')}</option>
                  <option value="end">{t('arrowEnd')}</option>
                  <option value="both">{t('arrowBoth')}</option>
                </select>
              </label>
            )}
            <label data-tip={t('helpRotation')}>{t('rotation')}{tip('helpRotation')}<input type="number" step={15} value={selShape.rot ?? 0} onChange={(e) => patchShape({ rot: ((Number(e.target.value) % 360) + 360) % 360 || undefined })} /></label>
            <p className="muted small">{t(selShape.kind === 'image' ? 'imageHelp' : 'shapeHelp')}</p>
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
            <label>{t('font')}
              <select value={selNote.font ?? 'arial'} onChange={(e) => patchNote({ font: e.target.value })}>
                {FONTS.map((f) => <option key={f.id} value={f.id} style={{ fontFamily: f.css }}>{f.label}</option>)}
              </select>
            </label>
            <div className="row">
              <button className={selNote.bold ? 'on' : ''} onClick={() => patchNote({ bold: !selNote.bold })}><b>B</b></button>
              <button className={selNote.italic ? 'on' : ''} onClick={() => patchNote({ italic: !selNote.italic })}><i>I</i></button>
            </div>
            <label data-tip={t('helpRotation')}>{t('rotation')}{tip('helpRotation')}<input type="number" step={15} value={selNote.rot ?? 0} onChange={(e) => patchNote({ rot: ((Number(e.target.value) % 360) + 360) % 360 || undefined })} /></label>
          </div>
        ) : selWire ? (
          <div className="form" onFocus={checkpoint}>
            <div className="kind">{t('wire')}</div>
            <label data-tip={t('helpWireLabel')}>{t('label')}{tip('helpWireLabel')}<input value={selWire.label} onChange={(e) => patchWire({ label: e.target.value })} /></label>
            <label data-tip={t('helpWireSection')}>{t('section')} (mm²){tip('helpWireSection')}<input value={selWire.section} onChange={(e) => patchWire({ section: e.target.value })} />
              {wireAdvice?.section && String(wireAdvice.section.value) !== selWire.section && (
                <span className="advice">💡 {wireAdvice.section.text}<button type="button" className="mini" onClick={(e) => { e.preventDefault(); patchWire({ section: String(wireAdvice.section!.value) }) }}>{t('applyAdvice')} {String(wireAdvice.section.value)}</button></span>
              )}
            </label>
            {selWire.via?.length ? (
              <button onClick={() => commit((d) => ({ ...d, wires: d.wires.map((w) => (w.id === selWire.id ? { ...w, via: undefined } : w)) }))}>{t('autoRoute')}</button>
            ) : (
              <p className="muted">{t('routeHelp')}</p>
            )}
            <div className="colors">
              {WIRE_COLORS.map((c) => (
                <button key={c} className={'swatch' + (selWire.color === c ? ' on' : '')} style={{ background: c === 'gnye' ? 'repeating-linear-gradient(45deg,#2e9b2e 0 4px,#f0d800 4px 8px)' : c }} title={c === 'gnye' ? t('colorGnye') : t('color')} aria-label={c}
                  onClick={() => commit((d) => ({ ...d, wires: d.wires.map((w) => (w.id === selWire.id ? { ...w, color: c } : w)) }))} />
              ))}
            </div>
            {wireAdvice?.color && selWire.color !== wireAdvice.color.value && (
              <span className="advice">💡 {wireAdvice.color.text}<button type="button" className="mini" onClick={() => patchWire({ color: wireAdvice.color!.value })}>{t('applyAdvice')} {wireAdvice.color.name}</button></span>
            )}
          </div>
        ) : (
          msyms.length > 1 ? multiForm : <p className="muted">{sel.length > 1 ? `${sel.length} ${t('sym')}` : t('nothingSelected')}</p>
        )}

        <h3>{t('sheet')}</h3>
        <div className="form" onFocus={checkpoint}>
          <label data-tip={t('helpPaper')}>{t('paper')}{tip('helpPaper')}
            <select value={doc.paper} onChange={(e) => commit((d) => ({ ...d, paper: e.target.value as Paper }))}>
              {['A4', 'A3', 'A2', 'A1'].map((p) => <option key={p}>{p}</option>)}
            </select>
          </label>
          {TB_FIELDS.map((k) => (
            <label key={k} data-tip={t(('tbH_' + k) as Key)}>{t(k === 'sheet' ? 'sheetNo' : k)}{tip(('tbH_' + k) as Key)}<input value={doc.title[k] ?? ''} onChange={(e) => patchTitle(k, e.target.value)} /></label>
          ))}
          <button onClick={() => setShowTitleBlock(true)}>{t('tbEdit')}</button>
        </div>
        </>)}
      </aside>

      {tooltip && tooltip.text && (
        <div className="tooltip" role="tooltip" style={{ left: tooltip.x, top: tooltip.y, transform: tooltip.above ? 'translateY(-100%)' : undefined }}>{tooltip.text}</div>
      )}

      {textEdit && (() => {
        const done = (value: string | null) => { if (textDone.current) return; textDone.current = true; if (value !== null) commitText(textEdit, value); setTextEdit(null) }
        const multi = textEdit.kind === 'note'
        const common = {
          className: 'inlineedit', autoFocus: true, defaultValue: textEditValue(textEdit), 'aria-label': t(multi ? 'editNote' : 'editText'), title: t(multi ? 'editNote' : 'editText'),
          style: { left: Math.max(4, Math.min(textEdit.x - 40, window.innerWidth - 260)), top: Math.max(4, Math.min(textEdit.y - 14, window.innerHeight - 90)) },
          onFocus: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => e.target.select(),
          onBlur: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => done(e.target.value),
          onKeyDown: (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(null) }
            else if (e.key === 'Enter' && (!multi || e.ctrlKey || e.metaKey)) { e.preventDefault(); done((e.target as HTMLInputElement).value) }
          },
        }
        return multi ? <textarea {...common} rows={3} /> : <input type="text" {...common} />
      })()}

      {propsId && selSym && selSym.id === propsId && (
        <div className="propspop" role="dialog" aria-label={t('propsTitle')} style={{ left: propsPos.x, top: propsPos.y }}>
          <div className="propspop-head" onMouseDown={dragProps}>
            <strong>{t('propsTitle')} · {selSym.label || SYMBOL_MAP[selSym.defId].name[lang]}</strong>
            <button className="icon" onClick={() => setPropsId(null)} aria-label={t('close')} title={t('close')}>✕</button>
          </div>
          <div className="propspop-body">{symForm}</div>
        </div>
      )}

      {menu && (
        <div className="ctx-back" onMouseDown={() => setMenu(null)} onContextMenu={(e) => e.preventDefault()}>
          <div className="ctx" style={{ left: Math.min(menu.x, window.innerWidth - 200), top: Math.max(8, Math.min(menu.y, window.innerHeight - (menu.target && ((doc.shapes ?? []).some((s) => s.id === menu.target) || doc.wires.some((w) => w.id === menu.target)) ? 420 : 220))) }} onMouseDown={(e) => e.stopPropagation()}>
            {menu.target ? (
              <>
                {(doc.shapes ?? []).some((s) => s.id === menu.target) && (() => {
                  const ids = sel.filter((id) => (doc.shapes ?? []).some((s) => s.id === id))
                  const first = (doc.shapes ?? []).find((s) => s.id === menu.target)!
                  const patchAll = (patch: Partial<Shape>) => commit((d) => ({ ...d, shapes: (d.shapes ?? []).map((s) => (ids.includes(s.id) ? { ...s, ...patch } : s)) }))
                  return (
                    <>
                      {first.kind !== 'image' && (
                        <>
                          <p className="ctx-title">{t('strokeWidth')}</p>
                          <div className="ctx-chips">
                            {SHAPE_WIDTHS.map((n) => <button key={n} className={'chip' + (first.width === n ? ' on' : '')} title={String(n)} onClick={() => patchAll({ width: n })}><svg width="26" height="14"><line x1="2" y1="7" x2="24" y2="7" stroke="currentColor" strokeWidth={n} /></svg></button>)}
                          </div>
                          <p className="ctx-title">{t('shapeColor')}</p>
                          <div className="colors ctx-colors">
                            {SHAPE_COLORS.map((c) => <button key={c} className={'swatch' + (first.color === c ? ' on' : '')} style={{ background: c }} aria-label={c} onClick={() => patchAll({ color: c })} />)}
                          </div>
                          <p className="ctx-title">{t('strokeStyle')}</p>
                          <div className="ctx-chips">
                            {STROKES.map((k) => <button key={k} className={'chip' + (first.stroke === k ? ' on' : '')} title={t(k === 'solid' ? 'strokeSolid' : k === 'dashed' ? 'strokeDashed' : k === 'dotted' ? 'strokeDotted' : 'strokeDashDot')} onClick={() => patchAll({ stroke: k })}><svg width="26" height="14"><line x1="2" y1="7" x2="24" y2="7" stroke="currentColor" strokeWidth={1.6} strokeDasharray={dashArray(k, 1.6)} strokeLinecap={k === 'dotted' ? 'round' : 'butt'} /></svg></button>)}
                          </div>
                        </>
                      )}
                      {(first.kind === 'rect' || first.kind === 'ellipse' || (first.kind === 'poly' && first.closed)) && (
                        <>
                          <p className="ctx-title">{t('shapeFill')}</p>
                          <div className="colors ctx-colors">
                            <button className={'swatch' + (!first.fill ? ' on' : '')} style={{ background: 'repeating-linear-gradient(45deg,#fff 0 3px,#ccc 3px 6px)' }} aria-label={t('shapeFillNone')} onClick={() => patchAll({ fill: undefined })} />
                            {SHAPE_FILLS.map((c) => <button key={c} className={'swatch' + (first.fill === c ? ' on' : '')} style={{ background: c + '40' }} aria-label={c} onClick={() => patchAll({ fill: c })} />)}
                          </div>
                        </>
                      )}
                      <hr />
                      <button onClick={() => { duplicate(); setMenu(null) }}><span>{t('duplicate')}</span><kbd>Ctrl+D</kbd></button>
                      <button onClick={() => { copySel(); setMenu(null) }}><span>{t('copy')}</span><kbd>Ctrl+C</kbd></button>
                      <hr />
                    </>
                  )
                })()}
                {doc.wires.some((w) => w.id === menu.target) && (
                  <>
                    <p className="ctx-title">{t('strokeWidth')}</p>
                    <div className="ctx-chips">
                      {[1, 1.6, 2.4, 3.5].map((n) => <button key={n} className={'chip' + ((doc.wires.find((w) => w.id === menu.target)?.width ?? 1.6) === n ? ' on' : '')} title={String(n)} onClick={() => commit((d) => ({ ...d, wires: d.wires.map((w) => (sel.includes(w.id) ? { ...w, width: n === 1.6 ? undefined : n } : w)) }))}><svg width="26" height="14"><line x1="2" y1="7" x2="24" y2="7" stroke="currentColor" strokeWidth={n} /></svg></button>)}
                    </div>
                    <p className="ctx-title">{t('strokeStyle')}</p>
                    <div className="ctx-chips">
                      {STROKES.map((k) => <button key={k} className={'chip' + ((doc.wires.find((w) => w.id === menu.target)?.dash ?? 'solid') === k ? ' on' : '')} title={t(k === 'solid' ? 'strokeSolid' : k === 'dashed' ? 'strokeDashed' : k === 'dotted' ? 'strokeDotted' : 'strokeDashDot')} onClick={() => commit((d) => ({ ...d, wires: d.wires.map((w) => (sel.includes(w.id) ? { ...w, dash: k === 'solid' ? undefined : k } : w)) }))}><svg width="26" height="14"><line x1="2" y1="7" x2="24" y2="7" stroke="currentColor" strokeWidth={1.6} strokeDasharray={dashArray(k, 1.6)} strokeLinecap={k === 'dotted' ? 'round' : 'butt'} /></svg></button>)}
                    </div>
                    <p className="ctx-title">{t('color')}</p>
                    <div className="colors ctx-colors">
                      {WIRE_COLORS.map((c) => <button key={c} className="swatch" style={{ background: c === 'gnye' ? 'repeating-linear-gradient(45deg,#2e9b2e 0 4px,#f0d800 4px 8px)' : c }} aria-label={c}
                        onClick={() => commit((d) => ({ ...d, wires: d.wires.map((w) => (sel.includes(w.id) ? { ...w, color: c } : w)) }))} />)}
                    </div>
                    <hr />
                  </>
                )}
                {doc.symbols.some((s) => s.id === menu.target) && (
                  <>
                    <button onClick={() => { openProps(menu.target!, menu.x, menu.y); setMenu(null) }}><span>⚙ {t('propsMenu')}</span><kbd>Entrée</kbd></button>
                    <hr />
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
              {remoteEx.items.map((ex) => (
                <div key={ex.id} className="card">
                  <strong>{ex.title[lang] || ex.title.fr}</strong>
                  <span className="lvl">{'★'.repeat(ex.level)}{'☆'.repeat(3 - ex.level)} {t(('level' + ex.level) as Key)}</span>
                  <p className="muted">{ex.about[lang] || ex.about.fr}</p>
                  <button onClick={() => openRemote(ex)}>{t('galleryLoad')}</button>
                </div>
              ))}
              {GALLERY.filter((g) => !remoteEx.hidden.includes(g.key)).map((g) => (
                <div key={g.key} className="card">
                  <strong>{t(g.key)}</strong>
                  <span className="lvl">{'★'.repeat(g.level)}{'☆'.repeat(3 - g.level)} {t(('level' + g.level) as Key)}</span>
                  <p className="muted">{g.about[lang]}</p>
                  <button onClick={() => { if (!doc.symbols.length || window.confirm(tr(lang, 'galleryReplace'))) { startTemplate(g.fn); setShowGallery(false) } }}>{t('galleryLoad')}</button>
                </div>
              ))}
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
            <div className="actions"><button onClick={() => { setShowKeys(false); setTourStep(0) }}>{t('tourReplay')}</button><button onClick={() => setShowKeys(false)}>{t('close')}</button></div>
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
                <label key={k} data-tip={t(('tbH_' + k) as Key)}>{t(k === 'sheet' ? 'sheetNo' : k)}{tip(('tbH_' + k) as Key)}<input autoFocus={k === 'title'} value={doc.title[k] ?? ''} onChange={(e) => patchTitle(k, e.target.value)} /></label>
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
                <p className="muted small">{t('checkDisclaimer')}</p>
                {issues.filter((i) => i.fix && !i.resolved && i.level !== 'info').length > 1 && (
                  <p><button onClick={() => applyAllFixes(issues)}>{t('applyAllFixes')} ({issues.filter((i) => i.fix && !i.resolved && i.level !== 'info').length})</button></p>
                )}
                <ul className="issues">
                  {issues.map((i, n) => (
                    <li key={n} className={i.level + (i.resolved ? ' resolved' : '')}>
                      <button className="link" disabled={!i.symId} onClick={() => { if (i.symId) { setSel([i.symId]); setShowCheck(false) } }}>
                        {i.resolved ? '✅' : i.level === 'error' ? '⛔' : i.level === 'warn' ? '⚠' : '💡'} {i.text}
                      </button>
                      {i.fix && !i.resolved && <button className="mini" onClick={() => applyFix(i.fix!)} title={i.fix.label}>{t('applyFix')} : {i.fix.label}</button>}
                      {i.why && <p className="why">{i.why}</p>}
                    </li>
                  ))}
                </ul>
              </>
            )}
            <div className="actions"><button onClick={() => setShowCheck(false)}>{t('close')}</button></div>
          </div>
        </div>
      )}

      {showGuided && <GuidedList list={allGuided} completed={guidedDone} lang={lang} onStart={startGuided} onClose={() => setShowGuided(false)} classCode={classInfo.code} pseudo={classInfo.pseudo} onClass={setClass} />}

      {tourStep !== null && (
        <div className="modal" onClick={endTour}>
          <div className="dialog tour" role="dialog" aria-label={t('tourTitle')} onClick={(e) => e.stopPropagation()}>
            <p className="muted small">{t('tourTitle')} — {tourStep + 1}/6</p>
            <h3>{t(('tour' + (tourStep + 1) + 't') as Key)}</h3>
            <p>{t(('tour' + (tourStep + 1)) as Key)}</p>
            <div className="actions">
              <button onClick={endTour}>{t('tourSkip')}</button>
              {tourStep > 0 && <button onClick={() => setTourStep(tourStep - 1)}>{t('tourPrev')}</button>}
              <button className="primary" onClick={() => (tourStep >= 5 ? endTour() : setTourStep(tourStep + 1))}>{tourStep >= 5 ? t('tourDone') : t('tourNext')}</button>
            </div>
          </div>
        </div>
      )}

      {showVersions && (
        <div className="modal" onClick={() => setShowVersions(false)}>
          <div className="dialog" role="dialog" aria-label={t('versions')} onClick={(e) => e.stopPropagation()}>
            <h3>{t('versions')}</h3>
            <p className="muted small">{t('versionsHelp')}</p>
            {versions.length === 0 ? <p>{t('versionsNone')}</p> : (
              <table>
                <thead><tr><th>{t('versionDate')}</th><th>{t('versionName')}</th><th>{t('versionSymbols')}</th><th /></tr></thead>
                <tbody>
                  {versions.map((v) => (
                    <tr key={v.id}>
                      <td>{new Date(v.at).toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-GB')}</td>
                      <td>{v.auto ? t('versionAuto') : v.name}</td>
                      <td>{v.symbols}</td>
                      <td>
                        <button className="mini" onClick={() => { if (window.confirm(tr(lang, 'versionRestoreConfirm'))) { commit(() => sanitize(v.doc)); setSel([]); setShowVersions(false) } }}>{t('versionRestore')}</button>{' '}
                        <button className="mini" onClick={() => setVersions(removeVersion(v.id))}>{t('delete')}</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="actions">
              <button onClick={saveVersion}>{t('versionSave')}</button>
              <button onClick={() => setShowVersions(false)}>{t('close')}</button>
            </div>
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
              <thead><tr><th>{t('label')}</th><th>{t('from')}</th><th>{t('to')}</th><th>{t('section')}</th><th>{lang === 'fr' ? 'Couleur' : 'Colour'}</th><th>mm</th></tr></thead>
              <tbody>{wireRows(all).map((r, i) => <tr key={i}><td>{r.label}</td><td>{r.from}</td><td>{r.to}</td><td>{r.section}</td><td>{r.color}</td><td>{r.mm}</td></tr>)}</tbody>
            </table>
            {(() => {
              const rows = terminalRows(all, lang)
              return rows.length ? (
                <>
                  <h3>{t('strips')}</h3>
                  <table>
                    <thead><tr><th>{t('strip')}</th><th>{t('terminal')}</th><th>{t('incoming')}</th><th>{t('outgoing')}</th></tr></thead>
                    <tbody>{rows.map((r, i) => <tr key={i}><td>{r.strip}</td><td>{r.terminal}</td><td>{r.inWires.join(' ; ')}</td><td>{r.outWires.join(' ; ')}</td></tr>)}</tbody>
                  </table>
                </>
              ) : null
            })()}
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
