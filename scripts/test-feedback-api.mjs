// Tests de l'API des retours (faux Redis local) : npm test
import http from 'node:http'

// faux Redis REST (commandes utilisées par l'API)
const store = { list: [], kv: {}, counters: {}, ttl: {} }
const srv = http.createServer((req, res) => {
  let b = ''
  req.on('data', c => (b += c))
  req.on('end', () => {
    const out = JSON.parse(b).map(([cmd, ...a]) => {
      if (cmd === 'INCR') { store.counters[a[0]] = (store.counters[a[0]] || 0) + 1; return { result: store.counters[a[0]] } }
      if (cmd === 'EXPIRE') return { result: 1 }
      if (cmd === 'LPUSH') { store.list.unshift(a[1]); return { result: store.list.length } }
      if (cmd === 'LTRIM') { store.list = store.list.slice(Number(a[1]), Number(a[2]) + 1); return { result: 'OK' } }
      if (cmd === 'SET') { store.kv[a[0]] = a[1]; store.ttl[a[0]] = a[2] === 'EX' ? a[3] : null; return { result: 'OK' } }
    })
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(out))
  })
}).listen(0)
await new Promise(r => srv.once('listening', r))
process.env.KV_REST_API_URL = 'http://127.0.0.1:' + srv.address().port
process.env.KV_REST_API_TOKEN = 'tok'
const target = new URL('../api/feedback.js', import.meta.url).href
const { default: handler } = await import(target)

const call = (method, body, ip = '9.9.9.9') => new Promise(resolve => {
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v }, status(c) { this.code = c; return this }, json(o) { this.body = o; resolve(this) }, end() { resolve(this) } }
  handler({ method, body, headers: { 'x-forwarded-for': ip } }, res)
})
let fails = 0
const check = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log((ok ? 'ok   ' : 'ÉCHEC') + ' ' + name + (ok ? '' : ` (obtenu ${JSON.stringify(got)}, attendu ${JSON.stringify(want)})`)) }

const good = { type: 'bug', title: 'Le moteur ne tourne pas', message: 'Quand je presse S2, rien ne bouge dans mon schéma.', email: 'a@b.fr', meta: { build: 'abc1234', lang: 'fr', ua: 'Chrome', screen: '1600x900', symbols: 12, wires: 17 } }

let r = await call('POST', good)
check('envoi valide -> 200 avec identifiant', [r.code, typeof r.body.id], [200, 'string'])
check('entrée enregistrée dans la liste', store.list.length, 1)
const saved = JSON.parse(store.list[0])
check('contenu : type, titre, e-mail, métadonnées', [saved.type, saved.title, saved.email, saved.meta.build, saved.hasDoc], ['bug', good.title, 'a@b.fr', 'abc1234', false])

r = await call('POST', { ...good, includeDoc: true, doc: JSON.stringify({ version: 1, symbols: [], wires: [] }) }, '8.8.8.8')
const withDoc = JSON.parse(store.list[0])
check('schéma joint : rangé à part, expire à 90 jours', [withDoc.hasDoc, Object.keys(store.kv).length, Object.values(store.ttl)[0]], [true, 1, 7776000])
r = await call('POST', { ...good, includeDoc: true, doc: 'pas du json' }, '8.8.4.4')
check('schéma invalide ignoré (pas de pièce jointe)', JSON.parse(store.list[0]).hasDoc, false)
r = await call('POST', { ...good, includeDoc: true, doc: 'x'.repeat(300_001) }, '7.7.7.7')
check('schéma trop gros -> 413', r.code, 413)

r = await call('POST', { ...good, type: 'autre' }, '6.6.6.6'); check('type inconnu -> 400', r.code, 400)
r = await call('POST', { ...good, title: 'ab' }, '6.6.6.7'); check('titre trop court -> 400', r.code, 400)
r = await call('POST', { ...good, message: 'court' }, '6.6.6.8'); check('message trop court -> 400', r.code, 400)
r = await call('POST', { ...good, email: 'pas-un-email' }, '6.6.6.9'); check('e-mail invalide -> 400', r.code, 400)
const before = store.list.length
r = await call('POST', { ...good, website: 'http://spam.example' }, '5.5.5.5')
check('champ piège rempli : faux succès, rien enregistré', [r.code, store.list.length], [200, before])
r = await call('GET'); check('GET refusé -> 405', r.code, 405)
r = await call('POST', { ...good, title: 'x'.repeat(500), message: 'm'.repeat(9000) }, '4.4.4.4')
const long = JSON.parse(store.list[0])
check('champs tronqués (titre 120, message 4000)', [long.title.length, long.message.length], [120, 4000])

let codes = []
for (let i = 0; i < 7; i++) codes.push((await call('POST', good, '3.3.3.3')).code)
check('limite par adresse : 5 acceptés puis 429', [codes.filter(c => c === 200).length, codes.filter(c => c === 429).length], [5, 2])

delete process.env.KV_REST_API_URL
const { default: h2 } = await import(target + '?nokv')
const res2 = { setHeader() {}, status(c) { this.code = c; return this }, json(o) { this.body = o }, end() {} }
await h2({ method: 'POST', body: good, headers: {} }, res2)
check('sans stockage configuré -> 503', res2.code, 503)

console.log(fails ? `\n${fails} ÉCHEC(S)` : '\ntous les tests de l\'API passent')
srv.close()
process.exitCode = fails ? 1 : 0
setTimeout(() => process.exit(fails ? 1 : 0), 50)

