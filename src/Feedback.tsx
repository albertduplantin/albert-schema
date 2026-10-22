import { useEffect, useRef, useState } from 'react'
import type { Doc, Lang } from './types'
import { tr, type Key } from './i18n'

declare const __BUILD__: string

const DRAFT = 'albertschema.feedback.draft'
const REPO = 'https://github.com/albertduplantin/albert-schema'
const KINDS = ['bug', 'idea', 'question'] as const
type Kind = (typeof KINDS)[number]

interface Draft {
  type: Kind
  title: string
  message: string
  email: string
}

const emptyDraft = (): Draft => ({ type: 'bug', title: '', message: '', email: '' })

function loadDraft(): Draft {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT) || 'null') as Partial<Draft> | null
    if (d) return { ...emptyDraft(), ...d, type: KINDS.includes(d.type as Kind) ? (d.type as Kind) : 'bug' }
  } catch { /* brouillon illisible : on repart de zéro */ }
  return emptyDraft()
}

/** Informations techniques jointes à chaque retour (jamais le contenu du schéma, sauf case cochée). */
function techInfo(doc: Doc, lang: Lang) {
  return {
    build: typeof __BUILD__ !== 'undefined' ? __BUILD__ : 'dev',
    lang,
    ua: navigator.userAgent,
    screen: `${window.innerWidth}x${window.innerHeight}`,
    symbols: doc.symbols.length,
    wires: doc.wires.length,
  }
}

interface Props {
  doc: Doc
  lang: Lang
  onClose: () => void
}

type Status = { kind: 'idle' } | { kind: 'sending' } | { kind: 'done'; id: string } | { kind: 'error'; reason: 'rate' | 'down' | 'net' | 'invalid' }

export default function Feedback({ doc, lang, onClose }: Props) {
  const t = (k: Key) => tr(lang, k)
  const [draft, setDraft] = useState<Draft>(loadDraft)
  const [attach, setAttach] = useState(false)
  const [showTech, setShowTech] = useState(false)
  const [website, setWebsite] = useState('') // champ piège anti-robots : invisible, doit rester vide
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const titleRef = useRef<HTMLInputElement>(null)
  const info = techInfo(doc, lang)

  useEffect(() => titleRef.current?.focus(), [])
  useEffect(() => {
    try { localStorage.setItem(DRAFT, JSON.stringify(draft)) } catch { /* ignoré */ }
  }, [draft])

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }))
  const valid = draft.title.trim().length >= 3 && draft.message.trim().length >= 10 && (!draft.email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.trim()))
  const sending = status.kind === 'sending'

  const issueUrl = () => {
    const body = `${draft.message.trim()}\n\n---\n${t('fbTech')} : ${info.build} · ${info.lang} · ${info.screen} · ${info.ua}`
    return `${REPO}/issues/new?title=${encodeURIComponent(draft.title.trim())}&body=${encodeURIComponent(body)}`
  }

  const submit = async () => {
    if (!valid || sending) return
    setStatus({ kind: 'sending' })
    try {
      const r = await fetch(import.meta.env.BASE_URL + 'api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: draft.type, title: draft.title, message: draft.message, email: draft.email,
          website, includeDoc: attach, ...(attach ? { doc: JSON.stringify(doc) } : {}), meta: info,
        }),
      })
      if (r.ok) {
        const d = (await r.json()) as { id?: string }
        try { localStorage.removeItem(DRAFT) } catch { /* ignoré */ }
        setDraft(emptyDraft())
        setStatus({ kind: 'done', id: d.id ?? '' })
      } else {
        setStatus({ kind: 'error', reason: r.status === 429 ? 'rate' : r.status === 400 || r.status === 413 ? 'invalid' : 'down' })
      }
    } catch {
      setStatus({ kind: 'error', reason: 'net' })
    }
  }

  const errorText = status.kind === 'error' ? t(({ rate: 'fbErrRate', down: 'fbErrDown', net: 'fbErrNet', invalid: 'fbErrInvalid' } as const)[status.reason]) : ''

  return (
    <div className="modal" onMouseDown={onClose}>
      <div className="dialog feedback" role="dialog" aria-modal="true" aria-labelledby="fb-title"
        onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }}>
        <h3 id="fb-title">{t('feedbackTitle')}</h3>

        {status.kind === 'done' ? (
          <>
            <p className="fb-ok" role="status">✓ {t('fbThanks')}{status.id ? ` (${t('fbRef')} ${status.id})` : ''}</p>
            <div className="actions"><button className="on" onClick={onClose}>{t('close')}</button></div>
          </>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); void submit() }} noValidate>
            <div className="fb-kinds" role="radiogroup" aria-label={t('fbType')}>
              {KINDS.map((k) => (
                <button type="button" key={k} role="radio" aria-checked={draft.type === k} className={draft.type === k ? 'on' : ''} onClick={() => set('type', k)}>
                  {t(({ bug: 'fbBug', idea: 'fbIdea', question: 'fbQuestion' } as const)[k])}
                </button>
              ))}
            </div>

            <label className="fb-field">{t('fbSubject')}
              <input ref={titleRef} value={draft.title} maxLength={120} required onChange={(e) => set('title', e.target.value)}
                placeholder={t(draft.type === 'bug' ? 'fbSubjectBug' : 'fbSubjectIdea')} />
            </label>
            <label className="fb-field">{t('fbMessage')}
              <textarea rows={6} value={draft.message} maxLength={4000} required onChange={(e) => set('message', e.target.value)}
                placeholder={t(draft.type === 'bug' ? 'fbMessageBug' : 'fbMessageIdea')} />
              <small className="muted">{draft.message.length} / 4000{draft.message.trim().length < 10 ? ` · ${t('fbMin')}` : ''}</small>
            </label>
            <label className="fb-field">{t('fbEmail')}
              <input type="email" value={draft.email} maxLength={200} onChange={(e) => set('email', e.target.value)} placeholder="nom@exemple.fr" />
              <small className="muted">{t('fbEmailHelp')}</small>
            </label>

            <label className="fb-check">
              <input type="checkbox" checked={attach} onChange={(e) => setAttach(e.target.checked)} />
              <span>{t('fbAttach')} <small className="muted">({doc.symbols.length} {t('fbSymbols')}, {doc.wires.length} {t('wires').toLowerCase()}) — {t('fbAttachHelp')}</small></span>
            </label>

            <div className="fb-trap" aria-hidden="true">
              <label>Website<input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} /></label>
            </div>

            <button type="button" className="link" onClick={() => setShowTech((v) => !v)} aria-expanded={showTech}>{showTech ? '▾' : '▸'} {t('fbTech')}</button>
            {showTech && (
              <pre className="fb-tech">{`build: ${info.build}\nlang: ${info.lang}\nécran: ${info.screen}\nsymboles: ${info.symbols} · conducteurs: ${info.wires}\n${info.ua}`}</pre>
            )}

            <p className="muted small">{t('fbPrivacy')}</p>
            {status.kind === 'error' && (
              <div className="alert" role="alert">{errorText} <a href={issueUrl()} target="_blank" rel="noreferrer">{t('fbGithub')}</a></div>
            )}
            <div className="actions fb-actions">
              <a className="link" href={issueUrl()} target="_blank" rel="noreferrer">{t('fbGithub')}</a>
              <span className="grow" />
              <button type="button" onClick={onClose}>{t('fbCancel')}</button>
              <button type="submit" className="on" disabled={!valid || sending}>{sending ? t('fbSending') : t('fbSend')}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
