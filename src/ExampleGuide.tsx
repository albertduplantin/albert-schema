import type { Lang } from './types'
import { EXAMPLE_GUIDES } from './exampleGuides'

/** Fiche d'un exemple intégré : à quoi il sert, ce qu'on y apprend, ce qu'on peut simuler. */
export default function ExampleGuide({ exKey, title, lang, labels, onClose }: { exKey: string; title: string; lang: Lang; labels: { what: string; learn: string; sim: string; close: string }; onClose: () => void }) {
  const g = EXAMPLE_GUIDES[exKey]?.[lang]
  if (!g) return null
  return (
    <aside className="exguide" role="dialog" aria-label={title}>
      <button className="icon exguide-x" onClick={onClose} aria-label={labels.close} title={labels.close}>✕</button>
      <h3>{title}</h3>
      <h4>{labels.what}</h4>
      <p>{g.purpose}</p>
      <h4>{labels.learn}</h4>
      <ul>{g.learn.map((l, i) => <li key={i}>{l}</li>)}</ul>
      <h4>{labels.sim}</h4>
      <ul>{g.simulate.map((l, i) => <li key={i}>{l}</li>)}</ul>
    </aside>
  )
}
