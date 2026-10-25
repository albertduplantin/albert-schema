import { readFileSync } from 'node:fs'
const ROOT = '..'
const { SYMBOLS, SYMBOL_MAP } = await import(ROOT + '/src/symbols/index.ts')
const lib = (await import('./lib-full.mjs')).loadFull()
for (const s of lib.symbols) { SYMBOLS.push(s); SYMBOL_MAP[s.id] = s }
const { organizeSources } = await import(ROOT + '/src/symbols/sources.ts')
organizeSources(SYMBOLS)
const { fieldsFor, kindOf } = await import(ROOT + '/src/ratings.ts')
const els = SYMBOLS.filter((s: any) => s.domain === 'electrical' && !s.legacy && !/^sim-/.test(s.id))
const hidden = SYMBOLS.filter((s: any) => s.domain === 'electrical' && s.legacy && !/10_electric/.test(s.id) === false)
console.log('symboles électriques de la palette :', els.length)
const byCat = new Map<string, any[]>()
for (const s of els) { const k = s.menu ?? s.cat; byCat.set(k, [...(byCat.get(k) ?? []), s]) }
const rows: string[] = []
let sim = 0, par = 0, none = 0
for (const [cat, list] of [...byCat.entries()].sort()) {
  let c = { n: list.length, sim: 0, par: 0, both: 0 }
  for (const s of list) {
    const hasSim = !!s.sim
    const hasPar = fieldsFor(s).length > 0 || ['coil', 'load', 'transformer'].includes(s.sim?.k) || (s.sim?.k === 'switch' && s.sim.delay) || s.sim?.k === 'source'
    if (hasSim) c.sim++
    if (hasPar) c.par++
    if (hasSim && hasPar) c.both++
    if (hasSim) sim++; else none++
    if (hasPar) par++
  }
  rows.push(`${cat.replace('10_electric_','').padEnd(70)} ${String(c.n).padStart(4)}  simulables ${String(c.sim).padStart(4)}  paramétrables ${String(c.par).padStart(4)}`)
}
console.log(rows.join('\n'))
console.log('TOTAL simulables', sim, '/', els.length, ' — paramétrables', par)
// détail des modèles de simulation
const kinds = new Map<string, number>()
for (const s of els) kinds.set(s.sim?.k ?? '(aucun)', (kinds.get(s.sim?.k ?? '(aucun)') ?? 0) + 1)
console.log([...kinds.entries()].map(([k, n]) => `${k}: ${n}`).join(' | '))
// ce qui n'est pas simulé : par catégorie, 3 exemples
const detail = new Map<string, string[]>()
for (const s of els.filter((x: any) => !x.sim)) { const k = (s.menu ?? s.cat).replace('10_electric_', ''); detail.set(k, [...(detail.get(k) ?? []), s.name.fr]) }
for (const [k, v] of [...detail.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 25)) console.log(k.padEnd(60), v.length, '| ex:', v.slice(0, 4).join(' ; '))

// ── cohérence des modèles de simulation : chaque borne citée existe
const { isOperableDef } = await import(ROOT + '/src/sim/engine.ts')
const everything = SYMBOLS.filter((s: any) => !s.legacy && !/^sim-/.test(s.id))
const problems: string[] = []
for (const s of everything) {
  const ports = new Set(s.ports.map((p: any) => p.id))
  const m = s.sim
  const need = (ids: string[], what: string) => { for (const id of ids) if (!ports.has(id)) problems.push(`${s.id} : ${what} cite la borne ${id}, absente`) }
  if (m?.k === 'switch') { need(m.poles.flat(), 'pôles'); need((m.changeover ?? []).flat(), 'inverseur') }
  else if (m?.k === 'coil') need(m.ports, 'bobine')
  else if (m?.k === 'load') need(m.ports, 'récepteur')
  else if (m?.k === 'transformer') { need(m.primary, 'primaire'); need(m.secondary, 'secondaire') }
  else if (m?.k === 'source') need(Object.keys(m.pot), 'source')
  const f = s.fluid
  if (f) { if (f.ports) need(f.ports, 'fluide'); if (f.k === 'cyl') need([f.cap, ...(f.rod ? [f.rod] : [])], 'vérin'); if (f.k === 'valve') need([...f.rest.flat(), ...f.act.flat()], 'distributeur') }
}
console.log('')
console.log('cohérence des modèles (bornes citées existantes) :', problems.length ? problems.length + ' problème(s)' : 'aucun problème')
for (const p of problems.slice(0, 20)) console.log('  ', p)
const sw = els.filter((s: any) => s.sim?.k === 'switch')
const ctl = new Map<string, number>()
for (const s of sw) ctl.set(s.sim.ctl, (ctl.get(s.sim.ctl) ?? 0) + 1)
console.log('contacts par commande :', [...ctl.entries()].map(([k, n]) => `${k}: ${n}`).join(' | '), '— manœuvrables en simulation :', sw.filter((s: any) => isOperableDef(s)).length)
const noPar = new Map<string, string[]>()
for (const s of els.filter((x: any) => x.sim)) {
  const has = fieldsFor(s).length > 0 || ['coil', 'load', 'transformer', 'source'].includes(s.sim.k) || (s.sim.k === 'switch' && s.sim.delay)
  if (!has) { const k = (s.menu ?? s.cat).replace('10_electric_', '') + ' / ' + s.sim.ctl; noPar.set(k, [...(noPar.get(k) ?? []), s.name.fr]) }
}
console.log('')
console.log('simulables sans caractéristique à régler :')
for (const [k, v] of [...noPar.entries()].sort((a, b) => b[1].length - a[1].length)) console.log('  ', k.padEnd(60), v.length, '| ex:', v.slice(0, 3).join(' ; '))
console.log('\n=== détail non simulés ===')
for (const cat of ['380_signaling_operating', '130_terminals_terminal_strips', '391_consumers_actuators', '310_relays_contactors_contacts', '200_fuses_protective_gears', '114_connections']) {
  const l = els.filter((s: any) => !s.sim && (s.menu ?? s.cat).endsWith('10_allpole/' + cat) || !s.sim && (s.menu ?? s.cat) === '10_electric_10_allpole/' + cat)
  console.log('--', cat, l.length)
  console.log(l.map((s: any) => s.id.split('/').slice(-2).join('/') + ' = ' + s.name.fr.slice(0, 45)).join('\n'))
}
