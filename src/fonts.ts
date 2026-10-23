/** Polices proposées pour les textes du schéma. Les polices de secours servent aux exports (PNG, SVG), où les polices de l'application ne sont pas embarquées. */
export const FONTS: { id: string; label: string; css: string }[] = [
  { id: 'arial', label: 'Arial', css: 'Arial, Helvetica, sans-serif' },
  { id: 'public', label: 'Public Sans', css: "'Public Sans', Arial, sans-serif" },
  { id: 'saira', label: 'Saira Condensed', css: "'Saira Condensed', 'Arial Narrow', Arial, sans-serif" },
  { id: 'plex', label: 'IBM Plex Mono', css: "'IBM Plex Mono', 'Courier New', monospace" },
  { id: 'times', label: 'Times New Roman', css: "'Times New Roman', Times, serif" },
  { id: 'georgia', label: 'Georgia', css: 'Georgia, serif' },
  { id: 'verdana', label: 'Verdana', css: 'Verdana, Geneva, sans-serif' },
  { id: 'courier', label: 'Courier New', css: "'Courier New', Courier, monospace" },
]

export const fontCss = (id: string | undefined) => (FONTS.find((f) => f.id === id) ?? FONTS[0]).css
