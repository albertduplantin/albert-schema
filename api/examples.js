// Galerie d'exemples publiée par l'administrateur (lecture publique).
//
//   GET /api/examples          -> { items: [{ id, title, about, level, order, n }], hidden: [clés d'exemples intégrés masqués] }
//   GET /api/examples?id=<id>  -> le schéma (JSON brut)
//
// Gestion : page d'administration (api/admin.js). Sans stockage configuré, la liste est vide : l'application n'affiche alors que ses exemples intégrés.
const EXAMPLES = 'albertschema:examples'
const HIDDEN = 'albertschema:examples:hidden'

const config = () => ({
  url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
})

async function redis(commands) {
  const { url, token } = config()
  const r = await fetch(`${url}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands),
  })
  if (!r.ok) throw new Error(`redis ${r.status}`)
  return r.json()
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    res.status(405).json({ error: 'method not allowed' })
    return
  }
  res.setHeader('Cache-Control', 'public, s-maxage=20, stale-while-revalidate=300')
  const { url, token } = config()
  if (!url || !token) {
    res.status(200).json({ items: [], hidden: [] })
    return
  }
  try {
    const id = String(req.query?.id || new URL(req.url, 'http://x').searchParams.get('id') || '')
    if (id) {
      if (!/^[a-f0-9-]{4,12}$/.test(id)) {
        res.status(400).json({ error: 'invalid id' })
        return
      }
      const [{ result }] = await redis([['HGET', EXAMPLES, id]])
      let doc = null
      try { doc = result ? JSON.parse(result).doc : null } catch { doc = null }
      if (!doc) {
        res.status(404).json({ error: 'not found' })
        return
      }
      res.status(200).json(doc)
      return
    }
    const [{ result: rows }, { result: hidden }] = await redis([['HGETALL', EXAMPLES], ['SMEMBERS', HIDDEN]])
    const items = []
    for (let i = 1; i < (rows?.length ?? 0); i += 2) {
      try {
        const { doc, ts, ...meta } = JSON.parse(rows[i])
        items.push(meta)
      } catch { /* entrée illisible ignorée */ }
    }
    items.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    res.status(200).json({ items, hidden: hidden ?? [] })
  } catch {
    res.status(200).json({ items: [], hidden: [] })
  }
}
