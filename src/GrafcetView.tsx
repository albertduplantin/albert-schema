import { Fragment, useContext, useMemo, type ReactNode } from 'react'
import type { Lang } from './types'
import { checkExpr, type PlcProgram, type PlcState } from './sim/plc'
import { liveCond } from './sim/plc'
import * as E from './plcEdit'
import * as G from './grafcet'
import { DndCtx, Draggable, Inline, Slot, T, type Payload } from './plcUi'

/**
 * Grafcet dessiné selon la norme : axe vertical, étapes carrées (double carré pour l'étape initiale), actions à droite,
 * transitions en barre avec leur réceptivité, divergences et convergences en OU (trait simple) ou en ET (trait double), renvois d'étape.
 * Tout se construit à la souris : on dépose un élément de la palette sur une étape ou une transition.
 */
interface Props { prog: PlcProgram; live: PlcState | undefined; lang: Lang; change: (p: PlcProgram, d?: boolean) => void }

export default function GrafcetView({ prog, live, lang, change }: Props) {
  const { setArmed } = useContext(DndCtx)
  const seqs = useMemo(() => G.parseGraph(prog), [prog])
  const fires = (i: number) => {
    const t = prog.transitions[i]
    return !!live && t.from.length > 0 && t.from.every((s) => live.steps.includes(s)) && liveCond(prog, live, t.cond)
  }

  const condField = (i: number) => {
    const t = prog.transitions[i]
    const err = checkExpr(t.cond)
    return (
      <Slot className="gf-cond" accept={(p) => p.k === 'var'} onDrop={(p, ev) => p.k === 'var' && change(E.setTransition(prog, i, { cond: E.appendCond(t.cond, p.name, ev.alt) }))}>
        <Inline value={t.cond} list="plc-vars" invalid={!!err} placeholder="a1 ET NON b0" onCommit={(v) => change(E.setTransition(prog, i, { cond: v }))} title={err ?? T(lang, 'Réceptivité de la transition : cliquez pour la modifier, ou glissez-y une variable', 'Transition condition: click to edit, or drag a variable onto it')} />
        {err && <span data-tip={err} className="gf-err">⚠</span>}
      </Slot>
    )
  }

  const stepNode = (id: number, key: string) => {
    const s = prog.steps.find((x) => x.id === id)
    if (!s) return null
    const active = !!live?.steps.includes(id)
    const act = (k: number, p: Partial<{ kind: 'N' | 'S' | 'R'; var: string }>) => change(E.setStep(prog, id, { actions: s.actions.map((x, j) => (j === k ? { ...x, ...p } : x)) }))
    return (
      <div key={key} className="gf-block gfg-stepw">
        <Slot className={`gf-step gfg-step${active ? ' active' : ''}`}
          accept={(p) => p.k === 'var' || (p.k === 'link' && p.from !== id) || (p.k === 'tool' && p.tool === 'alt')}
          onDrop={(p) => {
            if (p.k === 'var') change(E.addAction(prog, id, { kind: 'N', var: p.name }))
            else if (p.k === 'link') change(G.normalize(E.addTransition(prog, p.from, id)))
            else if (p.k === 'tool' && p.tool === 'alt') change(G.addAlternative(prog, id))
          }}>
          <span className="gfg-ctl">
            <Draggable payload={{ k: 'step', id }} className="gf-grip" click={false} title={T(lang, 'Étape ' + id, 'Step ' + id)}>⠿</Draggable>
            <Draggable payload={{ k: 'link', from: id }} className="gf-link" click={false} title={T(lang, 'Glisser sur une autre étape pour créer une transition (boucle, saut, alternative)', 'Drag onto another step to create a transition (loop, jump, branch)')}>↳</Draggable>
          </span>
          <button className={`gf-no gfg-no${s.init ? ' init' : ''}`} onClick={() => change(E.setInitial(prog, id, !s.init))} data-tip={T(lang, s.init ? 'Étape initiale (cliquez pour retirer)' : 'Cliquez pour en faire l’étape initiale', s.init ? 'Initial step (click to remove)' : 'Click to make it the initial step')}>{id}</button>
          <span className="gfg-side">
            <span className="gf-actions gfg-actions">
              {s.actions.map((a, k) => (
                <span key={k} className="gf-act">
                  <button className={`kind k${a.kind}`} onClick={() => act(k, { kind: a.kind === 'N' ? 'S' : a.kind === 'S' ? 'R' : 'N' })} data-tip={T(lang, a.kind === 'N' ? 'N (non mémorisée) : la sortie est à 1 uniquement tant que l’étape est active. Cliquez pour passer à S.' : a.kind === 'S' ? 'S (mise à 1 mémorisée) : la sortie reste à 1 après l’étape, jusqu’à une action R. Cliquez pour passer à R.' : 'R (remise à 0) : la sortie repasse à 0 et y reste. Cliquez pour passer à N.', a.kind === 'N' ? 'N (non-stored): the output is 1 only while the step is active. Click to switch to S.' : a.kind === 'S' ? 'S (set): the output stays at 1 after the step, until an R action. Click to switch to R.' : 'R (reset): the output goes back to 0 and stays there. Click to switch to N.')}>{a.kind}</button>
                  <Slot className="gf-var" accept={(p) => p.k === 'var'} onDrop={(p) => p.k === 'var' && act(k, { var: p.name })}>
                    <Inline value={a.var} list="plc-vars" placeholder="Q0.0" title={T(lang, 'Sortie commandée par l’étape', 'Output driven by the step')} onCommit={(v) => act(k, { var: v })} />
                  </Slot>
                  <button className="x" onClick={() => change(E.setStep(prog, id, { actions: s.actions.filter((_, j) => j !== k) }))} aria-label={T(lang, 'Retirer l’action', 'Remove action')}>✕</button>
                </span>
              ))}
              <button className="gf-addact" onClick={() => change(E.addAction(prog, id, { kind: 'N', var: '' }))} data-tip={T(lang, 'Ajouter une action (ou glissez une sortie sur l’étape)', 'Add an action (or drag an output onto the step)')}>＋ {T(lang, 'action', 'action')}</button>
            </span>
            <Inline className="gf-comment" title={T(lang, 'Commentaire libre sur le rôle de l’étape (ex. « A sort »)', 'Free comment on the step role (e.g. “A extends”)')} value={s.comment ?? ''} placeholder={T(lang, 'commentaire', 'comment')} onCommit={(v) => change(E.setStep(prog, id, { comment: v }), true)} />
            <button className="x gfg-del" onClick={() => change(G.removeStep(prog, id))} data-tip={T(lang, 'Supprimer l’étape', 'Delete the step')} aria-label={T(lang, 'Supprimer l’étape', 'Delete the step')}>🗑</button>
          </span>
        </Slot>
      </div>
    )
  }

  const trNode = (i: number, key: string) => {
    const t = prog.transitions[i]
    const acceptTr = (p: Payload) => p.k === 'var' || (p.k === 'tool' && ((p.tool === 'step' && t.to.length > 0) || (p.tool === 'par' && t.from.length === 1 && t.to.length > 0) || p.tool === 'time')) || p.k === 'step'
    return (
      <Slot key={key} className={`gf-trw gfg-trw${fires(i) ? ' fire' : ''}`} accept={acceptTr}
        onDrop={(p, ev) => {
          if (p.k === 'var') change(E.setTransition(prog, i, { cond: E.appendCond(t.cond, p.name, ev.alt) }))
          else if (p.k === 'step') return
          else if (p.k === 'tool' && p.tool === 'step') change(G.splitTransition(prog, i))
          else if (p.k === 'tool' && p.tool === 'par') change(G.addParallel(prog, i))
          else if (p.k === 'tool' && p.tool === 'time') change(E.setTransition(prog, i, { cond: E.appendCond(t.cond, 'T(3s)') }))
        }}>
        <span className="gfg-trl">
          <button className="gf-plus" onClick={(e) => { e.stopPropagation(); change(G.splitTransition(prog, i)) }} data-tip={T(lang, 'Insérer une étape ici', 'Insert a step here')} aria-label={T(lang, 'Insérer une étape ici', 'Insert a step here')}>＋</button>
        </span>
        <span className={`bar${t.from.length > 1 || t.to.length > 1 ? ' multi' : ''}`} />
        <span className="gfg-trr">
          {condField(i)}
          <button className="x" onClick={() => change(G.removeTransition(prog, i))} aria-label={T(lang, 'Supprimer la transition', 'Delete transition')}>✕</button>
        </span>
      </Slot>
    )
  }

  const renderSeq = (nodes: GNode[], path: string, closeEnd = false): ReactNode => {
    const out: ReactNode[] = []
    nodes.forEach((n, k) => {
      const key = `${path}.${k}`
      if (n.k === 'step') out.push(stepNode(n.id, key))
      else if (n.k === 'tr') out.push(trNode(n.i, key))
      else if (n.k === 'jump') out.push(<div key={key} className="gfg-jump"><span className="arrow">▼</span> {T(lang, 'étape', 'step')} {n.to}</div>)
      else {
        const isAnd = n.k === 'and'
        const merging = (b: GNode[]) => (isAnd ? n.k === 'and' && n.join !== null : n.k === 'or' && n.merge !== null && !b.some((x) => x.k === 'jump') && b.length > 0)
        out.push(
          <div key={key} className={`gfg-blk ${isAnd ? 'and' : 'or'}`}>
            <div className="gfg-brs">
              {n.branches.map((b, bi) => (
                <div key={bi} className={`gfg-br${merging(b) ? ' m' : ''}`}>
                  <div className="gfg-v" />
                  {renderSeq(b, `${key}.${bi}`)}
                  {merging(b) && <div className="gfg-v" />}
                </div>
              ))}
            </div>
            {isAnd && (
              <button className="gfg-addbr" onClick={() => { const j = n.k === 'and' ? n.join : null; void j; const first = (n.branches[0][0] as { id?: number } | undefined)?.id; const t = prog.transitions.findIndex((x) => first !== undefined && x.to.includes(first) && x.from.length === 1); if (t >= 0) change(G.addParallel(prog, t)) }} data-tip={T(lang, 'Ajouter une branche parallèle', 'Add a parallel branch')}>＋ {T(lang, 'branche', 'branch')}</button>
            )}
            {!isAnd && n.k === 'or' && (
              <button className="gfg-addbr" onClick={() => { const from = prog.transitions[(n.branches[0][0] as { i?: number } | undefined)?.i ?? -1]?.from[0]; if (from !== undefined) change(G.addAlternative(prog, from)) }} data-tip={T(lang, 'Ajouter une branche alternative', 'Add an alternative branch')}>＋ {T(lang, 'alternative', 'alternative')}</button>
            )}
          </div>,
        )
      }
      // trait de liaison entre deux éléments consécutifs
      if (k < nodes.length - 1 && n.k !== 'jump') out.push(<div key={key + 'v'} className="gfg-v" />)
    })
    return <div className="gfg-seq">{out}</div>
  }

  if (!prog.steps.length) {
    return (
      <div className="pe-empty">
        <p>{T(lang, 'Le Grafcet est vide.', 'The Grafcet is empty.')}</p>
        <Slot className="gf-first" accept={(p) => (p.k === 'tool' && p.tool === 'step') || p.k === 'step'} onDrop={() => change(G.insertAtStart(prog))}>
          <button className="primary" onClick={() => change(G.insertAtStart(prog))}>＋ {T(lang, 'Créer l’étape initiale', 'Create the initial step')}</button>
        </Slot>
        <p className="muted small">{T(lang, 'Glissez l’élément « Étape » ici, ou saisissez une séquence rapide (ex. A+ B+ A- B-) dans la palette de gauche.', 'Drag the “Step” element here, or type a quick sequence (e.g. A+ B+ A- B-) in the left palette.')}</p>
      </div>
    )
  }

  return (
    <div className="gf gfg">
      <p className="gf-legend muted small" data-tip={T(lang, 'N, S et R sont les types d’actions du Grafcet. Cliquez sur la lettre d’une action pour en changer.', 'N, S and R are the Grafcet action types. Click an action letter to change it.')}>
        <b>N</b> {T(lang, 'tant que l’étape est active', 'while the step is active')} · <b>S</b> {T(lang, 'mise à 1 mémorisée', 'latched set')} · <b>R</b> {T(lang, 'remise à 0', 'reset')} — {T(lang, 'survolez une lettre pour le détail', 'hover a letter for details')}
      </p>
      <Slot className="gf-slot" accept={(p) => (p.k === 'tool' && p.tool === 'step') || p.k === 'step'} onDrop={() => change(G.insertAtStart(prog))} label={T(lang, 'Insérer une étape en tête', 'Insert a step at the top')}>
        <button className="gf-plus" onClick={(e) => { e.stopPropagation(); change(G.insertAtStart(prog)) }} data-tip={T(lang, 'Insérer une étape initiale en tête', 'Insert a new initial step at the top')} aria-label={T(lang, 'Insérer une étape en tête', 'Insert a step at the top')}>＋</button>
      </Slot>
      {seqs.map((nodes, k) => (
        <Fragment key={k}>
          {renderSeq(nodes, 's' + k)}
          {(() => {
            const last = nodes[nodes.length - 1]
            if (last?.k === 'step' && !prog.transitions.some((t) => t.from.includes(last.id))) {
              return (
                <div className="gf-foot">
                  <button className="mini" onClick={() => change(G.appendStep(prog, last.id))}>＋ {T(lang, 'étape à la suite', 'next step')}</button>
                  {prog.steps.length > 1 && <button className="mini" onClick={() => change(E.addTransition(prog, last.id, (prog.steps.find((s) => s.init) ?? prog.steps[0]).id))}>↺ {T(lang, 'Fermer le cycle (retour à l’étape initiale)', 'Close the cycle (back to the initial step)')}</button>}
                </div>
              )
            }
            return null
          })()}
        </Fragment>
      ))}
      <div className="gf-foot"><button className="mini" onClick={() => setArmed({ k: 'tool', tool: 'step' })}>＋ {T(lang, 'Étape (choisir puis cliquer un emplacement)', 'Step (pick, then click a spot)')}</button></div>
    </div>
  )
}

type GNode = import('./grafcet').GNode
