// Fiches « à quoi ça sert » : chaque composant de la bibliothèque a une explication complète en français et en anglais : npm test
const ROOT = '..'
const { explain } = await import(ROOT + '/src/explain.ts')
const lib = (await import('./lib-full.mjs')).loadFull()
let fails = 0
const check = (name: string, got: any, want: any) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log((ok ? 'ok   ' : 'ÉCHEC'), name, ok ? '' : `(obtenu ${JSON.stringify(got)}, attendu ${JSON.stringify(want)})`) }
const weak: string[] = []
const bad: string[] = []
const { SYMBOLS } = await import(ROOT + '/src/symbols/index.ts')
for (const b of SYMBOLS.filter((x: any) => /^(sim-|plc-)/.test(x.id))) if (explain(b, 'fr').what === 'Composant de la bibliothèque électrique.') weak.push(b.id)
const generic = 'Composant de la bibliothèque électrique.'
for (const s of lib.symbols) {
  if (s.legacy || s.hidden) continue
  for (const lang of ['fr', 'en'] as const) {
    const e = explain(s, lang)
    if (!e.title || e.what.length < 30 || e.use.length < 30 || /undefined/.test(e.what + e.use + e.params.map((p: any) => p.why).join())) bad.push(s.id + ' ' + lang)
  }
  if (explain(s, 'fr').what === generic) weak.push(s.id)
}
check('fiches : aucun composant sans explication complète (FR et EN)', bad.slice(0, 5), [])
console.log(weak.length ? `info : ${weak.length} composants avec explication générique` : 'tous les composants ont une fiche spécifique')
if (process.argv[2] === '--list') console.log(weak.join('\n'))
check('fiches : un contacteur explique la bobine et le repère', /repère|tag/i.test(explain(lib.symbols.find((s: any) => /01_coils\/bobine3$/.test(s.id)), 'fr').params.map((p: any) => p.name).join()), true)
check('fiches : un distributeur électrique explique le repère 1YV14', explain(lib.symbols.find((s: any) => s.fluid?.k === 'valve' && s.fluid.a === 'elec'), 'fr').params.some((p: any) => /1YV14/.test(p.name)), true)
console.log(fails ? `\n${fails} ÉCHEC(S)` : '\ntous les tests des fiches passent')
process.exit(fails ? 1 : 0)
