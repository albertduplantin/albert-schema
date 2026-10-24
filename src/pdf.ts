import { PAPER_SIZE, UNIT_MM } from './geometry'
import type { Doc } from './types'

/** Rend un schéma SVG en image JPEG (fond blanc) à `scale` pixels par unité de feuille. */
async function svgToJpeg(svg: string, w: number, h: number, scale: number): Promise<{ data: Uint8Array; px: number; py: number }> {
  const px = Math.round(w * scale), py = Math.round(h * scale)
  const sized = svg.replace(/width="[^"]*mm" height="[^"]*mm"/, `width="${px}" height="${py}"`)
  const img = new Image()
  await new Promise<void>((ok, ko) => { img.onload = () => ok(); img.onerror = () => ko(new Error('svg')); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(sized) })
  const c = document.createElement('canvas')
  c.width = px; c.height = py
  const g = c.getContext('2d')!
  g.fillStyle = '#fff'; g.fillRect(0, 0, px, py)
  g.drawImage(img, 0, 0, px, py)
  const url = c.toDataURL('image/jpeg', 0.92)
  const bin = atob(url.slice(url.indexOf(',') + 1))
  const data = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i)
  return { data, px, py }
}

/** Assemble un PDF (une image JPEG pleine page par feuille), sans bibliothèque. */
export function buildPdf(pages: { jpeg: Uint8Array; px: number; py: number; wPt: number; hPt: number }[]): Blob {
  const enc = new TextEncoder()
  const chunks: Uint8Array[] = []
  const offsets: number[] = []
  let len = 0
  const push = (b: Uint8Array) => { chunks.push(b); len += b.length }
  const txt = (s: string) => push(enc.encode(s))
  const obj = (n: number, body: () => void) => { offsets[n] = len; txt(`${n} 0 obj\n`); body(); txt('\nendobj\n') }
  txt('%PDF-1.4\n')
  // objets : 1 catalogue, 2 pages, puis 3 par feuille (page, contenu, image)
  obj(1, () => txt('<< /Type /Catalog /Pages 2 0 R >>'))
  obj(2, () => txt(`<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ')}] >>`))
  pages.forEach((p, i) => {
    const n = 3 + i * 3
    obj(n, () => txt(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${p.wPt.toFixed(2)} ${p.hPt.toFixed(2)}] /Resources << /XObject << /Im0 ${n + 2} 0 R >> >> /Contents ${n + 1} 0 R >>`))
    const content = `q ${p.wPt.toFixed(2)} 0 0 ${p.hPt.toFixed(2)} 0 0 cm /Im0 Do Q`
    obj(n + 1, () => txt(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`))
    obj(n + 2, () => {
      txt(`<< /Type /XObject /Subtype /Image /Width ${p.px} /Height ${p.py} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`)
      push(p.jpeg)
      txt('\nendstream')
    })
  })
  const total = 3 + pages.length * 3
  const xref = len
  txt(`xref\n0 ${total}\n0000000000 65535 f \n`)
  for (let n = 1; n < total; n++) txt(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`)
  txt(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`)
  return new Blob(chunks as BlobPart[], { type: 'application/pdf' })
}

/** PDF direct : une page par SVG de feuille, à la taille réelle du papier (~150 dpi). */
export async function exportPdf(doc: Doc, svgs: string[], fileName: string) {
  const { w, h } = PAPER_SIZE[doc.paper]
  const scale = 150 / 25.4 / UNIT_MM // pixels par unité de feuille pour 150 dpi
  const pages = []
  for (const svg of svgs) {
    const j = await svgToJpeg(svg, w, h, scale)
    pages.push({ jpeg: j.data, px: j.px, py: j.py, wPt: (w * UNIT_MM * 72) / 25.4, hPt: (h * UNIT_MM * 72) / 25.4 })
  }
  const a = document.createElement('a')
  a.href = URL.createObjectURL(buildPdf(pages))
  a.download = fileName
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}
