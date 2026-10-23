import { useEffect, useRef, useState } from 'react'
import type { Instrument, Lang } from './types'
import { BODY, JAW, RANGES, SOCKETS, formatReading, probesOf } from './instruments'

interface Props {
  instr: Instrument
  /** valeur lue (V ou A) ; null : non évaluable ; undefined : simulation arrêtée */
  value: number | null | undefined
  /** voltmètre : la pointe touche-t-elle une borne ou un conducteur ? / pince : serre-t-elle un conducteur ? */
  touching: boolean[]
  lang: Lang
}

/** Valeur qui rejoint progressivement sa cible : l'aiguille s'amortit comme sur un vrai appareil. */
function useSmooth(target: number): number {
  const [v, setV] = useState(target)
  const cur = useRef(target)
  useEffect(() => {
    let raf = 0
    const tick = () => {
      const d = target - cur.current
      if (Math.abs(d) < 0.001) { cur.current = target; setV(target); return }
      cur.current += d * 0.18
      setV(cur.current)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target])
  return v
}

const compact = (n: number) => (n >= 1000 ? n / 1000 + 'k' : String(n))

/** Voltmètre ou pince ampèremétrique, à aiguille ou numérique, avec ses pointes de touche (voltmètre) et son calibre. */
export default function InstrumentView({ instr, value, touching, lang }: Props) {
  const { kind, style, range } = instr
  const unit = kind === 'voltmeter' ? 'V' : 'A'
  const w = BODY[kind].w
  const h = BODY[kind].h
  const ranges = RANGES[kind] as readonly number[]
  const idx = Math.max(0, ranges.indexOf(range))
  const frac = value == null ? 0 : Math.min(1.08, Math.abs(value) / range)
  const smooth = useSmooth(frac)
  const over = value != null && Math.abs(value) > range * 1.0001
  const knobY = kind === 'voltmeter' ? 122 : 150
  const knobX = kind === 'voltmeter' ? 55 : 45
  const knobR = kind === 'voltmeter' ? 19 : 13
  const knobAngle = -120 + (ranges.length > 1 ? (idx * 240) / (ranges.length - 1) : 0)
  const btnDx = kind === 'voltmeter' ? 41 : 21

  const lcd = (x: number, y: number, ww: number, hh: number) => (
    <g>
      <rect x={x} y={y} width={ww} height={hh} rx={3} fill="#cdd8bf" stroke="#2d3328" strokeWidth={1} />
      <text x={x + ww - 14} y={y + hh * 0.72} textAnchor="end" fontSize={Math.min(26, hh * 0.62)} fontFamily="'IBM Plex Mono', monospace" fontWeight={600} fill="#1d2418" stroke="none">
        {value === undefined ? '----' : value === null ? '----' : over ? 'OL' : (value < 0 ? '-' : '') + formatReading(value, range, lang)}
      </text>
      <text x={x + ww - 4} y={y + hh * 0.72} textAnchor="end" fontSize={9} fontFamily="'IBM Plex Mono', monospace" fill="#1d2418" stroke="none">{unit}</text>
      <text x={x + 4} y={y + 9} fontSize={6} fontFamily="'IBM Plex Mono', monospace" fill="#46503b" stroke="none">{kind === 'voltmeter' ? 'AC' : 'AC'}</text>
    </g>
  )

  const dial = (cx: number, cy: number, R: number, x: number, y: number, ww: number, hh: number) => {
    const A = 46 // demi-ouverture de l'échelle, en degrés
    const pt = (f: number, r: number) => {
      const a = ((-A + 2 * A * f) * Math.PI) / 180
      return { x: cx + r * Math.sin(a), y: cy - r * Math.cos(a) }
    }
    const arc0 = pt(0, R)
    const arc1 = pt(1, R)
    const ticks = Array.from({ length: 11 }, (_, i) => i / 10)
    const needleAngle = -A + 2 * A * Math.min(smooth, 1.08)
    return (
      <g>
        <rect x={x} y={y} width={ww} height={hh} rx={3} fill="#f6f1df" stroke="#2d3328" strokeWidth={1} />
        <path d={`M${arc0.x} ${arc0.y} A${R} ${R} 0 0 1 ${arc1.x} ${arc1.y}`} fill="none" stroke="#222" strokeWidth={0.9} />
        {ticks.map((f, i) => {
          const a = pt(f, R)
          const b = pt(f, R - (i % 5 === 0 ? 7 : 4))
          return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#222" strokeWidth={i % 5 === 0 ? 1 : 0.6} />
        })}
        {[0, 0.5, 1].map((f) => {
          const t = pt(f, R - 15)
          return <text key={f} x={t.x} y={t.y + 2} textAnchor="middle" fontSize={6.5} fill="#222" stroke="none">{compact(Math.round(range * f * 100) / 100)}</text>
        })}
        <text x={cx} y={cy - R * 0.45} textAnchor="middle" fontSize={9} fontWeight={700} fill="#222" stroke="none">{unit}~</text>
        <g transform={`rotate(${needleAngle} ${cx} ${cy})`}>
          <line x1={cx} y1={cy + 6} x2={cx} y2={cy - R + 4} stroke="#c0211b" strokeWidth={1.2} strokeLinecap="round" />
        </g>
        <circle cx={cx} cy={cy} r={3.2} fill="#222" />
        {over && <text x={x + ww - 4} y={y + 9} textAnchor="end" fontSize={6.5} fontWeight={700} fill="#c0211b" stroke="none">{lang === 'fr' ? 'SURCHARGE' : 'OVERLOAD'}</text>}
      </g>
    )
  }

  const controls = (
    <g fontFamily="'IBM Plex Mono', monospace">
      {/* sélecteur de calibre */}
      <circle cx={knobX} cy={knobY} r={knobR + 4} fill="#1a1a1a" stroke="none" />
      <circle cx={knobX} cy={knobY} r={knobR} fill="#3a3a3a" stroke="#777" strokeWidth={0.8} />
      <g transform={`rotate(${knobAngle} ${knobX} ${knobY})`}>
        <line x1={knobX} y1={knobY} x2={knobX} y2={knobY - knobR + 2} stroke="#fff" strokeWidth={2.2} strokeLinecap="round" />
      </g>
      {ranges.map((r, i) => {
        const a = ((-120 + (i * 240) / (ranges.length - 1)) * Math.PI) / 180
        const rr = knobR + 10
        return <text key={r} x={knobX + rr * Math.sin(a)} y={knobY - rr * Math.cos(a) + 2} textAnchor="middle" fontSize={5.2} fill={r === range ? '#fff' : '#9a9a9a'} stroke="none">{compact(r)}</text>
      })}
      <text x={knobX} y={knobY + knobR + 14} textAnchor="middle" fontSize={7.5} fontWeight={700} fill="#fff" stroke="none">{range} {unit}</text>
      <g data-ir={`${instr.id}|-1`} style={{ cursor: 'pointer' }}>
        <circle cx={knobX - btnDx} cy={knobY} r={7} fill="#222" stroke="#777" strokeWidth={0.8} />
        <text x={knobX - btnDx} y={knobY + 3} textAnchor="middle" fontSize={9} fill="#fff" stroke="none">◀</text>
        <title>{lang === 'fr' ? 'Calibre inférieur' : 'Lower range'}</title>
      </g>
      <g data-ir={`${instr.id}|1`} style={{ cursor: 'pointer' }}>
        <circle cx={knobX + btnDx} cy={knobY} r={7} fill="#222" stroke="#777" strokeWidth={0.8} />
        <text x={knobX + btnDx} y={knobY + 3} textAnchor="middle" fontSize={9} fill="#fff" stroke="none">▶</text>
        <title>{lang === 'fr' ? 'Calibre supérieur' : 'Higher range'}</title>
      </g>
      {/* supprimer, aiguille / numérique */}
      <g data-ix={instr.id} style={{ cursor: 'pointer' }}>
        <circle cx={9} cy={9} r={6.5} fill="#7b1d18" stroke="#fff" strokeWidth={0.8} />
        <text x={9} y={12} textAnchor="middle" fontSize={9} fill="#fff" stroke="none">✕</text>
        <title>{lang === 'fr' ? 'Retirer l’appareil' : 'Remove the instrument'}</title>
      </g>
      <g data-is={instr.id} style={{ cursor: 'pointer' }}>
        <rect x={w - 31} y={3} width={28} height={12} rx={3} fill="#222" stroke="#aaa" strokeWidth={0.6} />
        <text x={w - 17} y={11.6} textAnchor="middle" fontSize={6.2} fill="#fff" stroke="none">{style === 'needle' ? (lang === 'fr' ? 'AIGUILLE' : 'NEEDLE') : (lang === 'fr' ? 'NUMÉR.' : 'DIGITAL')}</text>
        <title>{lang === 'fr' ? 'Passer de l’aiguille au numérique' : 'Switch needle / digital'}</title>
      </g>
    </g>
  )

  const body = kind === 'voltmeter' ? (
    <g>
      <rect x={0} y={0} width={w} height={h} rx={11} fill={style === 'needle' ? '#4a5258' : '#f1c232'} stroke="#222" strokeWidth={1.4} />
      <rect x={4} y={4} width={w - 8} height={h - 8} rx={8} fill="none" stroke="#00000030" strokeWidth={1} />
      {style === 'digital' ? lcd(12, 22, w - 24, 52) : dial(55, 84, 56, 10, 20, 90, 64 + 4)}
      {controls}
      <text x={w / 2} y={h - 4} textAnchor="middle" fontSize={5.5} fontFamily="'IBM Plex Mono', monospace" fill={style === 'needle' ? '#cfd6db' : '#4d3a05'} stroke="none">ALBERT·MESURE</text>
      {/* prises */}
      {SOCKETS.map((s, i) => (
        <g key={i}>
          <circle cx={s.x} cy={s.y} r={8} fill="#111" stroke="#888" strokeWidth={0.8} />
          <circle cx={s.x} cy={s.y} r={3.4} fill={i === 0 ? '#222' : '#d12a22'} stroke="#bbb" strokeWidth={0.6} />
          <text x={s.x} y={s.y + 18} textAnchor="middle" fontSize={6} fontFamily="'IBM Plex Mono', monospace" fill={style === 'needle' ? '#e5e9ec' : '#2b2208'} stroke="none">{i === 0 ? 'COM' : 'V'}</text>
        </g>
      ))}
    </g>
  ) : (
    <g>
      {/* mâchoire */}
      <circle cx={JAW.x} cy={JAW.y} r={24.5} fill="none" stroke="#2b2b2b" strokeWidth={11} strokeDasharray="140 14" transform={`rotate(-82 ${JAW.x} ${JAW.y})`} />
      <circle cx={JAW.x} cy={JAW.y} r={24.5} fill="none" stroke="#ffffff22" strokeWidth={2} strokeDasharray="140 14" transform={`rotate(-82 ${JAW.x} ${JAW.y})`} />
      <rect x={14} y={60} width={62} height={h - 62} rx={11} fill="#e8731a" stroke="#222" strokeWidth={1.4} />
      {style === 'digital' ? lcd(20, 68, 50, 40) : dial(45, 100, 32, 20, 66, 50, 44)}
      {controls}
      <text x={w / 2} y={h - 6} textAnchor="middle" fontSize={5.2} fontFamily="'IBM Plex Mono', monospace" fill="#3a1d05" stroke="none">PINCE · ALBERT</text>
      <circle cx={JAW.x} cy={JAW.y} r={14} fill={touching[0] ? '#2f9e4433' : 'none'} stroke={touching[0] ? '#2f9e44' : '#999'} strokeWidth={1.2} strokeDasharray={touching[0] ? undefined : '3 3'} />
    </g>
  )

  const probes = kind === 'voltmeter' ? probesOf(instr) : null
  return (
    <g>
      {probes && SOCKETS.map((s, i) => {
        const t = probes[i]
        const sx = instr.x + s.x
        const sy = instr.y + s.y
        return <path key={'l' + i} d={`M${sx} ${sy + 8} C${sx} ${sy + 70} ${t.x} ${t.y - 120} ${t.x} ${t.y - 42}`} fill="none" stroke={i === 0 ? '#111' : '#d12a22'} strokeWidth={2.4} strokeLinecap="round" />
      })}
      <g transform={`translate(${instr.x} ${instr.y})`}>
        {body}
        <rect data-ib={instr.id} x={0} y={0} width={w} height={h} fill="transparent" stroke="none" style={{ cursor: 'move' }} pointerEvents="all" />
        {/* les commandes sont redessinées au-dessus de la zone de prise du boîtier */}
        <g pointerEvents="all">{controlsHit(instr, w, knobX, knobY, btnDx)}</g>
      </g>
      {probes && probes.map((t, i) => (
        <g key={'p' + i} transform={`translate(${t.x} ${t.y})`}>
          <line x1={0} y1={0} x2={0} y2={-10} stroke="#b9b9b9" strokeWidth={1.6} strokeLinecap="round" />
          <rect x={-3.6} y={-14} width={7.2} height={5} rx={1.5} fill="#ddd" stroke="#555" strokeWidth={0.5} />
          <rect x={-4} y={-44} width={8} height={31} rx={3.5} fill={i === 0 ? '#1d1d1d' : '#d12a22'} stroke="#222" strokeWidth={0.8} />
          <circle cx={0} cy={0} r={touching[i] ? 4 : 2.4} fill={touching[i] ? '#2f9e44' : '#999'} stroke="#fff" strokeWidth={0.8} />
          <circle data-probe={`${instr.id}|${i}`} cx={0} cy={-12} r={11} fill="transparent" stroke="none" style={{ cursor: 'grab' }} pointerEvents="all" />
        </g>
      ))}
    </g>
  )
}

/** Zones cliquables des commandes (au-dessus de la zone de déplacement du boîtier). */
function controlsHit(instr: Instrument, w: number, knobX: number, knobY: number, btnDx: number) {
  return (
    <>
      <circle data-ix={instr.id} cx={9} cy={9} r={8} fill="transparent" style={{ cursor: 'pointer' }} />
      <rect data-is={instr.id} x={w - 33} y={1} width={32} height={16} fill="transparent" style={{ cursor: 'pointer' }} />
      <circle data-ir={`${instr.id}|-1`} cx={knobX - btnDx} cy={knobY} r={9} fill="transparent" style={{ cursor: 'pointer' }} />
      <circle data-ir={`${instr.id}|1`} cx={knobX + btnDx} cy={knobY} r={9} fill="transparent" style={{ cursor: 'pointer' }} />
    </>
  )
}
