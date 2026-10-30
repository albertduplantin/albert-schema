// Tests de la mesure d'audience (api/visit.js) et de sa lecture par l'administration (faux Redis en mémoire) : npm test
import http from 'node:http'

const SECRET = 'un-mot-de-passe-solide-1234'
const store = { hash: {}, set: {}, hll: {}, num: {} }
const srv = http.createServer((req, res) => {
  let b = ''
  req.on('data', (c) => (b += c))
  req.on('end', () => {
    const out = JSON.parse(b).map(([cmd, ...a]) => {
      switch (cmd) {
        case 'INCR': store.num[a[0]] = (store.num[a[0]] || 0) + 1; return { result: store.num[a[0]] }
        case 'GET': return { result: store.num[a[0]] != null ? String(store.num[a[0]]) : null }
        case 'EXPIRE': return { result: 1 }
        case 'SADD': { const s = (store.set[a[0]] ??= new Set()); const had = s.has(a[1]); s.add(a[1]); return { result: had ? 0 : 1 } }
        case 'PFADD': (store.hll[a[0]] ??= new Set()).add(a[1]); return { result: 1 }
        case 'PFCOUNT': return { result: store.hll[a[0]]?.size ?? 0 }
        case 'HINCRBY': { const h = (store.hash[a[0]] ??= {}); h[a[1]] = (h[a[1]] || 0) + Number(a[2]); return { result: h[a[1]] } }
        case 'HGETALL': return { result: Object.entries(store.hash[a[0]] ?? {}).flatMap(([k, v]) => [k, String(v)]) }
        default: return { result: null }
      }
    })
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(out))
  })
}).listen(0)
await new Promise((r) => srv.once('listening', r))
process.env.KV_REST_API_URL = 'http://127.0.0.1:' + srv.address().port
process.env.KV_REST_API_TOKEN = 'tok'
process.env.ADMIN_TOKEN = SECRET
const { default: visit, normalizePage, originOf } = await import(new URL('../api/visit.js', import.meta.url).href)
const { default: admin } = await import(new URL('../api/admin.js', import.meta.url).href)

const run = (handler, req) => new Promise((resolve) => {
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v }, status(c) { this.code = c; return this }, json(o) { this.body = o; resolve(this) }, end() { resolve(this) } }
  handler(req, res)
})
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36'
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148'
const hit = (body, { ip = '1.1.1.1', ua = CHROME, country = 'FR', method = 'POST' } = {}) =>
  run(visit, { method, body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'x-forwarded-for': ip, 'user-agent': ua, 'x-vercel-ip-country': country, host: 'schema.albertduplantin.win' } })
const stats = (auth = SECRET) => run(admin, { method: 'GET', query: { action: 'stats', days: '7' }, url: '/api/admin?action=stats&days=7', headers: { 'x-forwarded-for': '9.9.9.9', ...(auth ? { authorization: 'Bearer ' + auth } : {}) } })

let fails = 0
const check = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log((ok ? 'ok   ' : 'ÉCHEC') + ' ' + name + (ok ? '' : ` (obtenu ${JSON.stringify(got)}, attendu ${JSON.stringify(want)})`)) }

// ── fonctions pures
check('page inconnue → éditeur', normalizePage('/n-importe-quoi'), '/')
check('page sans barre finale', normalizePage('/schema-hydraulique'), '/schema-hydraulique/')
check('paramètres ignorés', normalizePage('/en/?x=1'), '/en/')
check('origine : moteur de recherche', originOf('https://www.google.com/search?q=x', 'schema.albertduplantin.win'), 'google.com')
check('origine : le site lui-même', originOf('https://schema.albertduplantin.win/exemples/', 'schema.albertduplantin.win'), 'direct')
check('origine : vide', originOf('', 'x'), 'direct')
check('origine : illisible', originOf('pas une url', 'x'), 'direct')

// ── enregistrement
check('GET refusé', (await hit('', { method: 'GET' })).code, 405)
check('robot ignoré', (await hit({ p: '/' }, { ua: 'Googlebot/2.1' })).code, 204)
check('sans navigateur : ignoré', (await hit({ p: '/' }, { ua: '' })).code, 204)
check('aucune écriture pour un robot', Object.keys(store.hash).length, 0)

check('première visite', (await hit({ p: '/schema-hydraulique', r: 'https://www.google.com/', l: 'fr' })).code, 204)
await hit({ p: '/schema-hydraulique', r: 'https://www.google.com/', l: 'fr' }) // même personne, autre onglet
await hit({ p: '/', r: '', l: 'en' }, { ip: '2.2.2.2', ua: IPHONE, country: 'BE' })
await hit('pas du json', { ip: '3.3.3.3' })

const today = new Date().toISOString().slice(0, 10)
const day = store.hash[`albertschema:v:d:${today}`]
check('visites : 4', day.visits, 4)
check('visiteurs uniques : 3 (même IP et navigateur comptés une fois)', day.uniq, 3)
check('page d’arrivée hydraulique : 2', day['p:/schema-hydraulique/'], 2)
check('origine google.com : 2', day['r:google.com'], 2)
check('origine directe : 2', day['r:direct'], 2)
check('pays FR : 3, BE : 1', [day['c:FR'], day['c:BE']], [3, 1])
check('mobile : 1, ordinateur : 3', [day['d:mobile'], day['d:desktop']], [1, 3])
check('langue : fr 2, en 1', [day['l:fr'], day['l:en']], [2, 1])
check('aucune adresse IP dans les compteurs', JSON.stringify(store.hash).includes('1.1.1.1'), false)
check('aucune adresse IP dans les empreintes', JSON.stringify([...Object.values(store.set)].map((s) => [...s])).includes('1.1.1.1'), false)
check('visiteurs distincts du mois : 3', store.hll[`albertschema:v:m:${today.slice(0, 7)}`].size, 3)

// ── limitation de débit
let last = 0
for (let i = 0; i < 35; i++) last = (await hit({ p: '/' }, { ip: '8.8.8.8', ua: CHROME + i })).code
check('rafale depuis une adresse : refusée', last, 429)

// ── lecture par l’administration
check('statistiques sans mot de passe : 401', (await stats(null)).code, 401)
const s = await stats()
check('statistiques : 200', s.code, 200)
check('statistiques : 7 jours, le dernier est aujourd’hui', [s.body.days.length, s.body.days.at(-1).day], [7, today])
check('statistiques : visites du jour', s.body.days.at(-1).visits >= 4, true)
check('statistiques : page la plus vue', s.body.tops.pages[0][0] === '/' || s.body.tops.pages[0][0] === '/schema-hydraulique/', true)
check('statistiques : origine google.com présente', s.body.tops.origins.some(([k, n]) => k === 'google.com' && n === 2), true)
check('statistiques : mois courant', s.body.months[0].month, today.slice(0, 7))

srv.close()
console.log(fails ? `\n${fails} échec(s)` : '\ntout passe')
process.exit(fails ? 1 : 0)
