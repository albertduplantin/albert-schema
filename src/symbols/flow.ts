import type { Domain, SymbolDef } from '../types'

/** Corps commun : trait de passage, deux arcs qui étranglent le passage et flèche de réglage oblique. */
const throttleBody = (y: number, x0 = 20, x1 = 40) =>
  `<path d="M${x0} ${y - 6}Q${(x0 + x1) / 2} ${y}  ${x1} ${y - 6}" fill="none"/><path d="M${x0} ${y + 6}Q${(x0 + x1) / 2} ${y} ${x1} ${y + 6}" fill="none"/>` +
  `<path d="M${x0 + 2} ${y + 10}L${x1 - 2} ${y - 10}"/><path d="M${x1 - 2} ${y - 10}L${x1 - 7} ${y - 8.5}L${x1 - 4.5} ${y - 4.5}Z" fill="currentColor"/>`

const limiter = (domain: Domain, cat: string, group: SymbolDef['group']): SymbolDef => ({
  id: domain === 'hydraulic' ? 'flow-limiter-h' : 'flow-limiter-p', domain, prefix: 'LD',
  name: { fr: 'Limiteur de débit réglable', en: 'Adjustable flow limiter' }, std: 'ISO 1219-1', w: 60, h: 40,
  svg: `<path d="M0 20H60"/>${throttleBody(20)}`,
  ports: [{ id: 'l', x: 0, y: 20, dir: 'left' }, { id: 'r', x: 60, y: 20, dir: 'right' }],
  cat, group, score: 96, top: true, decor: false,
  fluid: { k: 'fthrottle', a: 'l', b: 'r' },
})

/** Régulateur de débit unidirectionnel (RDU) : limiteur réglable en parallèle d'un clapet ; le débit est étranglé de gauche à droite, libre de droite à gauche. */
const rdu = (domain: Domain, cat: string, group: SymbolDef['group']): SymbolDef => ({
  id: domain === 'hydraulic' ? 'flow-rdu-h' : 'flow-rdu-p', domain, prefix: 'RDU',
  name: { fr: 'Régulateur de débit unidirectionnel (RDU)', en: 'One-way flow control valve (throttle check)' }, std: 'ISO 1219-1', w: 60, h: 60,
  svg: `<path d="M0 30H60"/>${throttleBody(30)}` +
    // dérivation sous le passage : clapet dont le passage libre va de droite à gauche (siège en V à droite, bille à gauche)
    `<circle cx="10" cy="30" r="1.8" fill="currentColor"/><circle cx="50" cy="30" r="1.8" fill="currentColor"/><path d="M10 30V52H23.5M35 52H50V30" fill="none"/>` +
    `<g transform="translate(30 52) scale(-1 1)"><path d="M1.2 -5.5L-5 0L1.2 5.5" fill="none"/><circle cx="3.6" cy="0" r="3.4" fill="var(--bg)"/></g>`,
  ports: [{ id: 'l', x: 0, y: 30, dir: 'left' }, { id: 'r', x: 60, y: 30, dir: 'right' }],
  cat, group, score: 96, top: true, decor: false,
  fluid: { k: 'fthrottle', a: 'l', b: 'r', oneWay: true },
})

const H = '30_hydraulic/45_valves'
const P = '50_pneumatic/5010_compressed_air'
const PG = { fr: 'débit', en: 'flow' }
export const flowParts: SymbolDef[] = [limiter('hydraulic', H, null), rdu('hydraulic', H, null), limiter('pneumatic', P, PG), rdu('pneumatic', P, PG)]
