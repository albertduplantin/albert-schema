import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

const BUILD = (process.env.VERCEL_GIT_COMMIT_SHA ?? 'dev').slice(0, 7)

export default defineConfig({
  // __BUILD__ dans index.html : adresse versionnée du fichier de symboles préchargé
  plugins: [react(), { name: 'build-stamp', transformIndexHtml: (html: string) => html.split('__BUILD__').join(BUILD) }],
  base: './',
  // identifiant de la version déployée (commit Vercel), joint aux retours des utilisateurs
  define: { __BUILD__: JSON.stringify(BUILD) },
  // deux pages : l'éditeur et l'administration des retours (/admin)
  build: { rollupOptions: { input: { main: resolve(__dirname, 'index.html'), admin: resolve(__dirname, 'admin.html') } } },
})
