// Score de popularité (0-100) : fréquence d'usage estimée sur les machines industrielles actuelles.
//
// C'est un jugement éditorial (pas une mesure) : à ajuster librement.
// Un score élevé = symbole que l'on rencontre dans presque tous les schémas récents
// (contacteur, disjoncteur magnétothermique, alimentation 24 V, capteur inductif, distributeur 5/2…).
// Un score bas = symbole devenu rare (fusible de puissance, relais thermique seul, composants discrets…).

/** Règles de base par famille : [expression sur « catégorie/chemin », score]. Premier test vrai gagne. */
const GROUP_RULES = [
  // ── Électrique : protection
  [/12_magneto_thermal/, 95],
  [/11_circuit_breakers/, 92],
  [/20_disconnecting/, 85],
  [/50_residual/, 80],
  [/90_overvoltage/, 55],
  [/30_thermal_relays/, 50],
  [/10_fuses/, 38],
  // ── relais, contacteurs
  [/01_coils/, 95],
  [/01_auxiliary_contacts|02_power_contacts/, 95],
  [/15_protection_contacts/, 80],
  [/11_delayed_contacts/, 65],
  [/310_relays_contactors_contacts[/]03_contacts/, 75],
  // ── alimentations, variateurs
  [/30_power_supplies/, 97],
  [/40_uninterruptible/, 70],
  [/10_transformers/, 68],
  [/340_converters_inverters[/]10_converters/, 90],
  [/15_measuring_transducers/, 50],
  [/20_current_tansformers/, 45],
  [/90_filters/, 55],
  // ── commande et signalisation
  [/20_push_buttons/, 92],
  [/11_optical_signaling/, 92],
  [/21_selector_switches/, 85],
  [/01_human_machine_interface/, 85],
  [/12_acoustic_signaling/, 70],
  [/25_lever_switches/, 55],
  // ── capteurs
  [/02_sensors_inductive/, 92],
  [/04_sensors_optical/, 85],
  [/13_sensors_pressure/, 85],
  [/15_sensors_temperature/, 85],
  [/01_sensors_capacitive|03_sensors_magnetic|41_limit_switches|80_encoder/, 80],
  [/12_sensors_level/, 75],
  [/11_sensors_flow/, 70],
  [/16_sensors_ultrasonic/, 65],
  [/60_timers/, 55],
  [/14_sensors_humidity|70_meters_measuring/, 50],
  // ── récepteurs
  [/391_consumers_actuators[/]10_engines/, 95],
  [/70_servomoteur|391_consumers_actuators[/]20_valves/, 85],
  [/30_brakes/, 70],
  [/50_heatings/, 60],
  [/60_lightings/, 55],
  // ── sources
  [/70_voltage_current_sources/, 60],
  [/30_batteries/, 35],
  [/392_generators_sources/, 28],
  // ── électronique / automatisme
  [/41_PLC_controllers/i, 90],
  [/91_computer_science/, 60],
  [/11_diodes|01_resistors/, 48],
  [/395_electronics_semiconductors/, 38],
  // ── raccordement
  [/130_terminals_terminal_strips[/][^/]+[.]elmt$/, 90],
  [/95_terminals_spring_box/, 85],
  [/90_terminal_strips_diagram/, 70],
  [/10_connectors_circular/, 85],
  [/15_connectors_dsub/, 50],
  [/20_socket_outlets/, 45],
  [/140_connectors_plugs/, 40],
  [/110_network_supplies/, 72],
  [/120_cables_wiring/, 70],
  [/114_connections/, 60],
  [/450_high_voltage/, 20],
  [/500_home_installation[/].*(compteur|meter|counter)/i, 10],
  [/500_home_installation/, 8],
  [/11_singlepole/, 22],

  // ── Pneumatique : distributeurs (voies), puis pilotage via NAME_RULES
  [/50201060_5_2_way/, 92],
  [/50201020_3_2_way/, 88],
  [/50201010_2_2_way/, 70],
  [/50201070_5_3_way/, 66],
  [/50201040_4_2_way/, 50],
  [/50201030_3_3_way|50201050_4_3_way/, 35],
  [/502020_logic/, 55],
  [/502030_prop/, 60],
  [/50207010_silencer|50207011_silencer/, 80],
  [/502070_relief/, 40],
  // ── vérins
  [/50301012_double_acting_magnetic/, 90],
  [/50301011_double_acting/, 96],
  [/50301015_rodless/, 72],
  [/50301010_single_acting/, 72],
  [/50301013_double_acting_through_rod/, 55],
  [/50301014_cylinder_tandem/, 40],
  [/503040_cylinder_gripper/, 80],
  [/503020_cylinder_rot/, 65],
  [/503030_cylinder_motor/, 60],
  [/503070_cylinder_special/, 40],
  [/5040_sensors/, 80],
  // ── préparation d'air
  [/501014_filter_regulator_lubricator/, 92],
  [/501012_treatment|501013_control/, 85],
  [/501016_funktion_components/, 88],
  [/501010_air_generation/, 80],
  [/501015_pipes_connections/, 75],
  [/501017_indicator/, 65],
  [/501011_tank|501018_air_vacuum/, 55],
  [/5010_compressed_air/, 70],

  // ── Hydraulique
  [/51_cylinders/, 90],
  [/61_pumps/, 90],
  [/31_control_valves[/].*(2_2|3_2|4_2)/, 90],
  [/31_control_valves/, 62],
  [/45_valves/, 80],
  [/21_tanks/, 85],
  [/81_filters/, 80],
  [/71_exchangers/, 60],
]

/** Ajustements selon le nom du symbole (le chemin n'est volontairement pas testé : « 200_fuses_protective_gears » contient « fuse »). */
const NAME_RULES = [
  [/fusible|fuse|sicherung|pojistka/i, -20, 40], // [regex, delta, plafond]
  [/rémanence|remanence|verrouillage|latching|mechanical latch/i, -15],
  [/nema|ansi|american|us std/i, -20],
  [/tempo|timer|retard/i, -8],
  [/ancien|obsol|old /i, -20],
  [/frein de fin de course|cushion/i, -4],
  [/triphas|tripolaire|3p|3 p[oô]les|5[/]2|3[/]2/i, +4],
  [/[[]man[]]|manuel/i, -8],
]

/** Ajustements selon le dossier (pilotage des distributeurs pneumatiques). */
const PATH_RULES = [
  [/_elec([/]|$)/, +4], // pilotage électrique (électrovanne) : le plus courant
  [/_pneu([/]|$)/, -6],
  [/man_mech/, -14],
]

export function popularity({ rel, nameFr, nameEn }) {
  const path = rel.toLowerCase()
  let score = 40
  for (const [re, s] of GROUP_RULES) {
    if (re.test(path)) { score = s; break }
  }
  const name = nameFr + ' ' + nameEn
  for (const [re, delta, cap] of NAME_RULES) {
    if (re.test(name)) {
      score += delta
      if (cap !== undefined) score = Math.min(score, cap)
    }
  }
  for (const [re, delta] of PATH_RULES) if (re.test(path)) score += delta
  return Math.max(0, Math.min(100, score))
}
