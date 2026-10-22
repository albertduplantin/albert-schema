import type { Doc } from './types'

const unb64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([data as BlobPart]).stream().pipeThrough(stream))
  return new Uint8Array(await out.arrayBuffer())
}

/** Schéma → fragment d'URL compact (JSON compressé, base64url). Rien n'est envoyé à un serveur : tout est dans le lien. */
export async function encodeDoc(doc: Doc): Promise<string> {
  const bytes = await pipe(new TextEncoder().encode(JSON.stringify(doc)), new CompressionStream('deflate-raw'))
  let s = ''
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function decodeDoc(fragment: string): Promise<Doc> {
  const bytes = await pipe(unb64(fragment), new DecompressionStream('deflate-raw'))
  const d = JSON.parse(new TextDecoder().decode(bytes)) as Doc
  if (d.version !== 1 || !Array.isArray(d.symbols) || !Array.isArray(d.wires)) throw new Error('format')
  return d
}

export const shareUrl = (fragment: string) => `${location.origin}${location.pathname}#s=${fragment}`
export const fragmentFromHash = (hash: string) => (hash.startsWith('#s=') ? hash.slice(3) : null)
