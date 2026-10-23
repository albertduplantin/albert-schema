import type { PortDef, SymbolDef } from '../types'

/** Repères d'alimentation pour la simulation : imposent un potentiel sur le réseau auquel ils sont reliés. */
const source = (id: string, pot: string, text: string, fr: string, en: string, down: boolean): SymbolDef => {
  const port: PortDef = down ? { id: 'a', x: 10, y: 20, dir: 'down' } : { id: 'a', x: 10, y: 0, dir: 'up' }
  const fs = text.length > 3 ? 6 : 7.5
  return {
    id, domain: 'electrical', prefix: '', name: { fr, en }, std: 'Albert Schema Studio', w: 20, h: 20,
    svg: down
      ? `<path d="M10 14V20"/><rect x="0" y="0" width="20" height="14"/><text x="10" y="10" text-anchor="middle" font-size="${fs}" fill="currentColor" stroke="none">${text}</text>`
      : `<path d="M10 0V6"/><rect x="0" y="6" width="20" height="14"/><text x="10" y="16" text-anchor="middle" font-size="${fs}" fill="currentColor" stroke="none">${text}</text>`,
    ports: [port],
    cat: 'sim', group: null, score: 92, top: true, decor: false,
    sim: { k: 'source', pot: { a: pot } },
  }
}

export const simSources: SymbolDef[] = [
  source('sim-l1', 'L1', 'L1', 'Phase L1 (simulation)', 'Phase L1 (simulation)', true),
  source('sim-l2', 'L2', 'L2', 'Phase L2 (simulation)', 'Phase L2 (simulation)', true),
  source('sim-l3', 'L3', 'L3', 'Phase L3 (simulation)', 'Phase L3 (simulation)', true),
  source('sim-l', 'L', 'L', 'Phase L monophasée (simulation)', 'Single-phase L (simulation)', true),
  source('sim-n', 'N', 'N', 'Neutre N (simulation)', 'Neutral N (simulation)', false),
  source('sim-24v', '+', '+24V', '+24 V DC (simulation)', '+24 V DC (simulation)', true),
  source('sim-0v', '-', '0V', '0 V DC (simulation)', '0 V DC (simulation)', false),
]
