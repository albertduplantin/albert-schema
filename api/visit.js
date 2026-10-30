// Mesure d'audience sans cookie : une visite = une session de navigation (un onglet), comptée une fois.
//
//   POST /api/visit  <- { p: chemin de la page d'arrivée, r: page précédente (document.referrer), l: langue du navigateur }   (204)
//
// Vie privée : aucun cookie, aucun identifiant stocké chez le visiteur. Le « visiteur unique du jour » est une empreinte
// SHA-256 de (sel secret + jour + adresse IP + navigateur) : le jour change l'empreinte chaque jour, l'adresse IP n'est jamais
// enregistrée (seule l'empreinte l'est, 2 jours, pour ne pas compter deux fois la même personne). Les compteurs gardés
// longtemps sont agrégés : pages d'arrivée, site d'origine (nom de domaine seulement), pays (en-tête Vercel), type d'appareil, langue.
// Robots, localhost et navigateurs réglés sur « Do Not Track » ne sont pas comptés (voir public/v.js).
//
// Stockage Redis (Upstash) :
//   albertschema:v:d:<AAAA-MM-JJ>  hash de compteurs du jour : visits, uniq, p:<page>, r:<origine>, c:<pays>, d:<appareil>, l:<langue> (400 jours)
//   albertschema:v:u:<AAAA-MM-JJ>  ensemble d'empreintes du jour (2 jours)
//   albertschema:v:m:<AAAA-MM>     HyperLogLog : visiteurs distincts du mois, empreinte propre au mois (400 jours)
import { createHash } from 'node:crypto'

export const PAGES = ['/', '/schema-electrique/', '/schema-pneumatique/', '/schema-hydraulique/', '/exercices-guides/', '/exemples/', '/en/']
const KNOWN = new Set(PAGES)
const BOT = /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|monitor|uptime|curl|wget|python|java\/|go-http|node-fetch|axios|facebookexternalhit/i
const KEEP = 400 * 86400
const MAX_PER_MINUTE = 30

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

const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16)

/** Page d'arrivée connue (les autres chemins comptent pour l'éditeur « / »). */
export function normalizePage(p) {
  let s = String(p ?? '/').split(/[?#]/)[0]
  if (!s.endsWith('/')) s += '/'
  return KNOWN.has(s) ? s : '/'
}

/** Nom de domaine d'origine (sans « www. »), « direct » si absent, illisible ou interne au site. */
export function originOf(referrer, ownHost = '') {
  try {
    const h = new URL(String(referrer)).hostname.toLowerCase().replace(/^www\./, '')
    const own = String(ownHost).toLowerCase().replace(/^www\./, '').replace(/:\d+$/, '')
    if (!/^[a-z0-9.-]{3,60}$/.test(h)) return 'direct'
    if (h === own || h === 'albertduplantin.win' || h.endsWith('.albertduplantin.win') || h === 'albert-schema.vercel.app') return 'direct'
    return h
  } catch {
    return 'direct'
  }
}

export default async function handler(req, res) {
  const { url, token } = config()
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    res.status(405).json({ error: 'method not allowed' })
    return
  }
  const ua = String(req.headers['user-agent'] || '')
  if (!url || !token || !ua || BOT.test(ua)) {
    res.status(204).end()
    return
  }
  try {
    let body = req.body
    if (typeof body === 'string') {
      try { body = JSON.parse(body) } catch { body = null }
    }
    const page = normalizePage(body?.p)
    const origin = originOf(body?.r, req.headers.host)
    const lang = ['fr', 'en'].includes(String(body?.l)) ? String(body.l) : ''
    const country = /^[A-Z]{2}$/.test(String(req.headers['x-vercel-ip-country'] || '')) ? String(req.headers['x-vercel-ip-country']) : 'XX'
    const device = /mobi|android|iphone|ipad/i.test(ua) ? 'mobile' : 'desktop'

    const ip = String(req.headers['x-forwarded-for'] || 'unknown').split(',')[0].trim()
    const now = new Date()
    const day = now.toISOString().slice(0, 10)
    const month = day.slice(0, 7)
    const salt = process.env.STATS_SALT || process.env.ADMIN_TOKEN || token
    const rl = `albertschema:rl:visit:${ip}:${Math.floor(now.getTime() / 60000)}`
    const setKey = `albertschema:v:u:${day}`
    const [{ result: hits }, , { result: fresh }] = await redis([
      ['INCR', rl], ['EXPIRE', rl, 120],
      ['SADD', setKey, sha(`${salt}|${day}|${ip}|${ua}`)], ['EXPIRE', setKey, 172800],
    ])
    if (Number(hits) > MAX_PER_MINUTE) {
      res.status(429).json({ error: 'too many requests' })
      return
    }
    const d = `albertschema:v:d:${day}`
    const m = `albertschema:v:m:${month}`
    const commands = [
      ['HINCRBY', d, 'visits', 1],
      ['HINCRBY', d, `p:${page}`, 1],
      ['HINCRBY', d, `r:${origin}`, 1],
      ['HINCRBY', d, `c:${country}`, 1],
      ['HINCRBY', d, `d:${device}`, 1],
      ['EXPIRE', d, KEEP],
      ['PFADD', m, sha(`${salt}|${month}|${ip}|${ua}`)],
      ['EXPIRE', m, KEEP],
    ]
    if (Number(fresh) === 1) commands.push(['HINCRBY', d, 'uniq', 1])
    if (lang) commands.push(['HINCRBY', d, `l:${lang}`, 1])
    await redis(commands)
    res.status(204).end()
  } catch {
    res.status(204).end() // une mesure ratée ne doit jamais gêner le visiteur
  }
}
