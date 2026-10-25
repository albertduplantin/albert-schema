import { createContext, useContext, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react'
import type { Lang } from './types'
import { checkExpr, emptyProgram, liveCond, N_IN, N_OUT, varValue, type PlcContact, type PlcProgram, type PlcRung, type PlcState } from './sim/plc'
import * as E from './plcEdit'
import PlcWindow, { type WinState } from './PlcWindow'

/**
 * Éditeur graphique de l'automate : Grafcet et langage à contacts se construisent par glisser-déposer (ou par clic : on choisit un élément,
 * puis l'emplacement). Les variables se glissent sur les étapes, les transitions et les contacts. En simulation, l'état est affiché en direct.
 */
interface Props {
  win: WinState
  setWin: (p: Partial<WinState>) => void
  title: string
  lang: Lang
  program: PlcProgram | undefined
  live: PlcState | undefined
  /** `discrete` : une action complète (un pas d'historique) ; sinon saisie en cours */
  onChange: (p: PlcProgram, discrete: boolean) => void
  onFocus: () => void
  onClose: () => void
}

type Tool = 'step' | 'contactNO' | 'contactNC' | 'coil' | 'set' | 'reset' | 'ton' | 'rung'
type Payload = { k: 'tool'; tool: Tool } | { k: 'var'; name: string } | { k: 'step'; id: number } | { k: 'link'; from: number } | { k: 'rung'; i: number }

interface Dnd { drag: Payload | null; armed: Payload | null; setDrag: (p: Payload | null) => void; setArmed: (p: Payload | null) => void }
const DndCtx = createContext<Dnd>({ drag: null, armed: null, setDrag: () => {}, setArmed: () => {} })
const MIME = 'application/x-albert-plc'
const T = (lang: Lang, fr: string, en: string) => (lang === 'fr' ? fr : en)

// ───────────────────────── éléments communs

/** Élément qu'on peut saisir (glisser) ou choisir d'un clic puis poser d'un second clic. */
function Draggable({ payload, className, children, title, click = true }: { payload: Payload; className?: string; children: ReactNode; title?: string; click?: boolean }) {
  const { setDrag, armed, setArmed } = useContext(DndCtx)
  const same = armed && JSON.stringify(armed) === JSON.stringify(payload)
  return (
    <div className={`${className ?? ''} dragitem${same ? ' armed' : ''}`} draggable data-tip={title} role="button" tabIndex={0}
      onDragStart={(e) => { e.dataTransfer.setData(MIME, JSON.stringify(payload)); e.dataTransfer.effectAllowed = 'copyMove'; setDrag(payload) }}
      onDragEnd={() => setDrag(null)}
      onClick={() => click && setArmed(same ? null : payload)}
      onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && click) { e.preventDefault(); setArmed(same ? null : payload) } }}>
      {children}
    </div>
  )
}

/** Emplacement de dépôt : invisible au repos, mis en évidence dès qu'un élément compatible est saisi ou choisi. */
function Slot({ accept, onDrop, className, children, label }: { accept: (p: Payload) => boolean; onDrop: (p: Payload, e: { alt: boolean }) => void; className?: string; children?: ReactNode; label?: string }) {
  const { drag, armed, setDrag, setArmed } = useContext(DndCtx)
  const [over, setOver] = useState(false)
  const cur = drag ?? armed
  const can = !!cur && accept(cur)
  const fire = (p: Payload, alt: boolean) => { onDrop(p, { alt }); setDrag(null); setArmed(null); setOver(false) }
  return (
    <div className={`slot ${className ?? ''}${can ? ' can' : ''}${over && can ? ' over' : ''}`} aria-label={label}
      onDragOver={(e: DragEvent) => { if (can) { e.preventDefault(); setOver(true) } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e: DragEvent) => { if (!can || !cur) return; e.preventDefault(); fire(cur, e.altKey) }}
      onClick={(e) => { if (armed && can) { e.stopPropagation(); fire(armed, e.altKey) } }}>
      {children}
    </div>
  )
}

/** Texte modifiable en place (clic), validé par Entrée ou en quittant le champ, annulé par Échap. */
function Inline({ value, onCommit, placeholder, list, className, invalid, title }: { value: string; onCommit: (v: string) => void; placeholder?: string; list?: string; className?: string; invalid?: boolean; title?: string }) {
  const [edit, setEdit] = useState(false)
  const [v, setV] = useState(value)
  useEffect(() => { if (!edit) setV(value) }, [value, edit])
  if (!edit) {
    return <span className={`inline ${className ?? ''}${invalid ? ' bad' : ''}${value ? '' : ' blank'}`} role="button" tabIndex={0} data-tip={title} onClick={() => setEdit(true)} onKeyDown={(e) => { if (e.key === 'Enter') setEdit(true) }}>{value || placeholder || '…'}</span>
  }
  const done = (ok: boolean) => { setEdit(false); if (ok && v !== value) onCommit(v) }
  return <input className={`inline-input ${className ?? ''}`} autoFocus list={list} value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onBlur={() => done(true)}
    onKeyDown={(e) => { if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false) }} onFocus={(e) => e.currentTarget.select()} />
}

// ───────────────────────── éditeur

export default function PlcEditor({ win, setWin, title, lang, program, live, onChange, onFocus, onClose }: Props) {
  const prog = program ?? emptyProgram()
  const [tab, setTab] = useState<'grafcet' | 'ladder' | 'vars'>('grafcet')
  const [drag, setDrag] = useState<Payload | null>(null)
  const [armed, setArmed] = useState<Payload | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const change = (p: PlcProgram, discrete = true) => onChange(p, discrete)
  const nameOf = (a: string) => prog.names[a]?.trim() || a
  const alive = (a: string) => varValue(prog, live, a)

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && armed) { setArmed(null); e.stopPropagation() } }
    window.addEventListener('keydown', esc, true)
    return () => window.removeEventListener('keydown', esc, true)
  }, [armed])

  const known = useMemo(() => new Set(Object.values(prog.names).map((n) => n.trim().toLowerCase()).filter(Boolean)), [prog.names])
  const issues = useMemo(() => E.lint(prog, known, lang), [prog, known, lang])
  const addresses = useMemo(() => [
    ...Array.from({ length: N_IN }, (_, i) => `I0.${i}`), ...Array.from({ length: N_OUT }, (_, i) => `Q0.${i}`),
    ...Array.from({ length: 4 }, (_, i) => `M${i}`), ...prog.steps.map((s) => `X${s.id}`), ...[1, 2, 3, 4].map((i) => `T${i}`),
  ], [prog.steps])

  const varChip = (a: string, kind: 'in' | 'out' | 'mem') => (
    <Draggable key={a} payload={{ k: 'var', name: prog.names[a]?.trim() || a }} className={`vchip ${kind}`} data-tip={T(lang, 'Glissez cette variable sur une étape, une transition ou un contact', 'Drag this variable onto a step, a transition or a contact')}>
      <span className={'led' + (alive(a) ? ' on' : '')} aria-hidden="true" />
      <span className="vname">{nameOf(a)}</span>
      {prog.names[a]?.trim() && <small>{a}</small>}
    </Draggable>
  )

  const toolbox = (
    <aside className="pe-tools" aria-label={T(lang, 'Éléments', 'Elements')}>
      {tab === 'grafcet' && (
        <section>
          <h4>{T(lang, 'Éléments', 'Elements')}</h4>
          <Draggable payload={{ k: 'tool', tool: 'step' }} className="tool" title={T(lang, 'Étape : un état stable du cycle, pendant lequel la machine exécute ses actions. Glissez-la sur un « ＋ » de la séquence, ou cliquez puis cliquez sur l’emplacement.', 'Step: a stable state of the cycle during which the machine performs its actions. Drag it onto a “＋” in the sequence, or click then click the spot.')}><b className="mini-step">n</b> {T(lang, 'Étape', 'Step')}</Draggable>
        </section>
      )}
      {tab === 'ladder' && (
        <section>
          <h4>{T(lang, 'Éléments', 'Elements')}</h4>
          <Draggable payload={{ k: 'tool', tool: 'contactNO' }} className="tool" title={T(lang, 'Contact repos ouvert : laisse passer le courant quand sa variable est vraie (bouton appuyé, capteur actif…).', 'Normally open contact: passes power when its variable is true (button pressed, sensor active…).')}><svg width="30" height="16" viewBox="0 0 30 16"><path d="M0 8H9M9 1V15M21 1V15M21 8H30" /></svg> {T(lang, 'Contact (repos ouvert)', 'Contact (NO)')}</Draggable>
          <Draggable payload={{ k: 'tool', tool: 'contactNC' }} className="tool" title={T(lang, 'Contact repos fermé : laisse passer le courant quand sa variable est fausse (bouton d’arrêt, capteur non actif…).', 'Normally closed contact: passes power when its variable is false (stop button, inactive sensor…).')}><svg width="30" height="16" viewBox="0 0 30 16"><path d="M0 8H9M9 1V15M21 1V15M21 8H30M8 14L22 2" /></svg> {T(lang, 'Contact (repos fermé)', 'Contact (NC)')}</Draggable>
          <Draggable payload={{ k: 'tool', tool: 'coil' }} className="tool" title={T(lang, 'Bobine : la variable vaut 1 tant que le réseau conduit, 0 sinon (sortie non mémorisée).', 'Coil: the variable is 1 while the rung conducts, 0 otherwise (not latched).')}><svg width="30" height="16" viewBox="0 0 30 16"><path d="M0 8H8M22 8H30" /><circle cx="15" cy="8" r="7" fill="none" /></svg> {T(lang, 'Bobine', 'Coil')}</Draggable>
          <Draggable payload={{ k: 'tool', tool: 'set' }} className="tool" title={T(lang, 'Mise à 1 (S, Set) : la variable passe à 1 quand le réseau conduit et y reste, même quand il ne conduit plus. Une mise à 0 (R) est nécessaire pour l’éteindre.', 'Set (S): the variable goes to 1 when the rung conducts and stays there until a Reset (R).')}><svg width="30" height="16" viewBox="0 0 30 16"><path d="M0 8H8M22 8H30" /><circle cx="15" cy="8" r="7" fill="none" /><text x="15" y="11.5" fontSize="9" textAnchor="middle" stroke="none" fill="currentColor">S</text></svg> {T(lang, 'Mise à 1 (S)', 'Set (S)')}</Draggable>
          <Draggable payload={{ k: 'tool', tool: 'reset' }} className="tool" title={T(lang, 'Mise à 0 (R, Reset) : remet la variable à 0 quand le réseau conduit, et elle y reste.', 'Reset (R): sets the variable back to 0 when the rung conducts, and it stays there.')}><svg width="30" height="16" viewBox="0 0 30 16"><path d="M0 8H8M22 8H30" /><circle cx="15" cy="8" r="7" fill="none" /><text x="15" y="11.5" fontSize="9" textAnchor="middle" stroke="none" fill="currentColor">R</text></svg> {T(lang, 'Mise à 0 (R)', 'Reset (R)')}</Draggable>
          <Draggable payload={{ k: 'tool', tool: 'ton' }} className="tool" title={T(lang, 'Temporisation à l’enclenchement (TON) : son bit T1, T2… passe à 1 quand le réseau conduit sans interruption depuis la durée réglée. Utilisez T1 comme contact ailleurs.', 'On-delay timer (TON): its bit T1, T2… becomes 1 once the rung has conducted without interruption for the preset time. Use T1 as a contact elsewhere.')}><b className="mini-ton">TON</b> {T(lang, 'Temporisation', 'Timer')}</Draggable>
          <Draggable payload={{ k: 'tool', tool: 'rung' }} className="tool" title={T(lang, 'Réseau : une ligne de logique (contacts puis bobine). Glissez-le entre deux réseaux.', 'Rung: one line of logic (contacts then coil). Drag it between two rungs.')}><b className="mini-step">▭</b> {T(lang, 'Réseau', 'Rung')}</Draggable>
        </section>
      )}
      <section>
        <h4>{T(lang, 'Entrées', 'Inputs')}</h4>
        <div className="vlist">{Array.from({ length: N_IN }, (_, i) => varChip(`I0.${i}`, 'in'))}</div>
        <h4>{T(lang, 'Sorties', 'Outputs')}</h4>
        <div className="vlist">{Array.from({ length: N_OUT }, (_, i) => varChip(`Q0.${i}`, 'out'))}</div>
        <h4>{T(lang, 'Mémentos', 'Markers')}</h4>
        <div className="vlist">{Array.from({ length: 4 }, (_, i) => varChip(`M${i}`, 'mem'))}</div>
      </section>
    </aside>
  )

  const tabs = (
    <nav role="tablist" className="pe-tabs">
      {(['grafcet', 'ladder', 'vars'] as const).map((t) => (
        <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
          {t === 'grafcet' ? <span data-tip={T(lang, 'Grafcet : décrit le cycle de la machine en étapes et transitions (le plus simple pour les séquences de vérins).', 'Grafcet: describes the machine cycle as steps and transitions (simplest for cylinder sequences).')}>Grafcet</span> : t === 'ladder' ? T(lang, 'Langage à contacts', 'Ladder') : T(lang, 'Noms des E/S', 'I/O names')}
        </button>
      ))}
    </nav>
  )

  return (
    <PlcWindow win={win} set={setWin} lang={lang} title={title} onClose={onClose} header={<>{tabs}<span className={'runstate' + (live ? ' on' : '')}>{live ? T(lang, '▶ en marche', '▶ running') : T(lang, '■ arrêtée', '■ stopped')}</span></>}>
      <DndCtx.Provider value={{ drag, armed, setDrag, setArmed }}>
        <div className="pe" ref={root} onFocus={onFocus}>
          {tab !== 'vars' && toolbox}
          <div className="pe-main">
            {armed && (
              <div className="pe-hint" role="status">
                {T(lang, 'Cliquez sur un emplacement ＋ pour poser l’élément choisi · Échap pour annuler', 'Click a ＋ spot to place the chosen item · Esc to cancel')}
                <button className="mini" onClick={() => setArmed(null)}>✕</button>
              </div>
            )}
            {tab === 'grafcet' && <GrafcetEditor prog={prog} live={live} lang={lang} change={change} />}
            {tab === 'ladder' && <LadderEditor prog={prog} live={live} lang={lang} change={change} />}
            {tab === 'vars' && <NamesEditor prog={prog} lang={lang} change={change} alive={alive} />}
            {issues.length > 0 && tab !== 'vars' && (
              <ul className="pe-issues" role="status">{issues.slice(0, 4).map((m, i) => <li key={i}>⚠ {m}</li>)}</ul>
            )}
          </div>
        </div>
        <datalist id="plc-vars">{[...addresses, ...Object.values(prog.names).filter(Boolean)].map((a) => <option key={a} value={a} />)}</datalist>
      </DndCtx.Provider>
    </PlcWindow>
  )
}

// ───────────────────────── noms des entrées et sorties

function NamesEditor({ prog, lang, change, alive }: { prog: PlcProgram; lang: Lang; change: (p: PlcProgram, d?: boolean) => void; alive: (a: string) => boolean }) {
  const col = (prefix: string, n: number, label: string) => (
    <div>
      <h4>{label}</h4>
      {Array.from({ length: n }, (_, i) => {
        const a = `${prefix}${i}`
        return (
          <div key={a} className="plc-row">
            <span className={'led' + (alive(a) ? ' on' : '')} aria-hidden="true" />
            <code>{a}</code>
            <input value={prog.names[a] ?? ''} placeholder={T(lang, 'nom (ex. a1, dcy, A+)', 'name (e.g. a1, start, A+)')} onChange={(e) => change({ ...prog, names: { ...prog.names, [a]: e.target.value } }, false)} />
          </div>
        )
      })}
    </div>
  )
  return (
    <div className="pe-names">
      <p className="muted small">{T(lang, 'Un nom remplace l’adresse partout : dans les conditions, les actions et les contacts. Exemple : I0.1 → « a0 » (vérin A rentré), Q0.0 → « A+ ».', 'A name replaces the address everywhere. Example: I0.1 → “a0” (cylinder A retracted), Q0.0 → “A+”.')}</p>
      <div className="plc-io">{col('I0.', N_IN, T(lang, 'Entrées', 'Inputs'))}{col('Q0.', N_OUT, T(lang, 'Sorties', 'Outputs'))}{col('M', 4, T(lang, 'Mémentos', 'Markers'))}</div>
      <h4>{T(lang, 'Écriture des conditions', 'Condition syntax')}</h4>
      <p className="muted small">{T(lang, 'ET, OU, NON (ou . + /) et parenthèses · « 1 » = toujours vrai · front montant ↑a1 ou R(a1) · temps écoulé depuis l’activation de l’étape : T(3s). Astuce : glissez une variable sur une transition pour l’ajouter à sa condition (Alt = NON).', 'AND, OR, NOT (or . + /) and parentheses · “1” = always true · rising edge ↑a1 or R(a1) · time since the step became active: T(3s). Tip: drag a variable onto a transition to add it to its condition (Alt = NOT).')}</p>
    </div>
  )
}

// ───────────────────────── Grafcet

function GrafcetEditor({ prog, live, lang, change }: { prog: PlcProgram; live: PlcState | undefined; lang: Lang; change: (p: PlcProgram, d?: boolean) => void }) {
  const { setArmed } = useContext(DndCtx)
  const steps = prog.steps
  const n = steps.length
  const tIndex = (from: number, to: number) => prog.transitions.findIndex((t) => t.from.length === 1 && t.to.length === 1 && t.from[0] === from && t.to[0] === to)
  const consecutive = new Set(steps.slice(0, -1).map((s, i) => tIndex(s.id, steps[i + 1].id)).filter((i) => i >= 0))
  const others = prog.transitions.map((t, i) => ({ t, i })).filter(({ i }) => !consecutive.has(i))
  const fires = (i: number) => {
    const t = prog.transitions[i]
    return !!live && t.from.length > 0 && t.from.every((s) => live.steps.includes(s)) && liveCond(prog, live, t.cond)
  }
  const acceptStepSlot = (p: Payload) => (p.k === 'tool' && p.tool === 'step') || p.k === 'step'
  const dropStep = (index: number) => (p: Payload) => {
    if (p.k === 'tool') change(E.insertStep(prog, index).prog)
    else if (p.k === 'step') change(E.moveStep(prog, p.id, index))
  }
  const insertSlot = (index: number) => (
    <Slot key={`slot${index}`} className="gf-slot" accept={acceptStepSlot} onDrop={dropStep(index)} label={T(lang, 'Insérer une étape ici', 'Insert a step here')}>
      <button className="gf-plus" onClick={(e) => { e.stopPropagation(); change(E.insertStep(prog, index).prog) }} data-tip={T(lang, 'Insérer une étape ici', 'Insert a step here')} aria-label={T(lang, 'Insérer une étape ici', 'Insert a step here')}>＋</button>
    </Slot>
  )

  const condField = (i: number) => {
    const t = prog.transitions[i]
    const err = checkExpr(t.cond)
    return (
      <Slot className="gf-cond" accept={(p) => p.k === 'var'} onDrop={(p, ev) => p.k === 'var' && change(E.setTransition(prog, i, { cond: E.appendCond(t.cond, p.name, ev.alt) }))}>
        <Inline value={t.cond} list="plc-vars" invalid={!!err} placeholder="a1 ET NON b0" onCommit={(v) => change(E.setTransition(prog, i, { cond: v }))} data-tip={err ?? T(lang, 'Cliquez pour modifier la condition', 'Click to edit the condition')} />
        {err && <span data-tip={err} className="gf-err">⚠</span>}
      </Slot>
    )
  }

  if (!n) {
    return (
      <div className="pe-empty">
        <p>{T(lang, 'Le Grafcet est vide.', 'The Grafcet is empty.')}</p>
        <Slot className="gf-first" accept={acceptStepSlot} onDrop={dropStep(0)}>
          <button className="primary" onClick={() => change(E.insertStep(prog, 0).prog)}>＋ {T(lang, 'Créer l’étape initiale', 'Create the initial step')}</button>
        </Slot>
        <p className="muted small">{T(lang, 'Glissez l’élément « Étape » ici, ou cliquez sur le bouton.', 'Drag the “Step” element here, or click the button.')}</p>
      </div>
    )
  }

  return (
    <div className="gf">
      <p className="gf-legend muted small" data-tip={T(lang, 'N, S et R sont les types d’actions du Grafcet. Cliquez sur la lettre d’une action pour en changer.', 'N, S and R are the Grafcet action types. Click an action letter to change it.')}>
        <b>N</b> {T(lang, 'tant que l’étape est active', 'while the step is active')} · <b>S</b> {T(lang, 'mise à 1 mémorisée', 'latched set')} · <b>R</b> {T(lang, 'remise à 0', 'reset')} — {T(lang, 'survolez une lettre pour le détail', 'hover a letter for details')}
      </p>
      {insertSlot(0)}
      {steps.map((s, i) => {
        const ti = i + 1 < n ? tIndex(s.id, steps[i + 1].id) : -1
        const active = !!live?.steps.includes(s.id)
        return (
          <div key={s.id} className="gf-block">
            <Slot className={`gf-step${active ? ' active' : ''}`}
              accept={(p) => p.k === 'var' || (p.k === 'link' && p.from !== s.id)}
              onDrop={(p) => {
                if (p.k === 'var') change(E.addAction(prog, s.id, { kind: 'N', var: p.name }))
                else if (p.k === 'link') change(E.addTransition(prog, p.from, s.id))
              }}>
              <Draggable payload={{ k: 'step', id: s.id }} className="gf-grip" data-tip={T(lang, 'Glisser pour déplacer l’étape dans la séquence', 'Drag to move the step in the sequence')} click={false}>⠿</Draggable>
              <button className={`gf-no${s.init ? ' init' : ''}`} onClick={() => change(E.setInitial(prog, s.id, !s.init))} data-tip={T(lang, s.init ? 'Étape initiale (cliquez pour retirer)' : 'Cliquez pour en faire l’étape initiale', s.init ? 'Initial step (click to remove)' : 'Click to make it the initial step')}>{s.id}</button>
              <div className="gf-actions">
                {s.actions.map((a, k) => (
                  <span key={k} className="gf-act">
                    <button className={`kind k${a.kind}`} onClick={() => change(E.setStep(prog, s.id, { actions: s.actions.map((x, j) => (j === k ? { ...x, kind: a.kind === 'N' ? 'S' : a.kind === 'S' ? 'R' : 'N' } : x)) }))} data-tip={T(lang, a.kind === 'N' ? 'N (non mémorisée) : la sortie est à 1 uniquement tant que l’étape est active, elle retombe en la quittant. Cliquez pour passer à S.' : a.kind === 'S' ? 'S (mise à 1 mémorisée) : la sortie passe à 1 à l’activation de l’étape et y reste, même après avoir quitté l’étape, jusqu’à une action R. Cliquez pour passer à R.' : 'R (remise à 0) : la sortie repasse à 0 à l’activation de l’étape et y reste. Cliquez pour passer à N.', a.kind === 'N' ? 'N (non-stored): the output is 1 only while the step is active and drops on leaving it. Click to switch to S.' : a.kind === 'S' ? 'S (set): the output goes to 1 when the step becomes active and stays there after leaving it, until an R action. Click to switch to R.' : 'R (reset): the output goes back to 0 when the step becomes active and stays there. Click to switch to N.')}>{a.kind}</button>
                    <Slot className="gf-var" accept={(p) => p.k === 'var'} onDrop={(p) => p.k === 'var' && change(E.setStep(prog, s.id, { actions: s.actions.map((x, j) => (j === k ? { ...x, var: p.name } : x)) }))}>
                      <Inline value={a.var} list="plc-vars" placeholder="Q0.0" title={T(lang, 'Sortie commandée par l’étape : cliquez pour la saisir ou glissez-en une depuis la liste', 'Output driven by the step: click to type it or drag one from the list')} onCommit={(v) => change(E.setStep(prog, s.id, { actions: s.actions.map((x, j) => (j === k ? { ...x, var: v } : x)) }))} />
                    </Slot>
                    <button className="x" onClick={() => change(E.setStep(prog, s.id, { actions: s.actions.filter((_, j) => j !== k) }))} aria-label={T(lang, 'Retirer l’action', 'Remove action')}>✕</button>
                  </span>
                ))}
                <button className="gf-addact" onClick={() => change(E.addAction(prog, s.id, { kind: 'N', var: '' }))} data-tip={T(lang, 'Ajouter une action (ou glissez une sortie sur l’étape)', 'Add an action (or drag an output onto the step)')}>＋ {T(lang, 'action', 'action')}</button>
              </div>
              <Inline className="gf-comment" title={T(lang, 'Commentaire libre sur le rôle de l’étape (ex. « A sort »)', 'Free comment on the step role (e.g. “A extends”)')} value={s.comment ?? ''} placeholder={T(lang, 'commentaire', 'comment')} onCommit={(v) => change(E.setStep(prog, s.id, { comment: v }), true)} />
              <Draggable payload={{ k: 'link', from: s.id }} className="gf-link" data-tip={T(lang, 'Glisser sur une autre étape pour créer une transition (boucle, saut, alternative)', 'Drag onto another step to create a transition (loop, jump, branch)')} click={false}>↳</Draggable>
              <button className="x" onClick={() => change(E.deleteStep(prog, s.id))} data-tip={T(lang, 'Supprimer l’étape', 'Delete the step')} aria-label={T(lang, 'Supprimer l’étape', 'Delete the step')}>🗑</button>
            </Slot>
            {i + 1 < n && (
              ti >= 0 ? (
                <div className={`gf-tr${fires(ti) ? ' fire' : ''}`}>
                  <span className="bar" />
                  {condField(ti)}
                  <button className="x" onClick={() => change({ ...prog, transitions: prog.transitions.filter((_, k) => k !== ti) })} aria-label={T(lang, 'Supprimer la transition', 'Delete transition')}>✕</button>
                </div>
              ) : (
                <div className="gf-tr missing"><span className="bar dashed" /><button className="mini" onClick={() => change(E.addTransition(prog, s.id, steps[i + 1].id))}>＋ {T(lang, 'transition', 'transition')}</button></div>
              )
            )}
            {others.filter(({ t }) => Math.min(...t.from, 999) === s.id).map(({ t, i: k }) => (
              <div key={k} className={`gf-jump${fires(k) ? ' fire' : ''}`}>
                <span className="arrow">↳</span>
                <span className="lbl">{t.from.join(',')} → {t.to.join(',') || '?'}</span>
                {condField(k)}
                <Inline className="gf-dest" value={t.to.join(',')} placeholder="0" onCommit={(v) => change(E.setTransition(prog, k, { to: v.split(/[\s,;]+/).map(Number).filter((x) => Number.isFinite(x) && steps.some((st) => st.id === x)) }))} data-tip={T(lang, 'Étape(s) d’arrivée (plusieurs séparées par des virgules : parallélisme)', 'Target step(s) (comma-separated for parallel branches)')} />
                <button className="x" onClick={() => change({ ...prog, transitions: prog.transitions.filter((_, j) => j !== k) })} aria-label={T(lang, 'Supprimer la transition', 'Delete transition')}>✕</button>
              </div>
            ))}
            {i + 1 < n && insertSlot(i + 1)}
          </div>
        )
      })}
      {insertSlot(n)}
      <div className="gf-foot">
        {!prog.transitions.some((t) => t.from.includes(steps[n - 1].id)) && n > 1 && (
          <button className="mini" onClick={() => change(E.addTransition(prog, steps[n - 1].id, (steps.find((s) => s.init) ?? steps[0]).id))}>↺ {T(lang, 'Fermer le cycle (retour à l’étape initiale)', 'Close the cycle (back to the initial step)')}</button>
        )}
        <button className="mini" onClick={() => setArmed({ k: 'tool', tool: 'step' })}>＋ {T(lang, 'Étape (choisir puis cliquer un emplacement)', 'Step (pick, then click a spot)')}</button>
      </div>
    </div>
  )
}

// ───────────────────────── langage à contacts

function LadderEditor({ prog, live, lang, change }: { prog: PlcProgram; live: PlcState | undefined; lang: Lang; change: (p: PlcProgram, d?: boolean) => void }) {
  const { setArmed } = useContext(DndCtx)
  const setRung = (i: number, r: PlcRung) => change({ ...prog, ladder: prog.ladder.map((x, k) => (k === i ? r : x)) })
  const conducts = (c: PlcContact) => (c.var ? varValue(prog, live, c.var) !== !!c.neg : true)
  const rungOn = (r: PlcRung) => (r.branches.length === 0 ? true : r.branches.some((b) => b.every(conducts)))
  const isContactTool = (p: Payload) => (p.k === 'tool' && (p.tool === 'contactNO' || p.tool === 'contactNC')) || p.k === 'var'
  const toContact = (p: Payload): PlcContact => (p.k === 'var' ? { var: p.name } : { var: '', neg: p.k === 'tool' && p.tool === 'contactNC' ? true : undefined })
  const coilTool = (p: Payload) => (p.k === 'tool' && (p.tool === 'coil' || p.tool === 'set' || p.tool === 'reset' || p.tool === 'ton')) || p.k === 'var'
  const kindOf = (t: Tool): E.CoilKind => (t === 'set' ? 'S' : t === 'reset' ? 'R' : t === 'ton' ? 'TON' : '=')
  const rungSlot = (index: number) => (
    <Slot key={`rs${index}`} className="ld-rslot" accept={(p) => (p.k === 'tool' && p.tool === 'rung') || p.k === 'rung' || p.k === 'var' || isContactTool(p)}
      onDrop={(p) => {
        if (p.k === 'rung') change({ ...prog, ladder: E.moveItem(prog.ladder, p.i, index) })
        else if (p.k === 'tool' && p.tool === 'rung') change({ ...prog, ladder: [...prog.ladder.slice(0, index), E.newRung(), ...prog.ladder.slice(index)] })
        else change({ ...prog, ladder: [...prog.ladder.slice(0, index), E.newRung(toContact(p)), ...prog.ladder.slice(index)] })
      }}>
      <button className="gf-plus" onClick={(e) => { e.stopPropagation(); change({ ...prog, ladder: [...prog.ladder.slice(0, index), E.newRung(), ...prog.ladder.slice(index)] }) }} data-tip={T(lang, 'Insérer un réseau ici', 'Insert a rung here')}>＋</button>
    </Slot>
  )

  if (!prog.ladder.length) {
    return (
      <div className="pe-empty">
        <p>{T(lang, 'Aucun réseau Ladder.', 'No ladder rung.')}</p>
        <Slot className="gf-first" accept={(p) => isContactTool(p) || (p.k === 'tool' && p.tool === 'rung')} onDrop={(p) => change({ ...prog, ladder: [p.k === 'tool' && p.tool === 'rung' ? E.newRung() : E.newRung(toContact(p))] })}>
          <button className="primary" onClick={() => change({ ...prog, ladder: [E.newRung()] })}>＋ {T(lang, 'Créer un réseau', 'Create a rung')}</button>
        </Slot>
        <p className="muted small">{T(lang, 'Glissez un contact ou une variable ici, ou cliquez sur le bouton.', 'Drag a contact or a variable here, or click the button.')}</p>
      </div>
    )
  }

  return (
    <div className="ld">
      {rungSlot(0)}
      {prog.ladder.map((r, i) => {
        const on = !!live && rungOn(r)
        const contactSlot = (bi: number, at: number) => (
          <Slot className="cslot" accept={isContactTool} onDrop={(p) => setRung(i, E.insertContact(r, bi, at, toContact(p)))}>
            <button className="gf-plus" onClick={(e) => { e.stopPropagation(); setRung(i, E.insertContact(r, bi, at, { var: '' })) }} aria-label={T(lang, 'Insérer un contact', 'Insert a contact')} data-tip={T(lang, 'Insérer un contact', 'Insert a contact')}>＋</button>
          </Slot>
        )
        return (
          <div key={i} className="ld-block">
            <div className={`rung${on ? ' on' : ''}`}>
              <div className="rung-head">
                <Draggable payload={{ k: 'rung', i }} className="gf-grip" click={false} data-tip={T(lang, 'Glisser pour déplacer le réseau', 'Drag to move the rung')}>⠿</Draggable>
                <b>{i + 1}</b>
                <Inline className="gf-comment" value={r.comment ?? ''} placeholder={T(lang, 'commentaire du réseau', 'rung comment')} onCommit={(v) => setRung(i, { ...r, comment: v })} />
                <span className="grow" />
                <button className="x" onClick={() => change({ ...prog, ladder: prog.ladder.filter((_, k) => k !== i) })} aria-label={T(lang, 'Supprimer le réseau', 'Delete rung')}>🗑</button>
              </div>
              <div className="rung-body">
                <div className="rail" />
                <div className={`branches${r.branches.length > 1 ? ' multi' : ''}`}>
                  {r.branches.map((br, bi) => (
                    <div key={bi} className="branch">
                      {contactSlot(bi, 0)}
                      {br.map((c, ci) => (
                        <div key={ci} className="ctw">
                          <div className={`contact${conducts(c) && live ? ' on' : ''}`}>
                            <Slot className="cvar" accept={(p) => p.k === 'var'} onDrop={(p) => p.k === 'var' && setRung(i, E.setContact(r, bi, ci, { var: p.name }))}>
                              <Inline value={c.var} list="plc-vars" placeholder="I0.0" title={T(lang, 'Variable testée par ce contact : cliquez pour la saisir ou glissez-en une depuis la liste', 'Variable tested by this contact: click to type it or drag one from the list')} onCommit={(v) => setRung(i, E.setContact(r, bi, ci, { var: v }))} />
                            </Slot>
                            <button className="sym" onClick={() => setRung(i, E.setContact(r, bi, ci, { neg: c.neg ? undefined : true }))} data-tip={T(lang, c.neg ? 'Contact repos fermé (cliquez pour inverser)' : 'Contact repos ouvert (cliquez pour inverser)', c.neg ? 'Normally closed (click to toggle)' : 'Normally open (click to toggle)')}>
                              <svg width="44" height="26" viewBox="0 0 44 26"><path d="M0 13H13M13 3V23M31 3V23M31 13H44" />{c.neg && <path d="M12 21L32 5" />}</svg>
                            </button>
                            <button className="x" onClick={() => setRung(i, E.removeContact(r, bi, ci))} aria-label={T(lang, 'Retirer le contact', 'Remove contact')}>✕</button>
                          </div>
                          {contactSlot(bi, ci + 1)}
                        </div>
                      ))}
                    </div>
                  ))}
                  <Slot className="branch-new" accept={isContactTool} onDrop={(p) => setRung(i, E.insertContact(r, r.branches.length, 0, toContact(p)))}>
                    <button className="mini" onClick={() => setRung(i, E.insertContact(r, r.branches.length, 0, { var: '' }))}>＋ {T(lang, 'ligne en parallèle (OU)', 'parallel line (OR)')}</button>
                  </Slot>
                </div>
                <Slot className={`coilbox${live && on && r.coil.kind === '=' ? ' on' : ''}`} accept={coilTool} onDrop={(p) => (p.k === 'var' ? setRung(i, E.setCoil(r, { var: p.name })) : p.k === 'tool' && setRung(i, E.setCoil(r, { kind: kindOf(p.tool) })))}>
                  <button className="ckind" onClick={() => setRung(i, E.setCoil(r, { kind: r.coil.kind === '=' ? 'S' : r.coil.kind === 'S' ? 'R' : r.coil.kind === 'R' ? 'TON' : '=' }))} data-tip={T(lang, 'Type de bobine (cliquez pour changer) : normale, mise à 1, mise à 0, temporisation', 'Coil type (click to change): normal, set, reset, timer')}>
                    {r.coil.kind === 'TON' ? <b>TON</b> : <svg width="40" height="26" viewBox="0 0 40 26"><path d="M0 13H11M29 13H40" /><circle cx="20" cy="13" r="9" fill="none" />{r.coil.kind !== '=' && <text x="20" y="17" fontSize="11" textAnchor="middle" stroke="none" fill="currentColor">{r.coil.kind}</text>}</svg>}
                  </button>
                  <Inline value={r.coil.var} list="plc-vars" placeholder={r.coil.kind === 'TON' ? 'T1' : 'Q0.0'} title={T(lang, 'Variable commandée par ce réseau : une sortie (Q0.x), un mémento (M0…) ou un temporisateur (T1…)', 'Variable driven by this rung: an output (Q0.x), a marker (M0…) or a timer (T1…)')} onCommit={(v) => setRung(i, E.setCoil(r, { var: v }))} />
                  {r.coil.kind === 'TON' && (
                    <label className="small preset">{T(lang, 'durée', 'preset')} <input type="number" min={0} step={0.5} value={(r.coil.preset ?? 2000) / 1000} onChange={(e) => setRung(i, E.setCoil(r, { preset: Math.max(0, Number(e.target.value)) * 1000 }))} /> s</label>
                  )}
                </Slot>
                <div className="rail r" />
              </div>
            </div>
            {rungSlot(i + 1)}
          </div>
        )

      })}
      <div className="gf-foot"><button className="mini" onClick={() => setArmed({ k: 'tool', tool: 'contactNO' })}>＋ {T(lang, 'Contact (choisir puis cliquer un emplacement)', 'Contact (pick, then click a spot)')}</button></div>
    </div>
  )
}
