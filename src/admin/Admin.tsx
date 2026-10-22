import { useCallback, useEffect, useMemo, useState } from 'react'

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

const when = (ts: string) => new Date(ts).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })

function Login({ onLogin, error }: { onLogin: (pw: string) => void; error: string }) {
  const [pw, setPw] = useState('')
  return (
    <main className="login">
      <h1>Administration</h1>
      <p className="muted">AlbertSchema — retours des utilisateurs</p>
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
      <header className="bar">
        <h1>Retours <small>{total} au total</small></h1>
        <div className="stats">
          <span className="chip alert-chip">{counts.new} nouveau{counts.new > 1 ? 'x' : ''}</span>
          <span className="chip">{counts.bug} bug{counts.bug > 1 ? 's' : ''} ouvert{counts.bug > 1 ? 's' : ''}</span>
        </div>
        <span className="grow" />
        <button onClick={() => void load(token)} disabled={loading}>{loading ? 'Actualisation…' : 'Actualiser'}</button>
        <button onClick={exportCsv} disabled={!shown.length}>Exporter CSV</button>
        <button onClick={logout}>Se déconnecter</button>
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

      {error && <p className="err" role="alert">{error}</p>}
      {!loading && !shown.length && <p className="muted empty">{items.length ? 'Aucun retour ne correspond aux filtres.' : 'Aucun retour pour le moment.'}</p>}

      <ul className="list">
        {shown.map((it) => (
          <li key={it.id} className={'item ' + it.status}>
            <button className="row" onClick={() => toggle(it)} aria-expanded={open === it.id}>
              <span className={'badge ' + it.type}>{KIND_LABEL[it.type]}</span>
              <span className="title">{it.title}</span>
              {it.hasDoc && <span className="mini" title="Schéma joint">📎</span>}
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
    </main>
  )
}
