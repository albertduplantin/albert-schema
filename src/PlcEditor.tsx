import { useMemo, useState } from 'react'
import type { Lang } from './types'
import { checkExpr, emptyProgram, N_IN, N_OUT, varValue, type PlcAction, type PlcContact, type PlcProgram, type PlcRung, type PlcState, type PlcStep, type PlcTransition } from './sim/plc'

interface Props {
  title: string
  lang: Lang
  program: PlcProgram | undefined
  /** état en direct (simulation) : étapes actives, entrées et sorties */
  live: PlcState | undefined
  onChange: (p: PlcProgram) => void
  onFocus: () => void
  onClose: () => void
}

const fr = (lang: Lang, a: string, b: string) => (lang === 'fr' ? a : b)
const ids = (list: number[]) => list.join(', ')
const parseIds = (t: string): number[] => t.split(/[\s,;]+/).map((x) => Number(x.replace(/^X/i, ''))).filter((n) => Number.isFinite(n) && n >= 0 && /\d/.test(String(n)))

/** Éditeur du programme d'un automate : variables, Grafcet et langage à contacts, avec affichage en direct pendant la simulation. */
export default function PlcEditor({ title, lang, program, live, onChange, onFocus, onClose }: Props) {
  const prog = program ?? emptyProgram()
  const [tab, setTab] = useState<'grafcet' | 'ladder' | 'vars'>('grafcet')
  const set = (p: Partial<PlcProgram>) => onChange({ ...prog, ...p })
  const nameOf = (a: string) => prog.names[a]?.trim() || ''
  const addresses = useMemo(() => {
    const out: string[] = []
    for (let i = 0; i < N_IN; i++) out.push(`I0.${i}`)
    for (let i = 0; i < N_OUT; i++) out.push(`Q0.${i}`)
    for (let i = 0; i < 8; i++) out.push(`M${i}`)
    for (const s of prog.steps) out.push(`X${s.id}`)
    for (let i = 1; i <= 4; i++) out.push(`T${i}`)
    return [...out, ...Object.values(prog.names).filter(Boolean)]
  }, [prog])
  const alive = (a: string) => (live ? varValue(prog, live, a) : false)

  // ── Grafcet
  const setStep = (id: number, p: Partial<PlcStep>) => set({ steps: prog.steps.map((s) => (s.id === id ? { ...s, ...p } : s)) })
  const setTr = (i: number, p: Partial<PlcTransition>) => set({ transitions: prog.transitions.map((t, k) => (k === i ? { ...t, ...p } : t)) })
  const addStep = () => {
    const id = prog.steps.length ? Math.max(...prog.steps.map((s) => s.id)) + 1 : 0
    const last = prog.steps.length ? prog.steps[prog.steps.length - 1].id : null
    set({
      steps: [...prog.steps, { id, init: prog.steps.length === 0, actions: [] }],
      transitions: last === null ? prog.transitions : [...prog.transitions, { from: [last], to: [id], cond: '1' }],
    })
  }
  const closeCycle = () => {
    if (!prog.steps.length) return
    const init = prog.steps.find((s) => s.init) ?? prog.steps[0]
    const last = prog.steps[prog.steps.length - 1]
    if (last.id === init.id) return
    set({ transitions: [...prog.transitions, { from: [last.id], to: [init.id], cond: '1' }] })
  }
  const delStep = (id: number) => set({ steps: prog.steps.filter((s) => s.id !== id), transitions: prog.transitions.filter((t) => !t.from.includes(id) && !t.to.includes(id)) })

  // ── Ladder
  const setRung = (i: number, p: Partial<PlcRung>) => set({ ladder: prog.ladder.map((r, k) => (k === i ? { ...r, ...p } : r)) })
  const contactState = (c: PlcContact) => (c.var ? alive(c.var) !== !!c.neg : true)
  const rungOn = (r: PlcRung) => (r.branches.length === 0 ? true : r.branches.some((b) => b.every(contactState)))

  const actionRow = (st: PlcStep, a: PlcAction, k: number) => (
    <div key={k} className="plc-row">
      <select value={a.kind} onChange={(e) => setStep(st.id, { actions: st.actions.map((x, j) => (j === k ? { ...x, kind: e.target.value as PlcAction['kind'] } : x)) })} title={fr(lang, 'N : tant que l’étape est active · S : mise à 1 mémorisée · R : remise à 0', 'N: while the step is active · S: latched set · R: reset')}>
        <option value="N">N</option><option value="S">S</option><option value="R">R</option>
      </select>
      <input list="plc-vars" value={a.var} placeholder="Q0.0" onChange={(e) => setStep(st.id, { actions: st.actions.map((x, j) => (j === k ? { ...x, var: e.target.value } : x)) })} />
      <button className="mini" onClick={() => setStep(st.id, { actions: st.actions.filter((_, j) => j !== k) })} aria-label="✕">✕</button>
    </div>
  )

  return (
    <section className="plc-panel" aria-label={title} onFocus={onFocus}>
      <header>
        <strong>{title}</strong>
        <nav role="tablist">
          {(['grafcet', 'ladder', 'vars'] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
              {t === 'grafcet' ? 'Grafcet' : t === 'ladder' ? fr(lang, 'Langage à contacts', 'Ladder') : fr(lang, 'Variables et E/S', 'Variables and I/O')}
            </button>
          ))}
        </nav>
        <span className="grow" />
        <span className="muted small">{live ? fr(lang, '▶ automate en marche', '▶ controller running') : fr(lang, 'automate à l’arrêt (non alimenté ou simulation arrêtée)', 'controller stopped (unpowered or simulation off)')}</span>
        <button className="icon" onClick={onClose} aria-label={fr(lang, 'Fermer', 'Close')}>✕</button>
      </header>
      <datalist id="plc-vars">{addresses.map((a) => <option key={a} value={a} />)}</datalist>

      {tab === 'vars' && (
        <div className="plc-body">
          <p className="muted small">{fr(lang, 'Donnez un nom à chaque entrée et sortie : il remplace l’adresse partout (réceptivités, actions, contacts). Exemple : I0.1 → « a0 » (vérin A rentré), Q0.0 → « A+ ».', 'Give each input and output a name: it replaces the address everywhere (conditions, actions, contacts). Example: I0.1 → “a0” (cylinder A retracted), Q0.0 → “A+”.')}</p>
          <div className="plc-io">
            {[['I0', N_IN, fr(lang, 'Entrées', 'Inputs')], ['Q0', N_OUT, fr(lang, 'Sorties', 'Outputs')]].map(([p, n, label]) => (
              <div key={p as string}>
                <h4>{label as string}</h4>
                {Array.from({ length: n as number }, (_, i) => {
                  const a = `${p}.${i}`
                  return (
                    <div key={a} className="plc-row">
                      <span className={'led' + (alive(a) ? ' on' : '')} aria-hidden="true" />
                      <code>{a}</code>
                      <input value={prog.names[a] ?? ''} placeholder={fr(lang, 'nom (facultatif)', 'name (optional)')} onChange={(e) => set({ names: { ...prog.names, [a]: e.target.value } })} />
                    </div>
                  )
                })}
              </div>
            ))}
            <div>
              <h4>{fr(lang, 'Mémentos', 'Markers')}</h4>
              {Array.from({ length: 4 }, (_, i) => {
                const a = `M${i}`
                return (
                  <div key={a} className="plc-row">
                    <span className={'led' + (alive(a) ? ' on' : '')} aria-hidden="true" />
                    <code>{a}</code>
                    <input value={prog.names[a] ?? ''} placeholder={fr(lang, 'nom (facultatif)', 'name (optional)')} onChange={(e) => set({ names: { ...prog.names, [a]: e.target.value } })} />
                  </div>
                )
              })}
              <h4>{fr(lang, 'Syntaxe des conditions', 'Condition syntax')}</h4>
              <p className="muted small">
                {fr(lang,
                  'ET, OU, NON (ou . + /) et parenthèses ; « 1 » = toujours vrai. Front montant : ↑a1 ou R(a1). Temps écoulé depuis l’activation de l’étape : T(3s) ou t/X2/3s.',
                  'AND, OR, NOT (or . + /) and parentheses; “1” = always true. Rising edge: ↑a1 or R(a1). Time since the step became active: T(3s) or t/X2/3s.')}
              </p>
            </div>
          </div>
        </div>
      )}

      {tab === 'grafcet' && (
        <div className="plc-body plc-grafcet">
          <div className="plc-edit">
            <p className="muted small">{fr(lang, 'Une étape agit sur les sorties tant qu’elle est active. Une transition relie des étapes (plusieurs numéros séparés par des virgules pour un parallélisme) et se franchit quand la condition est vraie.', 'A step acts on the outputs while active. A transition links steps (comma-separated numbers for parallel branches) and fires when its condition is true.')}</p>
            <div className="plc-actions">
              <button onClick={addStep}>＋ {fr(lang, 'Étape', 'Step')}</button>
              <button onClick={() => set({ transitions: [...prog.transitions, { from: [], to: [], cond: '1' }] })}>＋ {fr(lang, 'Transition', 'Transition')}</button>
              <button onClick={closeCycle} title={fr(lang, 'Ajoute une transition de la dernière étape vers l’étape initiale', 'Adds a transition from the last step to the initial step')}>↺ {fr(lang, 'Fermer le cycle', 'Close the cycle')}</button>
            </div>
            <h4>{fr(lang, 'Étapes', 'Steps')}</h4>
            {prog.steps.map((st) => (
              <div key={st.id} className={'plc-card' + (live?.steps.includes(st.id) ? ' active' : '')}>
                <div className="plc-row">
                  <b className="stepno">{st.id}</b>
                  <label className="chk"><input type="checkbox" checked={!!st.init} onChange={(e) => setStep(st.id, { init: e.target.checked })} /> {fr(lang, 'initiale', 'initial')}</label>
                  <input value={st.comment ?? ''} placeholder={fr(lang, 'commentaire', 'comment')} onChange={(e) => setStep(st.id, { comment: e.target.value })} />
                  <button className="mini danger" onClick={() => delStep(st.id)} aria-label={fr(lang, 'Supprimer l’étape', 'Delete step')}>🗑</button>
                </div>
                {st.actions.map((a, k) => actionRow(st, a, k))}
                <button className="mini" onClick={() => setStep(st.id, { actions: [...st.actions, { kind: 'N', var: '' }] })}>＋ {fr(lang, 'action', 'action')}</button>
              </div>
            ))}
            <h4>{fr(lang, 'Transitions', 'Transitions')}</h4>
            {prog.transitions.map((t, i) => {
              const err = checkExpr(t.cond)
              return (
                <div key={i} className="plc-row plc-tr">
                  <input className="short" value={ids(t.from)} onChange={(e) => setTr(i, { from: parseIds(e.target.value) })} aria-label={fr(lang, 'depuis', 'from')} title={fr(lang, 'étape(s) d’origine', 'source step(s)')} />
                  <span>→</span>
                  <input className="short" value={ids(t.to)} onChange={(e) => setTr(i, { to: parseIds(e.target.value) })} aria-label={fr(lang, 'vers', 'to')} title={fr(lang, 'étape(s) suivante(s)', 'next step(s)')} />
                  <input className={'cond' + (err ? ' bad' : '')} list="plc-vars" value={t.cond} onChange={(e) => setTr(i, { cond: e.target.value })} placeholder="a1 ET NON b0" />
                  <span title={err ?? ''}>{err ? '⚠' : '✓'}</span>
                  <button className="mini danger" onClick={() => set({ transitions: prog.transitions.filter((_, k) => k !== i) })} aria-label={fr(lang, 'Supprimer', 'Delete')}>🗑</button>
                </div>
              )
            })}
          </div>
          <GrafcetView prog={prog} live={live} lang={lang} nameOf={nameOf} />
        </div>
      )}

      {tab === 'ladder' && (
        <div className="plc-body plc-ladder">
          <p className="muted small">{fr(lang, 'Chaque réseau : une ou plusieurs lignes de contacts en parallèle (OU), chaque ligne est une série de contacts (ET), puis la bobine. Les réseaux de la ligne sont évalués dans l’ordre, après le Grafcet.', 'Each rung: one or more parallel lines of contacts (OR), each line a series of contacts (AND), then the coil. Rungs run in order, after the Grafcet.')}</p>
          <button onClick={() => set({ ladder: [...prog.ladder, { branches: [[{ var: '' }]], coil: { kind: '=', var: '' } }] })}>＋ {fr(lang, 'Réseau', 'Rung')}</button>
          {prog.ladder.map((r, i) => (
            <div key={i} className={'plc-card' + (live && rungOn(r) ? ' active' : '')}>
              <div className="plc-row">
                <b>{i + 1}</b>
                <input value={r.comment ?? ''} placeholder={fr(lang, 'commentaire', 'comment')} onChange={(e) => setRung(i, { comment: e.target.value })} />
                <button className="mini danger" onClick={() => set({ ladder: prog.ladder.filter((_, k) => k !== i) })} aria-label={fr(lang, 'Supprimer le réseau', 'Delete rung')}>🗑</button>
              </div>
              {r.branches.map((br, bi) => (
                <div key={bi} className="plc-row plc-branch">
                  <span className="muted small">{bi === 0 ? '' : fr(lang, 'OU', 'OR')}</span>
                  {br.map((c, ci) => (
                    <span key={ci} className={'chip' + (live && contactState(c) ? ' on' : '')}>
                      <select value={c.neg ? 'nc' : 'no'} onChange={(e) => setRung(i, { branches: r.branches.map((b, j) => (j === bi ? b.map((x, k) => (k === ci ? { ...x, neg: e.target.value === 'nc' || undefined } : x)) : b)) })}>
                        <option value="no">─┤ ├─</option><option value="nc">─┤/├─</option>
                      </select>
                      <input list="plc-vars" value={c.var} placeholder="I0.0" onChange={(e) => setRung(i, { branches: r.branches.map((b, j) => (j === bi ? b.map((x, k) => (k === ci ? { ...x, var: e.target.value } : x)) : b)) })} />
                      <button className="mini" onClick={() => setRung(i, { branches: r.branches.map((b, j) => (j === bi ? b.filter((_, k) => k !== ci) : b)).filter((b) => b.length) })} aria-label="✕">✕</button>
                    </span>
                  ))}
                  <button className="mini" onClick={() => setRung(i, { branches: r.branches.map((b, j) => (j === bi ? [...b, { var: '' }] : b)) })}>＋ {fr(lang, 'contact', 'contact')}</button>
                </div>
              ))}
              <div className="plc-row">
                <button className="mini" onClick={() => setRung(i, { branches: [...r.branches, [{ var: '' }]] })}>＋ {fr(lang, 'ligne en parallèle (OU)', 'parallel line (OR)')}</button>
                <span>→</span>
                <select value={r.coil.kind} onChange={(e) => setRung(i, { coil: { ...r.coil, kind: e.target.value as PlcRung['coil']['kind'], ...(e.target.value === 'TON' && !r.coil.preset ? { preset: 2000 } : {}) } })}>
                  <option value="=">─( )─ {fr(lang, 'bobine', 'coil')}</option><option value="S">─(S)─ {fr(lang, 'mise à 1', 'set')}</option><option value="R">─(R)─ {fr(lang, 'mise à 0', 'reset')}</option><option value="TON">TON {fr(lang, 'temporisation', 'timer')}</option>
                </select>
                <input list="plc-vars" value={r.coil.var} placeholder={r.coil.kind === 'TON' ? 'T1' : 'Q0.0'} onChange={(e) => setRung(i, { coil: { ...r.coil, var: e.target.value } })} />
                {r.coil.kind === 'TON' && (
                  <label className="small">{fr(lang, 'durée (s)', 'preset (s)')} <input className="short" type="number" min={0} step={0.5} value={(r.coil.preset ?? 2000) / 1000} onChange={(e) => setRung(i, { coil: { ...r.coil, preset: Math.max(0, Number(e.target.value)) * 1000 } })} /></label>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

/** Dessin du Grafcet : étapes en colonne (l'étape initiale a un double cadre), transitions entre étapes consécutives, renvois pour les autres. */
function GrafcetView({ prog, live, lang, nameOf }: { prog: PlcProgram; live: PlcState | undefined; lang: Lang; nameOf: (a: string) => string }) {
  const steps = [...prog.steps].sort((a, b) => a.id - b.id)
  const rowH = 74
  const label = (v: string) => nameOf(v) || v
  if (!steps.length) return <div className="plc-view muted small">{fr(lang, 'Ajoutez une étape pour commencer le Grafcet.', 'Add a step to start the Grafcet.')}</div>
  const pos = new Map(steps.map((s, i) => [s.id, i]))
  const h = steps.length * rowH + 30
  return (
    <div className="plc-view">
      <svg width="100%" viewBox={`0 0 420 ${h}`} role="img" aria-label="Grafcet" style={{ maxHeight: 360 }}>
        {steps.map((s, i) => {
          const y = 20 + i * rowH
          const on = !!live?.steps.includes(s.id)
          return (
            <g key={s.id}>
              {i > 0 && <path d={`M60 ${y - 28}V${y}`} stroke="currentColor" fill="none" />}
              {s.init && <rect x={42} y={y - 3} width={36} height={30} fill="none" stroke="currentColor" />}
              <rect x={45} y={y} width={30} height={24} fill={on ? '#7bd88f' : 'var(--bg)'} stroke="currentColor" strokeWidth={1.4} />
              <text x={60} y={y + 16} textAnchor="middle" fontSize={12} fontWeight={700} fill="currentColor">{s.id}</text>
              {s.actions.length > 0 && (
                <g>
                  <path d="M75 12H95" transform={`translate(0 ${y})`} stroke="currentColor" />
                  {s.actions.map((a, k) => (
                    <g key={k} transform={`translate(95 ${y + k * 17 - (s.actions.length - 1) * 8 - 1})`}>
                      <rect width={92} height={16} fill="var(--bg)" stroke="currentColor" />
                      <text x={4} y={11.5} fontSize={9} fill="currentColor">{a.kind === 'N' ? '' : a.kind + ' '}{label(a.var)}</text>
                    </g>
                  ))}
                </g>
              )}
              {s.comment && <text x={200} y={y + 16} fontSize={8.5} fill="#777">{s.comment}</text>}
            </g>
          )
        })}
        {prog.transitions.map((t, i) => {
          const a = pos.get(t.from[0]), b = pos.get(t.to[0])
          if (a === undefined || b === undefined) return null
          const consecutive = b === a + 1
          const y = 20 + a * rowH + 24 + 20
          return (
            <g key={i}>
              {consecutive ? (
                <>
                  <path d={`M52 ${y}H68`} stroke="currentColor" strokeWidth={2} />
                  <text x={74} y={y + 3.5} fontSize={9} fill="currentColor">{t.cond}</text>
                </>
              ) : (
                <text x={200 + (i % 3) * 0} y={20 + a * rowH + 40} fontSize={8.5} fill="#2a5bd7" transform={`translate(0 ${(i % 2) * 11})`}>↳ {t.from.join(',')}→{t.to.join(',')} : {t.cond}</text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}
