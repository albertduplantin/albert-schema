import { useEffect, useMemo, useRef, useState } from 'react'
import type { Doc, Lang, PlacedSymbol } from './types'
import { SYMBOL_MAP } from './symbols'
import type { SimResult } from './sim/engine'

/**
 * Vue « machine » : la partie opérative en 2D, animée par la simulation du schéma.
 * Deux présentations : le banc (tous les vérins, moteurs et voyants du schéma, détecteurs compris) et une petite machine
 * (un vérin A pousse des pièces, un vérin B les repousse vers le bas), dont les pièces se déplacent réellement sous l'action des vérins.
 */
interface Props { doc: Doc; sim: SimResult | null; lang: Lang; onClose: () => void }

const T = (lang: Lang, fr: string, en: string) => (lang === 'fr' ? fr : en)
const defOf = (s: PlacedSymbol) => SYMBOL_MAP[s.defId]

interface Piece { id: number; x: number; y: number; state: 'table' | 'fall' | 'bin' }

const W = 600, H = 300
const TABLE_Y = 200, PW = 36, PH = 34

export default function MachineView({ doc, sim, lang, onClose }: Props) {
  const [mode, setMode] = useState<'machine' | 'bench'>('machine')
  const cyls = useMemo(() => doc.symbols.filter((s) => defOf(s)?.fluid?.k === 'cyl').sort((a, b) => (a.label || '').localeCompare(b.label || '')), [doc.symbols])
  const motors = doc.symbols.filter((s) => { const m = defOf(s)?.sim; return m?.k === 'load' && m.role === 'motor' })
  const lamps = doc.symbols.filter((s) => { const m = defOf(s)?.sim; return m?.k === 'load' && m.role === 'lamp' })
  const pos = (s?: PlacedSymbol) => (s && sim ? sim.cylPos[s.id] ?? 0 : 0)
  const dets = (cyl?: PlacedSymbol) => (cyl && cyl.label ? doc.symbols.filter((s) => s.det && s.det.cyl.replace(/\s+/g, '').toUpperCase() === cyl.label.replace(/\s+/g, '').toUpperCase()) : [])

  // ── petite machine : les pièces sont poussées par la tête des vérins
  const A = cyls[0], B = cyls[1]
  const pa = pos(A), pb = pos(B)
  const AX = 130, A_STROKE = 150, STATION = 298
  const headA = AX + pa * A_STROKE
  const BY = 112, B_STROKE = 62
  const headB = BY + pb * B_STROKE
  const pieces = useRef<Piece[]>([])
  const nextId = useRef(1)
  const [, tick] = useState(0)
  const hasB = !!B

  useEffect(() => {
    if (!sim) { if (pieces.current.length) { pieces.current = []; tick((n) => n + 1) } return }
    let ps = pieces.current
    const edge = hasB ? STATION + PW : 340
    // une pièce arrive devant le vérin A quand celui-ci est rentré et que le poste de chargement est libre
    const first = ps.length === 0 // vue ouverte en cours de cycle : une pièce est déjà devant la tête du vérin
    if ((pa < 0.05 || first) && !ps.some((p) => p.state === 'table' && p.x < AX + PW + 6) && ps.filter((p) => p.state !== 'bin').length < 3) {
      ps = [...ps, { id: nextId.current++, x: first ? Math.max(AX + 4, headA + 4) : AX + 4, y: TABLE_Y - PH, state: 'table' }]
    }
    ps = ps.map((p) => {
      if (p.state !== 'table') return p
      let { x, y } = p
      if (headA + 4 > x) x = headA + 4 // poussée par la tête du vérin A
      // au poste, le vérin B repousse la pièce vers le bas
      if (hasB && Math.abs(x - STATION) < 18 && headB + 8 > y) y = Math.min(headB + 8, TABLE_Y + 20)
      if (hasB ? y > TABLE_Y - PH + 12 : x + PW / 2 > edge) return { ...p, x, y, state: 'fall' as const }
      return { ...p, x, y }
    })
    // les pièces qui tombent arrivent dans le bac
    const falling = ps.filter((p) => p.state === 'fall')
    if (falling.length) window.setTimeout(() => { pieces.current = pieces.current.map((p) => (p.state === 'fall' ? { ...p, state: 'bin' as const } : p)).slice(-5); tick((n) => n + 1) }, 520)
    pieces.current = ps
    tick((n) => n + 1)
  }, [pa, pb, sim, hasB]) // eslint-disable-line react-hooks/exhaustive-deps

  const binX = hasB ? STATION - 20 : 340
  const cylinder = (key: string, x: number, y: number, p: number, len: number, vertical: boolean, label: string, ds: PlacedSymbol[]) => (
    <g key={key}>
      {vertical ? (
        <>
          <rect x={x - 12} y={y - 70} width={24} height={70} fill="#cfd8dc" stroke="#37474f" strokeWidth={1.5} rx={2} />
          <rect x={x - 3} y={y} width={6} height={p * len + 8} fill="#90a4ae" stroke="#37474f" />
          <rect x={x - 11} y={y + p * len + 6} width={22} height={9} fill="#546e7a" rx={2} />
          <text x={x + 18} y={y - 38} fontSize={13} fontWeight={700} fill="currentColor">{label}</text>
        </>
      ) : (
        <>
          <rect x={x - 90} y={y - 12} width={90} height={24} fill="#cfd8dc" stroke="#37474f" strokeWidth={1.5} rx={2} />
          <rect x={x} y={y - 3} width={p * len + 4} height={6} fill="#90a4ae" stroke="#37474f" />
          <rect x={x + p * len + 2} y={y - 14} width={9} height={28} fill="#546e7a" rx={2} />
          <text x={x - 85} y={y - 18} fontSize={13} fontWeight={700} fill="currentColor">{label}</text>
          {ds.map((d, i) => {
            const at = Math.min(1, Math.max(0, d.det?.at ?? 0))
            const on = !!sim?.closed[d.id]
            return (
              <g key={d.id}>
                <rect x={x - 88 + at * 78} y={y + 12} width={12} height={7} fill={on ? '#35c759' : '#eceff1'} stroke="#37474f" />
                <text x={x - 82 + at * 78} y={y + 30 + (i % 2) * 0} fontSize={10} textAnchor="middle" fill="currentColor">{d.label}</text>
              </g>
            )
          })}
        </>
      )}
    </g>
  )

  const machine = (
    <svg viewBox={`0 0 ${W} ${H}`} className="mv-svg" role="img" aria-label={T(lang, 'Machine animée', 'Animated machine')}>
      <rect x={0} y={0} width={W} height={H} fill="#f4f6f7" rx={6} />
      {!A && <text x={W / 2} y={H / 2} textAnchor="middle" fontSize={14} fill="#607d8b">{T(lang, 'Ajoutez un vérin au schéma pour voir la machine.', 'Add a cylinder to the diagram to see the machine.')}</text>}
      {/* table avec une ouverture sous le vérin B */}
      <rect x={20} y={TABLE_Y} width={(hasB ? STATION - 20 : binX) - 20 + (hasB ? 0 : 0)} height={14} fill="#78909c" />
      {hasB && <rect x={STATION + PW + 6} y={TABLE_Y} width={80} height={14} fill="#78909c" />}
      <rect x={binX} y={TABLE_Y + 40} width={hasB ? 74 : 90} height={50} fill="#eceff1" stroke="#78909c" strokeWidth={2} />
      <text x={binX + 37} y={TABLE_Y + 84} fontSize={10} textAnchor="middle" fill="#607d8b">{T(lang, 'bac', 'bin')}</text>
      {A && cylinder('A', AX, TABLE_Y - 17, pa, A_STROKE, false, A.label || 'A', dets(A))}
      {B && cylinder('B', STATION + PW / 2, BY - 6, pb, B_STROKE, true, B.label || 'B', dets(B))}
      {pieces.current.map((p) => {
        const inBin = p.state === 'bin'
        const idx = pieces.current.filter((q) => q.state === 'bin').findIndex((q) => q.id === p.id)
        const tx = p.state === 'table' ? p.x : inBin ? binX + 6 + (idx % 2) * 32 : p.x + 6
        const ty = p.state === 'table' ? p.y : inBin ? TABLE_Y + 52 - Math.floor(idx / 2) * 10 : TABLE_Y + 46
        return <rect key={p.id} x={0} y={0} width={PW} height={PH} rx={3} fill="#ffb74d" stroke="#e65100" strokeWidth={1.5}
          style={{ transform: `translate(${tx}px, ${ty}px)`, transition: p.state === 'table' ? 'transform .12s linear' : 'transform .5s cubic-bezier(.4,0,1,1)' }} />
      })}
      {lamps.slice(0, 4).map((l, i) => (
        <g key={l.id}>
          <circle cx={W - 30 - i * 34} cy={28} r={11} fill={sim?.energized.has(l.id) ? '#ffeb3b' : '#eceff1'} stroke="#37474f" strokeWidth={1.5} />
          <text x={W - 30 - i * 34} y={52} fontSize={10} textAnchor="middle" fill="currentColor">{l.label}</text>
        </g>
      ))}
    </svg>
  )

  // ── banc : tout ce que le schéma commande
  const bench = (
    <svg viewBox={`0 0 ${W} ${Math.max(H, 60 + (cyls.length + Math.ceil((motors.length + lamps.length) / 6)) * 62)}`} className="mv-svg" role="img" aria-label={T(lang, 'Banc d’essai', 'Test bench')}>
      <rect x={0} y={0} width={W} height={Math.max(H, 60 + (cyls.length + Math.ceil((motors.length + lamps.length) / 6)) * 62)} fill="#f4f6f7" rx={6} />
      {cyls.map((c, i) => cylinder(c.id, 230, 50 + i * 62, pos(c), 140, false, c.label || '?', dets(c)))}
      {[...motors, ...lamps].map((m, i) => {
        const isMotor = defOf(m)?.sim?.k === 'load' && (defOf(m)!.sim as { role?: string }).role === 'motor'
        const on = !!sim?.energized.has(m.id)
        const row = cyls.length + Math.floor(i / 6)
        const cx = 50 + (i % 6) * 92, cy = 50 + row * 62
        return (
          <g key={m.id}>
            <circle cx={cx} cy={cy} r={20} fill={isMotor ? '#cfd8dc' : on ? '#ffeb3b' : '#eceff1'} stroke="#37474f" strokeWidth={1.5} />
            {isMotor && (
              <g transform={`translate(${cx} ${cy})`} style={{ transformOrigin: 'center' }}>
                <g style={{ transformBox: 'fill-box', transformOrigin: 'center', animation: on ? 'mv-spin .9s linear infinite' : undefined, animationDirection: sim?.rotation?.[m.id] === -1 ? 'reverse' : 'normal' }}>
                  <path d="M0 -16L5 0L-5 0Z M0 16L5 0L-5 0Z" fill={on ? '#1f8f3a' : '#90a4ae'} />
                </g>
              </g>
            )}
            <text x={cx} y={cy + 36} fontSize={11} textAnchor="middle" fill="currentColor">{m.label}</text>
          </g>
        )
      })}
      {!cyls.length && !motors.length && !lamps.length && <text x={W / 2} y={H / 2} textAnchor="middle" fontSize={14} fill="#607d8b">{T(lang, 'Aucun vérin, moteur ni voyant dans ce schéma.', 'No cylinder, motor or lamp in this diagram.')}</text>}
    </svg>
  )

  return (
    <section className="machview" aria-label={T(lang, 'Vue machine', 'Machine view')}>
      <header>
        <b>{T(lang, 'Machine', 'Machine')}</b>
        <nav>
          <button className={mode === 'machine' ? 'on' : ''} onClick={() => setMode('machine')}>{T(lang, 'Poussoir / trieur', 'Pusher / sorter')}</button>
          <button className={mode === 'bench' ? 'on' : ''} onClick={() => setMode('bench')}>{T(lang, 'Banc', 'Bench')}</button>
        </nav>
        <span className="grow" />
        {!sim && <span className="muted small">{T(lang, 'Lancez la simulation ▶', 'Start the simulation ▶')}</span>}
        <button className="x" onClick={onClose} aria-label={T(lang, 'Fermer', 'Close')}>✕</button>
      </header>
      <div className="mv-body">{mode === 'machine' ? machine : bench}</div>
      <p className="muted small mv-note">{mode === 'machine'
        ? T(lang, 'Le vérin 1 (par ordre alphabétique des repères) pousse les pièces ; un second vérin les repousse vers le bas au poste. Leur mouvement est celui du schéma pneumatique.', 'Cylinder 1 (by tag order) pushes the pieces; a second cylinder pushes them down at the station. Their movement comes from the pneumatic diagram.')
        : T(lang, 'Tous les vérins, moteurs et voyants du schéma, avec leurs détecteurs.', 'Every cylinder, motor and lamp of the diagram, with their sensors.')}</p>
    </section>
  )
}
