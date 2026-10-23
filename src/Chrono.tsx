import { useRef, useState } from 'react'
import type { Lang } from './types'
import { tr } from './i18n'

export interface TraceRow { t: number; v: Record<string, boolean> }

interface Props {
  rows: TraceRow[]
  names: string[]
  /** temps simulé écoulé (ms) */
  now: number
  lang: Lang
  onClear: () => void
}

const WINDOW_MS = 30000
const ROW_H = 20
const LEFT = 56
const W = 640

/** Chronogramme : état de chaque bobine, récepteur et organe de commande au fil du temps simulé (30 dernières secondes). */
export default function Chrono({ rows, names, now, lang, onClear }: Props) {
  const [min, setMin] = useState(() => { try { return localStorage.getItem('albertschema.chronoMin') === '1' } catch { return false } })
  const toggle = () => { setMin(!min); try { localStorage.setItem('albertschema.chronoMin', min ? '0' : '1') } catch { /* ignoré */ } }
  const svgRef = useRef<SVGSVGElement>(null)
  const save = (name: string, blob: Blob) => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = name
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }
  /** enregistre le chronogramme en image (fond blanc, texte noir) */
  const exportPng = () => {
    const el = svgRef.current
    if (!el) return
    const src = new XMLSerializer().serializeToString(el).replace(/currentColor/g, '#000')
    const svg = src.replace('<svg', `<svg xmlns="http://www.w3.org/2000/svg"`).replace(/ width="[^"]*" height="[^"]*"/, ` width="${W * 2}" height="${H * 2}"`).replace(/>/, `><rect width="100%" height="100%" fill="#fff"/>`)
    const img = new Image()
    img.onload = () => {
      const c = document.createElement('canvas')
      c.width = W * 2; c.height = H * 2
      c.getContext('2d')!.drawImage(img, 0, 0)
      c.toBlob((b) => b && save('chronogramme.png', b))
    }
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
  }
  const exportCsv = () => {
    const lines = [['t (s)', ...names].join(';')]
    for (const r of rows) lines.push([(r.t / 1000).toFixed(2), ...names.map((n) => (r.v[n] ? 1 : 0))].join(';'))
    save('chronogramme.csv', new Blob([String.fromCharCode(0xfeff) + lines.join(String.fromCharCode(13, 10))], { type: 'text/csv;charset=utf-8' }))
  }
  const t1 = Math.max(now, WINDOW_MS)
  const t0 = t1 - WINDOW_MS
  const x = (t: number) => LEFT + ((Math.min(Math.max(t, t0), t1) - t0) / WINDOW_MS) * (W - LEFT - 8)
  const H = names.length * ROW_H + 22
  const ticks: number[] = []
  for (let s = Math.ceil(t0 / 5000) * 5; s * 1000 <= t1; s += 5) ticks.push(s)
  return (
    <div className={'chrono' + (min ? ' min' : '')} role="region" aria-label={tr(lang, 'chrono')}>
      <div className="chrono-head">
        <strong>{tr(lang, 'chrono')}</strong>
        <span className="grow" />
        {!min && <button onClick={exportPng}>PNG</button>}
        {!min && <button onClick={exportCsv}>CSV</button>}
        {!min && <button onClick={onClear}>{tr(lang, 'chronoClear')}</button>}
        <button className="icon" onClick={toggle} aria-expanded={!min} title={tr(lang, min ? 'chronoShow' : 'chronoHide')} aria-label={tr(lang, min ? 'chronoShow' : 'chronoHide')}>{min ? '▲' : '▼'}</button>
      </div>
      {!min && <div className="chrono-body">
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width="100%" height={Math.min(H, 220)} preserveAspectRatio="xMinYMin meet">
          {ticks.map((s) => (
            <g key={s}>
              <line x1={x(s * 1000)} x2={x(s * 1000)} y1={0} y2={H - 14} stroke="#8884" strokeDasharray="2 3" />
              <text x={x(s * 1000)} y={H - 3} fontSize={8} textAnchor="middle" fill="currentColor">{s} s</text>
            </g>
          ))}
          {names.map((n, i) => {
            const base = i * ROW_H + ROW_H - 4
            const hi = base - 12
            let d = ''
            let last = false
            let started = false
            const push = (t: number, on: boolean) => {
              const xx = x(t)
              const y = on ? hi : base
              if (!started) { d += `M${xx} ${y}`; started = true } else if (on !== last) d += `L${xx} ${last ? hi : base}L${xx} ${y}`
              last = on
            }
            let prev = false
            for (const r of rows) {
              const on = !!r.v[n]
              if (r.t < t0) { prev = on; continue }
              if (!started) push(t0, prev)
              push(r.t, on)
            }
            if (!started) push(t0, prev)
            d += `L${x(now)} ${last ? hi : base}`
            return (
              <g key={n}>
                <text x={4} y={base - 2} fontSize={9} fontWeight={700} fill="currentColor">{n}</text>
                <path d={d} fill="none" stroke="#2f9e44" strokeWidth={1.6} />
              </g>
            )
          })}
          <line x1={x(now)} x2={x(now)} y1={0} y2={H - 14} stroke="#e53935" strokeWidth={0.8} />
        </svg>
      </div>}
    </div>
  )
}
