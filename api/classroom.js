// Suivi de progression par code de classe, sans compte.
//
//   POST /api/classroom  <- { code, pseudo, exercise }   (204)  l'élève a terminé un exercice
//   GET  /api/classroom?code=XXXX  -> { students: { [pseudo]: { [exercice]: horodatage } } }
//
//   POST /api/classroom  <- { code, pseudo, exercise?, work: { comment?, doc } }   (204)  rendu d'un schéma à l'enseignant (200 Ko, 300 rendus par classe)
//   GET  /api/classroom?code=XXXX&work=1                       -> { works: [{ pseudo, exercise, ts, comment }] }
//   GET  /api/classroom?code=XXXX&work=1&pseudo=P&exercise=E   -> { ts, comment, doc }
//
// Le code de classe est choisi par l'enseignant (3 à 24 caractères) et communiqué oralement : qui le connaît peut
// lire la progression, qui n'y figure que sous pseudonyme. Aucune adresse n'est conservée (limitation de débit à la minute).
// Stockage : Redis Upstash (variables KV_REST_API_URL / KV_REST_API_TOKEN), table à expiration de 180 jours.
const config = () => ({
  url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
})
const CODE = /^[A-Za-z0-9-]{3,24}$/
const EXO = /^[a-z]-[a-z0-9-]{1,30}$/
const MAX_PER_CLASS = 3000
const MAX_RPM = 30
const MAX_WORKS = 300
const MAX_WORK_BYTES = 200_000
const WORK_TTL = 60 * 60 * 24 * 180

async function redis(commands) {
  const { url, token } = config()
  const r = await fetch(`${url}/pipeline`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(commands) })
  if (!r.ok) throw new Error(`redis ${r.status}`)
  return r.json()
}

export default async function handler(req, res) {
  const { url, token } = config()
  if (!url || !token) { res.status(503).json({ error: 'storage not configured' }); return }
  try {
    if (req.method === 'GET') {
      const code = String(req.query?.code ?? '').toLowerCase()
      if (!CODE.test(code)) { res.status(400).json({ error: 'invalid code' }); return }
      if (req.query?.work) {
        const wk = `albertschema:class:${code}:work`
        res.setHeader('Cache-Control', 'no-store')
        const pseudo = String(req.query?.pseudo ?? '')
        const exercise = String(req.query?.exercise ?? '')
        if (pseudo || exercise) {
          const [{ result: one }] = await redis([['HGET', wk, `${pseudo}|${exercise}`]])
          if (!one) { res.status(404).json({ error: 'not found' }); return }
          res.status(200).json(JSON.parse(one))
          return
        }
        const [{ result: all }] = await redis([['HGETALL', wk]])
        const works = []
        for (let i = 0; i + 1 < (all?.length ?? 0); i += 2) {
          const [p, e] = String(all[i]).split('|')
          try { const { ts, comment } = JSON.parse(all[i + 1]); works.push({ pseudo: p, exercise: e, ts, comment }) } catch { /* entrée illisible ignorée */ }
        }
        works.sort((a, b) => b.ts - a.ts)
        res.status(200).json({ works })
        return
      }
      const [{ result }] = await redis([['HGETALL', `albertschema:class:${code}`]])
      const students = {}
      for (let i = 0; i < (result?.length ?? 0); i += 2) {
        const [pseudo, exo] = String(result[i]).split('|')
        if (pseudo && exo) (students[pseudo] ??= {})[exo] = Number(result[i + 1])
      }
      res.setHeader('Cache-Control', 'no-store')
      res.status(200).json({ students })
      return
    }
    if (req.method === 'POST') {
      let body = req.body
      if (typeof body === 'string') { try { body = JSON.parse(body) } catch { body = null } }
      const code = String(body?.code ?? '').toLowerCase()
      const pseudo = String(body?.pseudo ?? '').trim().replace(/[|\n\r]/g, ' ').slice(0, 30)
      const work = body?.work && typeof body.work === 'object' ? body.work : null
      const exercise = String(body?.exercise ?? (work ? 'w-rendu' : ''))
      if (!CODE.test(code) || !pseudo || !EXO.test(exercise)) { res.status(400).json({ error: 'invalid body' }); return }
      const ip = String(req.headers['x-forwarded-for'] || 'unknown').split(',')[0].trim()
      const rl = `albertschema:rl:class:${ip}:${Math.floor(Date.now() / 60000)}`
      const [{ result: hits }] = await redis([['INCR', rl], ['EXPIRE', rl, 120]])
      if (Number(hits) > MAX_RPM) { res.status(429).json({ error: 'too many requests' }); return }
      if (work) {
        const doc = work.doc
        if (!doc || typeof doc !== 'object' || !Array.isArray(doc.symbols) || !Array.isArray(doc.wires)) { res.status(400).json({ error: 'invalid work' }); return }
        const comment = String(work.comment ?? '').trim().slice(0, 500)
        const value = JSON.stringify({ ts: Date.now(), comment, doc })
        if (value.length > MAX_WORK_BYTES) { res.status(413).json({ error: 'too large' }); return }
        const wk = `albertschema:class:${code}:work`
        const field = `${pseudo}|${exercise}`
        const [{ result: count }, { result: had }] = await redis([['HLEN', wk], ['HEXISTS', wk, field]])
        if (!Number(had) && Number(count) >= MAX_WORKS) { res.status(413).json({ error: 'class full' }); return }
        await redis([['HSET', wk, field, value], ['EXPIRE', wk, WORK_TTL]])
        res.status(204).end()
        return
      }
      const key = `albertschema:class:${code}`
      const [{ result: n }] = await redis([['HLEN', key]])
      if (Number(n) >= MAX_PER_CLASS) { res.status(413).json({ error: 'class full' }); return }
      await redis([['HSET', key, `${pseudo}|${exercise}`, String(Date.now())], ['EXPIRE', key, 60 * 60 * 24 * 180]])
      res.status(204).end()
      return
    }
    res.setHeader('Allow', 'GET, POST')
    res.status(405).json({ error: 'method not allowed' })
  } catch {
    res.status(502).json({ error: 'storage error' })
  }
}
