import { uid } from './geometry'
import type { Lang, Note } from './types'

interface Help { x: number; y: number; title: { fr: string; en: string }; text: { fr: string; en: string } }

/** Boutons d'explication (ⓘ) posés sur certains exemples de la galerie : le texte s'affiche à côté du bouton au clic. */
const HELPS: Record<string, Help[]> = {
  tplHydTP5: [
    {
      x: 360, y: 590,
      title: { fr: 'Le groupe hydraulique', en: 'The power unit' },
      text: {
        fr: 'Le moteur entraîne la pompe GMP, qui aspire l’huile dans la bâche et l’envoie dans le circuit. Le limiteur de pression LP, réglé à 100 bar (manomètre G3), fixe la pression maximale : au-delà, l’huile retourne à la bâche.',
        en: 'The motor drives pump GMP, which draws oil from the tank and sends it into the circuit. Relief valve LP, set to 100 bar (gauge G3), sets the maximum pressure: above it, the oil returns to the tank.',
      },
    },
    {
      x: 10, y: 60,
      title: { fr: 'Le moteur hydraulique M2', en: 'Hydraulic motor M2' },
      text: {
        fr: 'Le distributeur 4/3 1V1 commande le sens de rotation : 1Y1 dans un sens, 1Y2 dans l’autre. Les limiteurs de débit LA (8 %) et LB (12 %) règlent la vitesse. G1 et G2 donnent la pression sur chaque orifice du moteur.',
        en: 'The 4/3 valve 1V1 sets the direction of rotation: 1Y1 one way, 1Y2 the other. Flow controls LA (8%) and LB (12%) set the speed. G1 and G2 show the pressure at each motor port.',
      },
    },
    {
      x: 700, y: 40,
      title: { fr: 'Le vérin 1A', en: 'Cylinder 1A' },
      text: {
        fr: 'Le distributeur 4/3 1V2 commande le sens de déplacement du vérin : 1Y3 pour un sens, 1Y4 pour l’autre. G4 et G5 donnent la pression dans les deux chambres.',
        en: 'The 4/3 valve 1V2 sets the direction of the cylinder: 1Y3 one way, 1Y4 the other. G4 and G5 show the pressure in the two chambers.',
      },
    },
    {
      x: 880, y: 250,
      title: { fr: 'Les limiteurs RA et RB', en: 'Relief valves RA and RB' },
      text: {
        fr: 'Chaque chambre du vérin est protégée par son propre limiteur de pression, relié à la bâche : RA à 80 bar côté fond, RB à 40 bar côté tige. Si la pression d’une chambre dépasse son réglage, l’huile s’échappe vers la bâche. Ces limiteurs sont réglés sous le limiteur principal LP (100 bar).',
        en: 'Each cylinder chamber is protected by its own relief valve connected to the tank: RA at 80 bar on the piston side, RB at 40 bar on the rod side. If a chamber pressure goes above its setting, the oil escapes to the tank. They are set below the main relief valve LP (100 bar).',
      },
    },
  ],
}

/** Boutons d'explication de l'exemple `key`, dans la langue demandée (aucun si l'exemple n'en a pas). */
export const templateHelps = (key: string | undefined, lang: Lang): Note[] =>
  (key ? HELPS[key] ?? [] : []).map((h) => ({ id: uid(), x: h.x, y: h.y, text: h.text[lang], title: h.title[lang], size: 12, help: true }))
