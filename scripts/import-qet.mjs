// Convertit une sélection de la collection QElectroTech (fichiers .elmt, CC-BY 3.0)
// en bibliothèque JSON pour Albert Schema Studio.
//
// Usage : node scripts/import-qet.mjs <dossier qelectrotech-elements> <fichier de sortie.json> [api/_ids.json]
// Le 3e argument (facultatif) écrit la liste des identifiants valides, utilisée par /api/usage.
//
// Les fichiers .elmt lus sont traités comme des DONNÉES (lecture + regex), jamais exécutés.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { popularity } from './popularity.mjs'
import { classify } from './sim-classify.mjs'
import { classifyFluid } from './fluid-classify.mjs'
import { animate } from './sim-animate.mjs'

const [, , root, out, idsOut] = process.argv
if (!root || !out) {
  console.error('usage: node scripts/import-qet.mjs <qelectrotech-elements> <out.json>')
  process.exit(1)
}

const decode = (s) =>
  s.replace(/&#10;/g, '\n').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

const attrsOf = (raw) => {
  const a = {}
  for (const m of raw.matchAll(/([\w:-]+)="([^"]*)"/g)) a[m[1]] = decode(m[2])
  return a
}

const names = (xml) => {
  const n = {}
  for (const m of xml.matchAll(/<name lang="(\w+)">([^<]*)<\/name>/g)) n[m[1]] = decode(m[2]).trim()
  const fr = n.fr || n.en || ''
  const en = n.en || n.fr || ''
  return { fr, en }
}

const dirName = (dir) => {
  try {
    return names(readFileSync(join(dir, 'qet_directory'), 'utf8'))
  } catch {
    return { fr: '', en: '' }
  }
}

const walk = (dir) => {
  const res = []
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) res.push(...walk(p))
    else if (f.endsWith('.elmt')) res.push(p)
  }
  return res
}

// Préfixe de repère (EN 81346 / usage courant) selon le dossier
const PREFIX = [
  [/10_fuses/, 'F'], [/11_circuit_breakers/, 'Q'], [/12_magneto/, 'Q'], [/20_disconnecting/, 'Q'],
  [/30_thermal_relays/, 'F'], [/50_residual/, 'Q'], [/90_overvoltage/, 'F'],
  [/310_relays_contactors/, 'K'], [/330_transformers/, 'T'], [/340_converters/, 'U'],
  [/11_optical_signaling|12_acoustic_signaling/, 'H'], [/01_human_machine_interface/, 'A'], [/380_signaling/, 'S'], [/390_sensors/, 'B'], [/391_consumers/, 'M'], [/392_generators/, 'G'],
  [/395_electronics/, 'V'], [/130_terminals/, 'X'], [/140_connectors/, 'X'], [/120_cables/, 'W'],
  [/110_network/, 'G'], [/450_high_voltage/, 'Q'], [/500_home/, 'Q'], [/114_connections/, 'X'],
  [/21_tanks/, 'T'], [/31_control_valves/, 'V'], [/45_valves/, 'V'], [/51_cylinders/, 'A'], [/61_pumps/, 'P'],
  [/71_exchangers/, 'E'], [/81_filters/, 'F'],
  [/5010_compressed_air/, 'Z'], [/5020_velves/, 'V'], [/5030_actuators/, 'A'], [/5040_sensors/, 'B'],
]
const prefixFor = (rel) => (PREFIX.find(([re]) => re.test(rel)) ?? [null, 'E'])[1]

const COLORS = {
  black: 'currentColor', white: 'var(--bg)', blue: '#2a5bd7', red: '#d33', green: '#2a8a2a', gray: '#888', lightgray: '#ccc',
  yellow: '#e6c200', brun: '#7b4a1e', orange: '#e08000',
}
const colorOf = (c) => {
  if (!c || c === 'none') return null
  const k = c.toLowerCase()
  if (COLORS[k]) return COLORS[k]
  if (/^#[0-9a-f]{3,8}$/i.test(c)) return c
  if (/^html/i.test(c)) return '#999'
  return 'currentColor'
}
const WEIGHT = { none: 0, thin: 0.8, normal: 1.4, hight: 2.4, eleve: 3.2 }
const DASH = { dashed: '4 3', dotted: '1.5 3', dashdotted: '4 2 1 2' }

const n1 = (v) => Math.round(v * 10) / 10

function styleAttrs(style, closed) {
  const s = {}
  for (const part of (style || '').split(';')) {
    const [k, v] = part.split(':')
    if (k) s[k.trim()] = (v ?? '').trim()
  }
  const w = WEIGHT[s['line-weight']] ?? 1.4
  const stroke = colorOf(s.color) ?? 'currentColor'
  const fill = closed ? colorOf(s.filling) : colorOf(s.filling)
  let a = ''
  a += w === 0 ? ' stroke="none"' : (w === 1.4 ? '' : ` stroke-width="${w}"`)
  if (stroke !== 'currentColor') a += ` stroke="${stroke}"`
  a += fill ? ` fill="${fill}"` : ''
  if (DASH[s['line-style']]) a += ` stroke-dasharray="${DASH[s['line-style']]}"`
  return a
}

const escapeText = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function convert(xml) {
  const shapes = []
  const terminals = []
  const texts = [] // textes statiques conservés dans le dessin
  const textShapes = [] // textes statiques conservés : { i: indice de la forme, text }
  const segs = [] // segments et polylignes ouvertes (repérage des lames de contacts)
  const rounds = [] // cercles et ellipses (rotor des moteurs)
  const box = { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity }
  const grow = (x, y) => {
    box.x1 = Math.min(box.x1, x); box.y1 = Math.min(box.y1, y)
    box.x2 = Math.max(box.x2, x); box.y2 = Math.max(box.y2, y)
  }
  const tag = /<(line|rect|ellipse|circle|arc|polygon|text|terminal)((?:\s+[\w:-]+="[^"]*")*)\s*\/?>/g
  for (const m of xml.matchAll(tag)) {
    const kind = m[1]
    const a = attrsOf(m[2])
    const f = (k) => Number(a[k])
    if (kind === 'terminal') {
      const orient = { n: 'up', s: 'down', e: 'right', w: 'left' }[a.orientation]
      if (!orient || Number.isNaN(f('x'))) continue
      terminals.push({ x: f('x'), y: f('y'), dir: orient, name: a.name || '' })
      grow(f('x'), f('y'))
    } else if (kind === 'line') {
      grow(f('x1'), f('y1')); grow(f('x2'), f('y2'))
      segs.push({ i: shapes.length, pts: [[f('x1'), f('y1')], [f('x2'), f('y2')]] })
      shapes.push(`<path d="M${n1(f('x1'))} ${n1(f('y1'))}L${n1(f('x2'))} ${n1(f('y2'))}"${styleAttrs(a.style, false)}/>`)
    } else if (kind === 'rect') {
      grow(f('x'), f('y')); grow(f('x') + f('width'), f('y') + f('height'))
      const r = f('rx') > 0 ? ` rx="${f('rx')}" ry="${f('ry') || f('rx')}"` : ''
      shapes.push(`<rect x="${n1(f('x'))}" y="${n1(f('y'))}" width="${n1(f('width'))}" height="${n1(f('height'))}"${r}${styleAttrs(a.style, true)}/>`)
    } else if (kind === 'ellipse') {
      grow(f('x'), f('y')); grow(f('x') + f('width'), f('y') + f('height'))
      rounds.push({ cx: f('x') + f('width') / 2, cy: f('y') + f('height') / 2, r: Math.min(f('width'), f('height')) / 2 })
      shapes.push(`<ellipse cx="${n1(f('x') + f('width') / 2)}" cy="${n1(f('y') + f('height') / 2)}" rx="${n1(f('width') / 2)}" ry="${n1(f('height') / 2)}"${styleAttrs(a.style, true)}/>`)
    } else if (kind === 'circle') {
      const d = f('diameter')
      grow(f('x'), f('y')); grow(f('x') + d, f('y') + d)
      rounds.push({ cx: f('x') + d / 2, cy: f('y') + d / 2, r: d / 2 })
      shapes.push(`<circle cx="${n1(f('x') + d / 2)}" cy="${n1(f('y') + d / 2)}" r="${n1(d / 2)}"${styleAttrs(a.style, true)}/>`)
    } else if (kind === 'arc') {
      const cx = f('x') + f('width') / 2, cy = f('y') + f('height') / 2
      const rx = f('width') / 2, ry = f('height') / 2
      const s = (f('start') * Math.PI) / 180, e = ((f('start') + f('angle')) * Math.PI) / 180
      const P = (t) => [cx + rx * Math.cos(t), cy - ry * Math.sin(t)]
      const [x1, y1] = P(s), [x2, y2] = P(e)
      grow(f('x'), f('y')); grow(f('x') + f('width'), f('y') + f('height'))
      const large = Math.abs(f('angle')) > 180 ? 1 : 0
      const sweep = f('angle') >= 0 ? 0 : 1
      shapes.push(`<path d="M${n1(x1)} ${n1(y1)}A${n1(rx)} ${n1(ry)} 0 ${large} ${sweep} ${n1(x2)} ${n1(y2)}"${styleAttrs(a.style, false)} fill="none"/>`)
    } else if (kind === 'polygon') {
      const pts = []
      for (let i = 1; a[`x${i}`] !== undefined; i++) pts.push([f(`x${i}`), f(`y${i}`)])
      if (pts.length < 2) continue
      pts.forEach(([x, y]) => grow(x, y))
      const closed = a.closed !== 'false'
      if (!closed) segs.push({ i: shapes.length, pts, poly: true, st: styleAttrs(a.style, false) })
      shapes.push(`<path d="M${pts.map(([x, y]) => `${n1(x)} ${n1(y)}`).join('L')}${closed ? 'Z' : ''}"${styleAttrs(a.style, closed)}${closed ? '' : ' fill="none"'}/>`)
    } else if (kind === 'text') {
      const fm = /^[^,]*,([\d.]+)/.exec(a.font || '')
      const size = fm ? Number(fm[1]) : 9
      if (size < 6 || !a.text || a.text.trim() === '') continue // libellés de bornes : retirés
      const lines = a.text.split('\n')
      const rot = Number(a.rotation) || 0
      const tx = f('x'), ty = f('y')
      grow(tx, ty - size); grow(tx + Math.max(...lines.map((l) => l.length)) * size * 0.6, ty + (lines.length - 1) * size * 1.2)
      const body = lines.map((l, i) => `<tspan x="${n1(tx)}" dy="${i ? n1(size * 1.2) : 0}">${escapeText(l)}</tspan>`).join('')
      const tr = rot ? ` transform="rotate(${rot} ${n1(tx)} ${n1(ty)})"` : ''
      for (const l of lines) texts.push(l.trim())
      textShapes.push({ i: shapes.length, text: lines.map((l) => l.trim()).join('') })
      shapes.push(`<text x="${n1(tx)}" y="${n1(ty)}" font-size="${n1(size * 1.15)}" fill="currentColor" stroke="none"${tr}>${body}</text>`)
    }
  }
  // lame + fût dessinés en une seule polyligne : on sépare la lame (premier chemin) pour pouvoir l'animer
  const diag = (p, q) => Math.abs(p[0] - q[0]) > 2 && Math.abs(p[1] - q[1]) > 2 && Math.hypot(p[0] - q[0], p[1] - q[1]) >= 8
  const atTerm = (pt) => terminals.some((t) => Math.hypot(t.x - pt[0], t.y - pt[1]) <= 2.5)
  const d = (pts) => 'M' + pts.map(([x, y]) => n1(x) + ' ' + n1(y)).join('L')
  for (const s of [...segs]) {
    if (!s.poly || s.pts.length < 3) continue
    const P = s.pts
    let blade = null
    let rest = null
    const len = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1])
    const first = [P[0], P[1]]
    const last = [P[P.length - 2], P[P.length - 1]]
    // lame prolongée par un fût qui rejoint une borne, ou longue lame (≥ 14) au bout d'un déclencheur (disjoncteurs)
    if (diag(...first) && (atTerm(P[P.length - 1]) || len(...first) >= 14)) { blade = first; rest = P.slice(1) }
    else if (diag(...last) && (atTerm(P[0]) || len(...last) >= 14)) { blade = last; rest = P.slice(0, -1) }
    if (!blade) continue
    shapes[s.i] = `<path d="${d(blade)}"${s.st} fill="none"/><path d="${d(rest)}"${s.st} fill="none"/>`
    segs.splice(segs.indexOf(s), 1, { i: s.i, pts: blade }, { i: s.i, pts: rest })
  }
  return { shapes, terminals, box, texts, textShapes, segs, rounds }
}

const roots = [
  { domain: 'electrical', dir: '10_electric/10_allpole', catDepth: 1, label: null },
  { domain: 'electrical', dir: '10_electric/11_singlepole', catDepth: 1, label: { fr: 'Unifilaire — ', en: 'Single-line — ' } },
  { domain: 'hydraulic', dir: '30_hydraulic', catDepth: 1, label: null },
  { domain: 'pneumatic', dir: '50_pneumatic', catDepth: 1, label: null },
]

const symbols = []
const categories = { electrical: [], pneumatic: [], hydraulic: [] }
let skipped = 0

for (const r of roots) {
  const base = join(root, r.dir)
  for (const file of walk(base)) {
    const rel = relative(base, file).split(sep)
    const catId = r.dir.replace(/[\\/]/g, '_') + '/' + rel[0]
    const xml = readFileSync(file, 'utf8')
    const head = /<definition\b([^>]*)>/.exec(xml)
    const def = head ? attrsOf(head[1]) : {}
    if (/report/.test(def.link_type || '')) { skipped++; continue }
    const { shapes, terminals, box, texts, textShapes, segs, rounds } = convert(xml)
    if (!terminals.length || !shapes.length) { skipped++; continue }
    let ox = Math.floor(box.x1 / 10) * 10
    let oy = Math.floor(box.y1 / 10) * 10
    let w = Math.max(10, Math.ceil((box.x2 - ox) / 10) * 10)
    let h = Math.max(10, Math.ceil((box.y2 - oy) / 10) * 10)
    // un texte du dessin identique au nom d'une borne est retiré : le repère s'affiche depuis la borne et reste modifiable
    const termNames = new Set(terminals.map((t) => t.name).filter(Boolean))
    for (const ts of textShapes) if (termNames.has(ts.text)) shapes[ts.i] = ''
    const ports = terminals.map((t, i) => {
      const p = { id: 't' + i, x: n1(t.x - ox), y: n1(t.y - oy), dir: t.dir }
      // pas d'étiquette si le dessin l'affiche déjà (évite les numéros de bornes en double)
      if (t.name && t.name.length <= 4 && t.name.toLowerCase() !== 'terminal') p.label = t.name
      return p
    })
    const el = names(xml.slice(0, xml.indexOf('</names>') + 8))
    if (!el.fr && !el.en) { skipped++; continue }
    // catégorie
    if (!categories[r.domain].some((c) => c.id === catId)) {
      const cn = dirName(join(base, rel[0]))
      categories[r.domain].push({ id: catId, name: { fr: (r.label?.fr ?? '') + (cn.fr || rel[0]), en: (r.label?.en ?? '') + (cn.en || rel[0]) } })
    }
    // groupe : sous-dossier de 2e niveau (3e niveau pour pneumatique/hydraulique : types de distributeurs, de vérins…)
    const gi = r.domain !== 'electrical' && rel.length > 3 ? 2 : 1
    const grp = rel.length > gi + 1 ? dirName(join(base, ...rel.slice(0, gi + 1))) : null
    const relFromRoot = relative(root, file).split(sep).join('/')
    const fluid = r.domain === 'pneumatic' ? classifyFluid({ id: relFromRoot, nameFr: el.fr ?? '', ports }) : null
    const sim = r.domain === 'electrical' ? classify({ id: relFromRoot, nameFr: el.fr, nameEn: el.en, ports }) : null
    if (sim) {
      // animation : lames des contacts (CSS : rotation pilotée par --b{n}) et rotor des moteurs
      const anim = animate({ sim, terminals, segs, rounds })
      anim.blades.forEach((b, n) => {
        shapes[b.shape] = shapes[b.shape].replace('<path ', `<path class="blade" style="transform-box:fill-box;transform-origin:${b.origin};transform:rotate(var(--b${n},0deg));transition:transform .25s ease-out" `)
      })
      if (anim.blades.length) sim.blades = anim.blades.map((b) => ({ rot: b.rot, closed: b.closed }))
      if (anim.spin) sim.spin = { cx: n1(anim.spin.cx - ox), cy: n1(anim.spin.cy - oy), r: n1(anim.spin.r) }
    }
    // ── bornes : raccord sur la grille de 10, puis pas de 20 entre bornes voisines d'une même rangée.
    //  1. chaque borne est ramenée sur la grille en déformant son fil de raccordement (segment droit du dessin) ;
    //  2. si toutes les rangées de bornes sont à 10 d'écart, le symbole est agrandi ×2 : les fils restent droits et parallèles ;
    //  3. sinon, les rangées trop serrées sont écartées en inclinant légèrement leurs fils de raccordement.
    // Électrique seulement pour 2 et 3 (le pneumatique garde ses dessins normalisés).
    {
      const AXIS = { up: [0, 1], down: [0, -1], left: [1, 0], right: [-1, 0] } // sens « vers l'intérieur »
      const E = terminals.map((t) => ({ x: t.x, y: t.y, dir: t.dir }))
      const ox0 = ox
      const oy0 = oy
      // un fil de raccordement : suite de segments alignés avec l'axe de la borne, qui se touchent, en partant de la borne
      const findLead = (p) => {
        const inw = AXIS[p.dir]
        if (!inw) return null
        const lat = (q) => (inw[0] === 0 ? q[0] - p.x : q[1] - p.y)
        const u = (q) => (inw[0] === 0 ? (q[1] - p.y) * inw[1] : (q[0] - p.x) * inw[0])
        const items = []
        segs.forEach((sg) => {
          if (/class="blade"/.test(shapes[sg.i])) return
          for (let k = 0; k + 1 < sg.pts.length; k++) {
            const a = sg.pts[k]
            const b = sg.pts[k + 1]
            if (Math.abs(lat(a)) <= 0.6 && Math.abs(lat(b)) <= 0.6 && Math.abs(u(a) - u(b)) > 0.1) items.push({ sg, a, b, lo: Math.min(u(a), u(b)), hi: Math.max(u(a), u(b)) })
          }
        })
        const chain = []
        let cur = 0
        for (;;) {
          const next = items.filter((it) => !chain.includes(it) && it.lo <= cur + 2.5 && it.hi > cur + 0.1).sort((x, y) => y.hi - x.hi)[0]
          if (!next) break
          chain.push(next)
          cur = Math.max(cur, next.hi)
        }
        return cur >= 8 ? { chain, len: cur, u } : null
      }
      const shear = (lead, d) => {
        const touched = new Set() // un point commun à deux segments d'un même fil n'est déplacé qu'une fois
        const L = Math.min(lead.len, 20) // un fil très long (conducteur qui traverse le symbole) ne se déforme que sur ses 20 derniers
        for (const it of lead.chain) {
          for (const q of [it.a, it.b]) {
            if (touched.has(q)) continue
            touched.add(q)
            const t = Math.min(1, Math.max(0, 1 - lead.u(q) / L))
            q[0] += d[0] * t
            q[1] += d[1] * t
          }
          const sg = it.sg
          shapes[sg.i] = shapes[sg.i].replace(/ d="[^"]*"/, ' d="M' + sg.pts.map(([x, y]) => n1(x) + ' ' + n1(y)).join(' L') + '"')
        }
      }
      // déplace une borne vers `to` : déformation du fil de raccordement, ou à défaut petit coude
      const movePort = (p, to, lead) => {
        if (to.x === p.x && to.y === p.y) return
        lead = lead ?? findLead(p)
        if (lead) return shear(lead, [to.x - p.x, to.y - p.y])
        const inw = { up: [0, 2], down: [0, -2], left: [2, 0], right: [-2, 0] }[p.dir] ?? [0, 0]
        const pts = [[p.x + inw[0], p.y + inw[1]], [p.x, p.y]]
        if (to.x !== p.x && to.y !== p.y) pts.push([to.x, p.y])
        pts.push([to.x, to.y])
        shapes.push('<path d="M' + pts.map(([a, b]) => n1(a) + ' ' + n1(b)).join(' L') + '"/>')
      }
      const rowsOf = (P) => {
        const rows = []
        for (const dir of ['up', 'down', 'left', 'right']) {
          const horiz = dir === 'up' || dir === 'down'
          const m = new Map()
          P.forEach((p, i) => {
            if (p.dir !== dir) return
            const k = horiz ? p.y : p.x
            if (!m.has(k)) m.set(k, [])
            m.get(k).push(i)
          })
          for (const idx of m.values()) if (idx.length >= 2) rows.push({ horiz, idx: [...idx].sort((x, y) => (horiz ? P[x].x - P[y].x : P[x].y - P[y].y)) })
        }
        return rows
      }

      // 1. sur la grille
      // vers l'extérieur : un fil de raccordement ne raccourcit jamais, il s'allonge jusqu'à la grille ; latéralement, au plus près
      const snapOut = (v, outSign) => (outSign < 0 ? Math.floor(v / 10 + 1e-9) * 10 : outSign > 0 ? Math.ceil(v / 10 - 1e-9) * 10 : Math.round(v / 10) * 10)
      let P = E.map((p) => ({
        ...p,
        x: snapOut(p.x, p.dir === 'left' ? -1 : p.dir === 'right' ? 1 : 0),
        y: snapOut(p.y, p.dir === 'up' ? -1 : p.dir === 'down' ? 1 : 0),
      }))
      if (new Set(P.map((q) => q.x + ',' + q.y)).size !== P.length) P = E.map((p) => ({ ...p }))
      else E.forEach((p, i) => movePort(p, P[i]))
      let k = 1

      if (r.domain === 'electrical') {
        const rows = rowsOf(P)
        const pitch = (row) => row.idx.slice(1).map((v, j) => (row.horiz ? P[v].x - P[row.idx[j]].x : P[v].y - P[row.idx[j]].y))
        if (rows.length && rows.every((row) => pitch(row).every((g) => g === 10))) {
          // 2. agrandissement ×2 : tout le dessin (traits, arcs, ellipses, rectangles, positions des textes), pas l'épaisseur des traits
          k = 2
          const NUM = '-?\\d*\\.?\\d+(?:e-?\\d+)?'
          const scalePath = (d) => {
            const SIZE = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 }
            let cmd = 'M'
            let idx = 0
            return d.replace(new RegExp('([A-Za-z])|(' + NUM + ')', 'g'), (m, c, num) => {
              if (c) {
                cmd = c.toUpperCase()
                idx = 0
                return c
              }
              const i = idx++ % (SIZE[cmd] || 1)
              const skip = cmd === 'A' && (i === 2 || i === 3 || i === 4)
              return skip ? num : String(n1(Number(num) * k))
            })
          }
          for (let i = 0; i < shapes.length; i++) {
            if (!shapes[i]) continue
            let t = shapes[i].replace(/ d="([^"]*)"/, (m, d) => ' d="' + scalePath(d) + '"')
            for (const at of ['x', 'y', 'width', 'height', 'cx', 'cy', 'rx', 'ry', 'x1', 'y1', 'x2', 'y2', 'r']) {
              t = t.replace(new RegExp(' ' + at + '="(' + NUM + ')"'), (m, v) => ' ' + at + '="' + n1(Number(v) * k) + '"')
            }
            shapes[i] = t
          }
          P = P.map((p) => ({ ...p, x: p.x * k, y: p.y * k }))
        } else {
          // 3. rangées trop serrées : bornes écartées à 20, fils de raccordement légèrement inclinés
          const target = P.map((p) => ({ ...p }))
          const leads = new Map()
          for (const row of rows) {
            const g = pitch(row)
            if (g.every((v) => v >= 20) || g.some((v) => v < 10) || row.idx.length > 4) continue // connecteurs à nombreuses broches : inchangés
            const ls = row.idx.map((i) => findLead(P[i]))
            if (ls.some((l) => !l)) continue
            const pos = (i) => (row.horiz ? P[i].x : P[i].y)
            const c = Math.round((pos(row.idx[0]) + pos(row.idx[row.idx.length - 1])) / 2 / 10) * 10
            const moves = row.idx.map((i, j) => ({ i, v: c + (j - (row.idx.length - 1) / 2) * 20 }))
            if (moves.some((m, j) => Math.abs(m.v - pos(m.i)) > Math.min(10, ls[j].len))) continue
            moves.forEach((m, j) => {
              if (row.horiz) target[m.i].x = m.v
              else target[m.i].y = m.v
              leads.set(m.i, ls[j])
            })
          }
          if (new Set(target.map((q) => q.x + ',' + q.y)).size === target.length) {
            P.forEach((p, i) => movePort(p, target[i], leads.get(i)))
            P = target
          }
        }
      }

      // le cadre s'adapte : nouvelle origine et nouvelles dimensions, bornes comprises
      const minX = Math.min(box.x1 * k, ...P.map((p) => p.x))
      const minY = Math.min(box.y1 * k, ...P.map((p) => p.y))
      const maxX = Math.max(box.x2 * k, ...P.map((p) => p.x))
      const maxY = Math.max(box.y2 * k, ...P.map((p) => p.y))
      ox = Math.floor(minX / 10) * 10
      oy = Math.floor(minY / 10) * 10
      w = Math.max(10, Math.ceil((maxX - ox) / 10) * 10)
      h = Math.max(10, Math.ceil((maxY - oy) / 10) * 10)
      P.forEach((p, i) => {
        ports[i].x = p.x - ox
        ports[i].y = p.y - oy
      })
      if (sim?.spin) {
        sim.spin = { cx: n1((sim.spin.cx + ox0) * k - ox), cy: n1((sim.spin.cy + oy0) * k - oy), r: n1(sim.spin.r * k) }
      }
    }
    const svg = shapes.join('')
    symbols.push({
      id: 'qet:' + relFromRoot.replace(/\.elmt$/, ''),
      domain: r.domain, cat: catId,
      group: grp && (grp.fr || grp.en) ? grp : null,
      score: popularity({ rel: relFromRoot, nameFr: el.fr, nameEn: el.en }),
      sim,
      ...(fluid ? { fluid } : {}),
      prefix: prefixFor(r.dir + '/' + rel.join('/')),
      name: el, w, h,
      svg: shapes.map((s) => s).join('').replace(/(-?\d+(?:\.\d+)?)/g, (m) => m), // inchangé, translation ci-dessous
      ports,
      _ox: ox, _oy: oy,
    })
    symbols[symbols.length - 1].svg = `<g transform="translate(${-ox} ${-oy})">${svg}</g>`
    delete symbols[symbols.length - 1]._ox
    delete symbols[symbols.length - 1]._oy
  }
}

// Ordre d'affichage : familles les plus utilisées d'abord, unifilaire en dernier
const ORDER = ['310_', '200_', '380_', '330_', '391_', '340_', '390_', '395_', '130_', '110_', '120_', '140_', '114_', '392_', '450_', '500_']
const rank = (id) => {
  const tail = id.split('/').pop()
  const i = ORDER.findIndex((p) => tail.startsWith(p))
  return (id.includes('11_singlepole') ? 100 : 0) + (i < 0 ? 50 : i)
}
for (const d of Object.keys(categories)) categories[d].sort((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id))

// Tri des symboles : catégorie, puis groupes du plus au moins utilisé, puis symboles par score
const catIndex = (s) => categories[s.domain].findIndex((c) => c.id === s.cat)
const groupKey = (s) => s.cat + '|' + (s.group?.fr ?? '')
const groupMax = new Map()
for (const s of symbols) groupMax.set(groupKey(s), Math.max(groupMax.get(groupKey(s)) ?? 0, s.score))
const original = new Map(symbols.map((s, i) => [s.id, i]))
symbols.sort(
  (a, b) =>
    a.domain.localeCompare(b.domain) ||
    catIndex(a) - catIndex(b) ||
    groupMax.get(groupKey(b)) - groupMax.get(groupKey(a)) ||
    groupKey(a).localeCompare(groupKey(b)) ||
    b.score - a.score ||
    original.get(a.id) - original.get(b.id),
)

// « Les plus utilisés » : meilleurs scores par domaine, 3 symboles au plus par groupe
for (const d of Object.keys(categories)) {
  // tourniquet entre familles (la plus utilisée d'abord) pour éviter qu'une seule famille monopolise la liste
  const pool = symbols.filter((s) => s.domain === d && s.score >= 80 && !s.cat.includes('11_singlepole'))
  const byGroup = new Map()
  for (const s of pool.sort((a, b) => b.score - a.score)) {
    const k = groupKey(s)
    if (!byGroup.has(k)) byGroup.set(k, [])
    byGroup.get(k).push(s)
  }
  const queues = [...byGroup.values()].sort((a, b) => b[0].score - a[0].score)
  const seen = new Set()
  let n = 0
  for (let round = 0; round < 2 && n < 36; round++) {
    for (const q of queues) {
      const s = q.filter((x) => !seen.has(x.name.fr.toLowerCase()))[round === 0 ? 0 : 0]
      if (!s || n >= 36) continue
      seen.add(s.name.fr.toLowerCase())
      s.top = true
      n++
    }
  }
}
for (const s of symbols) if (!s.sim) delete s.sim
const simCount = symbols.filter((s) => s.sim).length
writeFileSync(out, JSON.stringify({ source: 'QElectroTech elements collection, CC-BY 3.0', categories, symbols }))
if (idsOut) writeFileSync(idsOut, JSON.stringify(symbols.map((s) => s.id)))
console.log(`${symbols.length} symboles importés, ${skipped} ignorés, ${simCount} simulables`)
for (const d of Object.keys(categories)) console.log(d, symbols.filter((s) => s.domain === d).length)
