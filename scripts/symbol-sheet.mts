import { readFileSync, writeFileSync } from 'node:fs'
const { ownDrawing } = await import('../src/symbols/own/index.ts')
const raw = JSON.parse(readFileSync(new URL('../data/library-raw.json', import.meta.url), 'utf8'))
const dom = process.argv[2] ?? 'electrical'
let html = '<body style="background:#fff;font:10px sans-serif;color:#222"><style>.c{display:inline-block;margin:4px;padding:3px;border:1px solid #ddd;vertical-align:top}.c div{max-width:170px}</style>'
let n = 0
for (const s of raw.symbols.filter((x: any) => x.domain === dom && !x.legacy)) {
  const o = ownDrawing(s)
  if (!o) continue
  n++
  const sc = Math.min(2.2, 170 / Math.max(s.w + 30, 1), 150 / Math.max(s.h + 30, 1))
  const dots = s.ports.map((p: any) => `<circle cx="${p.x}" cy="${p.y}" r="1.8" fill="#e53935" stroke="none"/>`).join('')
  html += `<div class="c"><div>${o.name?.fr ?? s.name.fr}</div><svg width="${(s.w + 40) * sc}" height="${(s.h + 40) * sc}" viewBox="-20 -20 ${s.w + 40} ${s.h + 40}" style="stroke:#222;fill:none;stroke-width:1.4"><rect x="0" y="0" width="${s.w}" height="${s.h}" stroke="#bbb" stroke-dasharray="2 2" stroke-width=".6"/>${o.svg.replace(/var\(--bg\)/g, '#fff')}${dots}</svg></div>`
}
writeFileSync(process.env.TEMP + '/sheet2.html', html)
console.log(n, 'symboles dessinés')
