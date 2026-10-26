import type { PortDef, SymbolDef } from '../types'
import { angle, blade, line, DASH } from './own/kit'

/** Automates programmables 24 V DC à 8 entrées et 8 sorties : sorties à relais (contact entre le commun 1L et la borne) ou à transistors (positif 24 V commuté). */
const W = 190, H = 130
const X0 = 70, STEP = 15
/** Câblage interne dessiné dans l'automate : barre du commun à y = BUS, contact de chaque sortie entre CT (fixe) et CB (charnière de la lame). */
export const PLC_GEOM = { W, H, X0, STEP, BUS: 70, CT: 82, CB: 106, COM_X: 15 }
const OPEN_TIP = [-6, -22] as const
/** rotation (°) qui amène la lame de la position ouverte à la position fermée (animée selon l'état de la sortie) */
export const PLC_BLADE_ROT = angle([OPEN_TIP[0], OPEN_TIP[1]], [0, -(PLC_GEOM.CB - PLC_GEOM.CT)])

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
    // câblage interne : le commun alimente une barre en pointillés, chaque sortie est un contact qui se ferme ou s'ouvre sous le contrôle du programme
    (relay ? line([PLC_GEOM.COM_X, H - 14], [PLC_GEOM.COM_X, PLC_GEOM.BUS], DASH) : line([PLC_GEOM.COM_X, 29], [PLC_GEOM.COM_X, PLC_GEOM.BUS], DASH)) +
    line([PLC_GEOM.COM_X, PLC_GEOM.BUS], [X0 + 7 * STEP, PLC_GEOM.BUS], DASH) +
    Array.from({ length: 8 }, (_, i) => {
      const x = X0 + i * STEP
      return line([x, PLC_GEOM.BUS], [x, PLC_GEOM.CT], DASH) + line([x, PLC_GEOM.CB], [x, H - 14], DASH) +
        `<circle cx="${x}" cy="${PLC_GEOM.CT}" r="1.2" fill="currentColor"/>` +
        blade(i, [x, PLC_GEOM.CB], [x + OPEN_TIP[0], PLC_GEOM.CB + OPEN_TIP[1]])
    }).join('') +
    txt(PLC_GEOM.COM_X + 9, PLC_GEOM.BUS - 3, relay ? '1L' : 'L+', 5) +
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
