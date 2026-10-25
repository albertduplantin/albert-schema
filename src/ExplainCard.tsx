import { explain } from './explain'
import type { Lang, SymbolDef } from './types'

/** Fiche pédagogique d'un composant (utilité, cas d'emploi, réglages importants et pourquoi). */
export function ExplainCard({ def, lang }: { def: SymbolDef; lang: Lang }) {
  const e = explain(def, lang)
  const fr = lang === 'fr'
  return (
    <div className="explain">
      <p><strong>{fr ? 'À quoi ça sert' : 'What it is for'}</strong><br />{e.what}</p>
      <p><strong>{fr ? 'Quand l’utiliser' : 'When to use it'}</strong><br />{e.use}</p>
      {e.params.length > 0 && (
        <>
          <p><strong>{fr ? 'Les réglages importants, et pourquoi' : 'Key settings, and why'}</strong></p>
          <ul>{e.params.map((p) => <li key={p.name}><b>{p.name}</b> — {p.why}</li>)}</ul>
        </>
      )}
      {e.sim.length > 0 && (
        <>
          <p><strong>{fr ? 'Dans le simulateur' : 'In the simulator'}</strong></p>
          <ul>{e.sim.map((s) => <li key={s}>{s}</li>)}</ul>
        </>
      )}
      {e.tip && <p className="explain-tip">💡 {e.tip}</p>}
    </div>
  )
}
