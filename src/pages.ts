import type { Doc, Page, Wire } from './types'

const contentOf = (d: Doc): Page => ({ name: '', symbols: d.symbols, wires: d.wires, ...(d.notes ? { notes: d.notes } : {}), ...(d.shapes ? { shapes: d.shapes } : {}), ...(d.instruments ? { instruments: d.instruments } : {}) })

/** Toutes les pages du projet, la page active étant à jour. Un schéma sans `pages` n'a qu'une feuille. */
export function pagesOf(doc: Doc): Page[] {
  const cur = doc.page ?? 0
  const pages = doc.pages?.length ? [...doc.pages] : [{ ...contentOf(doc), name: '1' }]
  pages[cur] = { ...contentOf(doc), name: pages[cur]?.name ?? String(cur + 1) }
  return pages
}

export const pageCount = (doc: Doc) => doc.pages?.length ?? 1

export function switchPage(doc: Doc, idx: number): Doc {
  const pages = pagesOf(doc)
  const i = Math.max(0, Math.min(idx, pages.length - 1))
  const t = pages[i]
  return { ...doc, pages, page: i, symbols: t.symbols, wires: t.wires, notes: t.notes, shapes: t.shapes, instruments: t.instruments }
}

export function addPage(doc: Doc): Doc {
  const pages = pagesOf(doc)
  pages.push({ name: String(pages.length + 1), symbols: [], wires: [] })
  return switchPage({ ...doc, pages }, pages.length - 1)
}

export function deletePage(doc: Doc, idx: number): Doc {
  const pages = pagesOf(doc)
  if (pages.length < 2) return doc
  pages.splice(idx, 1)
  return switchPage({ ...doc, pages, page: Math.min(doc.page ?? 0, pages.length - 1) }, Math.min(idx, pages.length - 1))
}

export function renamePage(doc: Doc, idx: number, name: string): Doc {
  const pages = pagesOf(doc)
  pages[idx] = { ...pages[idx], name }
  return { ...doc, pages }
}

/** Le projet entier en une seule feuille de calcul : pour la simulation, le contrôle, la nomenclature et les repères de fils. */
export function mergedDoc(doc: Doc): Doc {
  const base: Doc = !doc.pages || doc.pages.length < 2 ? doc : (() => {
    const pages = pagesOf(doc)
    return { ...doc, symbols: pages.flatMap((p) => p.symbols), wires: pages.flatMap((p) => p.wires) }
  })()
  return withSheetLinks(base)
}

/** Les renvois de feuille de même repère sont reliés par des conducteurs virtuels (le schéma est alors un seul réseau pour la simulation et le contrôle). */
export function withSheetLinks(doc: Doc): Doc {
  const groups = new Map<string, string[]>()
  for (const s of doc.symbols) {
    if (s.defId !== 'sim-ref' || !s.label.trim()) continue
    const k = s.label.trim().toUpperCase()
    groups.set(k, [...(groups.get(k) ?? []), s.id])
  }
  const wires: Wire[] = []
  for (const ids of groups.values()) {
    for (let i = 1; i < ids.length; i++) {
      wires.push({ id: 'ref:' + ids[i - 1] + ':' + ids[i], from: { symId: ids[i - 1], portId: 'a' }, to: { symId: ids[i], portId: 'a' }, label: '', color: '#000000', section: '' })
    }
  }
  return wires.length ? { ...doc, wires: [...doc.wires, ...wires] } : doc
}

/** Page (0-based) de chaque symbole du projet. */
export function pageOfSymbols(doc: Doc): Record<string, number> {
  const out: Record<string, number> = {}
  pagesOf(doc).forEach((p, i) => p.symbols.forEach((s) => (out[s.id] = i)))
  return out
}
