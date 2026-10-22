// Animation des symboles simulés : repère les lames des contacts et le rotor des moteurs.
//
// Entrées (coordonnées d'origine du fichier .elmt, avant recadrage) :
//   sim        modèle de simulation du symbole (voir sim-classify.mjs)
//   terminals  [{ x, y }]  (l'indice i correspond à la borne `t{i}`)
//   segs       [{ i, pts }] segments et polylignes ouvertes ; `i` = indice de la forme dans le dessin SVG
//   rounds     [{ cx, cy, r }] cercles et ellipses
//
// Sortie : { blades: [{ shape, rot, closed, origin }], spin }
//   - `shape`  : indice de la forme SVG à animer (une lame)
//   - `closed` : la lame est dessinée en position fermée (sa pointe touche le contact fixe)
//   - `rot`    : rotation (degrés, sens horaire) qui fait passer la lame de la position dessinée à l'autre position
//   - `origin` : pivot en pourcentage de la boîte de la lame (transform-box: fill-box)
//
// Le contact fixe est l'ensemble des traits reliés au fût de la borne d'en face (fût + petite barre ou crochet
// éventuels) : un contact NF dessiné fermé touche cette barre, un contact NO dessiné ouvert en est éloigné.

const ang = (p, q) => (Math.atan2(q[1] - p[1], q[0] - p[0]) * 180) / Math.PI
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1])
const norm = (a) => {
  while (a > 180) a -= 360
  while (a <= -180) a += 360
  return a
}
const rotate = (p, c, deg) => {
  const a = (deg * Math.PI) / 180
  const dx = p[0] - c[0]
  const dy = p[1] - c[1]
  return [c[0] + dx * Math.cos(a) - dy * Math.sin(a), c[1] + dx * Math.sin(a) + dy * Math.cos(a)]
}

/** Point du segment [a,b] le plus proche de p. */
function nearestOnSegment(p, a, b) {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const l2 = dx * dx + dy * dy
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2))
  return [a[0] + t * dx, a[1] + t * dy]
}

/** Point le plus proche de p sur un ensemble de polylignes : { d, pt }. */
function nearestOnSegs(p, segs) {
  let best = null
  for (const s of segs) {
    for (let k = 0; k + 1 < s.pts.length; k++) {
      const pt = nearestOnSegment(p, s.pts[k], s.pts[k + 1])
      const d = dist(p, pt)
      if (!best || d < best.d) best = { d, pt }
    }
  }
  return best
}

const isBlade = (s) => {
  if (s.pts.length !== 2) return false
  const [a, b] = s.pts
  return Math.abs(a[0] - b[0]) > 2 && Math.abs(a[1] - b[1]) > 2 && dist(a, b) >= 8
}

const MIN_BLADE = 14

export function animate({ sim, terminals, segs, rounds }) {
  const out = { blades: [], spin: null }

  if (sim?.k === 'switch' && sim.ctl !== 'fixed') {
    const portAt = (pt) => terminals.findIndex((t) => dist([t.x, t.y], pt) <= 2.5)
    const fixed = segs.filter((s) => !isBlade(s))

    // fût de chaque borne : trait non diagonal qui part de la borne ; on retient son autre extrémité
    const stemEnd = new Map()
    const stemSegs = new Map()
    for (const s of fixed) {
      const first = s.pts[0]
      const last = s.pts[s.pts.length - 1]
      for (const [from, to] of [[first, last], [last, first]]) {
        const pi = portAt(from)
        if (pi >= 0 && !stemEnd.has(pi)) {
          stemEnd.set(pi, to)
          stemSegs.set(pi, s)
        }
      }
    }

    // contact fixe d'une borne : fût + traits reliés à son extrémité (barre, crochet…)
    const contactOf = (pi) => {
      const seed = stemSegs.get(pi)
      if (!seed) return []
      const comp = new Set([seed])
      const touches = (a, b) =>
        [a.pts[0], a.pts[a.pts.length - 1]].some((p) => [b.pts[0], b.pts[b.pts.length - 1]].some((q) => dist(p, q) <= 1.5))
      let grew = true
      while (grew) {
        grew = false
        for (const s of fixed) {
          if (comp.has(s)) continue
          if ([...comp].some((c) => touches(c, s))) {
            comp.add(s)
            grew = true
          }
        }
      }
      return [...comp]
    }

    const partnerOf = (pi) => {
      const id = 't' + pi
      for (const [a, b] of sim.poles) {
        if (a === id) return Number(b.slice(1))
        if (b === id) return Number(a.slice(1))
      }
      for (const [com, , no] of sim.changeover ?? []) if (com === id) return Number(no.slice(1))
      return -1
    }

    for (const s of segs.filter(isBlade)) {
      const [A, B] = s.pts

      // pivot = extrémité de la lame la plus proche d'un fût (ou d'une borne)
      let best = null
      for (const [pivot, tip] of [[A, B], [B, A]]) {
        for (const [pi, end] of stemEnd) {
          const d = Math.min(dist(pivot, end), dist(pivot, [terminals[pi].x, terminals[pi].y]))
          if (d <= 3 && (!best || d < best.d)) best = { d, pivot, tip, pi }
        }
      }
      let pivot
      let tip
      let contact = []
      if (best) {
        const partner = partnerOf(best.pi)
        contact = partner >= 0 ? contactOf(partner) : []
        ;({ pivot, tip } = best)
      } else if (dist(A, B) >= MIN_BLADE) {
        // pivot relié à autre chose qu'une borne (disjoncteurs : déclencheur) : contact fixe = fût le plus proche d'une extrémité
        let near = null
        for (const [end, other] of [[A, B], [B, A]]) {
          for (const [pi, stem] of stemEnd) {
            const d = dist(end, stem)
            if (d <= 10 && (!near || d < near.d)) near = { d, tip: end, pivot: other, pi }
          }
        }
        if (near) {
          ;({ pivot, tip } = near)
          contact = contactOf(near.pi)
        }
      }
      if (!pivot || !contact.length) continue

      const touch = nearestOnSegs(tip, contact)
      const closed = touch.d <= 2
      let rot
      if (closed) {
        // ouverture : 25° dans le sens qui éloigne le plus la pointe du contact fixe
        const away = (deg) => nearestOnSegs(rotate(tip, pivot, deg), contact).d
        rot = away(25) >= away(-25) ? 25 : -25
      } else {
        // fermeture : la lame vise le point le plus proche du contact fixe
        rot = norm(ang(pivot, touch.pt) - ang(pivot, tip))
        if (Math.abs(rot) > 60) continue
      }
      const minx = Math.min(A[0], B[0]), maxx = Math.max(A[0], B[0])
      const miny = Math.min(A[1], B[1]), maxy = Math.max(A[1], B[1])
      const origin = `${Math.round(((pivot[0] - minx) / (maxx - minx)) * 100)}% ${Math.round(((pivot[1] - miny) / (maxy - miny)) * 100)}%`
      out.blades.push({ shape: s.i, rot: Math.round(rot), closed, origin })
    }
  }

  if (sim?.k === 'load' && sim.role === 'motor' && rounds.length) {
    const big = [...rounds].sort((a, b) => b.r - a.r)[0]
    if (big.r >= 8) out.spin = { cx: big.cx, cy: big.cy, r: big.r }
  }
  return out
}
