import type { Doc, Lang } from './types'
import { PAPER_SIZE, UNIT_MM } from './geometry'
import { SYMBOL_MAP } from './symbols'

function download(name: string, blob: Blob) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

export function sheetSvg(doc: Doc, content: SVGGElement): string {
  const { w, h } = PAPER_SIZE[doc.paper]
  const body = new XMLSerializer().serializeToString(content)
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w * UNIT_MM}mm" height="${h * UNIT_MM}mm">` +
    body.replace(/ xmlns="[^"]*"/g, '') +
    `</svg>`
  )
}

export const fileBase = (doc: Doc) => (doc.title.title || 'schema').replace(/[^\w\-]+/g, '_')

export function exportSvg(doc: Doc, content: SVGGElement) {
  download(fileBase(doc) + '.svg', new Blob([sheetSvg(doc, content)], { type: 'image/svg+xml' }))
}

export function exportPng(doc: Doc, content: SVGGElement) {
  const { w, h } = PAPER_SIZE[doc.paper]
  const svg = sheetSvg(doc, content).replace(/width="[^"]*mm" height="[^"]*mm"/, `width="${w * 2}" height="${h * 2}"`)
  const img = new Image()
  img.onload = () => {
    const c = document.createElement('canvas')
    c.width = w * 2
    c.height = h * 2
    c.getContext('2d')!.drawImage(img, 0, 0)
    c.toBlob((b) => b && download(fileBase(doc) + '.png', b))
  }
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
}

/** Ouvre une fenêtre d'impression à l'échelle réelle ; l'utilisateur choisit « Enregistrer au format PDF ». */
export function printSheet(doc: Doc, content: SVGGElement) {
  const { w, h } = PAPER_SIZE[doc.paper]
  const win = window.open('', '_blank')
  if (!win) return
  win.document.write(
    `<!doctype html><title>${doc.title.title}</title><style>@page{size:${w * UNIT_MM}mm ${h * UNIT_MM}mm;margin:0}html,body{margin:0}svg{display:block}</style>` +
      sheetSvg(doc, content),
  )
  win.document.close()
  win.focus()
  setTimeout(() => win.print(), 300)
}

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;')

/** Impression de tout le projet : une page par feuille, puis la nomenclature (l'utilisateur choisit « Enregistrer au format PDF »). */
export function printProject(doc: Doc, svgs: string[], rows: { label: string; name: string; desc: string; std: string }[], lang: Lang) {
  const { w, h } = PAPER_SIZE[doc.paper]
  const win = window.open('', '_blank')
  if (!win) return
  const head = lang === 'fr' ? ['Repère', 'Composant', 'Description', 'Norme'] : ['Tag', 'Component', 'Description', 'Standard']
  const table =
    `<section class="bom"><h2>${esc(doc.title.title || (lang === 'fr' ? 'Nomenclature' : 'Bill of materials'))} — ${lang === 'fr' ? 'Nomenclature' : 'Bill of materials'}</h2><table><thead><tr>${head.map((x) => `<th>${x}</th>`).join('')}</tr></thead><tbody>` +
    rows.map((r) => `<tr><td>${esc(r.label)}</td><td>${esc(r.name)}</td><td>${esc(r.desc)}</td><td>${esc(r.std)}</td></tr>`).join('') +
    `</tbody></table></section>`
  win.document.write(
    `<!doctype html><meta charset="utf-8"><title>${esc(doc.title.title)}</title><style>@page{size:${w * UNIT_MM}mm ${h * UNIT_MM}mm;margin:0}html,body{margin:0;font-family:Arial,sans-serif}svg{display:block}.pg{page-break-after:always}.bom{padding:15mm}table{border-collapse:collapse;width:100%;font-size:11px}td,th{border:1px solid #999;padding:3px 6px;text-align:left}</style>` +
      svgs.map((x) => `<div class="pg">${x}</div>`).join('') +
      table,
  )
  win.document.close()
  win.focus()
  setTimeout(() => win.print(), 400)
}

export function saveJson(doc: Doc) {
  download(fileBase(doc) + '.albert.json', new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }))
}

const csvCell = (v: string) => `"${v.replace(/"/g, '""')}"`

export function bomRows(doc: Doc, lang: Lang) {
  return doc.symbols
    .filter((s) => SYMBOL_MAP[s.defId].prefix !== '') // repères de simulation exclus
    .map((s) => ({ label: s.label, name: SYMBOL_MAP[s.defId].name[lang], desc: s.desc, std: SYMBOL_MAP[s.defId].std }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }))
}

export function wireRows(doc: Doc) {
  const name = (r: { symId: string; portId: string }) => {
    const s = doc.symbols.find((x) => x.id === r.symId)
    return s ? `${s.label || SYMBOL_MAP[s.defId].prefix}:${SYMBOL_MAP[s.defId].ports.find((p) => p.id === r.portId)?.label ?? r.portId}` : '?'
  }
  return doc.wires.map((w) => ({ label: w.label, from: name(w.from), to: name(w.to), section: w.section, color: w.color }))
}

export function exportCsv(doc: Doc, lang: Lang) {
  const lines = [['Tag', 'Component', 'Description', 'Standard'].map(csvCell).join(';')]
  for (const r of bomRows(doc, lang)) lines.push([r.label, r.name, r.desc, r.std].map(csvCell).join(';'))
  lines.push('')
  lines.push(['Wire', 'From', 'To', 'Section', 'Color'].map(csvCell).join(';'))
  for (const r of wireRows(doc)) lines.push([r.label, r.from, r.to, r.section, r.color].map(csvCell).join(';'))
  download(fileBase(doc) + '.csv', new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }))
}
