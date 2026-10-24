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
  if (has(/5010161060_silencer|5010161061_silencer|502070_relief\/\d+_silencer|50101820_sil_vacuum/)) return { k: 'fsink', ports: ids(ports) }

  // ── traversées : traitement d'air et restricteurs de débit à deux orifices
  // limiteurs de débit : réglables (deux sens) ou unidirectionnels avec clapet de retour libre (étranglement de gauche à droite)
  if (has(/50101610_flow\/(5010161050|5010161051|5010161052)_/) && ports.length === 2) {
    const [l, r] = [...ports].sort(byX)
    return { k: 'fthrottle', a: l.id, b: r.id, ...(has(/5010161050_/) ? { oneWay: true } : {}) }
  }
  if (has(/501012_treatment\//) || has(/501014_filter_regulator_lubricator\//) || has(/50101610_flow\/50101610(5\d)_/)) {
    const through = ports.filter((p) => p.dir === 'left' || p.dir === 'right')
    if (has(/501012_treatment\//) && /sécheur|filtre|refroidissement|chauffage|lubrificateur|Contrôle|séparation|eau/i.test(nameFr) && through.length === 2) return { k: 'flink', ports: ids(through) }
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


  // ── réservoirs : tous les orifices sont reliés au même volume
  if (has(/501011_tank\//)) return ports.length >= 1 ? { k: 'flink', ports: ids(ports) } : null

  // ── raccords, tuyaux souples, répartiteurs, broches rotatives à un passage : liaison directe
  if (has(/501015_pipes_connections\/(50101511|50101512|50101530|50101531|50101533|50101535|50101544|50101542|50101501)_/)) return { k: 'flink', ports: ids(ports) }
  // bouchon : orifice obturé, sa pression est seulement affichée
  if (has(/501015_pipes_connections\/50101520_/)) return { k: 'fgauge', ports: ids(ports) }
  // vanne d'arrêt manuelle : ouverte au repos, un clic la ferme
  if (has(/501015_pipes_connections\/(50101550|50101551)_/) && ports.length === 2) return { k: 'valve', rest: [[ports[0].id, ports[1].id]], act: [], a: 'man', b: 'none', manual: 'toggle' }

  // ── indicateurs de pression et régulateurs
  if (has(/501017_indicator\//) || has(/501013_control\/50101301_/)) return { k: 'fgauge', ports: ids(ports) }
  if (has(/501013_control\//) && ports.length === 2 && ports.every((p) => p.dir === 'up' || p.dir === 'down')) return { k: 'flink', ports: ids(ports) }

  // ── clapet anti-retour : l'air passe de l'orifice de droite vers celui de gauche (bille côté gauche)
  if (has(/50101610_flow\/(5010161010|5010161011)_/) && ports.length === 2) {
    const r = ports.find((p) => p.dir === 'right')
    const l = ports.find((p) => p.dir === 'left')
    return r && l ? { k: 'check', from: r.id, to: l.id } : null
  }
  // ── sélecteur de circuit (OU) et soupape à deux pressions (ET) : sortie en haut, entrées à gauche et à droite
  if (has(/(50101620_logic\/5010162011_|502020_logic\/50202010_)/) || has(/(50101620_logic\/5010162012_|502020_logic\/50202020_)/)) {
    const out = ports.find((p) => p.dir === 'up')
    const l = ports.find((p) => p.dir === 'left')
    const r = ports.find((p) => p.dir === 'right')
    if (!out || !l || !r) return null
    return { k: 'logic', op: has(/5010162011_|50202010_/) ? 'or' : 'and', ins: [l.id, r.id], out: out.id }
  }

  // ── pressostats et capteurs de pression : le contact électrique de même repère suit la pression
  if (has(/5040_sensors\/(504010_pressure_switch|504020_pressure_sensors)\//) && ports.length === 1) return { k: 'fpress', port: ports[0].id }

  // ── moteurs pneumatiques : un orifice (échappement libre) ou deux (sens selon l'orifice alimenté)
  if (has(/503030_cylinder_motor\//)) {
    const anti = /anti|inverse|contraire/i.test(nameFr)
    if (ports.length === 1) return { k: 'fmotor', a: ports[0].id, ...(anti ? { rev: true } : {}) }
    if (ports.length === 2) {
      const [a, b] = [...ports].sort((x, y) => x.y - y.y)
      return { k: 'fmotor', a: a.id, b: b.id }
    }
    return null
  }
  // ── pinces, vérins rotatifs, vérins spéciaux et à double tige : vérins simple ou double effet
  if (has(/503040_cylinder_gripper\/(50304010|50304011|50304020|50304021|50304030)_|503020_cylinder_rot\/|503070_cylinder_special\/(50307012|50307014|50307016)_|50301014_cylinder_tandem_double\/(5030101410|5030101411|5030101421|5030101422)_/)) {
    if (ports.length === 1) return { k: 'cyl', cap: ports[0].id, single: 'push' }
    if (ports.length === 2) {
      const [a, b] = ports.every((p) => p.dir === 'left' || p.dir === 'right') ? [...ports].sort((x, y) => x.y - y.y) : [...ports].sort(byX)
      return { k: 'cyl', cap: a.id, rod: b.id }
    }
    return null
  }

  // ── distributeurs à trois positions centrées par ressorts (5/3 et 3/3) : case de gauche = commande A, de droite = commande B
  if (has(/5020_velves\/502010_control\/(50201070_5_3_way|50201030_3_3_way)/)) {
    const m = /^(\d)\/3([a-z]*)\s*\[([a-z_]*)\]-\[([a-z_]*)\]/i.exec(nameFr.trim())
    if (!m) return null
    const ways = Number(m[1])
    const up = fluid.filter((p) => p.dir === 'up').sort(byX)
    const down = fluid.filter((p) => p.dir === 'down').sort(byX)
    let center = []
    let act
    let actB
    if (ways === 5 && up.length === 2 && down.length === 3 && fluid.length === 5) {
      const [B, A] = [up[0].id, up[1].id]
      const [R1, P, R2] = [down[0].id, down[1].id, down[2].id]
      act = [[P, B], [A, R2]]
      actB = [[P, A], [B, R1]]
      // position centrale d'après le dernier chiffre de la référence : 0 fermée, 1 échappement, 2 pression
      const d = /(\d)_5_3_way$/.exec(id.replace(/\.elmt$/, ''))?.[1]
      center = d === '1' ? [[A, R2], [B, R1]] : d === '2' ? [[P, A], [P, B]] : []
    } else if (ways === 3 && up.length === 1 && down.length === 2 && fluid.length === 3) {
      const [A, P, R] = [up[0].id, down[0].id, down[1].id]
      act = [[P, A]]
      actB = [[A, R]]
    } else return null
    const kind = (s) => {
      const t = s.split('_')
      return t.includes('elec') ? 'elec' : t.includes('man') ? 'man' : t.includes('pneu') ? 'pneu' : t.includes('spring') ? 'spring' : 'none'
    }
    const a = kind(m[3])
    const b = kind(m[4])
    if (!['elec', 'pneu', 'man'].includes(a)) return null
    const pilots = ports.filter((p) => p.dir === 'left' || p.dir === 'right')
    const v = { k: 'valve', rest: center, act, actB: ['elec', 'pneu'].includes(b) ? actB : [], a, b: ['elec', 'pneu', 'spring', 'none'].includes(b) ? b : 'none', three: true }
    const left = pilots.find((p) => p.dir === 'left')
    const right = pilots.find((p) => p.dir === 'right')
    if (a === 'pneu') v.pilotA = (left ?? pilots[0])?.id
    if (b === 'pneu') v.pilotB = (right ?? pilots[pilots.length - 1])?.id
    if ((a === 'pneu' && !v.pilotA) || (b === 'pneu' && !v.pilotB)) return null
    if (a === 'man') v.manual = 'momentary'
    return v
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

/**
 * Comportement fluidique des symboles hydrauliques (dossier 30_hydraulic). Les distributeurs sont dessinés avec leurs orifices sur la case de repos
 * (à droite, côté ressort) : en haut A (gauche) et B (droite), en bas P (gauche) et T (droite) ; la case de gauche, commandée par l'électroaimant,
 * est celle de la position actionnée (flèches croisées).
 */
export function classifyHydraulic({ id, nameFr, ports }) {
  const has = (re) => re.test(id)
  const ids = (a) => a.map((p) => p.id)
  const byX = (a, b) => a.x - b.x
  const up = ports.filter((p) => p.dir === 'up').sort(byX)
  const down = ports.filter((p) => p.dir === 'down').sort(byX)

  // ── bâches : échappement à la bâche (pression nulle)
  // bâche pressurisée = accumulateur : il stocke la pression d'une ligne sans rien relier
  if (has(/21_tanks\/bache_pressurisee/)) return { k: 'fgauge', ports: ids(ports) }
  if (has(/21_tanks\//)) return { k: 'fsink', ports: ids(ports) }

  // ── pompes : refoulement en haut, aspiration en bas ; la pompe ne refoule que si l'aspiration est reliée à une bâche
  if (has(/61_pumps\/(pompe_|pomp_mot)/) && !has(/pomp_mot/)) {
    const out = ports.find((p) => p.dir === 'up')
    const inn = ports.find((p) => p.dir === 'down')
    return out && inn ? { k: 'fpump', out: out.id, in: inn.id } : null
  }
  // ── moteurs hydrauliques : sens selon l'orifice alimenté
  if (has(/61_pumps\/moteur_hydr/) && up.length === 1 && down.length === 1) return { k: 'fmotor', a: up[0].id, b: down[0].id }

  // ── filtres et échangeurs : traversée
  if (has(/(81_filters|71_exchangers)\//) && ports.length === 2) return { k: 'flink', ports: ids(ports) }

  // ── vérins : la tige est du côté de la chambre annulaire
  if (has(/51_cylinders\//)) {
    if (has(/teleskop/)) return null
    if (ports.length === 1) return { k: 'cyl', cap: ports[0].id, single: 'push' }
    if (ports.length === 2) {
      const [l, r] = [...ports].sort(byX)
      if (has(/tige-a-gauche/)) return { k: 'cyl', cap: r.id, rod: l.id }
      return { k: 'cyl', cap: l.id, rod: r.id }
    }
    return null
  }

  // ── clapet anti-retour : passe de droite (pointe du V) à gauche (bille)
  if (has(/45_valves\/clapet_simple/) && ports.length === 2) {
    const [l, r] = [...ports].sort(byX)
    return { k: 'check', from: r.id, to: l.id }
  }
  if (has(/45_valves\/picv_valve/) && ports.length === 2) return { k: 'flink', ports: ids(ports) }
  if (has(/45_valves\/pressostat/) && ports.length === 1) return { k: 'fpress', port: ports[0].id }

  // ── robinets : manuels (ouverts au repos, un clic les ferme) ; électriques et motorisés (fermés au repos, ouverts sous tension)
  if (has(/45_valves\/(vanne_manuelle|vanne_man_1)(\.elmt)?$/) && ports.length === 2) return { k: 'valve', rest: [[ports[0].id, ports[1].id]], act: [], a: 'man', b: 'none', manual: 'toggle' }
  if (has(/45_valves\/(vanne_elec_1|vanne_mot_1)(\.elmt)?$/) && ports.length === 2) return { k: 'valve', rest: [], act: [[ports[0].id, ports[1].id]], a: 'elec', b: 'spring' }

  // ── distributeurs 2/2 : deux paires d'orifices (case de gauche, case de droite), reliées ensemble quand la voie est ouverte
  if (has(/31_control_valves\/11_2-2\//) && up.length === 2 && down.length === 2) {
    const open = [[up[0].id, down[0].id], [up[1].id, down[1].id]]
    const nc = has(/electrovanne_2_2_nf/) || /ferm/i.test(nameFr)
    return { k: 'valve', rest: nc ? [] : open, act: nc ? open : [], a: 'elec', b: 'spring' }
  }
  // ── distributeurs 3/2 : P en bas à gauche, T en bas à droite, A en haut ; au repos P→A, actionné A→T
  if (has(/31_control_valves\/12_3-2\/distributeur_3-2/) && up.length === 1 && down.length === 2) {
    const [A, P, T] = [up[0].id, down[0].id, down[1].id]
    return { k: 'valve', rest: [[P, A]], act: [[A, T]], a: 'elec', b: 'spring' }
  }
  // ── distributeurs 4/2 : au repos P→A et B→T ; actionné P→B et A→T (centre ouvert : tout relié au repos ; centre fermé : rien)
  if (has(/31_control_valves\/13_4-2\//) && up.length === 2 && down.length === 2) {
    const [A, B, P, T] = [up[0].id, up[1].id, down[0].id, down[1].id]
    const rest = has(/centre_ferme/) ? [] : has(/centre_ouvert/) ? [[P, A], [P, B], [P, T]] : [[P, A], [B, T]]
    return { k: 'valve', rest, act: [[P, B], [A, T]], a: 'elec', b: 'spring' }
  }

  // ── pièces élémentaires (cases isolées) : liaisons fixes selon leur nom
  if (has(/31_control_valves\/01_single_parts\//)) {
    if (has(/(fermee|fermes)(\.elmt)?$/) && ports.length === 2) return { k: 'fgauge', ports: ids(ports) }
    if (has(/1_voie_p_vers_a(\.elmt)?$/) && ports.length === 2) return { k: 'flink', ports: ids(ports) }
    if (has(/3_ports/) && ports.length === 3) {
      const A = ports.find((p) => p.dir === 'up')
      const downs = ports.filter((p) => p.dir === 'down')
      if (!A || downs.length !== 2) return null
      const same = downs.find((p) => p.x === A.x)
      const other = downs.find((p) => p.x !== A.x)
      return { k: 'fnet', links: [[A.id, has(/3_orifices_p-a(\.elmt)?$/) ? same.id : other.id]] }
    }
    if (has(/4_ports/) && up.length === 2 && down.length === 2) {
      const [A, B, P, T] = [up[0].id, up[1].id, down[0].id, down[1].id]
      const table = {
        'a-b-t_relies': [[A, B], [B, T]], 'b-t_fermes': [[P, A]], 'croisees': [[P, B], [A, T]], 'p-a-b_relies': [[P, A], [A, B]], 'p-a-t_relies': [[P, A], [A, T]],
        'p-a_fermes': [[B, T]], 'p-b_relies': [[P, B]], 'p-t_relies': [[P, T]], 'parallele': [[P, A], [B, T]], 'centre_ferme': [], 'centre_ouvert': [[P, A], [A, B], [B, T]],
      }
      const key = Object.keys(table).find((k) => id.replace(/\.elmt$/, '').endsWith(k) || id.replace(/\.elmt$/, '').endsWith('voies_' + k) || id.includes(k))
      return key ? { k: 'fnet', links: table[key] } : null
    }
    return null
  }
  return null
}
