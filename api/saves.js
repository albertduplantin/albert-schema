// Sauvegarde en ligne par code de reprise, sans compte : on retrouve ses schémas sur n'importe quel appareil.
//
//   POST /api/saves  { doc }               -> 201 { code }   crée une sauvegarde et renvoie son code (ex. K7QM-4TX9-2B3D)
//   POST /api/saves  { code, doc }         -> 204            met à jour (la sauvegarde doit exister)
//   GET  /api/saves?code=…[&v=prev]        -> 200 { doc }    lit la sauvegarde, ou la version d'il y a au moins une heure
//
// Le code (60 bits aléatoires) est le seul secret : qui le connaît peut lire et remplacer le schéma, personne d'autre.
// Aucun compte, aucune adresse conservée (limitation de débit à la minute). Une version plus ancienne est gardée en plus
// (au plus une par heure) pour rattraper une erreur. Stockage : Redis Upstash, durée de vie de 400 jours renouvelée à chaque usage.
import { randomBytes } from 'node:crypto'

const config = () => ({
  url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
})
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ' // Crockford : sans I, L, O, U
const LIFETIME = 60 * 60 * 24 * 400
const MAX_BYTES = 900_000
const LIMITS = { read: 40, write: 90 } // par minute et par adresse
const MAX_CREATE_PER_HOUR = 12

/** Normalise un code saisi : majuscules, sans tirets ni espaces, O→0, I et L→1. */
export const normalizeCode = (raw) => String(raw ?? '').toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1')
export const validCode = (c) => c.length === 12 && [...c].every((ch) => ALPHABET.includes(ch))
const newCode = () => [...randomBytes(12)].map((b) => ALPHABET[b % 32]).join('')

async function redis(commands) {
  const { url, token } = config()
  const r = await fetch(`${url}/pipeline`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(commands) })
  if (!r.ok) throw new Error(`redis ${r.status}`)
  return r.json()
}

const okDoc = (d) => d && typeof d === 'object' && d.version === 1 && Array.isArray(d.symbols) && Array.isArray(d.wires)

export default async function handler(req, res) {
  const { url, token } = config()
  if (!url || !token) { res.status(503).json({ error: 'storage not configured' }); return }
  res.setHeader('Cache-Control', 'no-store')
  try {
    const ip = String(req.headers['x-forwarded-for'] || 'unknown').split(',')[0].trim()
    const minute = Math.floor(Date.now() / 60000)
    const limit = async (kind, max, bucket, ttl) => {
      const k = `albertschema:rl:save:${kind}:${ip}:${bucket}`
      const [{ result: hits }] = await redis([['INCR', k], ['EXPIRE', k, ttl]])
      return Number(hits) <= max
    }
    if (req.method === 'GET') {
      const code = normalizeCode(req.query?.code)
      if (!validCode(code)) { res.status(400).json({ error: 'invalid code' }); return }
      if (!(await limit('read', LIMITS.read, minute, 120))) { res.status(429).json({ error: 'too many requests' }); return }
      const key = `albertschema:save:${code}` + (req.query?.v === 'prev' ? ':prev' : '')
      const [{ result }] = await redis([['GET', key]])
      if (!result) { res.status(404).json({ error: 'not found' }); return }
      await redis([['EXPIRE', `albertschema:save:${code}`, LIFETIME], ['EXPIRE', `albertschema:save:${code}:prev`, LIFETIME]])
      res.status(200).json({ doc: JSON.parse(result) })
      return
    }
    if (req.method === 'POST') {
      let body = req.body
      if (typeof body === 'string') { try { body = JSON.parse(body) } catch { body = null } }
      if (!okDoc(body?.doc)) { res.status(400).json({ error: 'invalid body' }); return }
      const text = JSON.stringify(body.doc)
      if (text.length > MAX_BYTES) { res.status(413).json({ error: 'too large' }); return }
      if (!(await limit('write', LIMITS.write, minute, 120))) { res.status(429).json({ error: 'too many requests' }); return }
      if (body.code === undefined) {
        if (!(await limit('create', MAX_CREATE_PER_HOUR, Math.floor(minute / 60), 7200))) { res.status(429).json({ error: 'too many requests' }); return }
        const code = newCode()
        await redis([['SET', `albertschema:save:${code}`, text, 'EX', LIFETIME]])
        res.status(201).json({ code })
        return
      }
      const code = normalizeCode(body.code)
      if (!validCode(code)) { res.status(400).json({ error: 'invalid code' }); return }
      const key = `albertschema:save:${code}`
      const [{ result: old }, { result: stamp }] = await redis([['GET', key], ['SET', key + ':pt', '1', 'NX', 'EX', 3600]])
      if (!old) { res.status(404).json({ error: 'not found' }); return }
      const cmds = [['SET', key, text, 'EX', LIFETIME]]
      if (stamp === 'OK') cmds.push(['SET', key + ':prev', old, 'EX', LIFETIME]) // au plus une ancienne version par heure
      await redis(cmds)
      res.status(204).end()
      return
    }
    res.setHeader('Allow', 'GET, POST')
    res.status(405).json({ error: 'method not allowed' })
  } catch {
    res.status(502).json({ error: 'storage error' })
  }
}
