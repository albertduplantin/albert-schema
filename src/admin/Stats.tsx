import { useCallback, useEffect, useState } from 'react'

interface Day { day: string; visits: number; uniq: number }
interface Data {
  today: string
  days: Day[]
  tops: Record<'pages' | 'origins' | 'countries' | 'devices' | 'langs', [string, number][]>
  months: { month: string; uniq: number }[]
}

type Call = (query: string, body?: unknown) => Promise<Response>

const PAGE_LABEL: Record<string, string> = {
  '/': 'Éditeur (page d’accueil)', '/schema-electrique/': 'Schémas électriques', '/schema-pneumatique/': 'Pneumatique',
  '/schema-hydraulique/': 'Hydraulique', '/exercices-guides/': 'Exercices guidés', '/exemples/': 'Exemples', '/en/': 'English',
}
const DEVICE_LABEL: Record<string, string> = { desktop: 'Ordinateur / tablette', mobile: 'Téléphone' }
const OWNER_FLAG = 'as.nostats'
const dayLabel = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
const monthLabel = (m: string) => new Date(m + '-15T12:00:00Z').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
const sum = (l: Day[], k: 'visits' | 'uniq') => l.reduce((a, d) => a + d[k], 0)

function Top({ title, rows, label = (k: string) => k }: { title: string; rows: [string, number][]; label?: (k: string) => string }) {
  const max = Math.max(1, ...rows.map((r) => r[1]))
  return (
    <section className="top">
      <h3>{title}</h3>
      {rows.length ? (
        <ul>{rows.map(([k, n]) => (
          <li key={k}><span className="fill" style={{ width: `${(100 * n) / max}%` }} /><span className="k">{label(k)}</span><span className="n">{n}</span></li>
        ))}</ul>
      ) : <p className="muted">Aucune donnée.</p>}
    </section>
  )
}

/** Audience : visiteurs uniques et visites par jour, pages d'arrivée, origines, pays, appareils (mesure sans cookie, voir api/visit.js). */
export default function Stats({ call, onError }: { call: Call; onError: (msg: string) => void }) {
  const [data, setData] = useState<Data | null>(null)
  const [span, setSpan] = useState(30)
  const [table, setTable] = useState(false)
  const [owner, setOwner] = useState(() => { try { return !!localStorage.getItem(OWNER_FLAG) } catch { return false } })

  const load = useCallback(async () => {
    try {
      setData((await (await call(`?action=stats&days=${span}`)).json()) as Data)
    } catch {
      onError('Chargement des statistiques impossible.')
    }
  }, [call, onError, span])
  useEffect(() => { void load() }, [load])

  const toggleOwner = () => {
    try {
      if (owner) localStorage.removeItem(OWNER_FLAG)
      else localStorage.setItem(OWNER_FLAG, '1')
      setOwner(!owner)
    } catch { onError('Ce navigateur refuse de mémoriser le réglage.') }
  }

  if (!data) return <p className="muted">Chargement…</p>
  const last = data.days[data.days.length - 1]
  const week = data.days.slice(-7)
  const max = Math.max(1, ...data.days.map((d) => d.uniq))
  const W = 900, H = 160, pad = 24
  const bw = (W - pad) / data.days.length

  return (
    <div className="stats-view">
      <header className="bar">
        <h1>Audience <small>mesure sans cookie, jours en heure UTC</small></h1>
        <span className="grow" />
        <select value={span} onChange={(e) => setSpan(Number(e.target.value))} aria-label="Période">
          <option value={7}>7 jours</option><option value={30}>30 jours</option><option value={90}>90 jours</option>
        </select>
        <button onClick={() => void load()}>Actualiser</button>
      </header>

      <div className="kpis">
        <div><b>{last.uniq}</b><span>visiteurs aujourd’hui</span></div>
        <div><b>{sum(week, 'uniq')}</b><span>sur 7 jours <em>(somme des visiteurs de chaque jour)</em></span></div>
        <div><b>{sum(data.days, 'uniq')}</b><span>sur {span} jours <em>(idem)</em></span></div>
        <div><b>{data.months[0]?.uniq ?? 0}</b><span>visiteurs distincts en {monthLabel(data.months[0]?.month ?? data.today.slice(0, 7))}</span></div>
        <div><b>{sum(data.days, 'visits')}</b><span>visites sur {span} jours</span></div>
      </div>

      <section className="chart">
        <h2>Visiteurs uniques par jour</h2>
        {table ? (
          <table className="daytable"><thead><tr><th>Jour</th><th>Visiteurs</th><th>Visites</th></tr></thead>
            <tbody>{[...data.days].reverse().map((d) => <tr key={d.day}><td>{d.day}</td><td>{d.uniq}</td><td>{d.visits}</td></tr>)}</tbody></table>
        ) : (
          <svg viewBox={`0 0 ${W} ${H + 22}`} role="img" aria-label={`Visiteurs uniques par jour sur ${span} jours, maximum ${max}`}>
            <line x1={pad} x2={W} y1={H} y2={H} stroke="var(--line)" />
            <text x={0} y={12} fontSize={11} fill="var(--muted)">{max}</text>
            <text x={0} y={H} fontSize={11} fill="var(--muted)">0</text>
            {data.days.map((d, i) => {
              const h = Math.max(d.uniq ? 2 : 0, (d.uniq / max) * (H - 18))
              return (
                <rect key={d.day} x={pad + i * bw + 1} y={H - h} width={Math.max(1, bw - 2)} height={h} rx={Math.min(4, bw / 2)} fill="var(--accent)">
                  <title>{`${dayLabel(d.day)} : ${d.uniq} visiteur${d.uniq > 1 ? 's' : ''}, ${d.visits} visite${d.visits > 1 ? 's' : ''}`}</title>
                </rect>
              )
            })}
            <text x={pad} y={H + 16} fontSize={11} fill="var(--muted)">{dayLabel(data.days[0].day)}</text>
            <text x={W} y={H + 16} fontSize={11} fill="var(--muted)" textAnchor="end">{dayLabel(last.day)}</text>
          </svg>
        )}
        <button className="linkish" onClick={() => setTable((v) => !v)}>{table ? 'Voir le graphique' : 'Voir le tableau'}</button>
      </section>

      <div className="tops">
        <Top title="Pages d’arrivée" rows={data.tops.pages} label={(k) => PAGE_LABEL[k] ?? k} />
        <Top title="Origine des visites" rows={data.tops.origins} label={(k) => (k === 'direct' ? 'Accès direct ou inconnu' : k)} />
        <Top title="Pays" rows={data.tops.countries} label={(k) => (k === 'XX' ? 'Inconnu' : (() => { try { return new Intl.DisplayNames('fr', { type: 'region' }).of(k) ?? k } catch { return k } })())} />
        <Top title="Appareils" rows={data.tops.devices} label={(k) => DEVICE_LABEL[k] ?? k} />
        <Top title="Langue du navigateur" rows={data.tops.langs} label={(k) => (k === 'fr' ? 'Français' : k === 'en' ? 'Anglais' : k)} />
      </div>

      <p className="muted small">
        Un visiteur unique est compté une fois par jour (empreinte de l’adresse IP et du navigateur, qui change chaque jour : l’adresse n’est jamais enregistrée).
        Les robots, les navigateurs réglés sur « Ne pas me suivre » et localhost ne sont pas comptés.
      </p>
      <p>
        <label className="check"><input type="checkbox" checked={owner} onChange={toggleOwner} /> Ne pas me compter dans ce navigateur (vos visites de test)</label>
      </p>
    </div>
  )
}
