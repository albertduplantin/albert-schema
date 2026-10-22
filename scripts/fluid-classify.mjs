// Comportement fluidique (pneumatique) déduit du nom et de la géométrie des éléments QElectroTech.
// Convention des symboles : les orifices sont dessinés sur la case de REPOS (côté ressort, à droite) ; en haut les orifices
// de travail, en bas l'alimentation et les échappements. Les orifices à gauche / à droite sont des pilotes.
//
// Modèles produits (champ `fluid` des symboles) :
//   { k: 'fsource', ports }                          source de pression (P)
//   { k: 'fsink', ports }                            échappement à l'air libre (R)
//   { k: 'flink', ports }                            traversée (traitement d'air, restricteur…)
//   { k: 'cyl', cap, rod?, single? }                 vérin : chambre arrière / avant ; `single` : 'push' ou 'pull'
//   { k: 'valve', rest, act, a, b, pilotA?, pilotB?, manual? }   distributeur à 2 positions

const byX = (a, b) => a.x - b.x

export function classifyFluid({ id, nameFr, ports }) {
  const has = (re) => re.test(id)
  const fluid = ports.filter((p) => p.dir === 'up' || p.dir === 'down')
  const ids = (a) => a.map((p) => p.id)

  // ── sources et échappements
  if (has(/501010_air_generation\//) || has(/50101545_source_energie_pneumatique/)) {
    return ports.length === 1 ? { k: 'fsource', ports: ids(ports) } : null
  }
  if (has(/5010161060_silencer|5010161061_silencer/)) return { k: 'fsink', ports: ids(ports) }

  // ── traversées : traitement d'air et restricteurs de débit à deux orifices
  if (has(/501012_treatment\//) || has(/501014_filter_regulator_lubricator\//) || has(/50101610_flow\/50101610(5\d)_/)) {
    const through = ports.filter((p) => p.dir === 'left' || p.dir === 'right')
    if (has(/501012_treatment\//) && /sécheur|filtre|refroidissement|chauffage|lubrificateur|Contrôle/i.test(nameFr) && through.length === 2) return { k: 'flink', ports: ids(through) }
    if (has(/501014_filter_regulator_lubricator\//) && through.length === 2) return { k: 'flink', ports: ids(through) }
    if (has(/50101610_flow/) && through.length === 2) return { k: 'flink', ports: ids(through) }
    return null
  }

  // ── vérins linéaires
  if (has(/503010_cylinder_lin\//) && !/tandem|telescop|multi_pos|cylinder_double_effet_magne|puissance/.test(id)) {
    const down = fluid.filter((p) => p.dir === 'down').sort(byX)
    if (down.length === 2) return { k: 'cyl', cap: down[0].id, rod: down[1].id }
    if (down.length === 1 && has(/50301010_single_acting\//)) {
      // chambre côté fond (à gauche) : la pression sort la tige ; côté tige : la pression la rentre
      return { k: 'cyl', cap: down[0].id, single: down[0].x < 35 ? 'push' : 'pull' }
    }
    return null
  }

  // ── distributeurs à deux positions (2/2, 3/2, 4/2, 5/2)
  if (has(/5020_velves\/502010_control\//)) {
    const m = /^(\d)\/(\d)([a-z]*)(?:_(nc|no))?\s*\[([a-z_]*)\]-\[([a-z_]*)\]/i.exec(nameFr.trim())
    if (!m) return null
    const ways = Number(m[1])
    if (Number(m[2]) !== 2 || fluid.length !== ways) return null
    const nc = m[4] !== 'no'
    const up = fluid.filter((p) => p.dir === 'up').sort(byX)
    const down = fluid.filter((p) => p.dir === 'down').sort(byX)
    let rest
    let act
    if (ways === 2 && up.length === 1 && down.length === 1) {
      const [A, P] = [up[0].id, down[0].id]
      rest = nc ? [] : [[P, A]]
      act = nc ? [[P, A]] : []
    } else if (ways === 3 && up.length === 1 && down.length === 2) {
      const [A, P, R] = [up[0].id, down[0].id, down[1].id]
      rest = nc ? [[A, R]] : [[P, A]]
      act = nc ? [[P, A]] : [[A, R]]
    } else if (ways === 4 && up.length === 2 && down.length === 2) {
      const [TL, TR, P, R] = [up[0].id, up[1].id, down[0].id, down[1].id]
      rest = [[P, TR], [TL, R]] // case de repos : flèches croisées
      act = [[P, TL], [TR, R]]
    } else if (ways === 5 && up.length === 2 && down.length === 3) {
      const [B, A, R1, P, R2] = [up[0].id, up[1].id, down[0].id, down[1].id, down[2].id]
      rest = [[P, A], [B, R1]]
      act = [[P, B], [A, R2]]
    } else return null
    const kind = (s) => (s.includes('elec') ? 'elec' : s === 'pneu' ? 'pneu' : s === 'man' || s === 'mech' ? 'man' : s === 'airspring' || s === 'spring' ? 'spring' : s === '' ? 'none' : s)
    const a = kind(m[5])
    const b = kind(m[6])
    if (!['elec', 'pneu', 'man'].includes(a) || !['elec', 'pneu', 'spring', 'none'].includes(b)) return null
    const pilots = ports.filter((p) => p.dir === 'left' || p.dir === 'right')
    const v = { k: 'valve', rest, act, a, b }
    const left = pilots.find((p) => p.dir === 'left')
    const right = pilots.find((p) => p.dir === 'right')
    if (a === 'pneu') v.pilotA = (left ?? pilots[0])?.id
    if (b === 'pneu') v.pilotB = (right ?? pilots[pilots.length - 1])?.id
    if ((a === 'pneu' && !v.pilotA) || (b === 'pneu' && !v.pilotB)) return null
    if (a === 'man') v.manual = b === 'spring' ? 'momentary' : 'toggle'
    return v
  }
  return null
}
