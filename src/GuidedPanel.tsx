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
  onLink: () => void
}

/** Panneau d'un exercice guidé : cahier des charges, étapes cochées automatiquement, indice de l'étape en cours. */
export function GuidedPanel({ ex, done, missing, lang, onClose, onSolution, onRestart, onList, onLink }: PanelProps) {
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
        <button className="link" onClick={onLink}>🔗 {lang === 'fr' ? 'Copier le lien de l’exercice' : 'Copy exercise link'}</button>
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
  classCode: string
  pseudo: string
  onClass: (code: string, pseudo: string) => void
}

const DOMAINS: Domain[] = ['electrical', 'pneumatic', 'hydraulic']

/** Liste des exercices guidés, filtrable par domaine et par niveau. */
/** Suivi de classe : code partagé par l'enseignant et pseudonyme de l'élève ; tableau des exercices terminés par élève. */
function ClassBox({ lang, classCode, pseudo, onClass, list }: Pick<ListProps, 'lang' | 'classCode' | 'pseudo' | 'onClass' | 'list'>) {
  const fr = lang === 'fr'
  const [code, setCode] = useState(classCode)
  const [name, setName] = useState(pseudo)
  const [rows, setRows] = useState<Record<string, Record<string, number>> | null>(null)
  const [err, setErr] = useState(false)
  const load = async () => {
    setErr(false)
    try {
      const r = await fetch('/api/classroom?code=' + encodeURIComponent(code.trim()))
      if (!r.ok) throw new Error('x')
      setRows((await r.json()).students)
    } catch { setRows(null); setErr(true) }
  }
  const valid = /^[A-Za-z0-9-]{3,24}$/.test(code.trim())
  return (
    <details className="class-box">
      <summary>{fr ? 'Suivi de classe (optionnel)' : 'Class tracking (optional)'}{classCode ? ` — ${classCode}` : ''}</summary>
      <p className="muted small">{fr ? 'L’enseignant choisit un code (3 à 24 lettres, chiffres ou tirets) et le donne à la classe. Chaque élève saisit le code et un pseudonyme (pas de nom réel) : ses exercices terminés apparaissent dans le tableau. Aucun compte.' : 'The teacher picks a code (3 to 24 letters, digits or dashes) and gives it to the class. Each student enters the code and a nickname (no real name): completed exercises appear in the table. No account.'}</p>
      <div className="class-fields">
        <label>{fr ? 'Code de classe' : 'Class code'}<input value={code} maxLength={24} onChange={(e) => setCode(e.target.value)} /></label>
        <label>{fr ? 'Pseudonyme' : 'Nickname'}<input value={name} maxLength={30} onChange={(e) => setName(e.target.value)} /></label>
        <button disabled={!valid} onClick={() => { onClass(code.trim(), name.trim()); void load() }}>{fr ? 'Enregistrer et voir la classe' : 'Save and view class'}</button>
        {classCode && <button className="link" onClick={() => { setCode(''); onClass('', name.trim()); setRows(null) }}>{fr ? 'Quitter la classe' : 'Leave class'}</button>}
      </div>
      {err && <p className="muted small">{fr ? 'Suivi indisponible pour le moment.' : 'Tracking is unavailable right now.'}</p>}
      {rows && (
        <div className="class-table">
          <table>
            <thead><tr><th>{fr ? 'Élève' : 'Student'}</th><th>{fr ? 'Terminés' : 'Done'}</th><th>{fr ? 'Exercices' : 'Exercises'}</th></tr></thead>
            <tbody>
              {Object.entries(rows).sort((a, b) => a[0].localeCompare(b[0])).map(([who, ex]) => (
                <tr key={who}><td>{who}</td><td>{Object.keys(ex).length}/{list.length}</td><td>{Object.keys(ex).map((id) => list.find((l) => l.id === id)?.title[lang] ?? id).join(' · ')}</td></tr>
              ))}
              {Object.keys(rows).length === 0 && <tr><td colSpan={3}>{fr ? 'Aucun exercice terminé pour l’instant.' : 'No exercise completed yet.'}</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </details>
  )
}

export function GuidedList({ list, completed, lang, onStart, onClose, classCode, pseudo, onClass }: ListProps) {
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
        <ClassBox lang={lang} classCode={classCode} pseudo={pseudo} onClass={onClass} list={list} />
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
