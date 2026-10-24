import { useState } from 'react'
import type { Domain, Lang } from './types'
import { tr, type Key } from './i18n'
import { fillNames, type GExercise } from './guided'

interface PanelProps {
  ex: GExercise
  done: boolean[]
  /** pour chaque étape : ce qui manque encore (conseils) */
  missing: string[][]
  lang: Lang
  onClose: () => void
  onSolution: () => void
  onRestart: () => void
  onList: () => void
}

/** Panneau d'un exercice guidé : cahier des charges, étapes cochées automatiquement, indice de l'étape en cours. */
export function GuidedPanel({ ex, done, missing, lang, onClose, onSolution, onRestart, onList }: PanelProps) {
  const [brief, setBrief] = useState(true)
  const [hint, setHint] = useState<string | null>(null)
  const t = (k: Key) => tr(lang, k)
  const current = done.findIndex((d) => !d)
  const finished = current === -1 && done.length > 0
  return (
    <section className="guided" aria-label={t('guidedTitle')}>
      <div className="guided-head">
        <strong>{fillNames(ex.title[lang], lang)}</strong>
        <button className="icon" onClick={onClose} aria-label={t('close')} title={t('close')}>✕</button>
      </div>
      <p className="guided-meta">{'★'.repeat(ex.level)}{'☆'.repeat(3 - ex.level)} {t(('level' + ex.level) as Key)} · {ex.minutes} min · {done.filter(Boolean).length}/{done.length}</p>
      <button className="link guided-brief-toggle" aria-expanded={brief} onClick={() => setBrief(!brief)}>{brief ? '▾' : '▸'} {t('guidedBrief')}</button>
      {brief && (
        <div className="guided-brief">
          {ex.brief.map((b, i) => <p key={i}>{fillNames(b[lang], lang)}</p>)}
          <h4>{t('guidedParts')}</h4>
          <ul>{ex.parts.map((b, i) => <li key={i}>{fillNames(b[lang], lang)}</li>)}</ul>
          <h4>{t('guidedExpect')}</h4>
          <ol>{ex.expect.map((b, i) => <li key={i}>{fillNames(b[lang], lang)}</li>)}</ol>
        </div>
      )}
      <ol className="guided-steps">
        {ex.steps.map((st, i) => {
          const isCur = i === current
          return (
            <li key={st.id} className={(done[i] ? 'done ' : '') + (isCur ? 'cur' : '')}>
              <span className="num" aria-hidden="true">{done[i] ? '✓' : i + 1}</span>
              <div>
                <div className="stitle">{fillNames(st.title[lang], lang)}</div>
                {isCur && (missing[i]?.length ?? 0) > 0 && (
                  <div className="guided-missing" role="note"><strong>{t('guidedMissing')}</strong><ul>{missing[i].map((m, k) => <li key={k}>{fillNames(m, lang)}</li>)}</ul></div>
                )}
                {isCur && (
                  <>
                    <button className="link" onClick={() => setHint(hint === st.id ? null : st.id)}>{hint === st.id ? t('guidedHideHint') : t('guidedHint')}</button>
                    {hint === st.id && <p className="hint">{fillNames(st.hint[lang], lang)}</p>}
                  </>
                )}
              </div>
            </li>
          )
        })}
      </ol>
      {finished && <p className="guided-win" role="status">✓ {t('guidedWin')}</p>}
      <div className="guided-actions">
        <button className="link" onClick={onSolution}>{t('guidedSolution')}</button>
        <button className="link" onClick={onRestart}>{t('guidedRestart')}</button>
        <button className="link" onClick={onList}>{t('guidedOthers')}</button>
      </div>
    </section>
  )
}

interface ListProps {
  list: GExercise[]
  completed: string[]
  lang: Lang
  onStart: (ex: GExercise) => void
  onClose: () => void
}

const DOMAINS: Domain[] = ['electrical', 'pneumatic', 'hydraulic']

/** Liste des exercices guidés, filtrable par domaine et par niveau. */
export function GuidedList({ list, completed, lang, onStart, onClose }: ListProps) {
  const [domain, setDomain] = useState<Domain | 'all'>('all')
  const [level, setLevel] = useState<0 | 1 | 2 | 3>(0)
  const t = (k: Key) => tr(lang, k)
  const shown = list.filter((e) => (domain === 'all' || e.domain === domain) && (level === 0 || e.level === level))
  return (
    <div className="modal" onClick={onClose}>
      <div className="dialog wide guided-list" role="dialog" aria-label={t('guidedTitle')} onClick={(e) => e.stopPropagation()}>
        <h3>{t('guidedTitle')}</h3>
        <p className="muted">{t('guidedIntro')}</p>
        <div className="guided-filters">
          <div className="seg" role="group" aria-label={t('guidedDomain')}>
            {(['all', ...DOMAINS] as const).map((d) => (
              <button key={d} className={domain === d ? 'on' : ''} onClick={() => setDomain(d)}>{d === 'all' ? t('guidedAll') : t(d)}</button>
            ))}
          </div>
          <div className="seg" role="group" aria-label={t('guidedLevel')}>
            {([0, 1, 2, 3] as const).map((l) => (
              <button key={l} className={level === l ? 'on' : ''} onClick={() => setLevel(l)}>{l === 0 ? t('guidedAll') : t(('level' + l) as Key)}</button>
            ))}
          </div>
        </div>
        <div className="cards">
          {shown.map((ex) => (
            <div key={ex.id} className="card wide">
              <strong>{completed.includes(ex.id) ? '✓ ' : ''}{ex.title[lang]}</strong>
              <span className="lvl">{t(ex.domain)} · {'★'.repeat(ex.level)}{'☆'.repeat(3 - ex.level)} {t(('level' + ex.level) as Key)} · {ex.minutes} min</span>
              <p className="muted">{ex.summary[lang]}</p>
              <button onClick={() => onStart(ex)}>{completed.includes(ex.id) ? t('guidedRetry') : t('guidedStart')}</button>
            </div>
          ))}
          {shown.length === 0 && <p>{t('guidedNone')}</p>}
        </div>
        <div className="actions"><button onClick={onClose}>{t('close')}</button></div>
      </div>
    </div>
  )
}
