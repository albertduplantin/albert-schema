import { Component, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

/** Écran de secours : évite la page blanche si des données locales sont corrompues. */
class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    if (!this.state.failed) return this.props.children
    const fr = (navigator.language || 'fr').startsWith('fr')
    const reset = () => {
      try {
        for (const k of Object.keys(localStorage)) if (k.startsWith('albertschema.')) localStorage.removeItem(k)
      } catch { /* ignoré */ }
      location.reload()
    }
    return (
      <div className="splash" style={{ flexDirection: 'column', gap: 12, textAlign: 'center', padding: 24 }}>
        <strong>{fr ? 'Une erreur est survenue.' : 'Something went wrong.'}</strong>
        <span>{fr ? 'Vos données locales sont peut-être corrompues.' : 'Your local data may be corrupted.'}</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => location.reload()}>{fr ? 'Recharger' : 'Reload'}</button>
          <button onClick={reset}>{fr ? 'Effacer les données locales et recharger' : 'Clear local data and reload'}</button>
        </div>
      </div>
    )
  }
}

try {
  const th = localStorage.getItem('albertschema.theme')
  if (th) document.documentElement.dataset.theme = th
} catch { /* ignoré */ }

// application installable et utilisable hors connexion (production uniquement)
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => undefined))
}

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
)
