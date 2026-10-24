// Exercices guidés publiés par l'administrateur (lecture publique).
//
//   GET /api/exos  -> { items: [{ id, domain, level, minutes, title, summary, brief, expect, doc }] }  (cache CDN 5 min)
const config = () => ({
  url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
})

export default async function handler(req, res) {
  const { url, token } = config()
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); res.status(405).json({ error: 'method not allowed' }); return }
  if (!url || !token) { res.status(200).json({ items: [] }); return }
  try {
    const r = await fetch(`${url}/pipeline`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify([['HGETALL', 'albertschema:exos']]) })
    if (!r.ok) throw new Error('redis')
    const [{ result: rows }] = await r.json()
    const items = []
    for (let i = 1; i < (rows?.length ?? 0); i += 2) {
      try { const { ts, n, ...e } = JSON.parse(rows[i]); items.push({ ...e, ts }) } catch { /* entrée illisible ignorée */ }
    }
    items.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || String(a.ts).localeCompare(String(b.ts)))
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600')
    res.status(200).json({ items: items.map(({ ts, order, ...e }) => e) })
  } catch {
    res.status(200).json({ items: [] })
  }
}
