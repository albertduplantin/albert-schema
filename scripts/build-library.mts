// Construit les bibliothèques de l'application à partir de la sortie brute de l'import (data/library-raw.json) :
//   public/library-core.json      symboles dessinés par l'application (aucune mention de licence tierce nécessaire)
//   public/library-extended.json  le reste de la collection QElectroTech (CC-BY 3.0), chargé à la demande
// Usage : npx tsx scripts/build-library.mts
import { readFileSync, writeFileSync } from 'node:fs'
const { staticSvg, isDynamic } = await import('../src/symbols/fluidDraw.ts')
const { ownDrawing } = await import('../src/symbols/own/index.ts')

const raw = JSON.parse(readFileSync(new URL('../data/library-raw.json', import.meta.url), 'utf8'))
let dyn = 0, own = 0
// symboles propres à l'application (absents de la collection d'origine)
const { extraSymbols } = await import('../src/symbols/own/extra.ts')
for (const e of extraSymbols) raw.symbols.push({ ...e, own: true })
const ids = JSON.parse(readFileSync(new URL('../api/_ids.json', import.meta.url), 'utf8'))
for (const e of extraSymbols) if (!ids.includes(e.id)) ids.push(e.id)
writeFileSync(new URL('../api/_ids.json', import.meta.url), JSON.stringify(ids))
for (const s of raw.symbols) {
  s.own = undefined
  if (extraSymbols.some((e: any) => e.id === s.id)) { s.own = true; own++; continue }
  if (s.legacy) continue
  // distributeurs et vérins fluides : dessinés par l'application d'après leur modèle
  if (s.fluid && isDynamic(s)) {
    const svg = staticSvg(s)
    if (svg) { s.svg = svg; s.own = true; s.std = s.domain === 'hydraulic' ? 'ISO 1219-1' : 'ISO 1219-1'; dyn++; continue }
  }
  const o = ownDrawing(s)
  if (o) {
    s.svg = o.svg
    if (o.blades && s.sim?.k === 'switch') s.sim.blades = o.blades
    if (s.sim && o.spin && s.sim.k === 'load') s.sim.spin = o.spin
    if (o.name) s.name = o.name
    s.std = o.std ?? 'CEI 60617'
    s.own = true
    own++
  }
}
// les symboles les plus courants (boutons, contacts, lampes, moteurs…) figurent dans « Les plus utilisés »
for (const s of raw.symbols) if (s.own && !s.legacy && s.domain === 'electrical' && (s.score ?? 0) >= 80) s.top = true
// un seul symbole par nom dans la palette : les variantes dessinées à l'identique (autre taille, autre origine) restent chargeables mais cachées
{
  const seen = new Set<string>()
  let hidden = 0
  for (const s of raw.symbols) {
    if (!s.own || s.legacy || s.hidden) continue
    const k = s.domain + '|' + s.name.fr
    if (seen.has(k)) { s.legacy = true; hidden++ } else seen.add(k)
  }
  console.log(hidden, 'doublons de nom masqués')
}
const isCore = (s: any) => s.own === true
const core = raw.symbols.filter(isCore).map(({ own: _o, ...s }: any) => ({ ...s, own: true }))
const ext = raw.symbols.filter((s: any) => !isCore(s)).map(({ own: _o, ...s }: any) => s)
// catégories : le noyau n'a que celles qu'il utilise ; la bibliothèque étendue porte la liste complète (dans l'ordre d'affichage)
const used = (list: any[], d: string) => new Set(list.filter((s) => s.domain === d).map((s) => s.cat))
const catsCore: any = {}
for (const d of Object.keys(raw.categories)) catsCore[d] = raw.categories[d].filter((c: any) => used(core, d).has(c.id))
writeFileSync(new URL('../public/library-core.json', import.meta.url), JSON.stringify({ source: 'Albert Schema Studio', categories: catsCore, symbols: core }))
writeFileSync(new URL('../public/library-extended.json', import.meta.url), JSON.stringify({ source: 'QElectroTech elements collection, CC-BY 3.0', categories: raw.categories, symbols: ext }))
const vis = (list: any[], d: string) => list.filter((s) => s.domain === d && !s.legacy).length
console.log(`noyau : ${core.length} symboles (${dyn} fluides dessinés par modèle, ${own} dessinés à la main) ; étendue : ${ext.length}`)
for (const d of ['electrical', 'pneumatic', 'hydraulic']) console.log(`  ${d} : ${vis(core, d)} visibles dans le noyau, ${vis(ext, d)} dans l'étendue`)
