import type { SymbolDef } from './types'

/** Recherche par fonction : un mot de l'utilisateur (« protéger », « temporiser »…) est élargi aux mots qui figurent dans les noms de symboles. */
const CONCEPTS: [string[], string[]][] = [
  [['proteg', 'protec', 'protect', 'surcharge', 'surintensit', 'overload'], ['fusible', 'fuse', 'disjoncteur', 'breaker', 'thermique', 'thermal', 'sectionneur', 'différentiel', 'residual', 'parafoudre', 'surge']],
  [['temporis', 'retard', 'delay', 'timer', 'timing'], ['temporis', 'timer', 'delay', 'retard']],
  [['urgence', 'emergency', 'arret', 'stop'], ['urgence', 'emergency', 'arrêt', 'stop', 'coup de poing']],
  [['demarr', 'start', 'lancer'], ['contacteur', 'contactor', 'moteur', 'motor', 'démarreur', 'starter', 'marche']],
  [['moteur', 'motor', 'tourner'], ['moteur', 'motor', 'contacteur', 'contactor', 'thermique', 'variateur', 'drive']],
  [['signal', 'voyant', 'indicat', 'alarme', 'alarm', 'avertis'], ['lampe', 'lamp', 'voyant', 'buzzer', 'klaxon', 'sirène', 'horn', 'beacon', 'signal']],
  [['command', 'manoeuvr', 'actionn', 'operate', 'control'], ['bouton', 'push', 'poussoir', 'sélecteur', 'selector', 'commutateur', 'pédale', 'levier', 'joystick']],
  [['detect', 'capt', 'sens', 'mesur', 'measur'], ['capteur', 'sensor', 'détecteur', 'detector', 'sonde', 'probe', 'fin de course', 'limit', 'cellule', 'pressostat', 'thermostat']],
  [['aliment', 'source', 'power', 'suppl', 'reseau', 'réseau'], ['alimentation', 'supply', 'source', 'transformateur', 'transformer', 'tension', 'phase', 'neutre', 'batterie']],
  [['relier', 'connect', 'raccord', 'jonction', 'bornier', 'terminal'], ['borne', 'terminal', 'connecteur', 'connector', 'jonction', 'prise', 'plug']],
  [['chauff', 'heat', 'resistance', 'résistance'], ['résistance', 'resistor', 'chauffage', 'heater', 'chauffe']],
  [['frein', 'brake', 'immobilis'], ['frein', 'brake']],
  [['electrovanne', 'électrovanne', 'solenoid', 'vanne', 'valve', 'distribu'], ['distributeur', 'valve', 'vanne', 'électrovanne', 'solenoid', 'tiroir']],
  [['pousser', 'tirer', 'verin', 'vérin', 'cylinder', 'actuat'], ['vérin', 'cylinder', 'piston', 'actionneur', 'actuator']],
  [['compris', 'air', 'pneum'], ['compresseur', 'compressor', 'filtre', 'filter', 'régulateur', 'régulation', 'pression', 'pressure', 'lubrificateur']],
  [['pompe', 'pump', 'hydrau', 'huile', 'oil'], ['pompe', 'pump', 'réservoir', 'tank', 'hydraulique', 'accumulateur', 'accumulator']],
]
const strip = (v: string) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const CONCEPTS_N = CONCEPTS.map(([k, e]) => [k.map(strip), e.map(strip)] as const)

/** Vrai si chaque mot de la requête figure (ou figure par concept) dans le nom, le groupe ou le préfixe du symbole. */
export function matchesQuery(s: SymbolDef, query: string): boolean {
  const hay = strip([s.name.fr, s.name.en, s.group?.fr ?? '', s.group?.en ?? '', s.prefix].join(' '))
  const tokens = strip(query).split(/[\s,;]+/).filter((t) => t.length > 0)
  if (!tokens.length) return false
  if (strip(s.prefix) === strip(query.trim())) return true
  return tokens.every((t) => hay.includes(t) || CONCEPTS_N.some(([keys, terms]) => keys.some((k) => t.length >= 4 && (k.startsWith(t) || t.startsWith(k))) && terms.some((x) => hay.includes(x))))
}
