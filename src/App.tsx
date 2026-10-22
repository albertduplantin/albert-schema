import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Doc, Domain, Lang, Paper, PlacedSymbol, Wire } from './types'
import { SYMBOLS, SYMBOL_MAP } from './symbols'
import { tr, type Key } from './i18n'
import { uid } from './geometry'
import Canvas from './Canvas'
import { bomRows, exportCsv, exportPng, exportSvg, printSheet, saveJson, wireRows } from './exporters'

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

export default function App() {
  const [lang, setLang] = useState<Lang>(() => (localStorage.getItem('albertschema.lang') as Lang) || 'fr')
  const [h, setH] = useState(() => ({ doc: loadDoc(), past: [] as Doc[], future: [] as Doc[] }))
  const [sel, setSel] = useState<string[]>([])
  const [placing, setPlacing] = useState<string | null>(null)
  const [domain, setDomain] = useState<Domain>('electrical')
  const [query, setQuery] = useState('')
  const [showBom, setShowBom] = useState(false)
  const contentRef = useRef<SVGGElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const clip = useRef<{ symbols: PlacedSymbol[]; wires: Wire[] } | null>(null)
  const doc = h.doc
  const t = (k: Key) => tr(lang, k)

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
  }, [doc, sel])

  const paste = useCallback(() => {
    const c = clip.current
    if (!c || !c.symbols.length) return
    const map = new Map<string, string>()
    commit((d) => {
      let acc = d
      const added: PlacedSymbol[] = []
      for (const s of c.symbols) {
        const id = uid()
        map.set(s.id, id)
        const ns = { ...s, id, x: s.x + 20, y: s.y + 20, label: '' }
        ns.label = nextLabel({ ...acc, symbols: [...acc.symbols, ...added] }, s.defId)
        added.push(ns)
      }
      const wires = c.wires.map((w) => ({
        ...w, id: uid(),
        from: { ...w.from, symId: map.get(w.from.symId)! },
        to: { ...w.to, symId: map.get(w.to.symId)! },
      }))
      acc = { ...acc, symbols: [...acc.symbols, ...added], wires: [...acc.wires, ...wires] }
      return acc
    })
    setSel(Array.from(map.values()))
  }, [commit])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      const ctrl = e.ctrlKey || e.metaKey
      if (e.key === 'Escape') { setPlacing(null); setSel([]) }
      else if (e.key === 'Delete' || e.key === 'Backspace') deleteSel()
      else if (e.key.toLowerCase() === 'r' && !ctrl) rotateSel()
      else if (ctrl && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo() }
      else if (ctrl && e.key.toLowerCase() === 'y') { e.preventDefault(); redo() }
      else if (ctrl && e.key.toLowerCase() === 'c') copySel()
      else if (ctrl && e.key.toLowerCase() === 'v') paste()
      else if (ctrl && e.key.toLowerCase() === 's') { e.preventDefault(); saveJson(doc) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [deleteSel, rotateSel, undo, redo, copySel, paste, doc])

  const autoLabel = () =>
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

  const autoWire = () => commit((d) => ({ ...d, wires: d.wires.map((w, i) => ({ ...w, label: String(i + 1) })) }))

  const openFile = (f: File) => {
    f.text().then((txt) => {
      try {
        const d = JSON.parse(txt) as Doc
        if (d.version !== 1 || !Array.isArray(d.symbols)) throw new Error('format')
        commit(() => d)
        setSel([])
      } catch {
        alert('Fichier invalide / invalid file')
      }
    })
  }

  const list = useMemo(() => {
    const q = query.trim().toLowerCase()
    return SYMBOLS.filter((s) => s.domain === domain && (!q || s.name[lang].toLowerCase().includes(q) || s.prefix.toLowerCase() === q))
  }, [domain, query, lang])

  const selSym = sel.length === 1 ? doc.symbols.find((s) => s.id === sel[0]) : undefined
  const selWire = sel.length === 1 ? doc.wires.find((w) => w.id === sel[0]) : undefined
  const patchSym = (patch: Partial<PlacedSymbol>) =>
    update((d) => ({ ...d, symbols: d.symbols.map((s) => (s.id === sel[0] ? { ...s, ...patch } : s)) }))
  const patchWire = (patch: Partial<Wire>) =>
    update((d) => ({ ...d, wires: d.wires.map((w) => (w.id === sel[0] ? { ...w, ...patch } : w)) }))
  const patchTitle = (k: keyof Doc['title'], v: string) => update((d) => ({ ...d, title: { ...d.title, [k]: v } }))

  const withContent = (fn: (c: SVGGElement) => void) => () => contentRef.current && fn(contentRef.current)

  return (
    <div className="app">
      <header className="toolbar">
        <strong className="brand">AlbertSchema</strong>
        <button onClick={() => { if (!doc.symbols.length || confirm(t('newConfirm'))) { commit(() => emptyDoc()); setSel([]) } }}>{t('new')}</button>
        <button onClick={() => fileRef.current?.click()}>{t('open')}</button>
        <button onClick={() => saveJson(doc)}>{t('save')}</button>
        <input ref={fileRef} type="file" accept=".json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) openFile(f); e.target.value = '' }} />
        <span className="sep" />
        <button onClick={undo} disabled={!h.past.length}>↶ {t('undo')}</button>
        <button onClick={redo} disabled={!h.future.length}>↷ {t('redo')}</button>
        <span className="sep" />
        <button onClick={rotateSel} disabled={!sel.length}>⟳ {t('rotate')}</button>
        <button onClick={copySel} disabled={!sel.length}>{t('copy')}</button>
        <button onClick={paste}>{t('paste')}</button>
        <button onClick={deleteSel} disabled={!sel.length}>{t('delete')}</button>
        <span className="sep" />
        <button onClick={autoLabel}>{t('autoLabel')}</button>
        <button onClick={autoWire}>{t('autoWire')}</button>
        <button onClick={() => setShowBom(true)}>{t('bom')}</button>
        <span className="sep" />
        <button onClick={withContent((c) => exportSvg(doc, c))}>{t('exportSvg')}</button>
        <button onClick={withContent((c) => exportPng(doc, c))}>{t('exportPng')}</button>
        <button onClick={withContent((c) => printSheet(doc, c))}>{t('print')}</button>
        <span className="grow" />
        <button className={lang === 'fr' ? 'on' : ''} onClick={() => setLang('fr')}>FR</button>
        <button className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')}>EN</button>
      </header>

      <aside className="palette">
        <div className="tabs">
          {DOMAINS.map((d) => (
            <button key={d} className={d === domain ? 'on' : ''} onClick={() => setDomain(d)}>{t(d)}</button>
          ))}
        </div>
        <input className="search" placeholder={t('search')} value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="symlist">
          {list.map((s) => (
            <button key={s.id} className={'symbtn' + (placing === s.id ? ' on' : '')} title={`${s.name[lang]} — ${s.std}`}
              onClick={() => { setPlacing(placing === s.id ? null : s.id); setSel([]) }}>
              <svg viewBox={`-6 -6 ${s.w + 12} ${s.h + 12}`} stroke="currentColor" fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
                dangerouslySetInnerHTML={{ __html: s.svg.replace(/var\(--bg\)/g, 'transparent') }} />
              <span>{s.name[lang]}</span>
            </button>
          ))}
        </div>
        <p className="note">{t('warn')}</p>
      </aside>

      <main className="stage">
        <Canvas doc={doc} lang={lang} sel={sel} setSel={setSel} placing={placing} setPlacing={setPlacing}
          commit={commit} update={update} checkpoint={checkpoint} contentRef={contentRef} nextLabel={nextLabel} />
        <div className="status">{placing ? t('placing') : t('hint')}</div>
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
                <button key={c} className={'swatch' + (selWire.color === c ? ' on' : '')} style={{ background: c }} title={t('color')}
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

      {showBom && (
        <div className="modal" onClick={() => setShowBom(false)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
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
