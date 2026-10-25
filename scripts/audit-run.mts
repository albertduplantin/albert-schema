// Essai fonctionnel de tous les symboles électriques simulables : chacun est posé dans un petit circuit et doit se comporter selon son modèle. npm test
import { readFileSync } from 'node:fs'
const ROOT = '..'
const { SYMBOLS, SYMBOL_MAP } = await import(ROOT + '/src/symbols/index.ts')
const lib = (await import('./lib-full.mjs')).loadFull()
for (const s of lib.symbols) { SYMBOLS.push(s); SYMBOL_MAP[s.id] = s }
const { simulate, isOperableDef } = await import(ROOT + '/src/sim/engine.ts')
const T = await import(ROOT + '/src/templates.ts')
const base: any = { version: 1, paper: 'A3', title: {}, symbols: [], wires: [] }
const LAMP = 'qet:10_electric/10_allpole/380_signaling_operating/11_optical_signaling/lampe2'
const COIL = 'qet:10_electric/10_allpole/310_relays_contactors_contacts/01_coils/bobine3'
const els = SYMBOLS.filter((s: any) => s.domain === 'electrical' && !s.legacy && !/^sim-/.test(s.id) && s.sim)
const fails: string[] = []
let n = 0
const run = (d: any, press: string[] = [], toggled: string[] = []) => simulate(d, SYMBOL_MAP, {}, { pressed: new Set(press), toggled: new Set(toggled) }, 1_000_000)
for (const s of els) {
  const m = s.sim
  n++
  try {
    if (m.k === 'load' && m.windings) {
      // moteur à enroulements séparés : étoile (bornes de fin reliées entre elles) sur un réseau triphasé
      const tops = m.windings.map((w: string[]) => w[0]), bots = m.windings.map((w: string[]) => w[1])
      const d = T.build(base, [['src', 'sim-src3', 100, 30], ['x', s.id, 100, 100, 'X1']], [['src', 'a', 'x', tops[0]], ['src', 'b', 'x', tops[1]], ['src', 'c', 'x', tops[2]], ['x', bots[0], 'x', bots[1]], ['x', bots[1], 'x', bots[2]]])
      const r = run(d)
      if (!r.energized.has(d.symbols.find((x: any) => x.label === 'X1').id)) fails.push(`${s.name.fr} (moteur à enroulements) : couplage étoile non alimenté`)
    } else if (m.k === 'ssr') {
      const d = T.build(base, [['src', 'sim-src1', 100, 30], ['x', s.id, 100, 100, 'X1'], ['h', LAMP, 100, 240, 'H1']], [['src', 'a', 'x', m.input[0]], ['x', m.input[1], 'src', 'b'], ['src', 'a', 'x', m.poles[0][0]], ['x', m.poles[0][1], 'h', 't0'], ['h', 't1', 'src', 'b']])
      if (!run(d).energized.has(d.symbols.find((x: any) => x.label === 'H1').id)) fails.push(`${s.name.fr} (relais statique) : la sortie ne suit pas l'entrée`)
    } else if (m.k === 'load' || m.k === 'coil') {
      const ps = m.ports
      const d = T.build(base, [['src', 'sim-src1', 100, 30], ['x', s.id, 100, 100, 'X1']], [['src', 'a', 'x', ps[0]], ...(ps[1] ? [['x', ps[1], 'src', 'b']] : [])])
      const r = run(d)
      if (ps.length >= 2 && !r.energized.has(d.symbols.find((x: any) => x.label === 'X1').id)) fails.push(`${s.name.fr} (${m.k}) : non alimenté entre ses deux bornes`)
    } else if (m.k === 'switch') {
      if (m.sel) {
        // sélecteur à N positions : la lampe est sur la sortie 1 (position par défaut)
        const d = T.build(base, [['src', 'sim-src1', 100, 30], ['x', s.id, 100, 100, 'S1'], ['h', LAMP, 100, 240, 'H1']], [['src', 'a', 'x', m.sel.com], ['x', m.sel.outs[0], 'h', 't0'], ['h', 't1', 'src', 'b']])
        const sw = d.symbols.find((x: any) => x.defId === s.id).id
        const lampId = d.symbols.find((x: any) => x.defId === LAMP).id
        if (!run(d).energized.has(lampId) || run(d, [], [sw]).energized.has(lampId)) fails.push(`${s.name.fr} (sélecteur à ${m.sel.outs.length} positions) : position 1 / position 2 incorrectes`)
        continue
      }
      const useChange = !m.poles.length && m.changeover?.length
      const [a, b] = useChange ? [m.changeover[0][0], m.changeover[0][1]] : m.poles[0]
      const specs: any[] = [['src', 'sim-src1', 100, 30], ['x', s.id, 100, 100, m.ctl === 'coil' ? 'KM1' : 'S1'], ['h', LAMP, 100, 240, 'H1']]
      const links: any[] = [['src', 'a', 'x', a], ['x', b, 'h', 't0'], ['h', 't1', 'src', 'b']]
      if (m.ctl === 'coil') { specs.push(['k', COIL, 300, 100, 'KM1']); links.push(['src', 'a', 'k', 't0'], ['k', 't1', 'src', 'b']) }
      const d = T.build(base, specs, links)
      const sw = d.symbols.find((x: any) => x.defId === s.id).id
      const lamp = () => d.symbols.find((x: any) => x.defId === LAMP).id
      const on = (r: any) => r.energized.has(lamp())
      if (m.ctl === 'fixed') { if (!on(run(d))) fails.push(`${s.name.fr} (fixe) : ne laisse pas passer le courant`) }
      else if (m.ctl === 'coil') {
        // bobine alimentée : le contact NO conduit, le contact NF est ouvert (les contacts temporisés ne réagissent pas tout de suite)
        const r = run(d); const closed = useChange ? false : (m.nc ? false : true)
        if (!useChange && !m.delay && on(r) !== closed) fails.push(`${s.name.fr} (contact de relais) : état incorrect bobine alimentée`) }
      else {
        if (m.pos3) {
          // sélecteur 1-0-2 : centre ouvert ; position 1 : commun–repos ; position 2 : commun–travail
          const c0 = on(run(d)), p1 = on(run(d, [], [sw])), p2 = on(run(d, [], [sw + ':2']))
          if (c0 || !p1 || p2) fails.push(`${s.name.fr} (pos3) : centre=${c0} position1=${p1} position2=${p2}`)
          continue
        }
        const rest = on(run(d)), act = on(run(d, [sw], [sw]))
        if (rest !== (useChange ? true : !!m.nc) || act !== (useChange ? false : !m.nc)) fails.push(`${s.name.fr} (${m.ctl}${m.nc ? ' NF' : ' NO'}) : repos=${rest} actionné=${act}`)
        if (!isOperableDef(s)) fails.push(`${s.name.fr} : pas manœuvrable`)
      }
    } else if (m.k === 'transformer') {
      const d = T.build(base, [['src', 'sim-src1', 100, 30], ['t', s.id, 100, 100, 'T1'], ['h', LAMP, 300, 240, 'H1']], [['src', 'a', 't', m.primary[0]], ['t', m.primary[1] ?? m.primary[0], 'src', 'b'], ['t', m.secondary[0], 'h', 't0'], ['h', 't1', 't', m.secondary[1] ?? m.secondary[0]]])
      d.symbols.find((x: any) => x.label === 'H1').volts = 24
      const r = run(d)
      if (m.primary.length >= 2 && m.secondary.length >= 2 && !r.energized.has(d.symbols.find((x: any) => x.label === 'H1').id)) fails.push(`${s.name.fr} (transformateur) : le secondaire n'alimente pas une lampe`)
    }
  } catch (e) { fails.push(`${s.name.fr} : erreur ${(e as Error).message}`) }
}
console.log(`essai fonctionnel : ${n} symboles simulables, ${fails.length} anomalie(s)`)
const by = new Map<string, string[]>()
for (const f of fails) { const k = f.replace(/^.*\((.*?)\) :.*$/, '$1'); by.set(k, [...(by.get(k) ?? []), f]) }
for (const [k, v] of by) console.log('--', k, v.length, '\n   ', v.slice(0, 6).join('\n    '))
