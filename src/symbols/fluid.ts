import type { Domain, PortDef, SymbolDef } from '../types'

const F = (
  domain: Domain,
  id: string,
  prefix: string,
  fr: string,
  en: string,
  w: number,
  h: number,
  svg: string,
  ports: PortDef[],
): SymbolDef => ({ id, domain, prefix, name: { fr, en }, std: 'ISO 1219-1', w, h, svg, ports })

/** Flèche de (x1,y1) vers (x2,y2) avec pointe pleine ouverte */
const arr = (x1: number, y1: number, x2: number, y2: number) => {
  const a = Math.atan2(y2 - y1, x2 - x1)
  const s = 7
  const hx = (da: number) => (x2 - s * Math.cos(a + da)).toFixed(1)
  const hy = (da: number) => (y2 - s * Math.sin(a + da)).toFixed(1)
  return `<path d="M${x1} ${y1}L${x2} ${y2}M${hx(0.45)} ${hy(0.45)}L${x2} ${y2}L${hx(-0.45)} ${hy(-0.45)}"/>`
}

const block = (x: number, y: number) => `<path d="M${x} ${y + 10}V${y}M${x - 6} ${y}H${x + 6}"/>`

const manual = '<path d="M10 20H3M3 13V27"/>'
const spring = '<path d="M90 20H93L95 13L99 27L103 13L107 27L110 20"/>'

const valve42 = (domain: Domain, id: string, fr: string, en: string): SymbolDef =>
  F(domain, id, 'V', fr, en, 110, 40,
    `<rect x="10" y="0" width="40" height="40"/><rect x="50" y="0" width="40" height="40"/>${manual}${spring}` +
      `${arr(20, 36, 40, 4)}${arr(20, 4, 40, 36)}${arr(60, 36, 60, 4)}${arr(80, 4, 80, 36)}`,
    [
      { id: 'a', x: 60, y: 0, dir: 'up', label: 'A' },
      { id: 'b', x: 80, y: 0, dir: 'up', label: 'B' },
      { id: 'p', x: 60, y: 40, dir: 'down', label: 'P' },
      { id: 't', x: 80, y: 40, dir: 'down', label: 'T' },
    ])

const valve32 = (domain: Domain, id: string, fr: string, en: string): SymbolDef =>
  F(domain, id, 'V', fr, en, 110, 40,
    `<rect x="10" y="0" width="40" height="40"/><rect x="50" y="0" width="40" height="40"/>${manual}${spring}` +
      `${arr(20, 36, 30, 4)}${block(40, 30)}${arr(70, 4, 80, 36)}${block(60, 30)}`,
    [
      { id: 'a', x: 70, y: 0, dir: 'up', label: 'A' },
      { id: 'p', x: 60, y: 40, dir: 'down', label: 'P' },
      { id: 'r', x: 80, y: 40, dir: 'down', label: 'R' },
    ])

const cylDA = (domain: Domain, id: string) =>
  F(domain, id, 'A', 'Vérin double effet', 'Double-acting cylinder', 100, 30,
    '<rect x="10" y="0" width="60" height="30"/><path d="M28 15H100"/><path d="M28 4V26" stroke-width="3.5"/>',
    [
      { id: 'a', x: 20, y: 30, dir: 'down', label: 'A' },
      { id: 'b', x: 60, y: 30, dir: 'down', label: 'B' },
    ])

export const pneumatic: SymbolDef[] = [
  F('pneumatic', 'pn-src', 'Z', "Source d'air comprimé", 'Compressed air source', 20, 30,
    '<path d="M10 0V10"/><circle cx="10" cy="20" r="10"/><path d="M5 24L10 14L15 24Z"/>',
    [{ id: 'a', x: 10, y: 0, dir: 'up' }]),
  F('pneumatic', 'pn-frl', 'Z', 'Unité FRL (simplifiée)', 'FRL unit (simplified)', 60, 40,
    '<rect x="10" y="0" width="40" height="40" stroke-dasharray="4 3"/><path d="M0 20H60M44 14L50 20L44 26"/>',
    [{ id: 'in', x: 0, y: 20, dir: 'left' }, { id: 'out', x: 60, y: 20, dir: 'right' }]),
  cylDA('pneumatic', 'pn-cyl-da'),
  F('pneumatic', 'pn-cyl-sa', 'A', 'Vérin simple effet (rappel ressort)', 'Single-acting cylinder (spring return)', 100, 30,
    '<rect x="10" y="0" width="60" height="30"/><path d="M70 15H100"/><path d="M28 4V26" stroke-width="3.5"/>' +
      '<path d="M28 15H34L38 8L44 22L50 8L56 22L60 15H70"/>',
    [{ id: 'a', x: 20, y: 30, dir: 'down', label: 'A' }]),
  valve32('pneumatic', 'pn-v32', 'Distributeur 3/2 (poussoir, ressort)', '3/2 valve (pushbutton, spring)'),
  valve42('pneumatic', 'pn-v42', 'Distributeur 4/2 (poussoir, ressort)', '4/2 valve (pushbutton, spring)'),
  F('pneumatic', 'pn-check', 'V', 'Clapet anti-retour', 'Check valve', 20, 40,
    '<path d="M10 0V40"/><circle cx="10" cy="22" r="5" fill="var(--bg)"/><path d="M4 27L10 34L16 27"/>',
    [{ id: 'a', x: 10, y: 0, dir: 'up' }, { id: 'b', x: 10, y: 40, dir: 'down' }]),
  F('pneumatic', 'pn-throttle', 'V', 'Étrangleur réglable', 'Adjustable throttle', 40, 40,
    '<path d="M20 0V40"/><path d="M10 8Q18 20 10 32M30 8Q22 20 30 32"/><path d="M4 36L36 4M29 5L36 4L35 11"/>',
    [{ id: 'a', x: 20, y: 0, dir: 'up' }, { id: 'b', x: 20, y: 40, dir: 'down' }]),
  F('pneumatic', 'pn-exh', 'Z', 'Échappement', 'Exhaust', 20, 20,
    '<path d="M10 0V8"/><path d="M4 18H16L10 8Z"/>',
    [{ id: 'a', x: 10, y: 0, dir: 'up' }]),
]

export const hydraulic: SymbolDef[] = [
  F('hydraulic', 'hy-pump', 'P', 'Pompe à cylindrée fixe', 'Fixed displacement pump', 40, 50,
    '<circle cx="20" cy="30" r="20"/><path d="M20 0V10"/><path d="M13 28L20 14L27 28Z" fill="currentColor"/>',
    [{ id: 'out', x: 20, y: 0, dir: 'up', label: 'P' }, { id: 'in', x: 20, y: 50, dir: 'down', label: 'S' }]),
  F('hydraulic', 'hy-motor', 'M', 'Moteur hydraulique', 'Hydraulic motor', 40, 50,
    '<circle cx="20" cy="30" r="20"/><path d="M20 0V10"/><path d="M13 14H27L20 28Z" fill="currentColor"/>',
    [{ id: 'in', x: 20, y: 0, dir: 'up' }, { id: 'out', x: 20, y: 50, dir: 'down' }]),
  F('hydraulic', 'hy-tank', 'T', 'Réservoir', 'Tank', 40, 30,
    '<path d="M0 10V30H40V10"/><path d="M20 0V18"/>',
    [{ id: 'a', x: 20, y: 0, dir: 'up' }]),
  F('hydraulic', 'hy-prime', 'M', "Moteur d'entraînement", 'Prime mover', 40, 40,
    '<circle cx="20" cy="20" r="20"/><text x="20" y="25" text-anchor="middle" font-size="14" fill="currentColor" stroke="none">M</text>',
    [{ id: 'a', x: 40, y: 20, dir: 'right' }]),
  cylDA('hydraulic', 'hy-cyl-da'),
  valve42('hydraulic', 'hy-v42', 'Distributeur 4/2 (levier, ressort)', '4/2 valve (lever, spring)'),
  F('hydraulic', 'hy-relief', 'V', 'Limiteur de pression', 'Pressure relief valve', 40, 40,
    '<rect x="5" y="0" width="30" height="40"/><path d="M20 40V8M14 15L20 8L26 15"/>',
    [{ id: 'a', x: 20, y: 0, dir: 'up' }, { id: 'b', x: 20, y: 40, dir: 'down' }]),
  F('hydraulic', 'hy-check', 'V', 'Clapet anti-retour', 'Check valve', 20, 40,
    '<path d="M10 0V40"/><circle cx="10" cy="22" r="5" fill="currentColor"/><path d="M4 27L10 34L16 27"/>',
    [{ id: 'a', x: 10, y: 0, dir: 'up' }, { id: 'b', x: 10, y: 40, dir: 'down' }]),
  F('hydraulic', 'hy-filter', 'F', 'Filtre', 'Filter', 40, 40,
    '<path d="M20 0V40"/><path d="M20 8L32 20L20 32L8 20Z" stroke-dasharray="3 2"/>',
    [{ id: 'a', x: 20, y: 0, dir: 'up' }, { id: 'b', x: 20, y: 40, dir: 'down' }]),
  F('hydraulic', 'hy-gauge', 'B', 'Manomètre', 'Pressure gauge', 40, 50,
    '<circle cx="20" cy="30" r="20"/><path d="M20 0V10"/><path d="M20 30L30 20"/>',
    [{ id: 'a', x: 20, y: 0, dir: 'up' }]),
]
