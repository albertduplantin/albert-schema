// Mesure d'audience sans cookie (voir api/visit.js) : une seule requête par onglet, aucune donnée stockée chez le visiteur
// hormis un drapeau de session. Ignorée sur localhost, avec « Do Not Track », et pour le propriétaire (drapeau posé depuis l'administration).
(function () {
  try {
    if (navigator.doNotTrack === '1' || /^(localhost|127\.|\[::1\])/.test(location.hostname)) return
    if (localStorage.getItem('as.nostats') || sessionStorage.getItem('as.v')) return
    sessionStorage.setItem('as.v', '1')
  } catch (e) { return }
  try {
    fetch('/api/visit', {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ p: location.pathname, r: document.referrer, l: (navigator.language || '').slice(0, 2).toLowerCase() }),
    }).catch(function () {})
  } catch (e) { /* ignoré */ }
})()
