// Tests des textes des exercices guidés : les noms de composants cités sont ceux de la bibliothèque. npm test
import { readFileSync } from 'node:fs'
const ROOT = '..'
const { SYMBOL_MAP, SYMBOLS } = await import(ROOT + '/src/symbols/index.ts')
const lib = JSON.parse(readFileSync(new URL('../public/qet-library.json', import.meta.url), 'utf8'))
for (const s of lib.symbols) { SYMBOLS.push(s); SYMBOL_MAP[s.id] = s }
const { GUIDED } = await import(ROOT + '/src/guidedData.ts')
const { fillNames, ALIASES } = await import(ROOT + '/src/guided.ts')

let fails = 0
const check = (name: string, ok: boolean, info = '') => { if (!ok) fails++; console.log(ok ? 'ok   ' : 'ÉCHEC', name, ok ? '' : info) }

const missingAlias = Object.entries(ALIASES).filter(([, id]) => !SYMBOL_MAP[id as string]).map(([a]) => a)
check('alias de symboles : tous existent dans la bibliothèque', missingAlias.length === 0, missingAlias.join(', '))

// libellés de l'interface que les textes ont le droit de citer
const ui = new Set([
  'Sources et alimentations', 'Sources and power supplies', 'Il vous manque', 'Still missing', '▶ Simuler', '▶ Simulate',
  'Tension de la source', 'Source voltage', 'Tension nominale', 'Rated voltage', 'Contrôle', 'Check', 'V appliqués, V assignés', 'V applied, V rated',
  'Appliquer', 'Apply', 'Temporisation (s)', 'Delay (s)', 'Repère', 'Tag', 'En parallèle', 'In parallel',
])
const names = new Set<string>()
for (const d of Object.values(SYMBOL_MAP) as { name: { fr: string; en: string } }[]) { names.add(d.name.fr); names.add(d.name.en) }
const titles = new Set<string>(GUIDED.flatMap((g: { title: { fr: string; en: string } }) => [g.title.fr, g.title.en]))
const tagLike = /^(A1|YV1|YV2|YV1\/YV2|S\d|KM\d|KT|H\d)/

const bad: string[] = []
for (const ex of GUIDED) {
  for (const lang of ['fr', 'en'] as const) {
    const texts: string[] = [ex.title[lang], ...ex.brief.map((b: { fr: string; en: string }) => b[lang]), ...ex.parts.map((b: { fr: string; en: string }) => b[lang]), ...ex.expect.map((b: { fr: string; en: string }) => b[lang]), ...ex.steps.flatMap((st: { title: { fr: string; en: string }; hint: { fr: string; en: string } }) => [st.title[lang], st.hint[lang]])]
    for (const t0 of texts) {
      const t = fillNames(t0, lang)
      if (t.includes('{{')) bad.push(`${ex.id}/${lang} : jeton non résolu dans « ${t0.slice(0, 60)} »`)
      for (const m of t.matchAll(/[«“] ?([^»”]+?) ?[»”]/g)) {
        const q = m[1].trim()
        if (!(names.has(q) || ui.has(q) || titles.has(q) || tagLike.test(q) || /^[+-−]$/.test(q))) bad.push(`${ex.id}/${lang} : « ${q} » n’est ni un symbole ni un libellé connu`)
      }
    }
  }
}
check('textes des exercices : tous les noms entre guillemets existent dans la bibliothèque ou l’interface', bad.length === 0, '\n  ' + [...new Set(bad)].join('\n  '))

for (const ex of GUIDED) {
  const ok = ex.parts.length >= 1 && ex.expect.length >= 2 && [...ex.parts, ...ex.expect].every((l: { fr: string; en: string }) => l.fr.trim() && l.en.trim())
  check(`« ${ex.id} » : matériel et fonctionnement attendu décrits dans les deux langues`, ok)
}
console.log(fails ? `\n${fails} ÉCHEC(S)` : '\ntous les tests passent')
process.exit(fails ? 1 : 0)
