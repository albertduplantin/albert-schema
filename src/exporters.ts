import type { Doc, Lang } from './types'
import { PAPER_SIZE, UNIT_MM, portPos } from './geometry'
import './ratings' // doit précéder transformer (dépendance circulaire)
import { termsWithTopology } from './transformer'
import { SYMBOL_MAP } from './symbols'
import { terminalRows } from './strips'
import { dxfOf } from './dxf'

function download(name: string, blob: Blob) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

/** Exports en noir et blanc : toutes les couleurs (fils, formes, remplissages) deviennent du noir, pour une impression sobre. */
let monochrome = false
export const setMonochrome = (on: boolean) => { monochrome = on }
export const toMonochrome = (svg: string) =>
  svg
    .replace(/(stroke|fill)="(#[0-9a-fA-F]{3,6}|gnye)"/g, (m, k: string, v: string) => (/^#(fff|ffffff)$/i.test(v) ? m : `${k}="#000000"`))
    .replace(/(stroke|fill)="rgb\([^)]*\)"/g, (m, k: string) => `${k}="#000000"`)

export function sheetSvg(doc: Doc, content: SVGGElement): string {
  const { w, h } = PAPER_SIZE[doc.paper]
  let body = new XMLSerializer().serializeToString(content).replace(/<g[^>]*class="help-btn"[^>]*>.*?<\/g>/gs, '') // boutons d'explication : à l'écran seulement
  if (monochrome) body = toMonochrome(body)
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

export function exportDxf(doc: Doc) {
  download(fileBase(doc) + '.dxf', new Blob([dxfOf(doc)], { type: 'application/dxf' }))
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
    .filter((s) => SYMBOL_MAP[s.defId].prefix !== '' && SYMBOL_MAP[s.defId].cat !== 'sim') // repères de simulation et renvois exclus
    .map((s) => ({ label: s.label, name: SYMBOL_MAP[s.defId].name[lang], desc: s.desc, std: SYMBOL_MAP[s.defId].std }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }))
}

export function wireRows(doc: Doc) {
  const terms = termsWithTopology(doc, SYMBOL_MAP)
  const name = (r: { symId: string; portId: string }) => {
    const s = doc.symbols.find((x) => x.id === r.symId)
    return s ? `${s.label || SYMBOL_MAP[s.defId].prefix}:${terms[s.id]?.[r.portId] || SYMBOL_MAP[s.defId].ports.find((p) => p.id === r.portId)?.label || r.portId}` : '?'
  }
  /** longueur du tracé sur la feuille, en mm de papier */
  const length = (w: Doc['wires'][number]) => {
    const a = doc.symbols.find((x) => x.id === w.from.symId), b = doc.symbols.find((x) => x.id === w.to.symId)
    const pa = a && portPos(a, w.from.portId), pb = b && portPos(b, w.to.portId)
    if (!pa || !pb) return 0
    const path = [pa, ...(w.via ?? []), pb]
    let l = 0
    for (let i = 1; i < path.length; i++) l += Math.abs(path[i].x - path[i - 1].x) + Math.abs(path[i].y - path[i - 1].y) // tracé orthogonal
    return Math.round(l * UNIT_MM)
  }
  return doc.wires.map((w) => ({ label: w.label, from: name(w.from), to: name(w.to), section: w.section, color: w.color, mm: length(w) }))
}

/** Liste de câblage regroupée par couleur et section : nombre de conducteurs et longueur tracée cumulée (pour préparer les fils à couper). */
export function wireSummary(doc: Doc) {
  const m = new Map<string, { color: string; section: string; count: number; mm: number }>()
  for (const r of wireRows(doc)) {
    const k = `${r.color}|${r.section}`
    const e = m.get(k) ?? { color: r.color, section: r.section, count: 0, mm: 0 }
    e.count++; e.mm += r.mm
    m.set(k, e)
  }
  return [...m.values()].sort((a, b) => a.section.localeCompare(b.section, undefined, { numeric: true }) || a.color.localeCompare(b.color))
}

/** Liste de câblage seule (fichier CSV) : un conducteur par ligne, puis le récapitulatif par couleur et section. */
export function exportWiringCsv(doc: Doc, lang: Lang) {
  const fr = lang === 'fr'
  const lines = [(fr ? ['Fil', 'De', 'À', 'Section (mm²)', 'Couleur', 'Longueur tracée (mm sur la feuille)'] : ['Wire', 'From', 'To', 'Section (mm²)', 'Colour', 'Drawn length (mm on sheet)']).map(csvCell).join(';')]
  for (const r of wireRows(doc)) lines.push([r.label, r.from, r.to, r.section, r.color, String(r.mm)].map(csvCell).join(';'))
  lines.push('')
  lines.push((fr ? ['Couleur', 'Section (mm²)', 'Nombre de conducteurs', 'Longueur tracée cumulée (mm)'] : ['Colour', 'Section (mm²)', 'Conductors', 'Total drawn length (mm)']).map(csvCell).join(';'))
  for (const r of wireSummary(doc)) lines.push([r.color, r.section, String(r.count), String(r.mm)].map(csvCell).join(';'))
  download(fileBase(doc) + '.cablage.csv', new Blob(['﻿' + lines.join(String.fromCharCode(13, 10))], { type: 'text/csv;charset=utf-8' }))
}

export function exportCsv(doc: Doc, lang: Lang) {
  const lines = [['Tag', 'Component', 'Description', 'Standard'].map(csvCell).join(';')]
  for (const r of bomRows(doc, lang)) lines.push([r.label, r.name, r.desc, r.std].map(csvCell).join(';'))
  lines.push('')
  lines.push(['Wire', 'From', 'To', 'Section', 'Color'].map(csvCell).join(';'))
  for (const r of wireRows(doc)) lines.push([r.label, r.from, r.to, r.section, r.color].map(csvCell).join(';'))
  const terms = terminalRows(doc, lang)
  if (terms.length) {
    lines.push('')
    lines.push(['Strip', 'Terminal', 'Incoming', 'Outgoing'].map(csvCell).join(';'))
    for (const r of terms) lines.push([r.strip, r.terminal, r.inWires.join(' | '), r.outWires.join(' | ')].map(csvCell).join(';'))
  }
  download(fileBase(doc) + '.csv', new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }))
}
