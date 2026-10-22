// Statistiques d'usage anonymes des symboles (classement commun à tous les utilisateurs).
//
//   GET  /api/usage  -> { total, counts: { [idSymbole]: nombre de poses } }  (cache CDN 10 min)
//   POST /api/usage  <- { ids: [idSymbole, …] }                              (204)
//
// Données reçues : uniquement des identifiants de symboles de la bibliothèque. Ni schéma, ni
// identité, ni adresse IP stockée (l'IP sert seulement à limiter le débit, clé expirante).
//
// Stockage : Redis Upstash (intégration Vercel Marketplace), via l'API REST. Variables d'environnement
// attendues : KV_REST_API_URL + KV_REST_API_TOKEN (ou UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN).
import IDS from './_ids.json' with { type: 'json' }

const VALID = new Set(IDS)
const HASH = 'albertschema:usage:v1'
const MAX_IDS_PER_REQUEST = 40
const MAX_SAME_ID_PER_REQUEST = 5
const MAX_REQUESTS_PER_MINUTE = 20
const TOP_N = 600

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
  const { url, token } = config()
  if (!url || !token) {
    res.status(503).json({ error: 'storage not configured' })
    return
  }
  try {
    if (req.method === 'GET') {
      const [{ result }] = await redis([['HGETALL', HASH]])
      const entries = []
      let total = 0
      for (let i = 0; i < (result?.length ?? 0); i += 2) {
        const key = result[i]
        const n = Number(result[i + 1])
        if (key === '__total') total = n
        else if (VALID.has(key)) entries.push([key, n])
      }
      entries.sort((a, b) => b[1] - a[1])
      res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=3600')
      res.status(200).json({ total, counts: Object.fromEntries(entries.slice(0, TOP_N)) })
      return
    }

    if (req.method === 'POST') {
      let body = req.body
      if (typeof body === 'string') {
        try { body = JSON.parse(body) } catch { body = null }
      }
      const raw = Array.isArray(body?.ids) ? body.ids.slice(0, MAX_IDS_PER_REQUEST) : []
      const per = new Map()
      for (const id of raw) {
        if (typeof id === 'string' && VALID.has(id) && (per.get(id) ?? 0) < MAX_SAME_ID_PER_REQUEST) {
          per.set(id, (per.get(id) ?? 0) + 1)
        }
      }
      if (per.size === 0) {
        res.status(204).end()
        return
      }
      // limitation de débit par adresse (clé expirante, l'adresse n'est pas conservée au-delà d'une minute)
      const ip = String(req.headers['x-forwarded-for'] || 'unknown').split(',')[0].trim()
      const key = `albertschema:rl:${ip}:${Math.floor(Date.now() / 60000)}`
      const [{ result: hits }] = await redis([['INCR', key], ['EXPIRE', key, 120]])
      if (Number(hits) > MAX_REQUESTS_PER_MINUTE) {
        res.status(429).json({ error: 'too many requests' })
        return
      }
      const commands = [...per].map(([id, n]) => ['HINCRBY', HASH, id, n])
      commands.push(['HINCRBY', HASH, '__total', [...per.values()].reduce((a, b) => a + b, 0)])
      await redis(commands)
      res.status(204).end()
      return
    }

    res.setHeader('Allow', 'GET, POST')
    res.status(405).json({ error: 'method not allowed' })
  } catch {
    res.status(502).json({ error: 'storage error' })
  }
}
