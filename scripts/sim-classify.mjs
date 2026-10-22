// Classe un symbole QElectroTech selon son comportement pour la simulation.
//
// Retourne un modèle `sim` (ou null si le symbole n'est pas simulable) :
//   { k: 'source', pot: { [port]: potentiel } }
//   { k: 'switch', poles: [[portA, portB], …], ctl: 'coil' | 'momentary' | 'toggle' | 'fixed', nc: boolean }
//   { k: 'coil',   ports: [a, b] }
//   { k: 'load',   ports: [...], role: 'lamp' | 'motor' | 'valve' | 'buzzer' | 'heater' }
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
    if (ports.length !== 2 || /thermique|statique|polaris/.test(name)) return null
    return { k: 'coil', ports: portIds }
  }

  // ── contacts : inverseurs et combinés NO/NF ignorés
  const changeover = /inverseur|no[ ]*[/-][ ]*(nf|nc)|no_nf|_no_nf|2 positions|3 positions/.test(name + ' ' + file)
  const nc =
    /(^|[^a-z])(nf|nc)([^a-z]|$)/.test(name) || /_nf|_nc|nf_|nc_/.test(file) || /ouverture|normally closed/.test(name)

  const contact = (ctl) => {
    if (changeover) return null
    const poles = pairPoles(ports)
    if (!poles.length || poles.length * 2 < ports.length - 0) {
      if (!poles.length) return null
    }
    return { k: 'switch', poles, ctl, nc }
  }

  if (has(/01_auxiliary_contacts|02_power_contacts|11_delayed_contacts/)) return contact('coil')
  if (has(/15_protection_contacts/)) return contact('toggle')
  if (has(/310_relays_contactors_contacts\/03_contacts/)) {
    return contact(/électromagnétique|contact simple/.test(name) ? 'coil' : 'toggle')
  }

  // ── organes de commande manuels
  if (has(/20_push_buttons/)) {
    if (/led|pedale|pédale|pedal/.test(name + file)) return null
    const latching = /urgence|verrou|tirette|cable|câble/.test(name)
    const r = contact(latching ? 'toggle' : 'momentary')
    if (r && latching) r.nc = true
    return r
  }
  if (has(/21_selector_switches|25_lever_switches|41_limit_switches/)) return contact('toggle')

  // ── protection : disjoncteurs et sectionneurs (fermés par défaut, basculables) ; fusibles et relais thermiques (toujours fermés)
  if (has(/200_fuses_protective_gears\/(11_circuit_breakers|12_magneto|20_disconnecting)/)) {
    const poles = pairPoles(ports)
    return poles.length ? { k: 'switch', poles, ctl: 'toggle', nc: true } : null
  }
  if (has(/200_fuses_protective_gears\/(10_fuses|30_thermal_relays)/)) {
    const poles = pairPoles(ports)
    return poles.length ? { k: 'switch', poles, ctl: 'fixed', nc: false } : null
  }

  // ── bornes : simples traversées
  if (has(/130_terminals_terminal_strips\/[^/]+$/) && !has(/90_terminal_strips_diagram/)) {
    const poles = pairPoles(ports)
    return poles.length ? { k: 'switch', poles, ctl: 'fixed', nc: false } : null
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
  if (has(/391_consumers_actuators\/20_valves/) && ports.length === 2) return { k: 'load', ports: portIds, role: 'valve' }
  if (has(/391_consumers_actuators\/50_heatings/) && ports.length === 2) return { k: 'load', ports: portIds, role: 'heater' }

  return null
}
