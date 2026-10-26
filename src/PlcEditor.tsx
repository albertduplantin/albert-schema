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

import { Draggable, DndCtx, Inline, Slot, T, type Payload, type Tool } from './plcUi'
import GrafcetView from './GrafcetView'
import * as G from './grafcet'

// ───────────────────────── éditeur

export default function PlcEditor({ win, setWin, title, lang, program, live, onChange, onFocus, onClose }: Props) {
  const prog = program ?? emptyProgram()
  const [tab, setTab] = useState<'grafcet' | 'ladder' | 'vars'>('grafcet')
  const [drag, setDrag] = useState<Payload | null>(null)
  const [armed, setArmed] = useState<Payload | null>(null)
  const [quick, setQuick] = useState('A+ B+ A- B-')
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
          <h4>{T(lang, 'Grafcet', 'Grafcet')}</h4>
          <Draggable payload={{ k: 'tool', tool: 'step' }} className="tool" title={T(lang, 'Étape : un état stable du cycle, pendant lequel la machine exécute ses actions. Déposez-la sur une transition (elle s’insère juste avant), ou sur le ＋ du haut pour une nouvelle étape initiale.', 'Step: a stable state of the cycle during which the machine performs its actions. Drop it on a transition (it is inserted before it), or on the top ＋ for a new initial step.')}><b className="mini-step">n</b> {T(lang, 'Étape', 'Step')}</Draggable>
          <Draggable payload={{ k: 'tool', tool: 'alt' }} className="tool" title={T(lang, 'Divergence en OU (sélection de séquence) : déposez-la sur une étape pour lui ajouter une branche alternative. Une seule branche sera suivie, celle dont la condition devient vraie en premier. Les branches se rejoignent par une convergence en OU.', 'OR divergence (sequence selection): drop it on a step to add an alternative branch. Only one branch is followed, the one whose condition becomes true first. Branches rejoin through an OR convergence.')}><svg width="30" height="18" viewBox="0 0 30 18"><path d="M15 0V4M5 4H25M5 4V18M25 4V18" /></svg> {T(lang, 'Alternative (OU)', 'Alternative (OR)')}</Draggable>
          <Draggable payload={{ k: 'tool', tool: 'par' }} className="tool" title={T(lang, 'Divergence en ET (parallélisme) : déposez-la sur une transition pour qu’elle active plusieurs étapes en même temps. La convergence en ET attend que toutes les branches soient terminées. Signalée par un trait double.', 'AND divergence (parallelism): drop it on a transition so that it activates several steps at once. The AND convergence waits for every branch to finish. Shown with a double line.')}><svg width="30" height="18" viewBox="0 0 30 18"><path d="M15 0V3M5 3H25M5 6H25M5 6V18M25 6V18" /></svg> {T(lang, 'Parallèle (ET)', 'Parallel (AND)')}</Draggable>
          <Draggable payload={{ k: 'tool', tool: 'time' }} className="tool" title={T(lang, 'Temporisation : déposez-la sur une transition pour ajouter « T(3s) » à sa condition (la transition n’est franchie que 3 secondes après l’activation de l’étape). Modifiez la durée dans la condition.', 'Delay: drop it on a transition to add “T(3s)” to its condition (the transition only fires 3 seconds after the step became active). Edit the duration in the condition.')}><b className="mini-ton">T</b> {T(lang, 'Temporisation', 'Delay')}</Draggable>
          <p className="muted small">{T(lang, 'Saut ou boucle : glissez le ↳ d’une étape sur une autre étape.', 'Jump or loop: drag the ↳ of a step onto another step.')}</p>
          <h4>{T(lang, 'Séquence rapide', 'Quick sequence')}</h4>
          <input className="pe-quick" value={quick} onChange={(e) => setQuick(e.target.value)} placeholder="A+ B+ A- B-" aria-label={T(lang, 'Séquence rapide', 'Quick sequence')}
            data-tip={T(lang, 'Écrivez les mouvements dans l’ordre : A+ (A sort), B- (B rentre). Entre parenthèses, des mouvements simultanés : (A+ B+). Les fins de course a1, a0, b1… et le départ « dcy » sont créés pour vous.', 'Write the movements in order: A+ (A extends), B- (B retracts). In parentheses, simultaneous movements: (A+ B+). The end sensors a1, a0, b1… and the start “dcy” are created for you.')} />
          <button className="mini" onClick={() => { if (!prog.steps.length || confirm(T(lang, 'Remplacer le Grafcet actuel ?', 'Replace the current Grafcet?'))) change(G.fromSequence(prog, quick)) }}>⚡ {T(lang, 'Générer le Grafcet', 'Generate the Grafcet')}</button>
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
            {tab === 'grafcet' && <GrafcetView prog={prog} live={live} lang={lang} change={change} />}
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
