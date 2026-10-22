import type { PortDef, SymbolDef } from '../types'

const STD = 'IEC 60617'

const p2v = (w: number, h: number): PortDef[] => [
  { id: 'a', x: w / 2, y: 0, dir: 'up' },
  { id: 'b', x: w / 2, y: h, dir: 'down' },
]

const E = (
  id: string,
  prefix: string,
  fr: string,
  en: string,
  w: number,
  h: number,
  svg: string,
  ports: PortDef[] = p2v(w, h),
): SymbolDef => ({ id, domain: 'electrical', prefix, name: { fr, en }, std: STD, w, h, svg, ports })

/** Pôle de contact normalement ouvert, dont la borne haute est en (x, 0) */
const noPole = (x: number, cross = false) =>
  `<path d="M${x} 0V10M${x} 30V40M${x} 30L${x + 8} 12"/>` +
  (cross ? `<path d="M${x + 5} 9L${x + 11} 15M${x + 11} 9L${x + 5} 15"/>` : '')

const threePorts = (): PortDef[] => [
  { id: 'a1', x: 10, y: 0, dir: 'up', label: '1' },
  { id: 'a2', x: 30, y: 0, dir: 'up', label: '3' },
  { id: 'a3', x: 50, y: 0, dir: 'up', label: '5' },
  { id: 'b1', x: 10, y: 40, dir: 'down', label: '2' },
  { id: 'b2', x: 30, y: 40, dir: 'down', label: '4' },
  { id: 'b3', x: 50, y: 40, dir: 'down', label: '6' },
]

const link = '<path d="M14 21H54" stroke-dasharray="3 2"/>'

export const electrical: SymbolDef[] = [
  E('el-no', 'K', 'Contact à fermeture (NO)', 'Make contact (NO)', 20, 40, noPole(10)),
  E('el-nc', 'K', 'Contact à ouverture (NC)', 'Break contact (NC)', 20, 40,
    '<path d="M10 0V10H4M10 30V40M10 30L4 10"/>'),
  E('el-coil', 'K', 'Bobine', 'Coil', 20, 40,
    '<path d="M10 0V10M10 30V40"/><rect x="0" y="10" width="20" height="20"/>'),
  E('el-pb-no', 'S', 'Bouton poussoir NO', 'Pushbutton NO', 20, 40,
    `${noPole(10)}<path d="M15 21H4" stroke-dasharray="3 2"/><path d="M4 15V27"/>`),
  E('el-pb-nc', 'S', 'Bouton poussoir NC', 'Pushbutton NC', 20, 40,
    '<path d="M10 0V10H4M10 30V40M10 30L4 10"/><path d="M8 20H16" stroke-dasharray="3 2"/><path d="M16 14V26"/>'),
  E('el-estop', 'S', "Arrêt d'urgence", 'Emergency stop', 20, 40,
    '<path d="M10 0V10H4M10 30V40M10 30L4 10"/><path d="M8 20H13" stroke-dasharray="3 2"/><path d="M13 14A6 6 0 0 1 13 26Z"/>'),
  E('el-fuse', 'F', 'Fusible', 'Fuse', 20, 40,
    '<path d="M10 0V40"/><rect x="5" y="8" width="10" height="24"/>'),
  E('el-cb1', 'Q', 'Disjoncteur 1P', 'Circuit breaker 1P', 20, 40, noPole(10, true)),
  E('el-cb3', 'Q', 'Disjoncteur 3P', 'Circuit breaker 3P', 60, 40,
    `${noPole(10, true)}${noPole(30, true)}${noPole(50, true)}${link}`, threePorts()),
  E('el-ct3', 'K', 'Contacteur 3P (puissance)', 'Contactor 3P (power)', 60, 40,
    `${noPole(10)}${noPole(30)}${noPole(50)}${link}`, threePorts()),
  E('el-th', 'F', 'Relais thermique', 'Thermal overload relay', 20, 40,
    '<path d="M10 0V8M10 32V40"/><rect x="0" y="8" width="20" height="24"/><path d="M5 26L8 14L12 26L15 14"/>'),
  E('el-motor3', 'M', 'Moteur triphasé', 'Three-phase motor', 60, 60,
    '<circle cx="30" cy="34" r="20"/><path d="M20 0V17M30 0V14M40 0V17"/>' +
      '<text x="30" y="35" text-anchor="middle" font-size="12" fill="currentColor" stroke="none">M</text>' +
      '<text x="30" y="47" text-anchor="middle" font-size="10" fill="currentColor" stroke="none">3~</text>',
    [
      { id: 'u', x: 20, y: 0, dir: 'up', label: 'U' },
      { id: 'v', x: 30, y: 0, dir: 'up', label: 'V' },
      { id: 'w', x: 40, y: 0, dir: 'up', label: 'W' },
    ]),
  E('el-lamp', 'H', 'Lampe de signalisation', 'Indicator lamp', 20, 40,
    '<path d="M10 0V10M10 30V40"/><circle cx="10" cy="20" r="10"/><path d="M3 13L17 27M17 13L3 27"/>'),
  E('el-res', 'R', 'Résistance', 'Resistor', 20, 40,
    '<path d="M10 0V8M10 32V40"/><rect x="4" y="8" width="12" height="24"/>'),
  E('el-cap', 'C', 'Condensateur', 'Capacitor', 20, 40,
    '<path d="M10 0V16M10 24V40M0 16H20M0 24H20"/>'),
  E('el-diode', 'V', 'Diode', 'Diode', 20, 40,
    '<path d="M10 0V12M10 28V40M0 12H20L10 28ZM0 28H20"/>'),
  E('el-trafo', 'T', 'Transformateur (représentation unifilaire)', 'Transformer (single-line)', 40, 60,
    '<circle cx="20" cy="20" r="14"/><circle cx="20" cy="40" r="14"/><path d="M20 0V6M20 54V60"/>'),
  E('el-trafo-1p', 'T', 'Transformateur monophasé', 'Single-phase transformer', 60, 60,
    '<circle cx="30" cy="20" r="14"/><circle cx="30" cy="40" r="14"/><path d="M20 0V10M40 0V10M20 50V60M40 50V60"/>',
    [
      { id: 'p1', x: 20, y: 0, dir: 'up', label: 'L1' },
      { id: 'p2', x: 40, y: 0, dir: 'up', label: 'N' },
      { id: 's1', x: 20, y: 60, dir: 'down', label: 'a' },
      { id: 's2', x: 40, y: 60, dir: 'down', label: 'b' },
    ]),
  E('el-trafo-2p', 'T', 'Transformateur biphasé (secondaire à point milieu)', 'Two-phase transformer (centre-tapped secondary)', 60, 60,
    '<circle cx="30" cy="20" r="14"/><circle cx="30" cy="40" r="14"/><path d="M20 0V10M40 0V10M20 50V60M30 54V60M40 50V60"/>',
    [
      { id: 'p1', x: 20, y: 0, dir: 'up', label: 'L1' },
      { id: 'p2', x: 40, y: 0, dir: 'up', label: 'L2' },
      { id: 's1', x: 20, y: 60, dir: 'down', label: 'a' },
      { id: 'sm', x: 30, y: 60, dir: 'down', label: '0' },
      { id: 's2', x: 40, y: 60, dir: 'down', label: 'b' },
    ]),
  E('el-term', 'X', 'Borne', 'Terminal', 20, 20,
    '<circle cx="10" cy="10" r="4"/><path d="M10 0V6M10 14V20"/>'),
  E('el-pe', 'PE', 'Terre de protection (PE)', 'Protective earth (PE)', 20, 30,
    '<path d="M10 0V14M0 14H20M4 20H16M7 26H13"/>', [{ id: 'a', x: 10, y: 0, dir: 'up' }]),
  E('el-src', 'G', 'Source alternative', 'AC source', 40, 40,
    '<circle cx="20" cy="20" r="14"/><path d="M12 20Q16 12 20 20T28 20"/><path d="M20 0V6M20 34V40"/>'),
]
