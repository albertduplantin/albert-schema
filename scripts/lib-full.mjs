// Bibliothèque complète (noyau + étendue) pour les tests et les scripts : les mêmes fichiers que l'application, fusionnés.
import { readFileSync } from 'node:fs'
export const loadFull = () => {
  const read = (f) => JSON.parse(readFileSync(new URL('../public/' + f, import.meta.url), 'utf8'))
  const core = read('library-core.json')
  const ext = read('library-extended.json')
  return { categories: ext.categories, symbols: [...core.symbols, ...ext.symbols] }
}
