// Corrections des noms de symboles de la collection QElectroTech : fautes, noms anglais restés dans la version française, minuscules.
const FIXES = {
  'cabinet_blast_lamp': { fr: 'Lampe de coffret (ballast)', en: 'Cabinet lamp with ballast' },
  'bache_a_l_air_libre': { fr: 'Bâche à l’air libre', en: 'Open tank' },
  'verin-assymetrique-double-effet-tige-a-gauche': { fr: 'Vérin asymétrique double effet, tige à gauche', en: 'Double-acting asymmetric cylinder, rod on the left' },
  'verin-asymetrique-doubl-effet': { fr: 'Vérin asymétrique double effet, tige à droite', en: 'Double-acting asymmetric cylinder, rod on the right' },
  '5030101100_double_effet': { fr: 'Vérin double effet', en: 'Double-acting cylinder' },
  '5030101010_simple_effet': { fr: 'Vérin simple effet à ressort', en: 'Single-acting cylinder with spring' },
  'induction_motor_6_terminals': { fr: 'Moteur triphasé à 6 bornes (étoile / triangle)', en: 'Three-phase motor, 6 terminals (star / delta)' },
  'dahlander_motor_6_terminals': { fr: 'Moteur triphasé Dahlander, 6 bornes', en: 'Three-phase Dahlander motor, 6 terminals' },
  'dahlander_motor_9_terminals': { fr: 'Moteur triphasé Dahlander, 9 bornes', en: 'Three-phase Dahlander motor, 9 terminals' },
  'dahlander_motor_12_terminals': { fr: 'Moteur triphasé Dahlander, 12 bornes', en: 'Three-phase Dahlander motor, 12 terminals' },
  'moto_ac_1ph': { fr: 'Moteur alternatif monophasé', en: 'Single-phase AC motor' },
  'moto_ac_3ph': { fr: 'Moteur alternatif triphasé', en: 'Three-phase AC motor' },
  'switch_led_green': { fr: 'Interrupteur à voyant (vert)', en: 'Switch with LED (green)' },
  'switch_led_red': { fr: 'Interrupteur à voyant (rouge)', en: 'Switch with LED (red)' },
  'power_supply_1_phase_ac_dc': { fr: 'Alimentation 24 V continu monophasée', en: '24 V DC power supply, single-phase' },
  'timer816': { fr: 'Minuterie T 816', en: 'Timer T 816' },
  'tmr48': { fr: 'Minuterie TMR48', en: 'Timer TMR48' },
  'rj45_socket': { fr: 'Prise RJ45', en: 'RJ45 socket' },
  'usb2_a_socket': { fr: 'Prise USB 2.0 type A', en: 'USB 2.0 type A socket' },
  'usb3_a_socket': { fr: 'Prise USB 3.0 type A', en: 'USB 3.0 type A socket' },
  'buzzer': { fr: 'Avertisseur sonore', en: 'Buzzer' },
  'contact_relais': { fr: 'Contact de relais thermique (NO)', en: 'Thermal relay contact (NO)' },
  'itcv': { fr: 'ITCV', en: 'ITCV' },
  'thermocouple': { fr: 'Thermocouple', en: 'Thermocouple' },
}

const up = (s) => (s ? s.replace(/^(\P{L}*)(\p{Ll})/u, (_, p, c) => p + c.toUpperCase()) : s)

/** Nom corrigé d'un symbole : table de corrections par fin d'identifiant, sinon première lettre en majuscule et fautes courantes. */
export function fixName(id, name) {
  const tail = id.replace(/\.elmt$/, '').split('/').pop()
  const f = FIXES[tail]
  if (f) return { ...name, fr: f.fr, en: f.en }
  const clean = (s) => up((s ?? '').replace(/assym/gi, (m) => (m[0] === 'A' ? 'Asym' : 'asym')).replace(/terminlas/g, 'terminals').replace(/\s{2,}/g, ' ').trim())
  return { ...name, fr: clean(name.fr), en: clean(name.en) }
}
