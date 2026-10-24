// Classe un symbole QElectroTech selon son comportement pour la simulation.
//
// Retourne un modèle `sim` (ou null si le symbole n'est pas simulable) :
//   { k: 'source', pot: { [port]: potentiel } }
//   { k: 'switch', poles: [[portA, portB], …], ctl: 'coil' | 'momentary' | 'toggle' | 'fixed', nc: boolean }
//   { k: 'coil',   ports: [a, b] }
//   { k: 'load',   ports: [...], role: 'lamp' | 'motor' | 'valve' | 'buzzer' | 'heater' | 'brake' }
//
// La classification repose sur le dossier d'origine et le nom du symbole : QElectroTech ne décrit pas
// le comportement électrique de ses éléments. Les symboles ambigus (inverseurs, cartes, automates…)
// sont volontairement ignorés plutôt que simulés de travers.

const same = (a, b) => Math.abs(a - b) < 1.5

/** Apparie les bornes en pôles : une borne « haut » et une borne « bas » alignées (ou gauche/droite). */
export function pairPoles(ports) {
  if (ports.length === 2) return [[ports[0].id, ports[1].id]]
  const poles = []
  const used = new Set()
  const pair = (isA, isB, key, along) => {
    for (const a of ports.filter(isA)) {
      if (used.has(a.id)) continue
      const cand = ports
        .filter((b) => isB(b) && !used.has(b.id) && same(b[key], a[key]))
        .sort((p, q) => Math.abs(p[along] - a[along]) - Math.abs(q[along] - a[along]))[0]
      if (cand) {
        used.add(a.id)
        used.add(cand.id)
        poles.push([a.id, cand.id])
      }
    }
  }
  pair((p) => p.dir === 'up', (p) => p.dir === 'down', 'x', 'y')
  pair((p) => p.dir === 'left', (p) => p.dir === 'right', 'y', 'x')
  return poles
}

/** Type de temporisation d'après le nom : 'on' (à la montée), 'off' (à la retombée), 'both' (les deux). */
export function timerKind(text) {
  const t = text.toLowerCase()
  if (/travail et (mise au )?repos|repos[- ]travail|repos et travail|travail_repos|repos_travail|tmp_t_r/.test(t)) return 'both'
  if (/mise au travail et|travail et mise/.test(t)) return 'both'
  if (/repos retard|mise au repos|tempo repos|tmp_r|_repos/.test(t)) return 'off'
  if (/travail retard|mise au travail|tempo travail|tmp_t|_travail|tempo_t/.test(t)) return 'on'
  return null
}

/** Inverseur à 3 bornes : commun = borne seule d'un côté ; contact repos (NF) à gauche/haut, contact travail (NO) à droite/bas. */
export function changeoverPorts(ports) {
  const by = {}
  for (const p of ports) (by[p.dir] ||= []).push(p)
  const dirs = Object.keys(by)
  if (dirs.length !== 2) return null
  const lone = dirs.find((d) => by[d].length === 1)
  const pair = dirs.find((d) => by[d].length === 2)
  if (!lone || !pair) return null
  const vertical = lone === 'up' || lone === 'down'
  const [nc, no] = [...by[pair]].sort((a, b) => (vertical ? a.x - b.x : a.y - b.y))
  return [by[lone][0].id, nc.id, no.id]
}

const labelPot = (l) => {
  const v = (l || '').toUpperCase()
  if (['L', 'L1', 'L2', 'L3', 'N'].includes(v)) return v
  if (v === 'PEN') return 'N'
  return null // PE, GND, … : ignorés (terre)
}

export function classify({ id, nameFr, nameEn, ports }) {
  const path = id.toLowerCase()
  const name = `${nameFr} ${nameEn}`.toLowerCase()
  const file = path.split('/').pop()
  const has = (re) => re.test(path)
  const portIds = ports.map((p) => p.id)

  // ── terre : repère « PE » (liaison équipotentielle ; ne crée pas de court-circuit avec le neutre)
  if (has(/110_network_supplies\/(terre|masse|ground1)(.elmt)?$/)) return { k: 'source', pot: Object.fromEntries(ports.map((p) => [p.id, 'PE'])) }

  // ── sources de tension (réseau)
  if (has(/110_network_supplies/)) {
    const pot = {}
    for (const p of ports) {
      const v = labelPot(p.label)
      if (v) pot[p.id] = v
    }
    return Object.keys(pot).length ? { k: 'source', pot } : null
  }
  if (has(/30_power_supplies\/ac2_dc/)) {
    const pot = {}
    for (const p of ports) {
      if ((p.label || '') === 'L+') pot[p.id] = '+'
      if ((p.label || '') === 'L-') pot[p.id] = '-'
    }
    return Object.keys(pot).length ? { k: 'source', pot } : null
  }

  // ── bobines
  if (has(/01_coils/)) {
    if (ports.length !== 2 || /thermique|statique/.test(name) || (/polaris/.test(name) && !/comm_polarise/.test(file))) return null
    const timer = timerKind(name + ' ' + file)
    return timer ? { k: 'coil', ports: portIds, timer } : { k: 'coil', ports: portIds }
  }

  // ── contacts : inverseurs et combinés NO/NF ignorés
  const changeover = /inverseur|no[ ]*[/-][ ]*(nf|nc)|no_nf|_no_nf|2 positions|3 positions/.test(name + ' ' + file)
  const nc =
    /(^|[^a-z])(nf|nc)([^a-z]|$)/.test(name) || /_nf|_nc|nf_|nc_/.test(file) || /ouverture|normally closed/.test(name)

  const delayed = has(/11_delayed_contacts/) ? timerKind(name + ' ' + file) : null
  const contact = (ctl, allowPosition = false) => {
    if (!allowPosition && /position/.test(name)) return null // sélecteurs à plusieurs contacts : non modélisés
    // contacteurs de puissance « inverseur » à 6 ou 8 bornes : simples contacts à plusieurs pôles (le nom désigne la forme du dessin)
    if (changeover && !(has(/02_power_contacts/) && ports.length !== 3)) {
      const co = ports.length === 3 ? changeoverPorts(ports) : null
      if (!co) return null
      return delayed ? { k: 'switch', poles: [], changeover: [co], ctl, nc: false, delay: delayed } : { k: 'switch', poles: [], changeover: [co], ctl, nc: false }
    }
    const poles = pairPoles(ports)
    if (!poles.length) return null
    return delayed ? { k: 'switch', poles, ctl, nc, delay: delayed } : { k: 'switch', poles, ctl, nc }
  }

  if (has(/01_auxiliary_contacts|02_power_contacts|11_delayed_contacts/)) return contact('coil')
  if (has(/15_protection_contacts/)) return contact('toggle')
  if (has(/310_relays_contactors_contacts\/03_contacts/)) {
    return contact(/électromagnétique|contact simple/.test(name) ? 'coil' : 'toggle')
  }

  // ── organes de commande manuels
  if (has(/20_push_buttons/)) {
    if (/led/.test(name + file)) return null
    // pédales à un seul contact NO ou NF ; les pédales NO/NF à quatre bornes ne sont pas modélisées
    if (/pedale|pédale|pedal|foot/.test(name + file)) return ports.length === 2 ? contact('momentary', true) : null
    const latching = /urgence|verrou|tirette|cable|câble/.test(name)
    const r = contact(latching ? 'toggle' : 'momentary')
    if (r && latching) r.nc = true
    return r
  }
  if (has(/21_selector_switches/)) {
    // sélecteurs et commutateurs rotatifs : deux bornes = interrupteur à deux positions ; trois bornes = inverseur
    // (1-0-2 et trois positions : centre ouvert, `pos3`) ; les sélecteurs à plusieurs contacts ne sont pas modélisés
    if (/position|rotatif|rotary|tournant|1-0-2|a cle|à clé|\bcle\b/.test(name + ' ' + file)) {
      if (ports.length === 2) return { k: 'switch', poles: pairPoles(ports), ctl: 'toggle', nc: false } // le nom « 2 positions » ne désigne pas ici un inverseur
      const co = ports.length === 3 ? changeoverPorts(ports) : null
      if (!co) return null
      const pos3 = /1-0-2|3 positions|3_pos|3pos|trois positions/.test(name + ' ' + file)
      return pos3 ? { k: 'switch', poles: [], changeover: [co], ctl: 'toggle', nc: false, pos3: true } : { k: 'switch', poles: [], changeover: [co], ctl: 'toggle', nc: false }
    }
    return contact('toggle')
  }
  if (has(/25_lever_switches|41_limit_switches/)) return contact('toggle')

  // ── capteurs et détecteurs à contact (2 fils NO / NF, ou inverseur à 3 bornes) : on les « actionne » en simulation comme un fin de course
  if (has(/390_sensors_instruments\/(01_sensors_capacitive|02_sensors_inductive|03_sensors_magnetic|04_sensors_optical|11_sensors_flow|12_sensors_level|13_sensors_pressure|14_sensors_humidity|15_sensors_temperature|16_sensors_ultrasonic)\//)) {
    if (/sonde|thermocouple|emetteur|émetteur|recepteur|récepteur|luminosit|crepuscolar|capteur_pression$|cellule|sécurité|ossd/.test(name + ' ' + file)) return null
    if (ports.length === 2) return contact('toggle', true)
    const co = ports.length === 3 && /nf_no|nf\/no|nc\/no/.test(file + ' ' + name) ? changeoverPorts(ports) : null
    return co ? { k: 'switch', poles: [], changeover: [co], ctl: 'toggle', nc: false } : null
  }

  // ── protection : disjoncteurs et sectionneurs (fermés par défaut, basculables) ; fusibles et relais thermiques (toujours fermés)
  if (has(/200_fuses_protective_gears\/(11_circuit_breakers|12_magneto|20_disconnecting|50_residual_current_circuit_breaker)/)) {
    const poles = pairPoles(ports)
    return poles.length ? { k: 'switch', poles, ctl: 'toggle', nc: true } : null
  }
  if (has(/200_fuses_protective_gears\/(10_fuses|30_thermal_relays)/)) {
    const poles = pairPoles(ports)
    return poles.length ? { k: 'switch', poles, ctl: 'fixed', nc: false } : null
  }

  // ── connecteurs à ressort et jonctions : toutes les bornes sont reliées entre elles
  if (has(/130_terminals_terminal_strips\/95_terminals_spring_box\//) || has(/114_connections\/(combine|splice|bod|lphd|corner)(\.elmt)?$/)) {
    if (ports.length < 2) return null
    return { k: 'switch', poles: ports.slice(1).map((p) => [ports[0].id, p.id]), ctl: 'fixed', nc: false }
  }
  if (has(/90_terminal_strips_diagram\/90-10-0(111|121|211)(\.elmt)?$/)) {
    const poles = pairPoles(ports)
    return poles.length ? { k: 'switch', poles, ctl: 'fixed', nc: false } : null
  }

  // ── bornes : simples traversées
  if (has(/130_terminals_terminal_strips\/[^/]+$/) && !has(/90_terminal_strips_diagram/)) {
    const poles = pairPoles(ports)
    return poles.length ? { k: 'switch', poles, ctl: 'fixed', nc: false } : null
  }

  // ── transformateurs à enroulements séparés : primaire en haut, secondaire en bas (autotransformateurs non modélisés)
  if (has(/330_transformers_power_supplies\/10_transformers/) && !/auto/.test(name + file)) {
    const byX = (a, b) => a.x - b.x
    const primary = ports.filter((p) => p.dir === 'up').sort(byX).map((p) => p.id)
    const secondary = ports.filter((p) => p.dir === 'down').sort(byX).map((p) => p.id)
    if (primary.length >= 2 && secondary.length >= 2 && primary.length <= 4 && secondary.length <= 6) return { k: 'transformer', primary, secondary }
    return null
  }

  // ── récepteurs
  if (has(/11_optical_signaling/)) {
    if (/carte|horloge/.test(name) || ports.length !== 2) return null
    return { k: 'load', ports: portIds, role: 'lamp' }
  }
  if (has(/60_lightings/) && ports.length === 2) return { k: 'load', ports: portIds, role: 'lamp' }
  if (has(/12_acoustic_signaling/) && ports.length === 2) return { k: 'load', ports: portIds, role: 'buzzer' }
  if (has(/391_consumers_actuators\/10_engines/)) {
    const live = ports.filter((p) => !/^(pe|gnd|terre)$/i.test(p.label || ''))
    if (live.length < 2 || live.length > 6 || /dahlander|6_terminals|9_terminals|12_terminals/.test(file)) return null
    return { k: 'load', ports: live.map((p) => p.id), role: 'motor' }
  }
  if (has(/391_consumers_actuators\/30_brakes\/(brzda_motoru|frein_electro|frein_magnetique)(\.elmt)?$/) && ports.length === 2) return { k: 'load', ports: portIds, role: 'brake' }
  if (has(/391_consumers_actuators\/20_valves/) && ports.length === 2) return { k: 'load', ports: portIds, role: 'valve' }
  if (has(/391_consumers_actuators\/50_heatings/) && ports.length === 2) return { k: 'load', ports: portIds, role: 'heater' }

  return null
}
