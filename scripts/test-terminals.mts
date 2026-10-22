// Tests de la numérotation des bornes : npm test
import { readFileSync } from 'node:fs'
import { defaultTerm, editTerm, suggestTerms, termGroups } from '../src/terminals.ts'

const lib = JSON.parse(readFileSync(new URL('../public/qet-library.json', import.meta.url), 'utf8'))
const def = (end: string) => lib.symbols.find((s: any) => s.id.endsWith(end))
let fails = 0
const check = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log((ok ? 'ok   ' : 'ÉCHEC') + ' ' + name + (ok ? '' : ` (obtenu ${JSON.stringify(got)}, attendu ${JSON.stringify(want)})`))
}
const labels = (d: any, terms?: Record<string, string>) => Object.fromEntries(d.ports.map((p: any) => [p.id, terms?.[p.id] ?? defaultTerm(d, p.id)]))

// contact auxiliaire NO (con_simple) : 13 / 14 → 53 / 54
{
  const d = def('01_auxiliary_contacts/con_simple')
  check('contact NO : numérotation normalisée 13/14', Object.values(labels(d)), ['13', '14'])
  const first = termGroups(d)[0].ports[0]
  const t = editTerm(d, undefined, first, '53')
  check('contact NO : 13 → 53 entraîne 14 → 54', Object.values(labels(d, t)), ['53', '54'])
}
// contact NF : 21 / 22 → 61 / 62
{
  const d = def('01_auxiliary_contacts/con_simple_nf')
  check('contact NF : 21/22 par défaut', Object.values(labels(d)), ['21', '22'])
  const t = editTerm(d, undefined, termGroups(d)[0].ports[0], '61')
  check('contact NF : 21 → 61 entraîne 22 → 62', Object.values(labels(d, t)), ['61', '62'])
}
// contacteur 3 pôles de puissance : 1-2 / 3-4 / 5-6 → décalage de tous les pôles
{
  const d = def('02_power_contacts/com_puiss4')
  const sug = suggestTerms(d)
  const groups = termGroups(d)
  check('contacteur 3 pôles : 3 pôles de 2 bornes', groups.map((g) => g.ports.length), [2, 2, 2])
  check('contacteur 3 pôles : 1/2, 3/4, 5/6', groups.map((g) => g.ports.map((p) => sug[p]).join('/')), ['1/2', '3/4', '5/6'])
  const t = editTerm(d, undefined, groups[0].ports[0], '7')
  check('contacteur 3 pôles : 1 → 7 décale tous les pôles (7/8, 9/10, 11/12)', groups.map((g) => g.ports.map((p) => t[p]).join('/')), ['7/8', '9/10', '11/12'])
}
// édition d'un pôle seul : le premier pôle n'est pas touché
{
  const d = def('02_power_contacts/com_puiss4')
  const groups = termGroups(d)
  const t = editTerm(d, undefined, groups[1].ports[0], '13')
  check('pôle 2 modifié : seul ce pôle suit (13/14), les autres gardent leur défaut', groups.map((g) => g.ports.map((p) => t[p] ?? '-').join('/')), ['-/-', '13/14', '-/-'])
}
// inverseur : 11 (commun) / 12 (NF) / 14 (NO)
{
  const d = def('01_auxiliary_contacts/contnonc')
  const g = termGroups(d)[0]
  check('inverseur : commun/NF/NO = 11/12/14', g.ports.map((p) => suggestTerms(d)[p]), ['11', '12', '14'])
  const t = editTerm(d, undefined, g.ports[0], '51')
  check('inverseur : 11 → 51 entraîne 52 et 54', g.ports.map((p) => t[p]), ['51', '52', '54'])
}
// bobine A1/A2
{
  const d = def('01_coils/bobine3')
  check('bobine : A1 en haut, A2 en bas', Object.values(labels(d)), ['A1', 'A2'])
}
// saisie vide : retour au défaut ; saisie non numérique : isolée
{
  const d = def('01_auxiliary_contacts/con_simple')
  const first = termGroups(d)[0].ports[0]
  let t = editTerm(d, undefined, first, '53')
  t = editTerm(d, t, first, '')
  check('saisie vide : repère par défaut rétabli', t[first], undefined)
  const t2 = editTerm(d, undefined, first, 'X1')
  check('saisie non numérique : la borne voisine ne bouge pas', Object.keys(t2), [first])
}

console.log(fails ? `\n${fails} ÉCHEC(S)` : '\ntous les tests de numérotation passent')
process.exit(fails ? 1 : 0)
