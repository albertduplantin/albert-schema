// Tests de la sauvegarde en ligne par code de reprise, faux Redis local : npm test
import http from 'node:http'

const kv = {}, counters = {}
const srv = http.createServer((req, res) => {
  let b = ''
  req.on('data', c => (b += c))
  req.on('end', () => {
    const out = JSON.parse(b).map(([cmd, key, ...a]) => {
      switch (cmd) {
        case 'INCR': counters[key] = (counters[key] || 0) + 1; return { result: counters[key] }
        case 'EXPIRE': return { result: 1 }
        case 'GET': return { result: kv[key] ?? null }
        case 'SET': if (a.includes('NX') && key in kv) return { result: null }; kv[key] = a[0]; return { result: 'OK' }
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
const { default: api, normalizeCode } = await import(new URL('../api/saves.js', import.meta.url).href)
let ipn = 0
const call = (method, { query = {}, body, ip } = {}) => new Promise(resolve => {
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v }, status(c) { this.code = c; return this }, json(o) { this.body = o; resolve(this) }, end() { resolve(this) } }
  api({ method, query, body, headers: { 'x-forwarded-for': ip ?? '10.0.0.' + (++ipn) } }, res)
})
let fails = 0
const check = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log((ok ? 'ok   ' : 'ECHEC') + ' ' + name + (ok ? '' : ` (obtenu ${JSON.stringify(got)}, attendu ${JSON.stringify(want)})`)) }

const doc = (n) => ({ version: 1, paper: 'A3', title: {}, symbols: Array.from({ length: n }, (_, i) => ({ id: 's' + i })), wires: [] })
const created = await call('POST', { body: { doc: doc(3) } })
check('création : 201 et un code de 12 caractères', [created.code, /^[0-9A-HJKMNP-TV-Z]{12}$/.test(created.body.code)], [201, true])
const code = created.body.code
const dashed = code.replace(/(.{4})(.{4})(.{4})/, '$1-$2-$3').toLowerCase()
check('lecture : la casse et les tirets du code sont ignorés', (await call('GET', { query: { code: dashed } })).body.doc.symbols.length, 3)
check('mise à jour : 204', (await call('POST', { body: { code, doc: doc(5) } })).code, 204)
check('lecture après mise à jour', (await call('GET', { query: { code } })).body.doc.symbols.length, 5)
check('version précédente : celle d’avant la première mise à jour (3 symboles)', (await call('GET', { query: { code, v: 'prev' } })).body.doc.symbols.length, 3)
await call('POST', { body: { code, doc: doc(7) } })
check('une seule ancienne version par heure : la précédente reste celle de 3 symboles', (await call('GET', { query: { code, v: 'prev' } })).body.doc.symbols.length, 3)
check('mise à jour d’un code inconnu : 404 (on ne crée pas de clé arbitraire)', (await call('POST', { body: { code: 'ABCDEFGHJKMN', doc: doc(1) } })).code, 404)
check('lecture d’un code inconnu : 404', (await call('GET', { query: { code: 'ABCDEFGHJKMN' } })).code, 404)
check('code mal formé refusé', (await call('GET', { query: { code: 'abc' } })).code, 400)
check('document invalide refusé', (await call('POST', { body: { doc: { version: 2 } } })).code, 400)
check('document trop gros refusé', (await call('POST', { body: { doc: { ...doc(1), notes: 'x'.repeat(1_000_000) } } })).code, 413)
check('confusions O/0 et I/L/1 corrigées', normalizeCode('o1il-0'), '01110')
for (let i = 0; i < 12; i++) await call('POST', { body: { doc: doc(1) }, ip: '9.9.9.9' })
check('création limitée par heure et par adresse', (await call('POST', { body: { doc: doc(1) }, ip: '9.9.9.9' })).code, 429)
check('méthode non permise', (await call('DELETE')).code, 405)
srv.closeAllConnections?.(); srv.close()
console.log(fails ? `\n${fails} ECHEC(S)` : '\ntous les tests de sauvegarde en ligne passent')
process.exit(fails ? 1 : 0)
