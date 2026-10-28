import type { Lang } from './types'

const ERRORS: Record<Lang, Record<number, string>> = {
  fr: { 400: 'Ce code n’a pas la bonne forme (12 caractères).', 404: 'Aucune sauvegarde avec ce code.', 413: 'Ce schéma est trop volumineux pour la sauvegarde en ligne (images ?).', 429: 'Trop de demandes, réessayez dans une minute.', 0: 'Pas de connexion.', 503: 'Service indisponible.' },
  en: { 400: 'This code is not the right shape (12 characters).', 404: 'No backup with this code.', 413: 'This diagram is too large for the online backup (images?).', 429: 'Too many requests, try again in a minute.', 0: 'No connection.', 503: 'Service unavailable.' },
}
/** Message d'erreur de la sauvegarde en ligne (fichier à part : l'éditeur n'a pas besoin de charger la fenêtre pour l'afficher). */
export const cloudErrorText = (lang: Lang, status: number): string => ERRORS[lang][status] ?? ERRORS[lang][0]
