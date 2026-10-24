// Tests du suivi de progression par code de classe, faux Redis local : npm test
import http from 'node:http'

const hashes = {}, counters = {}
const srv = http.createServer((req, res) => {
  let b = ''
  req.on('data', c => (b += c))
  req.on('end', () => {
    const out = JSON.parse(b).map(([cmd, key, ...a]) => {
      switch (cmd) {
        case 'INCR': counters[key] = (counters[key] || 0) + 1; return { result: counters[key] }
        case 'EXPIRE': return { result: 1 }
        case 'HSET': (hashes[key] ??= {})[a[0]] = a[1]; return { result: 1 }
        case 'HLEN': return { result: Object.keys(hashes[key] ?? {}).length }
        case 'HGETALL': return { result: Object.entries(hashes[key] ?? {}).flatMap(([k, v]) => [k, v]) }
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
const { default: api } = await import(new URL('../api/classroom.js', import.meta.url).href)
const call = (method, { query = {}, body } = {}) => new Promise(resolve => {
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v }, status(c) { this.code = c; return this }, json(o) { this.body = o; resolve(this) }, end() { resolve(this) } }
  api({ method, query, body, headers: { 'x-forwarded-for': '1.2.3.4' } }, res)
})
let fails = 0
const check = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log((ok ? 'ok   ' : 'ECHEC') + ' ' + name + (ok ? '' : ` (obtenu ${JSON.stringify(got)}, attendu ${JSON.stringify(want)})`)) }

check('envoi valide', (await call('POST', { body: { code: 'Classe-1A', pseudo: 'Léa', exercise: 'e-lamp' } })).code, 204)
await call('POST', { body: { code: 'classe-1a', pseudo: 'Léa', exercise: 'e-startstop' } })
await call('POST', { body: { code: 'CLASSE-1A', pseudo: 'Tom', exercise: 'e-lamp' } })
const g = await call('GET', { query: { code: 'classe-1a' } })
check('lecture : deux élèves, la casse du code est ignorée', [Object.keys(g.body.students).sort(), Object.keys(g.body.students['Léa']).sort()], [['Léa', 'Tom'], ['e-lamp', 'e-startstop']])
check('code trop court refusé', (await call('POST', { body: { code: 'ab', pseudo: 'x', exercise: 'e-lamp' } })).code, 400)
check('exercice invalide refusé', (await call('POST', { body: { code: 'abcd', pseudo: 'x', exercise: '../etc' } })).code, 400)
check('pseudo vide refusé', (await call('POST', { body: { code: 'abcd', pseudo: '  ', exercise: 'e-lamp' } })).code, 400)
check('lecture sans code valide refusée', (await call('GET', { query: { code: 'a' } })).code, 400)
check('méthode non permise', (await call('DELETE')).code, 405)
srv.closeAllConnections?.(); srv.close()
console.log(fails ? `\n${fails} ECHEC(S)` : '\ntous les tests de suivi de classe passent')
process.exit(fails ? 1 : 0)
