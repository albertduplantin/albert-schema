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

/** Renvoi de feuille : deux renvois de même repère (sur la même feuille ou sur deux feuilles) sont le même conducteur. */
const sheetLink: SymbolDef = {
  id: 'sim-ref', domain: 'electrical', prefix: 'REF', name: { fr: 'Renvoi de feuille (suite du schéma)', en: 'Sheet link (continuation)' }, std: 'ISO 7200 / IEC 61082', w: 20, h: 20,
  svg: '<path d="M10 0V6"/><path d="M0 6H20V15L10 20L0 15Z"/>',
  ports: [{ id: 'a', x: 10, y: 0, dir: 'up' }],
  cat: 'sim', group: null, score: 91, top: true, decor: false,
}

/** Source 24 V alternatif : une borne phase et une borne neutre dans le même symbole. */
const source24vac: SymbolDef = {
  id: 'sim-24vac', domain: 'electrical', prefix: '', name: { fr: 'Source 24 V alternatif (phase + neutre)', en: '24 V AC source (phase + neutral)' }, std: 'Albert Schema Studio', w: 40, h: 20,
  svg: '<path d="M10 14V20"/><path d="M30 14V20"/><rect x="0" y="0" width="40" height="14"/><text x="20" y="10" text-anchor="middle" font-size="6.5" fill="currentColor" stroke="none">24V~</text>',
  ports: [{ id: 'a', x: 10, y: 20, dir: 'down', label: 'L' }, { id: 'b', x: 30, y: 20, dir: 'down', label: 'N' }],
  cat: 'sim', group: null, score: 101, top: true, decor: false,
  sim: { k: 'source', pot: { a: 'L@24', b: 'N@24' } },
}

/** Blocs source configurables : tension (et nature pour le monophasé / continu) réglées dans les propriétés. Les bornes inutilisées restent libres. */
const block = (id: string, fr: string, en: string, w: number, ports: { id: string; x: number }[]): SymbolDef => ({
  id, domain: 'electrical', prefix: '', name: { fr, en }, std: 'Albert Schema Studio', w, h: 40,
  svg: `<rect x="0" y="0" width="${w}" height="24"/>${ports.map((p) => `<path d="M${p.x} 24V40"/>`).join('')}`,
  ports: ports.map((p) => ({ id: p.id, x: p.x, y: 40, dir: 'down' as const })),
  cat: 'sim', group: null, score: 102, top: true, decor: false,
  sim: { k: 'source', pot: {} },
})
const source1 = block('sim-src1', 'Source monophasée ou continue (réglable)', 'Single-phase or DC source (adjustable)', 60, [{ id: 'a', x: 10 }, { id: 'b', x: 30 }, { id: 'c', x: 50 }])
;(source1.sim as { pot: Record<string, string> }).pot = { a: 'L', b: 'N', c: 'PE' }
const source1i = block('sim-src1i', 'Source monophasée sans terre (isolée)', 'Single-phase source without earth (isolated)', 40, [{ id: 'a', x: 10 }, { id: 'b', x: 30 }])
;(source1i.sim as { pot: Record<string, string> }).pot = { a: 'LI', b: 'NI' }
const source3 = block('sim-src3', 'Source triphasée (réglable)', 'Three-phase source (adjustable)', 100, [{ id: 'a', x: 10 }, { id: 'b', x: 30 }, { id: 'c', x: 50 }, { id: 'd', x: 70 }, { id: 'e', x: 90 }])
;(source3.sim as { pot: Record<string, string> }).pot = { a: 'L1', b: 'L2', c: 'L3', d: 'N', e: 'PE' }

export const simSources: SymbolDef[] = [
  source1,
  source1i,
  source3,
  source24vac,
  sheetLink,
  source('sim-l1', 'L1', 'L1', 'Phase L1 (simulation)', 'Phase L1 (simulation)', true),
  source('sim-l2', 'L2', 'L2', 'Phase L2 (simulation)', 'Phase L2 (simulation)', true),
  source('sim-l3', 'L3', 'L3', 'Phase L3 (simulation)', 'Phase L3 (simulation)', true),
  source('sim-l', 'L', 'L', 'Phase L monophasée (simulation)', 'Single-phase L (simulation)', true),
  source('sim-n', 'N', 'N', 'Neutre N (simulation)', 'Neutral N (simulation)', false),
  source('sim-l24', 'L@24', 'L24', 'Phase 24 V alternatif (simulation)', 'Phase 24 V AC (simulation)', true),
  source('sim-n24', 'N@24', 'N24', 'Neutre 24 V alternatif (simulation)', 'Neutral 24 V AC (simulation)', false),
  source('sim-24v', '+', '+24V', '+24 V DC (simulation)', '+24 V DC (simulation)', true),
  source('sim-0v', '-', '0V', '0 V DC (simulation)', '0 V DC (simulation)', false),
]
