// Administration des retours des utilisateurs (lecture, statut, notes, suppression).
//
//   GET  /api/admin?action=list            -> { total, items: [{ …retour, status, note }] }   (300 plus récents)
//   GET  /api/admin?action=doc&id=<id>     -> schéma joint (JSON brut)
//   POST /api/admin { action: 'status' | 'note' | 'delete', id, status?, note? }
//   GET  /api/admin?action=examples        -> { items: [exemples enregistrés, sans le schéma], hidden: [clés d'exemples intégrés masqués] }
//   GET  /api/admin?action=exos            -> { items: [exercices guidés publiés, sans le schéma] }
//   POST /api/admin { action: 'xo-save', id?, domain, level, minutes, order, title, summary, brief:[…], expect:[…], doc } | { action: 'xo-delete', id }
//   POST /api/admin { action: 'ex-save', id?, title:{fr,en}, about:{fr,en}, level, order, doc }   -> { ok, id }
//   POST /api/admin { action: 'ex-delete', id }   |   { action: 'ex-hide', key, hidden }
//
// Accès : en-tête `Authorization: Bearer <ADMIN_TOKEN>`. Sans variable d'environnement ADMIN_TOKEN (10 caractères minimum), l'API
// répond 404 comme si elle n'existait pas. Les mauvais essais sont comptés par adresse (10 par quart d'heure, puis 429).
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'

const LIST = 'albertschema:feedback'
const STATUS = 'albertschema:feedback:status'
const STATUSES = new Set(['new', 'read', 'done', 'spam'])
const MAX_FAILS = 10
const MAX_NOTE = 1000
const LIMIT = 300
const EXAMPLES = 'albertschema:examples'
const HIDDEN = 'albertschema:examples:hidden'
const MAX_EXAMPLES = 100
const EXOS = 'albertschema:exos'
const MAX_EXOS = 60
const lines = (v, n, max) => (Array.isArray(v) ? v.map((x) => text(x, max)).filter(Boolean).slice(0, n) : [])
const MAX_EXAMPLE_DOC = 400_000
const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

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
  if (!secret || secret.length < 10 || !url || !token) {
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
      if (action === 'examples') {
        const [{ result: rows }, { result: hidden }] = await redis([['HGETALL', EXAMPLES], ['SMEMBERS', HIDDEN]])
        const items = []
        for (let i = 1; i < (rows?.length ?? 0); i += 2) {
          try {
            const { doc, ...meta } = JSON.parse(rows[i])
            items.push(meta)
          } catch { /* entrée illisible ignorée */ }
        }
        items.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || String(a.ts).localeCompare(String(b.ts)))
        res.status(200).json({ items, hidden: hidden ?? [] })
        return
      }
      if (action === 'exos') {
        const [{ result: rows }] = await redis([['HGETALL', EXOS]])
        const items = []
        for (let i = 1; i < (rows?.length ?? 0); i += 2) {
          try { const { doc, ...meta } = JSON.parse(rows[i]); items.push(meta) } catch { /* entrée illisible ignorée */ }
        }
        items.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || String(a.ts).localeCompare(String(b.ts)))
        res.status(200).json({ items })
        return
      }
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
      if (body && body.action === 'ex-save') {
        const title = { fr: text(body.title?.fr, 120), en: text(body.title?.en, 120) }
        const about = { fr: text(body.about?.fr, 400), en: text(body.about?.en, 400) }
        const level = [1, 2, 3].includes(Number(body.level)) ? Number(body.level) : 1
        const order = Number.isFinite(Number(body.order)) ? Math.max(-999, Math.min(999, Math.round(Number(body.order)))) : 0
        const id = body.id ? String(body.id) : randomUUID().slice(0, 8)
        if (!validId(id) || !title.fr || !title.en) {
          res.status(400).json({ error: 'invalid example' })
          return
        }
        let doc = body.doc
        if (doc !== undefined) {
          const raw = typeof doc === 'string' ? doc : JSON.stringify(doc)
          let parsed
          try { parsed = JSON.parse(raw) } catch { parsed = null }
          if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.symbols) || !Array.isArray(parsed.wires) || parsed.symbols.length > 2000 || raw.length > MAX_EXAMPLE_DOC) {
            res.status(400).json({ error: 'invalid document' })
            return
          }
          doc = parsed
        }
        const [{ result: existing }, { result: count }] = await redis([['HGET', EXAMPLES, id], ['HLEN', EXAMPLES]])
        if (!existing && Number(count ?? 0) >= MAX_EXAMPLES) {
          res.status(400).json({ error: 'too many examples' })
          return
        }
        let prev = {}
        try { prev = existing ? JSON.parse(existing) : {} } catch { prev = {} }
        if (!doc && !prev.doc) {
          res.status(400).json({ error: 'document required' })
          return
        }
        const entry = { id, title, about, level, order, ts: prev.ts ?? new Date().toISOString(), n: (doc ?? prev.doc).symbols.length, doc: doc ?? prev.doc }
        await redis([['HSET', EXAMPLES, id, JSON.stringify(entry)]])
        res.status(200).json({ ok: true, id })
        return
      }
      if (body && body.action === 'ex-delete' && validId(body.id)) {
        await redis([['HDEL', EXAMPLES, body.id]])
        res.status(200).json({ ok: true })
        return
      }
      if (body && body.action === 'ex-hide' && typeof body.key === 'string' && /^[A-Za-z0-9]{2,40}$/.test(body.key)) {
        await redis([[body.hidden ? 'SADD' : 'SREM', HIDDEN, body.key]])
        res.status(200).json({ ok: true })
        return
      }
      if (body && body.action === 'xo-save') {
        const title = { fr: text(body.title?.fr, 120), en: text(body.title?.en, 120) }
        const summary = { fr: text(body.summary?.fr, 300), en: text(body.summary?.en, 300) }
        const brief = { fr: lines(body.brief?.fr, 8, 700), en: lines(body.brief?.en, 8, 700) }
        const expect = { fr: lines(body.expect?.fr, 12, 300), en: lines(body.expect?.en, 12, 300) }
        const domain = ['electrical', 'pneumatic', 'hydraulic'].includes(body.domain) ? body.domain : 'electrical'
        const level = [1, 2, 3].includes(Number(body.level)) ? Number(body.level) : 1
        const minutes = Math.max(5, Math.min(180, Math.round(Number(body.minutes) || 20)))
        const order = Number.isFinite(Number(body.order)) ? Math.max(-999, Math.min(999, Math.round(Number(body.order)))) : 0
        const id = body.id ? String(body.id) : randomUUID().slice(0, 8)
        if (!validId(id) || !title.fr || !brief.fr.length || !expect.fr.length) {
          res.status(400).json({ error: 'invalid exercise' })
          return
        }
        let doc = body.doc
        if (doc !== undefined) {
          const raw = typeof doc === 'string' ? doc : JSON.stringify(doc)
          let parsed
          try { parsed = JSON.parse(raw) } catch { parsed = null }
          if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.symbols) || !Array.isArray(parsed.wires) || parsed.symbols.length > 2000 || raw.length > MAX_EXAMPLE_DOC) {
            res.status(400).json({ error: 'invalid document' })
            return
          }
          doc = parsed
        }
        const [{ result: existing }, { result: count }] = await redis([['HGET', EXOS, id], ['HLEN', EXOS]])
        if (!existing && Number(count ?? 0) >= MAX_EXOS) {
          res.status(400).json({ error: 'too many exercises' })
          return
        }
        let prev = {}
        try { prev = existing ? JSON.parse(existing) : {} } catch { prev = {} }
        if (!doc && !prev.doc) {
          res.status(400).json({ error: 'document required' })
          return
        }
        const entry = { id, domain, level, minutes, order, title: { fr: title.fr, en: title.en || title.fr }, summary: { fr: summary.fr, en: summary.en || summary.fr },
          brief: { fr: brief.fr, en: brief.en.length ? brief.en : brief.fr }, expect: { fr: expect.fr, en: expect.en.length ? expect.en : expect.fr },
          ts: prev.ts ?? new Date().toISOString(), n: (doc ?? prev.doc).symbols.length, doc: doc ?? prev.doc }
        await redis([['HSET', EXOS, id, JSON.stringify(entry)]])
        res.status(200).json({ ok: true, id })
        return
      }
      if (body && body.action === 'xo-delete' && validId(body.id)) {
        await redis([['HDEL', EXOS, body.id]])
        res.status(200).json({ ok: true })
        return
      }
      if (body && String(body.action).startsWith('xo-')) {
        res.status(400).json({ error: 'invalid request' })
        return
      }
      if (body && String(body.action).startsWith('ex-')) {
        res.status(400).json({ error: 'invalid request' })
        return
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
