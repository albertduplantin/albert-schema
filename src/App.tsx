import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Doc, Domain, Lang, Paper, PlacedSymbol, Wire } from './types'
import { SYMBOLS, SYMBOL_MAP } from './symbols'
import { tr, type Key } from './i18n'
import { uid } from './geometry'
import Canvas from './Canvas'
import { bomRows, exportCsv, exportPng, exportSvg, printSheet, saveJson, wireRows } from './exporters'
import { motorStarter, pneumaticCylinder } from './templates'

const STORE = 'albertschema.doc'
const emptyDoc = (): Doc => ({
  version: 1,
  paper: 'A3',
  title: { title: '', author: '', company: '', date: new Date().toISOString().slice(0, 10), revision: 'A', sheet: '1/1' },
  symbols: [],
  wires: [],
})

function loadDoc(): Doc {
  try {
    const raw = localStorage.getItem(STORE)
    if (raw) return JSON.parse(raw) as Doc
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
  const prefix = SYMBOL_MAP[defId].prefix
  const re = new RegExp('^' + prefix + '(\\d+)$')
  let max = 0
  for (const s of doc.symbols) {
    const m = re.exec(s.label)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return prefix + (max + 1)
}

const DOMAINS: Domain[] = ['electrical', 'pneumatic', 'hydraulic']
const WIRE_COLORS = ['#000000', '#0050c8', '#c80000', '#008000', '#8a5a00', '#7a7a7a', '#e08000', '#6a00a0']

const SHORTCUTS: Record<Lang, [string, string][]> = {
  fr: [
    ['Clic sur un symbole, puis clic', 'Poser un symbole (répétable)'],
    ['Glisser depuis la bibliothèque', 'Poser un symbole à l’endroit voulu'],
    ['Glisser depuis une borne', 'Tracer un conducteur'],
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
    ['Drag from a terminal', 'Draw a conductor'],
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

export default function App() {
  const [lang, setLang] = useState<Lang>(() => (localStorage.getItem('albertschema.lang') as Lang) || 'fr')
  const [h, setH] = useState(() => ({ doc: loadDoc(), past: [] as Doc[], future: [] as Doc[] }))
  const [sel, setSel] = useState<string[]>([])
  const [placing, setPlacing] = useState<string | null>(null)
  const [domain, setDomain] = useState<Domain>('electrical')
  const [query, setQuery] = useState('')
  const [recent, setRecent] = useState<string[]>(loadRecent)
  const [showBom, setShowBom] = useState(false)
  const [showKeys, setShowKeys] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; target: string | null } | null>(null)
  const contentRef = useRef<SVGGElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const exportRef = useRef<HTMLDetailsElement>(null)
  const clip = useRef<{ symbols: PlacedSymbol[]; wires: Wire[] } | null>(null)
  const toastTimer = useRef<number>()
  const doc = h.doc
  const t = (k: Key) => tr(lang, k)

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

  useEffect(() => {
    try { localStorage.setItem(STORE, JSON.stringify(doc)) } catch { /* quota ou mode privé */ }
  }, [doc])
  useEffect(() => {
    try { localStorage.setItem('albertschema.lang', lang) } catch { /* ignoré */ }
    document.documentElement.lang = lang
  }, [lang])

  const onPlaced = useCallback((defId: string) => {
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
    const map = new Map<string, string>()
    commit((d) => {
      const added: PlacedSymbol[] = []
      for (const s of c.symbols) {
        const id = uid()
        map.set(s.id, id)
        const ns = { ...s, id, x: s.x + 20, y: s.y + 20, label: '' }
        ns.label = nextLabel({ ...d, symbols: [...d.symbols, ...added] }, s.defId)
        added.push(ns)
      }
      const wires = c.wires.map((w) => ({
        ...w, id: uid(),
        from: { ...w.from, symId: map.get(w.from.symId)! },
        to: { ...w.to, symId: map.get(w.to.symId)! },
      }))
      return { ...d, symbols: [...d.symbols, ...added], wires: [...d.wires, ...wires] }
    })
    setSel(Array.from(map.values()))
  }, [commit])

  const duplicate = useCallback(() => { copySel(); paste() }, [copySel, paste])

  const nudge = useCallback((dx: number, dy: number) => {
    if (!sel.length) return
    commit((d) => ({ ...d, symbols: d.symbols.map((s) => (sel.includes(s.id) ? { ...s, x: s.x + dx, y: s.y + dy } : s)) }))
  }, [sel, commit])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      const ctrl = e.ctrlKey || e.metaKey
      const k = e.key.toLowerCase()
      const step = e.shiftKey ? 50 : 10
      if (e.key === 'Escape') { setMenu(null); setPlacing(null); setSel([]); setShowKeys(false); setShowBom(false) }
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
  }, [deleteSel, rotateSel, undo, redo, copySel, paste, duplicate, nudge, doc, placing, say, lang])

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
    commit((d) => ({ ...d, wires: d.wires.map((w, i) => ({ ...w, label: String(i + 1) })) }))
    say(t('toastWires'))
  }

  const openFile = (f: File) => {
    f.text().then((txt) => {
      try {
        const d = JSON.parse(txt) as Doc
        if (d.version !== 1 || !Array.isArray(d.symbols)) throw new Error('format')
        commit(() => d)
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

  const list = useMemo(() => {
    const q = query.trim().toLowerCase()
    return SYMBOLS.filter((s) => s.domain === domain && (!q || s.name[lang].toLowerCase().includes(q) || s.prefix.toLowerCase() === q))
  }, [domain, query, lang])
  const recents = useMemo(() => recent.map((id) => SYMBOL_MAP[id]).filter((s) => s.domain === domain), [recent, domain])

  const selSym = sel.length === 1 ? doc.symbols.find((s) => s.id === sel[0]) : undefined
  const selWire = sel.length === 1 ? doc.wires.find((w) => w.id === sel[0]) : undefined
  const patchSym = (patch: Partial<PlacedSymbol>) =>
    update((d) => ({ ...d, symbols: d.symbols.map((s) => (s.id === sel[0] ? { ...s, ...patch } : s)) }))
  const patchWire = (patch: Partial<Wire>) =>
    update((d) => ({ ...d, wires: d.wires.map((w) => (w.id === sel[0] ? { ...w, ...patch } : w)) }))
  const patchTitle = (k: keyof Doc['title'], v: string) => update((d) => ({ ...d, title: { ...d.title, [k]: v } }))

  const withContent = (fn: (c: SVGGElement) => void) => () => {
    if (exportRef.current) exportRef.current.open = false
    if (contentRef.current) fn(contentRef.current)
  }

  const hint = placing ? t('hintPlace') : sel.length ? t('hintSel') : t('hintIdle')

  const symButton = (s: (typeof SYMBOLS)[number]) => (
    <button key={s.id} className={'symbtn' + (placing === s.id ? ' on' : '')} title={`${s.name[lang]} — ${s.std}`}
      draggable
      onDragStart={(e) => { e.dataTransfer.setData('text/x-albert-symbol', s.id); e.dataTransfer.effectAllowed = 'copy'; setPlacing(null) }}
      onClick={() => { setPlacing(placing === s.id ? null : s.id); setSel([]) }}>
      <svg viewBox={`-6 -6 ${s.w + 12} ${s.h + 12}`} stroke="currentColor" fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
        dangerouslySetInnerHTML={{ __html: s.svg.replace(/var\(--bg\)/g, 'transparent') }} />
      <span>{s.name[lang]}</span>
    </button>
  )

  return (
    <div className="app">
      <header className="toolbar" role="toolbar">
        <strong className="brand">AlbertSchema</strong>
        <div className="group">
          <button onClick={() => { if (!doc.symbols.length || confirm(t('newConfirm'))) { commit(() => emptyDoc()); setSel([]) } }}>{t('new')}</button>
          <button onClick={() => fileRef.current?.click()}>{t('open')}</button>
          <button onClick={() => { saveJson(doc); say(t('toastSaved')) }} title="Ctrl+S">{t('save')}</button>
        </div>
        <input ref={fileRef} type="file" accept=".json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) openFile(f); e.target.value = '' }} />
        <div className="group">
          <button className="icon" onClick={undo} disabled={!h.past.length} title={`${t('undo')} (Ctrl+Z)`} aria-label={t('undo')}>↶</button>
          <button className="icon" onClick={redo} disabled={!h.future.length} title={`${t('redo')} (Ctrl+Y)`} aria-label={t('redo')}>↷</button>
        </div>
        <div className="group">
          <button className="icon" onClick={rotateSel} disabled={!sel.length} title={`${t('rotate')} (R)`} aria-label={t('rotate')}>⟳</button>
          <button className="icon" onClick={duplicate} disabled={!sel.length} title={`${t('duplicate')} (Ctrl+D)`} aria-label={t('duplicate')}>⧉</button>
          <button className="icon danger" onClick={deleteSel} disabled={!sel.length} title={`${t('delete')} (Suppr)`} aria-label={t('delete')}>🗑</button>
        </div>
        <div className="group">
          <button onClick={autoLabel}>{t('autoLabel')}</button>
          <button onClick={autoWire}>{t('autoWire')}</button>
          <button onClick={() => setShowBom(true)}>{t('bom')}</button>
        </div>
        <details className="menu" ref={exportRef}>
          <summary>{t('export')} ▾</summary>
          <div className="menu-list">
            <button onClick={withContent((c) => exportSvg(doc, c))}>{t('exportSvg')}</button>
            <button onClick={withContent((c) => exportPng(doc, c))}>{t('exportPng')}</button>
            <button onClick={withContent((c) => printSheet(doc, c))}>{t('print')}</button>
            <button onClick={() => { if (exportRef.current) exportRef.current.open = false; exportCsv(doc, lang) }}>{t('exportCsv')}</button>
          </div>
        </details>
        <span className="grow" />
        <span className="saved" aria-live="polite">✓ {t('saved')}</span>
        <button className="icon" onClick={() => setShowKeys(true)} title={`${t('shortcuts')} (?)`} aria-label={t('shortcuts')}>?</button>
        <div className="group">
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
        <div className="symscroll">
          {!query && recents.length > 0 && (
            <>
              <div className="section">{t('recent')}</div>
              <div className="symlist">{recents.map(symButton)}</div>
              <div className="section">{t(domain)}</div>
            </>
          )}
          <div className="symlist">{list.map(symButton)}</div>
        </div>
        <p className="note">{t('warn')}</p>
      </aside>

      <main className="stage">
        <Canvas doc={doc} lang={lang} sel={sel} setSel={setSel} placing={placing} setPlacing={setPlacing}
          commit={commit} update={update} checkpoint={checkpoint} contentRef={contentRef} nextLabel={nextLabel}
          onPlaced={onPlaced} onContext={(x, y, target) => setMenu({ x, y, target })} labels={{ zoomIn: t('zoomIn'), zoomOut: t('zoomOut'), fit: t('fit') }} />
        {!doc.symbols.length && !placing && (
          <div className="empty">
            <h2>{t('emptyTitle')}</h2>
            <p>{t('emptyText')}</p>
            <div className="tpls">
              <button onClick={() => startTemplate(motorStarter)}>{t('tplMotor')}</button>
              <button onClick={() => startTemplate(pneumaticCylinder)}>{t('tplPneu')}</button>
            </div>
          </div>
        )}
        <div className="status">{hint}</div>
        {toast && <div className="toast" role="status">{toast}</div>}
      </main>

      <aside className="props">
        <h3>{t('properties')}</h3>
        {selSym ? (
          <div className="form" onFocus={checkpoint}>
            <div className="kind">{SYMBOL_MAP[selSym.defId].name[lang]} <small>({SYMBOL_MAP[selSym.defId].std})</small></div>
            <label>{t('label')}<input value={selSym.label} onChange={(e) => patchSym({ label: e.target.value })} /></label>
            <label>{t('description')}<input value={selSym.desc} onChange={(e) => patchSym({ desc: e.target.value })} /></label>
          </div>
        ) : selWire ? (
          <div className="form" onFocus={checkpoint}>
            <div className="kind">{t('wire')}</div>
            <label>{t('label')}<input value={selWire.label} onChange={(e) => patchWire({ label: e.target.value })} /></label>
            <label>{t('section')}<input value={selWire.section} onChange={(e) => patchWire({ section: e.target.value })} /></label>
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
          {(['title', 'company', 'author', 'date', 'revision', 'sheet'] as const).map((k) => (
            <label key={k}>{t(k === 'sheet' ? 'sheetNo' : k)}<input value={doc.title[k]} onChange={(e) => patchTitle(k, e.target.value)} /></label>
          ))}
        </div>
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

      {showKeys && (
        <div className="modal" onClick={() => setShowKeys(false)}>
          <div className="dialog" role="dialog" aria-label={t('shortcutsTitle')} onClick={(e) => e.stopPropagation()}>
            <h3>{t('shortcutsTitle')}</h3>
            <table><tbody>{SHORTCUTS[lang].map(([k, d]) => <tr key={k}><td><kbd>{k}</kbd></td><td>{d}</td></tr>)}</tbody></table>
            <div className="actions"><button onClick={() => setShowKeys(false)}>{t('close')}</button></div>
          </div>
        </div>
      )}

      {showBom && (
        <div className="modal" onClick={() => setShowBom(false)}>
          <div className="dialog" role="dialog" aria-label={t('bom')} onClick={(e) => e.stopPropagation()}>
            <h3>{t('bom')}</h3>
            <table>
              <thead><tr><th>{t('label')}</th><th>{t('component')}</th><th>{t('description')}</th><th>{t('standard')}</th></tr></thead>
              <tbody>{bomRows(doc, lang).map((r, i) => <tr key={i}><td>{r.label}</td><td>{r.name}</td><td>{r.desc}</td><td>{r.std}</td></tr>)}</tbody>
            </table>
            <h3>{t('wires')}</h3>
            <table>
              <thead><tr><th>{t('label')}</th><th>{t('from')}</th><th>{t('to')}</th><th>{t('section')}</th></tr></thead>
              <tbody>{wireRows(doc).map((r, i) => <tr key={i}><td>{r.label}</td><td>{r.from}</td><td>{r.to}</td><td>{r.section}</td></tr>)}</tbody>
            </table>
            <div className="actions">
              <button onClick={() => exportCsv(doc, lang)}>{t('csv')}</button>
              <button onClick={() => setShowBom(false)}>{t('close')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
