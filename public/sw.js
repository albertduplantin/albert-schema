// Mise en cache : fichiers à adresse versionnée (scripts, styles, polices, symboles) servis depuis le cache d'abord (démarrage instantané,
// usage hors connexion) ; page d'accueil et le reste : réseau d'abord, le cache sert de secours.
const CACHE = 'albertschema-v2'
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()))
})
const versioned = (url) => url.pathname.includes('/assets/') || url.pathname.includes('/fonts/') || (/library-.*\.json$/.test(url.pathname) && url.searchParams.has('v'))
self.addEventListener('fetch', (e) => {
  const req = e.request
  const url = new URL(req.url)
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/admin')) return
  const store = (res) => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)) } return res }
  if (versioned(url)) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then(store)))
    return
  }
  e.respondWith(fetch(req).then(store).catch(() => caches.match(req).then((r) => r || caches.match('./'))))
})
