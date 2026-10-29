import { useCallback, useEffect, useMemo, useState } from 'react'
import Examples from './Examples'
import Exos from './Exos'

type Kind = 'bug' | 'idea' | 'question'
type Status = 'new' | 'read' | 'done' | 'spam'

interface Item {
  id: string
  ts: string
  type: Kind
  title: string
  message: string
  email?: string
  meta: { build?: string; lang?: string; ua?: string; screen?: string; symbols?: number; wires?: number }
  hasDoc: boolean
  status: Status
  note: string
  /** date à laquelle l'auteur a été prévenu par e-mail */
  mailed?: string
}

const KEY = 'albertschema.admin'
const ENDPOINT = import.meta.env.BASE_URL + 'api/admin'
const KIND_LABEL: Record<Kind, string> = { bug: 'Bug', idea: 'Amélioration', question: 'Question' }
const STATUS_LABEL: Record<Status, string> = { new: 'Nouveau', read: 'Lu', done: 'Traité', spam: 'Indésirable' }

class ApiError extends Error {
  constructor(public status: number) {
    super('api ' + status)
  }
}

async function api(token: string, query: string, body?: unknown): Promise<Response> {
  const r = await fetch(`${ENDPOINT}${query}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  if (!r.ok) throw new ApiError(r.status)
  return r
}

/** Protège les tableurs contre l'injection de formules : une cellule commençant par = + - @ est préfixée d'une apostrophe. */
const csvCell = (v: unknown) => {
  let s = String(v ?? '')
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s
  return `"${s.replace(/"/g, '""')}"`
}

function download(name: string, blob: Blob) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

/** Message prêt à envoyer à l'auteur d'un retour (dans sa langue), pour le prévenir que sa demande est prise en compte ou traitée. */
function reply(it: Item, kind: 'seen' | 'done'): { subject: string; body: string } {
  const en = it.meta.lang === 'en'
  const what = it.type === 'bug' ? (en ? 'bug report' : 'signalement') : it.type === 'idea' ? (en ? 'suggestion' : 'demande d’amélioration') : (en ? 'question' : 'question')
  const link = 'https://schema.albertduplantin.win'
  const subject = (en ? 'Re: ' : 'Re : ') + it.title
  const line = en
    ? kind === 'done'
      ? `Your ${what} “${it.title}” has been dealt with${it.type === 'bug' ? ': the fix is now online' : ': it is now available'}. You may need to reload the page (Ctrl+F5) to get the latest version.`
      : `Thank you: your ${what} “${it.title}” has been received and taken into account. I will let you know when it is done.`
    : kind === 'done'
      ? `Votre ${what} « ${it.title} » a été traité${it.type === 'bug' ? ' : la correction est en ligne' : ' : c’est disponible'}. Il faudra peut-être recharger la page (Ctrl+F5) pour avoir la dernière version.`
      : `Merci : votre ${what} « ${it.title} » a bien été reçu et pris en compte. Je vous préviendrai quand ce sera fait.`
  const body = en ? `Hello,\n\n${line}\n\n${link}\n\nBest regards,\nAlbert Schema Studio` : `Bonjour,\n\n${line}\n\n${link}\n\nCordialement,\nAlbert Schema Studio`
  return { subject, body }
}

const when = (ts: string) => new Date(ts).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })

function Login({ onLogin, error }: { onLogin: (pw: string) => void; error: string }) {
  const [pw, setPw] = useState('')
  return (
    <main className="login">
      <h1>Administration</h1>
      <p className="muted">Albert Schema Studio — retours des utilisateurs</p>
      <form onSubmit={(e) => { e.preventDefault(); if (pw) onLogin(pw) }}>
        <label>Mot de passe
          <input type="password" autoComplete="current-password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} />
        </label>
        {error && <p className="err" role="alert">{error}</p>}
        <button type="submit" className="primary" disabled={!pw}>Se connecter</button>
      </form>
    </main>
  )
}

export default function Admin() {
  const [token, setToken] = useState(() => { try { return sessionStorage.getItem(KEY) ?? '' } catch { return '' } })
  const [items, setItems] = useState<Item[]>([])
  const [total, setTotal] = useState(0)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [kind, setKind] = useState<Kind | ''>('')
  const [status, setStatus] = useState<Status | 'todo' | ''>('todo')
  const [q, setQ] = useState('')
  const [view, setView] = useState<'feedback' | 'examples' | 'exos'>('feedback')
  const callApi = useCallback((query: string, body?: unknown) => api(token, query, body), [token])

  const logout = useCallback(() => {
    try { sessionStorage.removeItem(KEY) } catch { /* ignoré */ }
    setToken('')
    setItems([])
  }, [])

  const load = useCallback(async (tk: string) => {
    setLoading(true)
    try {
      const r = await api(tk, '?action=list')
      const d = (await r.json()) as { total: number; items: Item[] }
      setItems(d.items)
      setTotal(d.total)
      setError('')
      try { sessionStorage.setItem(KEY, tk) } catch { /* ignoré */ }
      setToken(tk)
    } catch (e) {
      const s = e instanceof ApiError ? e.status : 0
      setError(s === 401 ? 'Mot de passe incorrect.' : s === 429 ? 'Trop de tentatives : réessayez dans 15 minutes.' : s === 404 ? 'Administration non activée sur ce site.' : 'Service indisponible.')
      if (s === 401 || s === 404 || s === 429) {
        try { sessionStorage.removeItem(KEY) } catch { /* ignoré */ }
        setToken('')
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (token) void load(token)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- chargement initial avec le mot de passe de la session
  useEffect(() => {
    if (!token) return
    const id = window.setInterval(() => { if (document.visibilityState === 'visible') void load(token) }, 60_000)
    return () => window.clearInterval(id)
  }, [token, load])

  const patch = (id: string, change: Partial<Item>) => setItems((l) => l.map((i) => (i.id === id ? { ...i, ...change } : i)))
  const act = async (body: Record<string, unknown>) => {
    try { await api(token, '', body) } catch { setError('Action impossible (connexion ou session expirée).') }
  }
  const setItemStatus = (it: Item, s: Status) => { patch(it.id, { status: s }); void act({ action: 'status', id: it.id, status: s }) }
  /** Ouvre la messagerie avec un message prêt, note la date, et marque le retour « Traité » si c'est le cas. */
  const notify = (it: Item, kind: 'seen' | 'done') => {
    const m = reply(it, kind)
    window.location.href = `mailto:${it.email}?subject=${encodeURIComponent(m.subject)}&body=${encodeURIComponent(m.body)}`
    patch(it.id, { mailed: new Date().toISOString() })
    void act({ action: 'mailed', id: it.id })
    if (kind === 'done' && it.status !== 'done') setItemStatus(it, 'done')
  }
  const toggle = (it: Item) => {
    const next = open === it.id ? null : it.id
    setOpen(next)
    if (next && it.status === 'new') setItemStatus(it, 'read') // ouvrir un retour le marque comme lu
  }
  const remove = (it: Item) => {
    if (!confirm(`Supprimer définitivement « ${it.title} » ?`)) return
    setItems((l) => l.filter((i) => i.id !== it.id))
    setTotal((n) => n - 1)
    void act({ action: 'delete', id: it.id })
  }
  const downloadDoc = async (it: Item) => {
    try {
      const r = await api(token, `?action=doc&id=${encodeURIComponent(it.id)}`)
      download(`retour-${it.id}.albert.json`, new Blob([await r.text()], { type: 'application/json' }))
    } catch {
      setError('Schéma introuvable (expiré après 90 jours ?).')
    }
  }
  const exportCsv = () => {
    const head = ['id', 'date', 'type', 'statut', 'titre', 'message', 'email', 'note', 'version', 'langue']
    const rows = shown.map((i) => [i.id, i.ts, KIND_LABEL[i.type], STATUS_LABEL[i.status], i.title, i.message, i.email ?? '', i.note, i.meta.build ?? '', i.meta.lang ?? ''])
    const csv = [head, ...rows].map((r) => r.map(csvCell).join(';')).join('\r\n')
    download('retours-albertschema.csv', new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
  }

  const counts = useMemo(() => ({
    new: items.filter((i) => i.status === 'new').length,
    bug: items.filter((i) => i.type === 'bug' && i.status !== 'done' && i.status !== 'spam').length,
  }), [items])
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return items.filter((i) =>
      (!kind || i.type === kind) &&
      (status === '' || (status === 'todo' ? i.status === 'new' || i.status === 'read' : i.status === status)) &&
      (!needle || `${i.title} ${i.message} ${i.email ?? ''} ${i.note}`.toLowerCase().includes(needle)),
    )
  }, [items, kind, status, q])

  if (!token) return <Login onLogin={(pw) => void load(pw)} error={error} />

  return (
    <main className="admin">
      <nav className="tabs" role="tablist">
        <button role="tab" aria-selected={view === 'feedback'} className={view === 'feedback' ? 'on' : ''} onClick={() => setView('feedback')}>Retours{counts.new ? ` (${counts.new})` : ''}</button>
        <button role="tab" aria-selected={view === 'examples'} className={view === 'examples' ? 'on' : ''} onClick={() => setView('examples')}>Exemples</button>
        <button role="tab" aria-selected={view === 'exos'} className={view === 'exos' ? 'on' : ''} onClick={() => setView('exos')}>Exercices</button>
        <span className="grow" />
        <button onClick={logout}>Se déconnecter</button>
      </nav>
      {error && <p className="err" role="alert">{error}</p>}
      {view === 'exos' ? <Exos call={callApi} onError={setError} /> : view === 'examples' ? <Examples call={callApi} onError={setError} /> : (<>
      <header className="bar">
        <h1>Retours <small>{total} au total</small></h1>
        <div className="stats">
          <span className="chip alert-chip">{counts.new} nouveau{counts.new > 1 ? 'x' : ''}</span>
          <span className="chip">{counts.bug} bug{counts.bug > 1 ? 's' : ''} ouvert{counts.bug > 1 ? 's' : ''}</span>
        </div>
        <span className="grow" />
        <button onClick={() => void load(token)} disabled={loading}>{loading ? 'Actualisation…' : 'Actualiser'}</button>
        <button onClick={exportCsv} disabled={!shown.length}>Exporter CSV</button>
      </header>

      <div className="filters">
        <input type="search" placeholder="Rechercher (titre, message, e-mail, note)…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Rechercher" />
        <select value={kind} onChange={(e) => setKind(e.target.value as Kind | '')} aria-label="Nature">
          <option value="">Toutes natures</option>
          {(Object.keys(KIND_LABEL) as Kind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value as Status | 'todo' | '')} aria-label="Statut">
          <option value="todo">À traiter (nouveaux et lus)</option>
          <option value="">Tous les statuts</option>
          {(Object.keys(STATUS_LABEL) as Status[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
      </div>

      {!loading && !shown.length && <p className="muted empty">{items.length ? 'Aucun retour ne correspond aux filtres.' : 'Aucun retour pour le moment.'}</p>}

      <ul className="list">
        {shown.map((it) => (
          <li key={it.id} className={'item ' + it.status}>
            <button className="row" onClick={() => toggle(it)} aria-expanded={open === it.id}>
              <span className={'badge ' + it.type}>{KIND_LABEL[it.type]}</span>
              <span className="title">{it.title}</span>
              {it.hasDoc && <span className="mini" title="Schéma joint">📎</span>}
              {it.mailed && <span className="mini" title={'Auteur prévenu par e-mail le ' + when(it.mailed)}>✉</span>}
              <span className={'state ' + it.status}>{STATUS_LABEL[it.status]}</span>
              <time>{when(it.ts)}</time>
            </button>
            {open === it.id && (
              <div className="detail">
                <p className="message">{it.message}</p>
                <dl>
                  {it.email && <><dt>E-mail</dt><dd><a href={`mailto:${it.email}?subject=${encodeURIComponent('Re: ' + it.title)}`}>{it.email}</a></dd></>}
                  <dt>Version</dt><dd>{it.meta.build || '—'} · {it.meta.lang || '—'} · écran {it.meta.screen || '—'}</dd>
                  <dt>Schéma</dt><dd>{it.meta.symbols ?? '—'} symboles, {it.meta.wires ?? '—'} conducteurs{it.hasDoc ? ' · joint' : ''}</dd>
                  <dt>Navigateur</dt><dd className="ua">{it.meta.ua || '—'}</dd>
                  <dt>Référence</dt><dd>{it.id}</dd>
                </dl>
                <label className="note">Note interne
                  <textarea rows={2} maxLength={1000} defaultValue={it.note} onBlur={(e) => { if (e.target.value !== it.note) { patch(it.id, { note: e.target.value }); void act({ action: 'note', id: it.id, note: e.target.value }) } }} />
                </label>
                <div className="actions">
                  <label>Statut
                    <select value={it.status} onChange={(e) => setItemStatus(it, e.target.value as Status)}>
                      {(Object.keys(STATUS_LABEL) as Status[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                    </select>
                  </label>
                  {it.email ? (
                    <>
                      <button onClick={() => notify(it, 'seen')} title="Ouvre votre messagerie avec un message prêt à envoyer">✉ Prévenir : pris en compte</button>
                      <button onClick={() => notify(it, 'done')} title="Ouvre votre messagerie avec un message prêt à envoyer ; passe le retour en « Traité »">✉ Prévenir : traité</button>
                    </>
                  ) : <span className="muted">Pas d’adresse e-mail : impossible de prévenir l’auteur.</span>}
                  {it.mailed && <span className="muted">✉ prévenu le {when(it.mailed)} <button className="linkish" onClick={() => { patch(it.id, { mailed: undefined }); void act({ action: 'mailed', id: it.id, mailed: false }) }}>retirer</button></span>}
                  {it.hasDoc && <button onClick={() => void downloadDoc(it)}>Télécharger le schéma</button>}
                  <span className="grow" />
                  <button className="danger" onClick={() => remove(it)}>Supprimer</button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
      {total > items.length && <p className="muted">Seuls les {items.length} retours les plus récents sont affichés.</p>}
      </>)}
    </main>
  )
}
