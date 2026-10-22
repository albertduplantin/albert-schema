// Tests de la galerie d'exemples (API publique + gestion par l'administrateur), faux Redis local : npm test
import http from 'node:http'

const SECRET = 'un-mot-de-passe-solide-1234'
const hashes = {}, sets = {}, counters = {}
const srv = http.createServer((req, res) => {
  let b = ''
  req.on('data', c => (b += c))
  req.on('end', () => {
    const out = JSON.parse(b).map(([cmd, key, ...a]) => {
      switch (cmd) {
        case 'GET': return { result: counters[key] != null ? String(counters[key]) : null }
        case 'INCR': counters[key] = (counters[key] || 0) + 1; return { result: counters[key] }
        case 'EXPIRE': return { result: 1 }
        case 'HSET': (hashes[key] ??= {})[a[0]] = a[1]; return { result: 1 }
        case 'HGET': return { result: hashes[key]?.[a[0]] ?? null }
        case 'HDEL': delete hashes[key]?.[a[0]]; return { result: 1 }
        case 'HLEN': return { result: Object.keys(hashes[key] ?? {}).length }
        case 'HGETALL': return { result: Object.entries(hashes[key] ?? {}).flatMap(([k, v]) => [k, v]) }
        case 'SADD': (sets[key] ??= new Set()).add(a[0]); return { result: 1 }
        case 'SREM': sets[key]?.delete(a[0]); return { result: 1 }
        case 'SMEMBERS': return { result: [...(sets[key] ?? [])] }
        default: return { result: null }
      }
    })
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(out))
  })
}).listen(0)
await new Promise(r => srv.once('listening', r))
process.env.KV_REST_API_URL = 'http://127.0.0.1:' + srv.address().port
process.env.KV_REST_API_TOKEN = 'tok'
process.env.ADMIN_TOKEN = SECRET
const { default: admin } = await import(new URL('../api/admin.js', import.meta.url).href)
const { default: pub } = await import(new URL('../api/examples.js', import.meta.url).href)

const call = (handler, method, { auth, query = {}, body } = {}) => new Promise(resolve => {
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v }, status(c) { this.code = c; return this }, json(o) { this.body = o; resolve(this) }, send(s) { this.body = s; resolve(this) }, end() { resolve(this) } }
  handler({ method, query, body, url: '/api/x', headers: { 'x-forwarded-for': '9.9.9.9', ...(auth ? { authorization: 'Bearer ' + auth } : {}) } }, res)
})
let fails = 0
const check = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log((ok ? 'ok   ' : 'ÉCHEC') + ' ' + name + (ok ? '' : ` (obtenu ${JSON.stringify(got)}, attendu ${JSON.stringify(want)})`)) }

const doc = { version: 1, paper: 'A3', title: {}, symbols: [{ id: 's1' }, { id: 's2' }], wires: [] }
const ex = (extra = {}) => ({ action: 'ex-save', title: { fr: 'Mon exemple', en: 'My example' }, about: { fr: 'Description', en: 'Description' }, level: 2, order: 5, doc, ...extra })

let r = await call(pub, 'GET')
check('galerie publique vide au départ', [r.code, r.body.items.length, r.body.hidden.length], [200, 0, 0])
r = await call(admin, 'POST', { body: ex() })
check('création sans mot de passe refusée', r.code, 401)
r = await call(admin, 'POST', { auth: SECRET, body: ex() })
check('création avec mot de passe', [r.code, r.body.ok, typeof r.body.id], [200, true, 'string'])
const id = r.body.id
r = await call(pub, 'GET')
check('l exemple apparaît dans la liste publique, sans le schéma', [r.body.items.length, r.body.items[0].title.fr, r.body.items[0].level, r.body.items[0].n, 'doc' in r.body.items[0]], [1, 'Mon exemple', 2, 2, false])
r = await call(pub, 'GET', { query: { id } })
check('le schéma se télécharge par identifiant', [r.code, r.body.symbols.length], [200, 2])
r = await call(pub, 'GET', { query: { id: 'zzzz' } })
check('identifiant invalide -> 400', r.code, 400)
r = await call(pub, 'GET', { query: { id: 'aaaaaaaa' } })
check('identifiant inconnu -> 404', r.code, 404)

r = await call(admin, 'POST', { auth: SECRET, body: ex({ id, title: { fr: 'Renommé', en: 'Renamed' }, doc: undefined }) })
check('modification sans renvoyer le schéma', r.code, 200)
r = await call(pub, 'GET', { query: { id } })
check('le schéma est conservé', r.body.symbols.length, 2)
r = await call(admin, 'GET', { auth: SECRET, query: { action: 'examples' } })
check('liste d administration', [r.body.items.length, r.body.items[0].title.en], [1, 'Renamed'])

r = await call(admin, 'POST', { auth: SECRET, body: ex({ doc: { version: 2, symbols: [], wires: [] } }) })
check('schéma invalide refusé', r.code, 400)
r = await call(admin, 'POST', { auth: SECRET, body: ex({ doc: 'pas du json' }) })
check('JSON illisible refusé', r.code, 400)
r = await call(admin, 'POST', { auth: SECRET, body: ex({ title: { fr: '', en: 'x' } }) })
check('titre manquant refusé', r.code, 400)
r = await call(admin, 'POST', { auth: SECRET, body: ex({ doc: undefined }) })
check('nouvel exemple sans schéma refusé', r.code, 400)
r = await call(admin, 'POST', { auth: SECRET, body: ex({ doc: { ...doc, symbols: new Array(2001).fill({}) } }) })
check('schéma trop gros refusé', r.code, 400)

r = await call(admin, 'POST', { auth: SECRET, body: { action: 'ex-hide', key: 'tplMotor', hidden: true } })
r = await call(pub, 'GET')
check('exemple intégré masqué', r.body.hidden, ['tplMotor'])
r = await call(admin, 'POST', { auth: SECRET, body: { action: 'ex-hide', key: 'tplMotor', hidden: false } })
r = await call(pub, 'GET')
check('exemple intégré ré-affiché', r.body.hidden, [])
r = await call(admin, 'POST', { auth: SECRET, body: { action: 'ex-hide', key: '../x', hidden: true } })
check('clé d exemple intégré invalide refusée', r.code, 400)

r = await call(admin, 'POST', { auth: SECRET, body: { action: 'ex-delete', id } })
r = await call(pub, 'GET')
check('suppression', r.body.items.length, 0)
r = await call(pub, 'POST')
check('API publique : POST refusé', r.code, 405)

console.log(fails ? `\n${fails} ÉCHEC(S)` : '\ntous les tests de la galerie passent')
process.exit(fails ? 1 : 0)
