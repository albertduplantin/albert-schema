import { useCallback, useEffect, useState } from 'react'
import { BUILTIN_META } from '../galleryMeta'
import { tr } from '../i18n'

interface Example {
  id: string
  title: { fr: string; en: string }
  about: { fr: string; en: string }
  level: 1 | 2 | 3
  order: number
  n?: number
  ts?: string
}

interface Form {
  id?: string
  titleFr: string
  titleEn: string
  aboutFr: string
  aboutEn: string
  level: 1 | 2 | 3
  order: number
  /** schéma choisi dans le formulaire (absent à la modification : le schéma enregistré est conservé) */
  doc?: string
  docInfo?: string
}

const EMPTY: Form = { titleFr: '', titleEn: '', aboutFr: '', aboutEn: '', level: 1, order: 100 }
const LEVEL = { 1: 'Débutant', 2: 'Intermédiaire', 3: 'Avancé' } as const

type Call = (query: string, body?: unknown) => Promise<Response>

/** Gestion de la galerie d'exemples : exemples publiés (ajout, modification, suppression) et exemples intégrés (masquer / afficher). */
export default function Examples({ call, onError }: { call: Call; onError: (msg: string) => void }) {
  const [items, setItems] = useState<Example[]>([])
  const [hidden, setHidden] = useState<string[]>([])
  const [form, setForm] = useState<Form | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const d = (await (await call('?action=examples')).json()) as { items: Example[]; hidden: string[] }
      setItems(d.items)
      setHidden(d.hidden)
    } catch {
      onError('Chargement des exemples impossible.')
    }
  }, [call, onError])
  useEffect(() => { void load() }, []) // eslint-disable-line react-hooks/exhaustive-deps -- chargement initial

  const toggleBuiltin = async (key: string, show: boolean) => {
    setHidden((h) => (show ? h.filter((k) => k !== key) : [...h, key]))
    try { await call('', { action: 'ex-hide', key, hidden: !show }) } catch { onError('Action impossible.'); void load() }
  }

  const pickFile = async (f: File | undefined) => {
    if (!f || !form) return
    try {
      const txt = await f.text()
      const d = JSON.parse(txt)
      if (d.version !== 1 || !Array.isArray(d.symbols) || !Array.isArray(d.wires)) throw new Error('format')
      if (txt.length > 400_000) throw new Error('size')
      setForm({ ...form, doc: txt, docInfo: `${f.name} : ${d.symbols.length} symboles, ${d.wires.length} conducteurs` })
      onError('')
    } catch {
      onError('Fichier invalide : choisissez un schéma enregistré depuis Albert Schema Studio (.albert.json, 400 Ko maximum).')
    }
  }

  const save = async () => {
    if (!form) return
    setBusy(true)
    try {
      await call('', {
        action: 'ex-save', id: form.id,
        title: { fr: form.titleFr, en: form.titleEn }, about: { fr: form.aboutFr, en: form.aboutEn },
        level: form.level, order: form.order, ...(form.doc ? { doc: form.doc } : {}),
      })
      setForm(null)
      onError('')
      await load()
    } catch {
      onError('Enregistrement refusé : titres français et anglais obligatoires, et un schéma valide pour un nouvel exemple.')
    } finally {
      setBusy(false)
    }
  }

  const edit = (e: Example) => setForm({ id: e.id, titleFr: e.title.fr, titleEn: e.title.en, aboutFr: e.about.fr, aboutEn: e.about.en, level: e.level, order: e.order })
  const remove = async (e: Example) => {
    if (!confirm(`Supprimer l’exemple « ${e.title.fr} » ?`)) return
    setItems((l) => l.filter((x) => x.id !== e.id))
    try { await call('', { action: 'ex-delete', id: e.id }) } catch { onError('Suppression impossible.'); void load() }
  }
  const valid = !!form && !!form.titleFr.trim() && !!form.titleEn.trim() && (!!form.id || !!form.doc)

  return (
    <section className="examples">
      <header className="bar">
        <h1>Exemples <small>{items.length} publié{items.length > 1 ? 's' : ''}</small></h1>
        <span className="grow" />
        <button className="primary" onClick={() => setForm({ ...EMPTY })} disabled={!!form}>Ajouter un exemple</button>
      </header>
      <p className="muted">
        Les exemples publiés apparaissent en premier, dans la liste de départ d’une feuille vide et dans la galerie, avant les exemples intégrés ; ils se classent entre eux par « ordre ». Pour en créer un : dessinez le schéma dans Albert Schema Studio,
        cliquez sur « Enregistrer » (fichier .albert.json), puis ajoutez-le ici.
      </p>

      {form && (
        <div className="exform">
          <h2>{form.id ? 'Modifier l’exemple' : 'Nouvel exemple'}</h2>
          <div className="grid2">
            <label>Titre (français)<input value={form.titleFr} maxLength={120} onChange={(e) => setForm({ ...form, titleFr: e.target.value })} /></label>
            <label>Titre (anglais)<input value={form.titleEn} maxLength={120} onChange={(e) => setForm({ ...form, titleEn: e.target.value })} /></label>
            <label>Description (français)<textarea rows={3} value={form.aboutFr} maxLength={400} onChange={(e) => setForm({ ...form, aboutFr: e.target.value })} /></label>
            <label>Description (anglais)<textarea rows={3} value={form.aboutEn} maxLength={400} onChange={(e) => setForm({ ...form, aboutEn: e.target.value })} /></label>
            <label>Niveau
              <select value={form.level} onChange={(e) => setForm({ ...form, level: Number(e.target.value) as 1 | 2 | 3 })}>
                {([1, 2, 3] as const).map((l) => <option key={l} value={l}>{LEVEL[l]}</option>)}
              </select>
            </label>
            <label>Ordre (le plus petit en premier)<input type="number" min={-999} max={999} value={form.order} onChange={(e) => setForm({ ...form, order: Number(e.target.value) })} /></label>
          </div>
          <label>Schéma{form.id ? ' (laisser vide pour conserver l’actuel)' : ''}
            <input type="file" accept=".json,application/json" onChange={(e) => void pickFile(e.target.files?.[0])} />
          </label>
          {form.docInfo && <p className="muted">✓ {form.docInfo}</p>}
          <div className="actions">
            <button className="primary" onClick={() => void save()} disabled={!valid || busy}>{busy ? 'Enregistrement…' : 'Enregistrer'}</button>
            <button onClick={() => setForm(null)}>Annuler</button>
          </div>
        </div>
      )}

      {!items.length && !form && <p className="muted empty">Aucun exemple publié pour le moment.</p>}
      <ul className="list">
        {items.map((e) => (
          <li key={e.id} className="item">
            <div className="row static">
              <span className="badge idea">{'★'.repeat(e.level)}</span>
              <span className="title">{e.title.fr}<small className="muted"> · {e.title.en}</small></span>
              <span className="mini">{e.n ?? '?'} symboles</span>
              <span className="mini">ordre {e.order}</span>
              <button onClick={() => edit(e)} disabled={!!form}>Modifier</button>
              <button className="danger" onClick={() => void remove(e)}>Supprimer</button>
            </div>
          </li>
        ))}
      </ul>

      <h2>Exemples intégrés</h2>
      <p className="muted">Décochez pour retirer un exemple intégré de la galerie (il n’est pas supprimé, vous pouvez le réafficher).</p>
      <ul className="list">
        {BUILTIN_META.map((m) => (
          <li key={m.key} className="item">
            <label className="row static">
              <input type="checkbox" checked={!hidden.includes(m.key)} onChange={(e) => void toggleBuiltin(m.key, e.target.checked)} />
              <span className="title">{tr('fr', m.key)}</span>
              <span className="mini">{LEVEL[m.level]}</span>
            </label>
          </li>
        ))}
      </ul>
    </section>
  )
}
