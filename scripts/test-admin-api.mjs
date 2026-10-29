// Tests de l'API d'administration des retours (faux Redis local) : npm test
import http from 'node:http'

const SECRET = 'un-mot-de-passe-solide-1234'

// faux Redis REST : commandes utilisées par api/admin.js
const db = { list: [], hash: {}, kv: {}, counters: {} }
const srv = http.createServer((req, res) => {
  let b = ''
  req.on('data', c => (b += c))
  req.on('end', () => {
    const out = JSON.parse(b).map(([cmd, ...a]) => {
      switch (cmd) {
        case 'GET': return { result: a[0].includes(':doc:') ? db.kv[a[0]] ?? null : db.counters[a[0]] != null ? String(db.counters[a[0]]) : null }
        case 'INCR': db.counters[a[0]] = (db.counters[a[0]] || 0) + 1; return { result: db.counters[a[0]] }
        case 'EXPIRE': return { result: 1 }
        case 'LRANGE': return { result: db.list.slice(Number(a[1]), Number(a[2]) + 1) }
        case 'LLEN': return { result: db.list.length }
        case 'HGETALL': return { result: Object.entries(db.hash).flatMap(([k, v]) => [k, v]) }
        case 'HGET': return { result: db.hash[a[1]] ?? null }
        case 'HSET': db.hash[a[1]] = a[2]; return { result: 1 }
        case 'HDEL': delete db.hash[a[1]]; return { result: 1 }
        case 'DEL': delete db.kv[a[0]]; return { result: 1 }
        case 'LREM': { const i = db.list.indexOf(a[2]); if (i >= 0) db.list.splice(i, 1); return { result: i >= 0 ? 1 : 0 } }
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
const target = new URL('../api/admin.js', import.meta.url).href
const { default: handler } = await import(target)

const call = (method, { auth, query = {}, body, ip = '1.2.3.4' } = {}) => new Promise(resolve => {
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v }, status(c) { this.code = c; return this }, json(o) { this.body = o; resolve(this) }, send(s) { this.body = s; resolve(this) }, end() { resolve(this) } }
  handler({ method, query, body, url: '/api/admin', headers: { 'x-forwarded-for': ip, ...(auth ? { authorization: 'Bearer ' + auth } : {}) } }, res)
})
let fails = 0
const check = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log((ok ? 'ok   ' : 'ÉCHEC') + ' ' + name + (ok ? '' : ` (obtenu ${JSON.stringify(got)}, attendu ${JSON.stringify(want)})`)) }

const entry = (id, type, title) => JSON.stringify({ id, ts: '2026-10-22T10:00:00.000Z', type, title, message: 'message de ' + title, meta: { build: 'abc' }, hasDoc: id === 'aaaa1111' })
db.list = [entry('aaaa1111', 'bug', 'Bug un'), entry('bbbb2222', 'idea', 'Idée deux'), entry('cccc3333', 'question', 'Question trois')]
db.kv['albertschema:feedback:doc:aaaa1111'] = JSON.stringify({ version: 1, symbols: [], wires: [] })

// ── accès
let r = await call('GET')
check('sans mot de passe -> 401', r.code, 401)
r = await call('GET', { auth: 'faux' })
check('mauvais mot de passe -> 401', r.code, 401)
r = await call('GET', { auth: SECRET, query: { action: 'list' } })
check('bon mot de passe -> 200, total et liste', [r.code, r.body.total, r.body.items.length], [200, 3, 3])
check('réponses jamais mises en cache', r.headers['Cache-Control'], 'no-store')
check('statut « nouveau » par défaut', r.body.items.map(i => i.status).join(), 'new,new,new')
check('ordre conservé (plus récent en premier)', r.body.items.map(i => i.id).join(), 'aaaa1111,bbbb2222,cccc3333')

// ── statut et note
r = await call('POST', { auth: SECRET, body: { action: 'status', id: 'bbbb2222', status: 'done' } })
check('changement de statut -> 200', r.code, 200)
r = await call('POST', { auth: SECRET, body: { action: 'note', id: 'bbbb2222', note: 'à planifier en novembre' } })
r = await call('GET', { auth: SECRET })
const two = r.body.items.find(i => i.id === 'bbbb2222')
check('statut et note conservés ensemble', [two.status, two.note], ['done', 'à planifier en novembre'])
r = await call('POST', { auth: SECRET, body: { action: 'mailed', id: 'bbbb2222' } })
r = await call('GET', { auth: SECRET })
const mailedItem = r.body.items.find(i => i.id === 'bbbb2222')
check('auteur prévenu : date enregistrée, statut et note conservés', [!!mailedItem.mailed, mailedItem.status, mailedItem.note], [true, 'done', 'à planifier en novembre'])
await call('POST', { auth: SECRET, body: { action: 'mailed', id: 'bbbb2222', mailed: false } })
r = await call('GET', { auth: SECRET })
check('repère « prévenu » retiré', r.body.items.find(i => i.id === 'bbbb2222').mailed, undefined)
r = await call('POST', { auth: SECRET, body: { action: 'status', id: 'bbbb2222', status: 'invalide' } })
check('statut inconnu -> 400', r.code, 400)
r = await call('POST', { auth: SECRET, body: { action: 'note', id: 'bbbb2222', note: 'x'.repeat(5000) } })
r = await call('GET', { auth: SECRET })
check('note tronquée à 1000 caractères', r.body.items.find(i => i.id === 'bbbb2222').note.length, 1000)
r = await call('POST', { auth: SECRET, body: { action: 'status', id: '../../etc', status: 'read' } })
check('identifiant invalide -> 400', r.code, 400)

// ── schéma joint
r = await call('GET', { auth: SECRET, query: { action: 'doc', id: 'aaaa1111' } })
check('schéma joint récupéré', [r.code, JSON.parse(r.body).version], [200, 1])
r = await call('GET', { auth: SECRET, query: { action: 'doc', id: 'bbbb2222' } })
check('pas de schéma -> 404', r.code, 404)

// ── suppression
r = await call('POST', { auth: SECRET, body: { action: 'delete', id: 'aaaa1111' } })
check('suppression -> 200, retrouvée', [r.code, r.body.found], [200, true])
check('suppression : entrée et schéma retirés', [db.list.length, 'albertschema:feedback:doc:aaaa1111' in db.kv], [2, false])
r = await call('POST', { auth: SECRET, body: { action: 'delete', id: 'dddd4444' } })
check('suppression d\'un identifiant inconnu : sans erreur', [r.code, r.body.found], [200, false])

// ── méthode
r = await call('PUT', { auth: SECRET })
check('méthode PUT -> 405', r.code, 405)

// ── essais répétés : blocage après 10 échecs, même avec le bon mot de passe
for (let i = 0; i < 10; i++) await call('GET', { auth: 'faux', ip: '6.6.6.6' })
r = await call('GET', { auth: 'faux', ip: '6.6.6.6' })
check('10 échecs -> 429', r.code, 429)
r = await call('GET', { auth: SECRET, ip: '6.6.6.6' })
check('adresse bloquée : même le bon mot de passe est refusé (429)', r.code, 429)
r = await call('GET', { auth: SECRET, ip: '7.7.7.7' })
check('une autre adresse n\'est pas affectée', r.code, 200)

// ── désactivée sans mot de passe configuré (ou trop court)
process.env.ADMIN_TOKEN = 'court'
const { default: h2 } = await import(target + '?short')
const r2 = await new Promise(resolve => { const res = { headers: {}, setHeader() {}, status(c) { this.code = c; return this }, json(o) { this.body = o; resolve(this) }, end() { resolve(this) } }; h2({ method: 'GET', query: {}, headers: {} }, res) })
check('mot de passe trop court : l\'API se comporte comme une route inexistante (404)', r2.code, 404)
delete process.env.ADMIN_TOKEN
const { default: h3 } = await import(target + '?none')
const r3 = await new Promise(resolve => { const res = { headers: {}, setHeader() {}, status(c) { this.code = c; return this }, json(o) { this.body = o; resolve(this) }, end() { resolve(this) } }; h3({ method: 'GET', query: {}, headers: {} }, res) })
check('sans mot de passe configuré : 404', r3.code, 404)

console.log(fails ? `\n${fails} ÉCHEC(S)` : '\ntous les tests de l\'API d\'administration passent')
srv.close()
process.exitCode = fails ? 1 : 0
setTimeout(() => process.exit(fails ? 1 : 0), 50)
