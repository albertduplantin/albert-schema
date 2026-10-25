import type { PortDef, SymbolDef } from '../types'

/** Automates programmables 24 V DC à 8 entrées et 8 sorties : sorties à relais (contact entre le commun 1L et la borne) ou à transistors (positif 24 V commuté). */
const W = 190, H = 100
const X0 = 70, STEP = 15

const build = (id: string, fr: string, en: string, relay: boolean): SymbolDef => {
  const ports: PortDef[] = [
    { id: 'lp', x: 15, y: 0, dir: 'up', label: 'L+' },
    { id: 'm', x: 35, y: 0, dir: 'up', label: 'M' },
    ...Array.from({ length: 8 }, (_, i) => ({ id: `i${i}`, x: X0 + i * STEP, y: 0, dir: 'up' as const, label: `I0.${i}` })),
    ...(relay ? [{ id: 'com', x: 15, y: H, dir: 'down' as const, label: '1L' }] : []),
    ...Array.from({ length: 8 }, (_, i) => ({ id: `q${i}`, x: X0 + i * STEP, y: H, dir: 'down' as const, label: `Q0.${i}` })),
  ]
  const txt = (x: number, y: number, t: string, size = 5.5) => `<text x="${x}" y="${y}" font-size="${size}" text-anchor="middle" fill="currentColor" stroke="none">${t}</text>`
  const svg =
    `<rect x="0" y="14" width="${W}" height="${H - 28}" rx="3" fill="var(--bg)"/>` +
    ports.map((p) => `<path d="M${p.x} ${p.y}V${p.dir === 'up' ? 14 : H - 14}"/>`).join('') +
    ports.filter((p) => p.dir === 'up').map((p) => txt(p.x, 25, p.label ?? '')).join('') +
    ports.filter((p) => p.dir === 'down').map((p) => txt(p.x, H - 19, p.label ?? '')).join('') +
    txt(W / 2, 48, 'AUTOMATE PROGRAMMABLE', 7.5) + txt(W / 2, 58, relay ? '8 E / 8 S relais · 24 V DC' : '8 E / 8 S transistors · 24 V DC', 5.5)
  return {
    id, domain: 'electrical', prefix: 'A', name: { fr, en }, std: 'IEC 61131-3', w: W, h: H, svg, ports,
    cat: 'plc', group: null, score: 95, top: false, decor: false,
    sim: {
      k: 'plc', supply: ['lp', 'm'], inputs: Array.from({ length: 8 }, (_, i) => `i${i}`),
      outputs: Array.from({ length: 8 }, (_, i) => ({ com: relay ? 'com' : 'lp', out: `q${i}` })),
    },
  }
}

export const plcParts: SymbolDef[] = [
  build('plc-8e8s-relay', 'Automate programmable 8 E / 8 S, sorties relais (24 V DC)', 'PLC 8 in / 8 out, relay outputs (24 V DC)', true),
  build('plc-8e8s-trans', 'Automate programmable 8 E / 8 S, sorties transistors (24 V DC)', 'PLC 8 in / 8 out, transistor outputs (24 V DC)', false),
]
