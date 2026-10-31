/**
 * Adresse de la page de dons (Ko-fi, par exemple https://ko-fi.com/votre-nom).
 * Tant qu'elle est vide, aucun lien de don n'est affiché, ni dans l'éditeur ni dans les pages de présentation.
 */
export const DONATE_URL = 'https://ko-fi.com/topinambourrutabaga'

const KEY = 'albertschema.donate'
const EVERY_MS = 30 * 86_400_000

interface State { at?: number; off?: boolean }
const read = (): State => { try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') as State } catch { return {} } }
const write = (s: State) => { try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* stockage refusé : le message ne sera pas retenu */ } }

/** Le message discret proposé après un export peut-il s'afficher : lien configuré, pas refusé, pas déjà vu depuis 30 jours. */
export function donateDue(now = Date.now()): boolean {
  if (!DONATE_URL) return false
  const s = read()
  return !s.off && (!s.at || now - s.at > EVERY_MS)
}
export const donateShown = (now = Date.now()) => write({ ...read(), at: now })
export const donateOff = () => write({ ...read(), off: true })
