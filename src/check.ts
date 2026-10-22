import type { Doc, Lang, SymbolDef } from './types'
import { devKey, simulate } from './sim/engine'
import { valveCoils } from './sim/fluid'

export interface Issue {
  level: 'error' | 'warn'
  text: string
  symId?: string
}

const S = (lang: Lang, fr: string, en: string) => (lang === 'fr' ? fr : en)

/** Contrôle de cohérence du schéma : repères, renvois bobine ↔ contacts, bornes libres, court-circuit au repos. */
export function checkDoc(doc: Doc, defs: Record<string, SymbolDef>, lang: Lang): Issue[] {
  const out: Issue[] = []
  const name = (s: { label: string; defId: string }) => s.label || defs[s.defId]?.name[lang] || '?'
  const coils = doc.symbols.filter((s) => defs[s.defId]?.sim?.k === 'coil')
  const contacts = doc.symbols.filter((s) => {
    const m = defs[s.defId]?.sim
    return m?.k === 'switch' && m.ctl === 'coil'
  })
  const coilKeys = new Set(coils.filter((s) => s.label).map((s) => devKey(s.label)))
  const contactKeys = new Set(contacts.filter((s) => s.label).map((s) => devKey(s.label)))
  // un électrodistributeur est « commandé » par les bobines dont il porte le repère (YV1 ou YV1/YV2)
  for (const s of doc.symbols) if (defs[s.defId]?.fluid?.k === 'valve') for (const k of valveCoils(s.label)) if (k) contactKeys.add(k)

  for (const c of coils) {
    if (!c.label) out.push({ level: 'warn', symId: c.id, text: S(lang, 'Bobine sans repère : ses contacts ne peuvent pas lui être associés.', 'Coil without a reference: no contact can be linked to it.') })
    else if (!contactKeys.has(devKey(c.label))) out.push({ level: 'warn', symId: c.id, text: S(lang, `Bobine ${c.label} : aucun contact ne porte ce repère.`, `Coil ${c.label}: no contact carries this reference.`) })
  }
  for (const k of contacts) {
    if (!k.label) out.push({ level: 'error', symId: k.id, text: S(lang, 'Contact sans repère : il ne sera jamais actionné.', 'Contact without a reference: it will never operate.') })
    else if (!coilKeys.has(devKey(k.label))) out.push({ level: 'error', symId: k.id, text: S(lang, `Contact ${k.label} : aucune bobine ${k.label} dans le schéma.`, `Contact ${k.label}: there is no coil ${k.label} in the diagram.`) })
  }
  const seen = new Map<string, number>()
  for (const c of coils) if (c.label) seen.set(devKey(c.label), (seen.get(devKey(c.label)) ?? 0) + 1)
  for (const [k, n] of seen) if (n > 1) out.push({ level: 'warn', text: S(lang, `${n} bobines portent le repère ${k} (elles seront alimentées ensemble).`, `${n} coils share the reference ${k} (they will operate together).`) })

  // bornes non raccordées des appareils simulés
  const used = new Set(doc.wires.flatMap((w) => [`${w.from.symId}:${w.from.portId}`, `${w.to.symId}:${w.to.portId}`]))
  for (const s of doc.symbols) {
    const m = defs[s.defId]?.sim
    if (!m || m.k === 'source') continue
    const ports = m.k === 'switch' ? [...m.poles.flat(), ...(m.changeover ?? []).flat()] : m.k === 'transformer' ? [...m.primary, ...m.secondary] : m.ports
    const free = ports.filter((p) => !used.has(`${s.id}:${p}`))
    if (free.length === ports.length) out.push({ level: 'warn', symId: s.id, text: S(lang, `${name(s)} n'est raccordé à aucun fil.`, `${name(s)} is not connected to any wire.`) })
    else if (free.length && (m.k === 'coil' || m.k === 'load')) out.push({ level: 'warn', symId: s.id, text: S(lang, `${name(s)} : borne non raccordée.`, `${name(s)}: unconnected terminal.`) })
  }

  // court-circuit au repos (aucun organe manœuvré)
  try {
    const r = simulate(doc, defs, {}, { pressed: new Set(), toggled: new Set() }, 0)
    if (r.shorts.length) {
      const pots = [...new Set(r.shorts.flatMap((x) => x.potentials))].join(' / ')
      out.push({ level: 'error', text: S(lang, `Court-circuit entre ${pots} dès le repos.`, `Short circuit between ${pots} at rest.`) })
    }
  } catch { /* schéma incomplet : pas de verdict */ }

  return out.sort((a, b) => (a.level === b.level ? 0 : a.level === 'error' ? -1 : 1))
}
