// Administration des retours des utilisateurs (lecture, statut, notes, suppression).
//
//   GET  /api/admin?action=list            -> { total, items: [{ …retour, status, note }] }   (300 plus récents)
//   GET  /api/admin?action=doc&id=<id>     -> schéma joint (JSON brut)
//   POST /api/admin { action: 'status' | 'note' | 'delete', id, status?, note? }
//
// Accès : en-tête `Authorization: Bearer <ADMIN_TOKEN>`. Sans variable d'environnement ADMIN_TOKEN (16 caractères minimum), l'API
// répond 404 comme si elle n'existait pas. Les mauvais essais sont comptés par adresse (10 par quart d'heure, puis 429).
import { createHash, timingSafeEqual } from 'node:crypto'

const LIST = 'albertschema:feedback'
const STATUS = 'albertschema:feedback:status'
const STATUSES = new Set(['new', 'read', 'done', 'spam'])
const MAX_FAILS = 10
const MAX_NOTE = 1000
const LIMIT = 300

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

const digest = (s) => createHash('sha256').update(String(s)).digest()
const validId = (id) => typeof id === 'string' && /^[a-f0-9-]{4,12}$/.test(id)

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  const secret = process.env.ADMIN_TOKEN
  const { url, token } = config()
  // fonction désactivée : indiscernable d'une route inexistante
  if (!secret || secret.length < 16 || !url || !token) {
    res.status(404).json({ error: 'not found' })
    return
  }

  try {
    const ip = String(req.headers['x-forwarded-for'] || 'unknown').split(',')[0].trim()
    const failKey = `albertschema:admin:fail:${ip}:${Math.floor(Date.now() / 900_000)}`
    const [{ result: fails }] = await redis([['GET', failKey]])
    if (Number(fails || 0) >= MAX_FAILS) {
      res.status(429).json({ error: 'too many attempts' })
      return
    }
    const given = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')
    if (!timingSafeEqual(digest(given), digest(secret))) {
      await redis([['INCR', failKey], ['EXPIRE', failKey, 1800]])
      res.status(401).json({ error: 'unauthorized' })
      return
    }

    if (req.method === 'GET') {
      const action = String(req.query?.action || new URL(req.url, 'http://x').searchParams.get('action') || 'list')
      if (action === 'doc') {
        const id = String(req.query?.id || new URL(req.url, 'http://x').searchParams.get('id') || '')
        if (!validId(id)) {
          res.status(400).json({ error: 'invalid id' })
          return
        }
        const [{ result }] = await redis([['GET', `${LIST}:doc:${id}`]])
        if (!result) {
          res.status(404).json({ error: 'no document' })
          return
        }
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.status(200).send(result)
        return
      }
      const [{ result: rows }, { result: total }, { result: marks }] = await redis([
        ['LRANGE', LIST, 0, LIMIT - 1], ['LLEN', LIST], ['HGETALL', STATUS],
      ])
      const state = {}
      for (let i = 0; i < (marks?.length ?? 0); i += 2) {
        try { state[marks[i]] = JSON.parse(marks[i + 1]) } catch { /* entrée illisible ignorée */ }
      }
      const items = []
      for (const row of rows ?? []) {
        try {
          const e = JSON.parse(row)
          items.push({ ...e, status: state[e.id]?.status ?? 'new', note: state[e.id]?.note ?? '' })
        } catch { /* entrée illisible ignorée */ }
      }
      res.status(200).json({ total: Number(total ?? items.length), items })
      return
    }

    if (req.method === 'POST') {
      let body = req.body
      if (typeof body === 'string') {
        try { body = JSON.parse(body) } catch { body = null }
      }
      if (!body || !validId(body.id)) {
        res.status(400).json({ error: 'invalid request' })
        return
      }
      const id = body.id
      const [{ result: current }] = await redis([['HGET', STATUS, id]])
      let prev = {}
      try { prev = current ? JSON.parse(current) : {} } catch { prev = {} }

      if (body.action === 'status' && STATUSES.has(body.status)) {
        await redis([['HSET', STATUS, id, JSON.stringify({ ...prev, status: body.status })]])
        res.status(200).json({ ok: true })
        return
      }
      if (body.action === 'note' && typeof body.note === 'string') {
        await redis([['HSET', STATUS, id, JSON.stringify({ ...prev, note: body.note.slice(0, MAX_NOTE) })]])
        res.status(200).json({ ok: true })
        return
      }
      if (body.action === 'delete') {
        const [{ result: rows }] = await redis([['LRANGE', LIST, 0, 999]])
        const row = (rows ?? []).find((r) => {
          try { return JSON.parse(r).id === id } catch { return false }
        })
        const commands = [['HDEL', STATUS, id], ['DEL', `${LIST}:doc:${id}`]]
        if (row) commands.push(['LREM', LIST, 1, row])
        await redis(commands)
        res.status(200).json({ ok: true, found: !!row })
        return
      }
      res.status(400).json({ error: 'invalid action' })
      return
    }

    res.setHeader('Allow', 'GET, POST')
    res.status(405).json({ error: 'method not allowed' })
  } catch {
    res.status(502).json({ error: 'storage error' })
  }
}
