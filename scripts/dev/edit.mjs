// Édition par blocs, sans échappement ni script à réécrire : conserve les fins de ligne (CRLF) du fichier.
// Usage : node scripts/dev/edit.mjs patch.txt     (ou « - » pour lire l'entrée standard)
// Format du patch (le texte est pris tel quel, une occurrence exacte et unique de l'ancien texte est exigée) :
//   @@ src/Fichier.ts
//   <<<<
//   ancien texte (une ou plusieurs lignes)
//   ====
//   nouveau texte
//   >>>>
//   (plusieurs blocs par fichier, plusieurs « @@ » possibles ; « <<<<~ » au lieu de « <<<< » = remplacer toutes les occurrences)
import fs from 'node:fs'

const src = fs.readFileSync(process.argv[2] === '-' ? 0 : process.argv[2], 'utf8').replace(/\r/g, '')
const files = new Map()
let file = null, mode = null, old = [], neu = [], all = false, errors = 0, n = 0
const load = (f) => {
  if (!files.has(f)) { const raw = fs.readFileSync(f, 'utf8'); files.set(f, { crlf: raw.includes('\r'), s: raw.replace(/\r/g, '') }) }
  return files.get(f)
}
for (const line of src.split('\n')) {
  if (mode === null) {
    if (line.startsWith('@@ ')) file = line.slice(3).trim()
    else if (line.startsWith('<<<<')) { mode = 'old'; old = []; neu = []; all = line.startsWith('<<<<~') }
  } else if (mode === 'old' && line === '====') mode = 'new'
  else if (mode === 'new' && line === '>>>>') {
    mode = null
    const f = load(file), a = old.join('\n'), b = neu.join('\n')
    const count = a ? f.s.split(a).length - 1 : 0
    if (count === 0 || (count > 1 && !all)) { errors++; console.error(`✗ ${file} : ${count === 0 ? 'texte absent' : count + ' occurrences'} → ${a.slice(0, 80).replace(/\n/g, '⏎')}`) }
    else { f.s = f.s.split(a).join(b); n++ }
  } else (mode === 'old' ? old : neu).push(line)
}
if (errors) { console.error(`${errors} bloc(s) refusé(s) : rien n'a été écrit`); process.exit(1) }
for (const [f, { crlf, s }] of files) fs.writeFileSync(f, crlf ? s.split('\n').join('\r\n') : s)
console.log(`${n} bloc(s) appliqué(s) dans ${files.size} fichier(s)`)
