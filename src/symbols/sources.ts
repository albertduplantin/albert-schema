import type { SymbolDef } from '../types'

/**
 * Sources d'alimentation : un seul menu « Sources et alimentations », en groupes, au lieu de quatre catégories de la bibliothèque
 * (sources de simulation, sources réseau, alimentations, générateurs). Les doublons sont retirés de la palette : ils restent
 * chargeables, donc les anciens schémas qui les utilisent s'ouvrent toujours.
 */
export const SOURCES_MENU = 'sources'
export const SOURCES_NAME = { fr: 'Sources et alimentations', en: 'Sources and power supplies' }

const G = (fr: string, en: string) => ({ fr, en })
const GROUPS: { group: { fr: string; en: string }; ids: string[] }[] = [
  { group: G('Sources de simulation (tension réglable)', 'Simulation sources (adjustable voltage)'), ids: ['sim-src1', 'sim-src1i', 'sim-src3', 'sim-l', 'sim-n', 'sim-24v', 'sim-0v'] },
  { group: G('Terres et masses', 'Earth and frame'), ids: ['110_network_supplies/terre', '110_network_supplies/masse'] },
  { group: G('Alimentations continues', 'DC power supplies'), ids: ['30_power_supplies/ac2_dc', '30_power_supplies/power_supply_acdc_3_pole', '40_uninterruptible_power_supply/ups'] },
  { group: G('Générateurs', 'Generators'), ids: ['10_generators/gene_tri', '10_generators/generatrice_dc', '10_generators/dynamotachymtrique', '10_generators/windmill', '10_generators/photovoltaic_solar_module', '10_generators/pvcell', '20_power_units/engine_generator', '20_power_units/micro_turbine_generator'] },
  { group: G('Piles', 'Batteries'), ids: ['30_batteries/pile_1_element', '30_batteries/pile_2_elements'] },
  { group: G('Sources idéales', 'Ideal sources'), ids: ['70_voltage_current_sources/tention_n', '70_voltage_current_sources/courant_n'] },
]

/** Doublons retirés de la palette (même fonction qu'un symbole conservé) : motif de chaque retrait en regard. */
export const HIDDEN_DUPLICATES: Record<string, string> = {
  // sources réseau en barres : remplacées par les blocs réglables « Source monophasée » et « Source triphasée »
  '110_network_supplies/src_3p': 'remplacée par le bloc Source triphasée réglable',
  '110_network_supplies/src_3pn': 'remplacée par le bloc Source triphasée réglable',
  '110_network_supplies/src_3p_pe_n': 'remplacée par le bloc Source triphasée réglable',
  '110_network_supplies/src_3ppe': 'remplacée par le bloc Source triphasée réglable',
  '110_network_supplies/src_3p_pen': 'remplacée par le bloc Source triphasée réglable',
  '110_network_supplies/src_tnc_tns': 'remplacée par le bloc Source triphasée réglable',
  '110_network_supplies/src_1pn': 'remplacée par le bloc Source monophasée réglable',
  '110_network_supplies/src_1p_pe_n': 'remplacée par le bloc Source monophasée réglable',
  // repères isolés remplacés par les blocs (les anciens schémas et exemples les utilisent toujours)
  'sim-l1': 'remplacé par le bloc Source triphasée',
  'sim-l2': 'remplacé par le bloc Source triphasée',
  'sim-l3': 'remplacé par le bloc Source triphasée',
  'sim-l24': 'remplacé par une source L réglée à 24 V',
  'sim-n24': 'remplacé par une source N réglée à 24 V',
  'sim-24vac': 'remplacé par le bloc Source monophasée réglée à 24 V',
  '110_network_supplies/3f_n_pe_pravy': 'doublon de « Source tripolaire + PE + N », nom erroné',
  '110_network_supplies/3_pen_pravy': 'doublon de « Source tripolaire + PEN »',
  '110_network_supplies/src_1p_pen': 'même fonction que « Source unipolaire + neutre » (TN-C interdit en installation neuve)',
  '110_network_supplies/src_n': 'doublon du repère de simulation N',
  '110_network_supplies/src_p': 'doublon du repère de simulation L',
  '110_network_supplies/ground1': 'doublon de « Masse »',
  '70_voltage_current_sources/courant_o': 'ancienne notation de la source de courant',
  '70_voltage_current_sources/tention_o': 'ancienne notation de la source de tension',
  '30_batteries/pile_1_element_court': 'variante courte de « Pile 1 élément »',
  '30_power_supplies/2080_ps120_240vac': 'référence constructeur identique à « Alimentation AC/DC tripolaire »',
  '30_power_supplies/power_supply_1_phase_ac_dc': 'doublon non simulé de « Alternatif monophasé > Continu »',
  '50101545_source_energie_pneumatique': 'doublon de « Source d’air comprimé »',
}

const endsWithPath = (id: string, tail: string) => id === tail || id.endsWith('/' + tail)

/** Applique le menu unique des sources et masque les doublons. */
export function organizeSources(symbols: SymbolDef[]) {
  for (const s of symbols) {
    for (const g of GROUPS) {
      if (g.ids.some((t) => endsWithPath(s.id, t))) { s.menu = SOURCES_MENU; s.group = g.group }
    }
    if (Object.keys(HIDDEN_DUPLICATES).some((t) => endsWithPath(s.id, t))) s.legacy = true
    // le renvoi de feuille n'est pas une source : il rejoint les connexions
    if (s.id === 'sim-ref') s.menu = '10_electric_10_allpole/114_connections'
  }
}
