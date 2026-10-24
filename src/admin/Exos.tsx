import { useCallback, useEffect, useState } from 'react'

interface Exo {
  id: string
  domain: 'electrical' | 'pneumatic' | 'hydraulic'
  level: 1 | 2 | 3
  minutes: number
  order: number
  title: { fr: string; en: string }
  summary: { fr: string; en: string }
  brief: { fr: string[]; en: string[] }
  expect: { fr: string[]; en: string[] }
  n?: number
}

interface Form {
  id?: string
  domain: Exo['domain']
  level: 1 | 2 | 3
  minutes: number
  order: number
  titleFr: string
  titleEn: string
  summaryFr: string
  summaryEn: string
  briefFr: string
  briefEn: string
  expectFr: string
  expectEn: string
  doc?: string
  docInfo?: string
}

const EMPTY: Form = { domain: 'electrical', level: 1, minutes: 20, order: 100, titleFr: '', titleEn: '', summaryFr: '', summaryEn: '', briefFr: '', briefEn: '', expectFr: '', expectEn: '' }
const LEVEL = { 1: 'Débutant', 2: 'Intermédiaire', 3: 'Avancé' } as const
const DOMAIN = { electrical: 'Électrique', pneumatic: 'Pneumatique', hydraulic: 'Hydraulique' } as const

type Call = (query: string, body?: unknown) => Promise<Response>

/** paragraphes séparés par une ligne vide */
const paras = (t: string) => t.split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean)
/** une entrée par ligne */
const rows = (t: string) => t.split('\n').map((x) => x.trim()).filter(Boolean)

/**
 * Création d’exercices guidés : le schéma de référence est dessiné dans l’éditeur ; les étapes (matériel, repères, câblage, simulation,
 * comportement) se déduisent de ce schéma. Il suffit d’ajouter le cahier des charges et le fonctionnement attendu.
 */
export default function Exos({ call, onError }: { call: Call; onError: (msg: string) => void }) {
  const [items, setItems] = useState<Exo[]>([])
  const [form, setForm] = useState<Form | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try { setItems(((await (await call('?action=exos')).json()) as { items: Exo[] }).items) } catch { onError('Chargement des exercices impossible.') }
  }, [call, onError])
  useEffect(() => { void load() }, []) // eslint-disable-line react-hooks/exhaustive-deps -- chargement initial

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
      const r = await call('', {
        action: 'xo-save', id: form.id, domain: form.domain, level: form.level, minutes: form.minutes, order: form.order,
        title: { fr: form.titleFr, en: form.titleEn }, summary: { fr: form.summaryFr, en: form.summaryEn },
        brief: { fr: paras(form.briefFr), en: paras(form.briefEn) }, expect: { fr: rows(form.expectFr), en: rows(form.expectEn) },
        ...(form.doc ? { doc: form.doc } : {}),
      })
      if (!r.ok) throw new Error('refus')
      setForm(null)
      onError('')
      await load()
    } catch {
      onError('Enregistrement refusé : titre, cahier des charges, fonctionnement attendu et (pour un nouvel exercice) un schéma valide sont obligatoires.')
    } finally {
      setBusy(false)
    }
  }

  const edit = (e: Exo) => setForm({
    id: e.id, domain: e.domain, level: e.level, minutes: e.minutes, order: e.order,
    titleFr: e.title.fr, titleEn: e.title.en, summaryFr: e.summary.fr, summaryEn: e.summary.en,
    briefFr: e.brief.fr.join('\n\n'), briefEn: e.brief.en.join('\n\n'), expectFr: e.expect.fr.join('\n'), expectEn: e.expect.en.join('\n'),
  })
  const remove = async (e: Exo) => {
    if (!confirm(`Supprimer l’exercice « ${e.title.fr} » ?`)) return
    setItems((l) => l.filter((x) => x.id !== e.id))
    try { await call('', { action: 'xo-delete', id: e.id }) } catch { onError('Suppression impossible.'); void load() }
  }
  const valid = !!form && !!form.titleFr.trim() && paras(form.briefFr).length > 0 && rows(form.expectFr).length > 0 && (!!form.id || !!form.doc)

  return (
    <section className="examples">
      <header className="bar">
        <h1>Exercices guidés <small>{items.length} publié{items.length > 1 ? 's' : ''}</small></h1>
        <span className="grow" />
        <button className="primary" onClick={() => setForm({ ...EMPTY })} disabled={!!form}>Créer un exercice</button>
      </header>
      <p className="muted">
        Méthode : 1) dessinez dans Albert Schema Studio le <strong>schéma complet et juste</strong> (c’est la solution), en repérant les appareils (S1, S2, KM1, H1…) ; 2) enregistrez-le (.albert.json) ;
        3) créez l’exercice ici avec le cahier des charges et le fonctionnement attendu. Les étapes se déduisent du schéma : matériel à poser, repères, câblage complet, passage en simulation, puis
        comparaison du comportement de l’élève avec celui de la solution (chaque bouton est appuyé puis relâché). Après publication, ouvrez l’exercice et cliquez sur « Voir une solution » : toutes les étapes doivent se cocher.
      </p>

      {form && (
        <div className="exform">
          <h2>{form.id ? 'Modifier l’exercice' : 'Nouvel exercice'}</h2>
          <div className="grid2">
            <label>Titre (français)<input value={form.titleFr} maxLength={120} onChange={(e) => setForm({ ...form, titleFr: e.target.value })} /></label>
            <label>Titre (anglais, facultatif)<input value={form.titleEn} maxLength={120} onChange={(e) => setForm({ ...form, titleEn: e.target.value })} /></label>
            <label>Résumé (français)<textarea rows={2} value={form.summaryFr} maxLength={300} onChange={(e) => setForm({ ...form, summaryFr: e.target.value })} /></label>
            <label>Résumé (anglais, facultatif)<textarea rows={2} value={form.summaryEn} maxLength={300} onChange={(e) => setForm({ ...form, summaryEn: e.target.value })} /></label>
            <label>Cahier des charges (français) — séparez les paragraphes par une ligne vide
              <textarea rows={7} value={form.briefFr} onChange={(e) => setForm({ ...form, briefFr: e.target.value })} />
            </label>
            <label>Cahier des charges (anglais, facultatif) — même découpage
              <textarea rows={7} value={form.briefEn} onChange={(e) => setForm({ ...form, briefEn: e.target.value })} />
            </label>
            <label>Fonctionnement attendu (français) — une ligne par comportement, par exemple : J’appuie sur S1, la lampe H1 s’allume.
              <textarea rows={6} value={form.expectFr} onChange={(e) => setForm({ ...form, expectFr: e.target.value })} />
            </label>
            <label>Fonctionnement attendu (anglais, facultatif) — mêmes lignes
              <textarea rows={6} value={form.expectEn} onChange={(e) => setForm({ ...form, expectEn: e.target.value })} />
            </label>
            <label>Domaine
              <select value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value as Form['domain'] })}>
                {(Object.keys(DOMAIN) as (keyof typeof DOMAIN)[]).map((d) => <option key={d} value={d}>{DOMAIN[d]}</option>)}
              </select>
            </label>
            <label>Niveau
              <select value={form.level} onChange={(e) => setForm({ ...form, level: Number(e.target.value) as 1 | 2 | 3 })}>
                {([1, 2, 3] as const).map((l) => <option key={l} value={l}>{LEVEL[l]}</option>)}
              </select>
            </label>
            <label>Durée estimée (minutes)<input type="number" min={5} max={180} value={form.minutes} onChange={(e) => setForm({ ...form, minutes: Number(e.target.value) })} /></label>
            <label>Ordre (le plus petit en premier)<input type="number" min={-999} max={999} value={form.order} onChange={(e) => setForm({ ...form, order: Number(e.target.value) })} /></label>
          </div>
          <label>Schéma de la solution{form.id ? ' (laisser vide pour conserver l’actuel)' : ''}
            <input type="file" accept=".json,application/json" onChange={(e) => void pickFile(e.target.files?.[0])} />
          </label>
          {form.docInfo && <p className="muted">✓ {form.docInfo}</p>}
          <div className="actions">
            <button className="primary" onClick={() => void save()} disabled={!valid || busy}>{busy ? 'Enregistrement…' : 'Enregistrer'}</button>
            <button onClick={() => setForm(null)}>Annuler</button>
          </div>
        </div>
      )}

      {!items.length && !form && <p className="muted empty">Aucun exercice publié pour le moment.</p>}
      <ul className="list">
        {items.map((e) => (
          <li key={e.id} className="item">
            <div className="row static">
              <span className="badge idea">{'★'.repeat(e.level)}</span>
              <span className="title">{e.title.fr}<small className="muted"> · {DOMAIN[e.domain]} · {e.minutes} min · lien : ?exo=u-{e.id}</small></span>
              <span className="mini">{e.n ?? '?'} symboles</span>
              <button onClick={() => edit(e)} disabled={!!form}>Modifier</button>
              <button className="danger" onClick={() => void remove(e)}>Supprimer</button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
