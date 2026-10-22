// Retours des utilisateurs : signalement de bug, demande d'amélioration, question.
//
//   POST /api/feedback  <- { type, title, message, email?, includeDoc?, doc?, meta? }   -> 200 { id }
//
// Stockage : liste Redis `albertschema:feedback` (les 1000 plus récents), JSON par entrée. Un schéma joint (avec accord explicite
// de l'utilisateur) est rangé à part, `albertschema:feedback:doc:<id>`, et expire au bout de 90 jours.
// Consultation : console Upstash (Data Browser) ; voir le README.
//
// Protections : champs validés et bornés, champ piège anti-robots, limite de 5 envois par heure et par adresse (clé expirante),
// plafond global de 300 envois par jour.
import { randomUUID } from 'node:crypto'

const LIST = 'albertschema:feedback'
const TYPES = new Set(['bug', 'idea', 'question'])
const MAX_TITLE = 120
const MAX_MESSAGE = 4000
const MAX_EMAIL = 200
const MAX_DOC = 300_000
const MAX_PER_HOUR_PER_IP = 5
const MAX_PER_DAY = 300

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

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    res.status(405).json({ error: 'method not allowed' })
    return
  }
  const { url, token } = config()
  if (!url || !token) {
    res.status(503).json({ error: 'storage not configured' })
    return
  }

  let body = req.body
  if (typeof body === 'string') {
    try { body = JSON.parse(body) } catch { body = null }
  }
  if (!body || typeof body !== 'object') {
    res.status(400).json({ error: 'invalid body' })
    return
  }

  // champ piège : un robot le remplit, un humain ne le voit pas. On répond « succès » sans rien enregistrer.
  if (typeof body.website === 'string' && body.website.trim() !== '') {
    res.status(200).json({ id: 'ok' })
    return
  }

  const type = TYPES.has(body.type) ? body.type : null
  const title = str(body.title, MAX_TITLE)
  const message = str(body.message, MAX_MESSAGE)
  const email = str(body.email, MAX_EMAIL)
  if (!type || title.length < 3 || message.length < 10) {
    res.status(400).json({ error: 'missing fields' })
    return
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ error: 'invalid email' })
    return
  }
  let doc = null
  if (body.includeDoc === true && typeof body.doc === 'string') {
    if (body.doc.length > MAX_DOC) {
      res.status(413).json({ error: 'document too large' })
      return
    }
    try {
      JSON.parse(body.doc)
      doc = body.doc
    } catch {
      doc = null
    }
  }
  const m = body.meta && typeof body.meta === 'object' ? body.meta : {}
  const meta = {
    build: str(m.build, 40),
    lang: str(m.lang, 10),
    ua: str(m.ua, 300),
    screen: str(m.screen, 30),
    symbols: Number.isFinite(m.symbols) ? Number(m.symbols) : undefined,
    wires: Number.isFinite(m.wires) ? Number(m.wires) : undefined,
  }

  try {
    // limites de débit : par adresse (1 h) et globale (24 h) ; les clés expirent, l'adresse n'est pas conservée
    const ip = String(req.headers['x-forwarded-for'] || 'unknown').split(',')[0].trim()
    const hourKey = `albertschema:fb:ip:${ip}:${Math.floor(Date.now() / 3_600_000)}`
    const dayKey = `albertschema:fb:day:${Math.floor(Date.now() / 86_400_000)}`
    const [{ result: hourHits }, , { result: dayHits }] = await redis([
      ['INCR', hourKey], ['EXPIRE', hourKey, 7200], ['INCR', dayKey], ['EXPIRE', dayKey, 172800],
    ])
    if (Number(hourHits) > MAX_PER_HOUR_PER_IP || Number(dayHits) > MAX_PER_DAY) {
      res.status(429).json({ error: 'too many requests' })
      return
    }

    const id = randomUUID().slice(0, 8)
    const entry = { id, ts: new Date().toISOString(), type, title, message, ...(email ? { email } : {}), meta, hasDoc: !!doc }
    const commands = [['LPUSH', LIST, JSON.stringify(entry)], ['LTRIM', LIST, 0, 999]]
    if (doc) commands.push(['SET', `${LIST}:doc:${id}`, doc, 'EX', 90 * 86400])
    await redis(commands)
    res.status(200).json({ id })
  } catch {
    res.status(502).json({ error: 'storage error' })
  }
}
