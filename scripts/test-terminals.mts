// Tests de la numérotation des bornes : npm test
import { readFileSync } from 'node:fs'
import { defaultTerm, duplicateTerms, editTermUnique, effectiveTerms, othersTerms, termGroups } from '../src/terminals.ts'

const lib = JSON.parse(readFileSync(new URL('../public/qet-library.json', import.meta.url), 'utf8'))
const defs: Record<string, any> = Object.fromEntries(lib.symbols.map((s: any) => [s.id, s]))
const id = (end: string) => lib.symbols.find((s: any) => s.id.endsWith(end)).id

let fails = 0
const check = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log((ok ? 'ok   ' : 'ÉCHEC') + ' ' + name + (ok ? '' : ` (obtenu ${JSON.stringify(got)}, attendu ${JSON.stringify(want)})`))
}

const AUX_NO = id('01_auxiliary_contacts/con_simple')
const AUX_NC = id('01_auxiliary_contacts/con_simple_nf')
const CHG = id('01_auxiliary_contacts/contnonc')
const POWER3 = id('02_power_contacts/com_puiss4')
const COIL = id('01_coils/bobine3')
let n = 0
const sym = (defId: string, label: string, terms?: Record<string, string>): any => ({ id: 's' + ++n, defId, x: 0, y: 0, rot: 0, label, desc: '', ...(terms ? { terms } : {}) })
/** repères d'un symbole dans l'ordre d'affichage des groupes de bornes (haut/bas, pôle par pôle) */
const shown = (s: any, eff: Record<string, Record<string, string>>) => termGroups(defs[s.defId]).map((g) => g.ports.map((p) => eff[s.id]?.[p] ?? '-').join('/'))

// ── numéros affichés d'office, sans aucune saisie
{
  const c = sym(AUX_NO, 'S2')
  const eff = effectiveTerms([c], defs)
  check('contact NO seul : 13/14 affichés d\'office', shown(c, eff), ['13/14'])
  const nc = sym(AUX_NC, 'S1')
  check('contact NF seul : 11/12 affichés d\'office', shown(nc, effectiveTerms([nc], defs)), ['11/12'])
  const k = sym(COIL, 'KM1')
  check('bobine : A1/A2 affichés d\'office', shown(k, effectiveTerms([k], defs)), ['A1/A2'])
}

// ── un même appareil : jamais deux contacts avec les mêmes numéros
{
  const kc = sym(COIL, 'KM1')
  const p1 = sym(POWER3, 'KM1')
  const p2 = sym(POWER3, 'KM1')
  const a1 = sym(AUX_NO, 'KM1')
  const a2 = sym(AUX_NC, 'KM1')
  const a3 = sym(AUX_NO, 'KM1')
  const a4 = sym(CHG, 'KM1')
  const all = [kc, p1, p2, a1, a2, a3, a4]
  const eff = effectiveTerms(all, defs)
  check('contacteur KM1 : 1er contact de puissance 1-2 / 3-4 / 5-6', shown(p1, eff), ['1/2', '3/4', '5/6'])
  check('contacteur KM1 : 2e contact de puissance 7-8 / 9-10 / 11-12', shown(p2, eff), ['7/8', '9/10', '11/12'])
  check('contacteur KM1 : 1er auxiliaire NO 13/14', shown(a1, eff), ['13/14'])
  check('contacteur KM1 : auxiliaire suivant NF 21/22 (rang suivant)', shown(a2, eff), ['21/22'])
  check('contacteur KM1 : auxiliaire suivant NO 33/34', shown(a3, eff), ['33/34'])
  check('contacteur KM1 : inverseur 41/42/44', shown(a4, eff), ['41/42/44'])
  check('contacteur KM1 : aucun numéro en double', duplicateTerms(all, eff).size, 0)
  // un autre appareil repart de zéro
  const other = sym(AUX_NO, 'KM2')
  check('autre appareil KM2 : repart à 13/14', shown(other, effectiveTerms([...all, other], defs)), ['13/14'])
}

// ── numéros saisis : réservés, les autres s'adaptent
{
  const a1 = sym(AUX_NO, 'KM1', { t0: '13', t1: '14' })
  const a2 = sym(AUX_NO, 'KM1')
  const eff = effectiveTerms([a1, a2], defs)
  check('13/14 saisis sur le 1er : le 2e prend 23/24', shown(a2, eff), ['23/24'])
  const b1 = sym(AUX_NO, 'KM1')
  const b2 = sym(AUX_NO, 'KM1', { t0: '13', t1: '14' }) // posé après : sa saisie reste prioritaire
  const eff2 = effectiveTerms([b1, b2], defs)
  check('saisie sur le 2e : il garde 13/14 et le 1er s\'écarte (23/24)', [shown(b1, eff2)[0], shown(b2, eff2)[0]], ['23/24', '13/14'])
}

// ── édition : un numéro déjà pris est incrémenté automatiquement
{
  const a1 = sym(AUX_NO, 'KM1')
  const a2 = sym(AUX_NO, 'KM1')
  const all = [a1, a2]
  const eff = effectiveTerms(all, defs)
  const first = termGroups(defs[a2.defId])[0].ports[0]
  const defaults = Object.fromEntries(defs[a2.defId].ports.map((p: any) => [p.id, defaultTerm(all, defs, a2.id, p.id)]))
  const others = othersTerms(all, eff, a2.id)
  check('numéros du 1er contact connus (13/14)', [...others].sort(), ['13', '14'])
  // le 2e contact (23/24) passe en 13 : déjà pris → décalé en 23/24
  const t = editTermUnique(defs[a2.defId], undefined, first, '13', defaults, others)
  check('13 déjà pris par le 1er contact : décalé automatiquement en 23/24', defs[a2.defId].ports.map((p: any) => t[p.id]).sort(), ['23', '24'])
  // un numéro libre est accepté tel quel
  const t2 = editTermUnique(defs[a2.defId], undefined, first, '53', defaults, others)
  check('53 libre : accepté, 54 suit', defs[a2.defId].ports.map((p: any) => t2[p.id]).sort(), ['53', '54'])
}

// ── contacteur de puissance : modification d'un pôle, décalage des suivants
{
  const p1 = sym(POWER3, 'KM1')
  const p2 = sym(POWER3, 'KM1')
  const all = [p1, p2]
  const eff = effectiveTerms(all, defs)
  const groups = termGroups(defs[p2.defId])
  const defaults = Object.fromEntries(defs[p2.defId].ports.map((p: any) => [p.id, defaultTerm(all, defs, p2.id, p.id)]))
  const others = othersTerms(all, eff, p2.id)
  // 7 → 1 (déjà pris par le premier contacteur) : décalage des 6 bornes jusqu'à une plage libre
  const t = editTermUnique(defs[p2.defId], undefined, groups[0].ports[0], '1', defaults, others)
  const vals = groups.map((g) => g.ports.map((p) => t[p]).join('/'))
  check('contact de puissance : 1 déjà pris → trois pôles renumérotés', vals.length, 3)
  check('contact de puissance : plus aucun numéro en commun avec KM1', groups.flatMap((g) => g.ports).every((p) => !others.has(t[p])), true)
}

// ── anomalie signalée si un fichier contient déjà des doublons
{
  const a1 = sym(AUX_NO, 'KM1', { t0: '13', t1: '14' })
  const a2 = sym(AUX_NO, 'KM1', { t0: '13', t1: '14' })
  const eff = effectiveTerms([a1, a2], defs)
  check('doublons saisis à la main : détectés', duplicateTerms([a1, a2], eff).size, 4)
}

// ── lampes : X1 / X2 (et non A1 / A2, réservés aux bobines)
{
  const lamp = sym(id('11_optical_signaling/lampe2'), 'H1')
  const buz = sym(id('12_acoustic_signaling/' + lib.symbols.find((s: any) => /12_acoustic_signaling/.test(s.id) && s.sim?.k === 'load').id.split('/').pop()), 'H2')
  const eff = effectiveTerms([lamp, buz], defs)
  check('lampe : X1 en haut, X2 en bas (pas A1/A2)', shown(lamp, eff), ['X1', 'X2'])
  check('avertisseur sonore : X1 / X2', Object.values(eff[buz.id]).sort(), ['X1', 'X2'])
  const coil = sym(COIL, 'KM1')
  check('bobine : toujours A1 / A2', Object.values(effectiveTerms([coil], defs)[coil.id]).sort(), ['A1', 'A2'])
  // une lampe saisie à la main garde ses numéros
  const custom = sym(id('11_optical_signaling/lampe2'), 'H3', { t0: 'X3', t1: 'X4' })
  check('lampe avec bornes saisies : saisie prioritaire', Object.values(effectiveTerms([custom], defs)[custom.id]).sort(), ['X3', 'X4'])
}

// ── relais thermique : 95-96 (NF) et 97-98 (NO)
{
  const nf = sym(id('15_protection_contacts/contact_relais_nf_esclave'), 'F1')
  const no = sym(id('15_protection_contacts/act_termique_no_esclave'), 'F1')
  const eff = effectiveTerms([nf, no], defs)
  check('relais thermique : NF 95/96, NO 97/98', [Object.values(eff[nf.id]).sort().join('/'), Object.values(eff[no.id]).sort().join('/')], ['95/96', '97/98'])
}

console.log(fails ? `\n${fails} ÉCHEC(S)` : '\ntous les tests de numérotation passent')
process.exit(fails ? 1 : 0)
