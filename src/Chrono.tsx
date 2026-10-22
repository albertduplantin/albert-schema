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
  const t1 = Math.max(now, WINDOW_MS)
  const t0 = t1 - WINDOW_MS
  const x = (t: number) => LEFT + ((Math.min(Math.max(t, t0), t1) - t0) / WINDOW_MS) * (W - LEFT - 8)
  const H = names.length * ROW_H + 22
  const ticks: number[] = []
  for (let s = Math.ceil(t0 / 5000) * 5; s * 1000 <= t1; s += 5) ticks.push(s)
  return (
    <div className="chrono" role="region" aria-label={tr(lang, 'chrono')}>
      <div className="chrono-head"><strong>{tr(lang, 'chrono')}</strong><button onClick={onClear}>{tr(lang, 'chronoClear')}</button></div>
      <div className="chrono-body">
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={Math.min(H, 220)} preserveAspectRatio="xMinYMin meet">
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
      </div>
    </div>
  )
}
