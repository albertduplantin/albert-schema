import { useCallback, useEffect, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from 'react'
import type { Lang } from './types'

/** Fenêtre de programmation : ancrée en bas, à gauche ou à droite de la feuille (qui se réduit pour lui laisser la place), flottante, agrandie ou réduite. */
export interface WinState {
  dock: 'bottom' | 'left' | 'right' | 'float'
  max: boolean
  min: boolean
  /** épaisseur ancrée : largeur (gauche, droite) ou hauteur (bas) */
  w: number
  h: number
  fx: number
  fy: number
  fw: number
  fh: number
}

const KEY = 'albertschema.plcwin'
const DEFAULT: WinState = { dock: 'bottom', max: false, min: false, w: 480, h: 360, fx: 90, fy: 70, fw: 820, fh: 480 }

export function usePlcWin(): [WinState, (p: Partial<WinState>) => void] {
  const [win, setWin] = useState<WinState>(() => {
    try { return { ...DEFAULT, ...(JSON.parse(localStorage.getItem(KEY) || '{}') as Partial<WinState>), min: false } } catch { return DEFAULT }
  })
  const set = useCallback((p: Partial<WinState>) => {
    setWin((w) => {
      const next = { ...w, ...p }
      try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* ignoré */ }
      return next
    })
  }, [])
  return [win, set]
}

const T = (lang: Lang, fr: string, en: string) => (lang === 'fr' ? fr : en)
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))

interface Props {
  win: WinState
  set: (p: Partial<WinState>) => void
  lang: Lang
  title: string
  header?: ReactNode
  onClose: () => void
  children: ReactNode
}

export default function PlcWindow({ win, set, lang, title, header, onClose, children }: Props) {
  const ref = useRef<HTMLElement>(null)
  const drag = useRef<{ kind: 'size' | 'move' | 'corner'; dx: number; dy: number } | null>(null)
  const [, force] = useState(0)
  useEffect(() => { const f = () => force((n) => n + 1); window.addEventListener('resize', f); return () => window.removeEventListener('resize', f) }, [])

  const stage = () => ref.current?.parentElement?.getBoundingClientRect()

  const start = (kind: 'size' | 'move' | 'corner') => (e: RPointerEvent) => {
    if (win.max) return
    const st = stage(); if (!st) return
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    drag.current = { kind, dx: e.clientX - st.left - win.fx, dy: e.clientY - st.top - win.fy }
    e.preventDefault()
  }
  const move = (e: RPointerEvent) => {
    const d = drag.current, st = stage()
    if (!d || !st) return
    if (d.kind === 'move') set({ fx: clamp(e.clientX - st.left - d.dx, 0, st.width - 120), fy: clamp(e.clientY - st.top - d.dy, 0, st.height - 40) })
    else if (d.kind === 'corner') set({ fw: clamp(e.clientX - st.left - win.fx, 360, st.width - win.fx), fh: clamp(e.clientY - st.top - win.fy, 220, st.height - win.fy) })
    else if (win.dock === 'bottom') set({ h: clamp(st.bottom - e.clientY, 140, st.height - 70) })
    else if (win.dock === 'left') set({ w: clamp(e.clientX - st.left, 280, st.width - 120) })
    else if (win.dock === 'right') set({ w: clamp(st.right - e.clientX, 280, st.width - 120) })
  }
  const end = () => { drag.current = null }

  const cls = `plcwin dock-${win.dock}${win.max ? ' max' : ''}${win.min ? ' min' : ''}`
  const style: Record<string, string | number> = {}
  if (!win.max && !win.min) {
    if (win.dock === 'bottom') style.height = win.h
    else if (win.dock === 'left' || win.dock === 'right') style.width = win.w
    else { style.left = win.fx; style.top = win.fy; style.width = win.fw; style.height = win.fh }
  }

  const dockBtn = (d: WinState['dock'], icon: string, fr: string, en: string) => (
    <button key={d} className={win.dock === d && !win.max ? 'on' : ''} onClick={() => set({ dock: d, max: false, min: false })} data-tip={T(lang, fr, en)} aria-label={T(lang, fr, en)}>{icon}</button>
  )

  return (
    <section ref={ref} className={cls} style={style} aria-label={title}>
      {!win.max && !win.min && win.dock !== 'float' && (
        <div className={`plcwin-grip grip-${win.dock}`} onPointerDown={start('size')} onPointerMove={move} onPointerUp={end} role="separator" aria-label={T(lang, 'Redimensionner', 'Resize')} />
      )}
      <header onDoubleClick={() => set({ max: !win.max, min: false })} onPointerDown={win.dock === 'float' && !win.max ? start('move') : undefined} onPointerMove={move} onPointerUp={end}>
        <strong className="plcwin-title">{title}</strong>
        <div className="plcwin-extra" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>{header}</div>
        <span className="grow" />
        <div className="plcwin-btns" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
          {dockBtn('left', '◧', 'Ancrer à gauche', 'Dock left')}
          {dockBtn('bottom', '⬓', 'Ancrer en bas', 'Dock bottom')}
          {dockBtn('right', '◨', 'Ancrer à droite', 'Dock right')}
          {dockBtn('float', '❐', 'Fenêtre flottante', 'Floating window')}
          <button onClick={() => set({ min: !win.min, max: false })} data-tip={T(lang, win.min ? 'Restaurer' : 'Réduire', win.min ? 'Restore' : 'Minimise')} aria-label={T(lang, 'Réduire', 'Minimise')}>{win.min ? '▢' : '—'}</button>
          <button className={win.max ? 'on' : ''} onClick={() => set({ max: !win.max, min: false })} data-tip={T(lang, win.max ? 'Restaurer la taille' : 'Agrandir (plein écran)', win.max ? 'Restore size' : 'Maximise')} aria-label={T(lang, 'Agrandir', 'Maximise')}>{win.max ? '🗗' : '🗖'}</button>
          <button onClick={onClose} data-tip={T(lang, 'Fermer', 'Close')} aria-label={T(lang, 'Fermer', 'Close')}>✕</button>
        </div>
      </header>
      {!win.min && <div className="plcwin-body">{children}</div>}
      {!win.min && !win.max && win.dock === 'float' && <div className="plcwin-grip grip-corner" onPointerDown={start('corner')} onPointerMove={move} onPointerUp={end} aria-hidden="true" />}
    </section>
  )
}
