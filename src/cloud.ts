import type { Doc } from './types'

/** Sauvegarde en ligne par code de reprise (api/saves.js) : le code, gardé sur l'appareil, ouvre le même schéma ailleurs. */
const KEY = 'albertschema.vault'

export const getVault = (): string | null => { try { return localStorage.getItem(KEY) } catch { return null } }
export const setVault = (code: string | null) => { try { if (code) localStorage.setItem(KEY, code); else localStorage.removeItem(KEY) } catch { /* stockage indisponible */ } }

/** Affiche un code par groupes de quatre : K7QM-4TX9-2B3D. */
export const formatCode = (c: string) => c.replace(/(.{4})(.{4})(.{4})/, '$1-$2-$3')
/** Même normalisation que le serveur : majuscules, sans tirets ni espaces, O→0, I et L→1. */
export const normalizeCode = (raw: string) => raw.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1')
export const looksLikeCode = (raw: string) => /^[0-9A-HJKMNP-TV-Z]{12}$/.test(normalizeCode(raw))

export class CloudError extends Error {
  constructor(public status: number) { super('cloud ' + status) }
}

async function call(method: 'GET' | 'POST', url: string, body?: unknown): Promise<Response> {
  let r: Response
  try {
    r = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined })
  } catch { throw new CloudError(0) } // hors connexion
  if (!r.ok) throw new CloudError(r.status)
  return r
}

/** Crée une sauvegarde en ligne et renvoie son code. */
export async function createSave(doc: Doc): Promise<string> {
  return (await (await call('POST', '/api/saves', { doc })).json()).code as string
}
/** Remplace le contenu de la sauvegarde. */
export async function updateSave(code: string, doc: Doc): Promise<void> {
  await call('POST', '/api/saves', { code, doc })
}
/** Lit une sauvegarde ; `prev` : la version d'il y a au moins une heure. */
export async function fetchSave(code: string, prev = false): Promise<Doc> {
  return (await (await call('GET', `/api/saves?code=${encodeURIComponent(normalizeCode(code))}${prev ? '&v=prev' : ''}`)).json()).doc as Doc
}

/** Un schéma vide ne remplace jamais une sauvegarde : un « Nouveau » par erreur ne l'efface pas. */
export const hasContent = (d: Doc): boolean => d.symbols.length > 0 || (d.pages ?? []).some((p) => p.symbols.length > 0)
