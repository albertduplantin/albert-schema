import { createContext, useContext, useEffect, useState, type DragEvent, type ReactNode } from 'react'
import type { Lang } from './types'

/** Éléments d'interface communs aux éditeurs de l'automate (Grafcet, Ladder) : glisser-déposer, emplacements de dépôt, texte modifiable en place. */
export type Tool = 'step' | 'alt' | 'par' | 'time' | 'quick' | 'contactNO' | 'contactNC' | 'coil' | 'set' | 'reset' | 'ton' | 'rung'
export type Payload = { k: 'tool'; tool: Tool } | { k: 'var'; name: string } | { k: 'step'; id: number } | { k: 'link'; from: number } | { k: 'rung'; i: number }

export interface Dnd { drag: Payload | null; armed: Payload | null; setDrag: (p: Payload | null) => void; setArmed: (p: Payload | null) => void }
export const DndCtx = createContext<Dnd>({ drag: null, armed: null, setDrag: () => {}, setArmed: () => {} })
export const MIME = 'application/x-albert-plc'
export const T = (lang: Lang, fr: string, en: string) => (lang === 'fr' ? fr : en)

// ───────────────────────── éléments communs

/** Élément qu'on peut saisir (glisser) ou choisir d'un clic puis poser d'un second clic. */
export function Draggable({ payload, className, children, title, click = true }: { payload: Payload; className?: string; children: ReactNode; title?: string; click?: boolean }) {
  const { setDrag, armed, setArmed } = useContext(DndCtx)
  const same = armed && JSON.stringify(armed) === JSON.stringify(payload)
  return (
    <div className={`${className ?? ''} dragitem${same ? ' armed' : ''}`} draggable data-tip={title} role="button" tabIndex={0}
      onDragStart={(e) => { e.dataTransfer.setData(MIME, JSON.stringify(payload)); e.dataTransfer.effectAllowed = 'copyMove'; setDrag(payload) }}
      onDragEnd={() => setDrag(null)}
      onClick={() => click && setArmed(same ? null : payload)}
      onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && click) { e.preventDefault(); setArmed(same ? null : payload) } }}>
      {children}
    </div>
  )
}

/** Emplacement de dépôt : invisible au repos, mis en évidence dès qu'un élément compatible est saisi ou choisi. */
export function Slot({ accept, onDrop, className, children, label }: { accept: (p: Payload) => boolean; onDrop: (p: Payload, e: { alt: boolean }) => void; className?: string; children?: ReactNode; label?: string }) {
  const { drag, armed, setDrag, setArmed } = useContext(DndCtx)
  const [over, setOver] = useState(false)
  const cur = drag ?? armed
  const can = !!cur && accept(cur)
  const fire = (p: Payload, alt: boolean) => { onDrop(p, { alt }); setDrag(null); setArmed(null); setOver(false) }
  return (
    <div className={`slot ${className ?? ''}${can ? ' can' : ''}${over && can ? ' over' : ''}`} aria-label={label}
      onDragOver={(e: DragEvent) => { if (can) { e.preventDefault(); setOver(true) } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e: DragEvent) => { if (!can || !cur) return; e.preventDefault(); fire(cur, e.altKey) }}
      onClick={(e) => { if (armed && can) { e.stopPropagation(); fire(armed, e.altKey) } }}>
      {children}
    </div>
  )
}

/** Texte modifiable en place (clic), validé par Entrée ou en quittant le champ, annulé par Échap. */
export function Inline({ value, onCommit, placeholder, list, className, invalid, title }: { value: string; onCommit: (v: string) => void; placeholder?: string; list?: string; className?: string; invalid?: boolean; title?: string }) {
  const [edit, setEdit] = useState(false)
  const [v, setV] = useState(value)
  useEffect(() => { if (!edit) setV(value) }, [value, edit])
  if (!edit) {
    return <span className={`inline ${className ?? ''}${invalid ? ' bad' : ''}${value ? '' : ' blank'}`} role="button" tabIndex={0} data-tip={title} onClick={() => setEdit(true)} onKeyDown={(e) => { if (e.key === 'Enter') setEdit(true) }}>{value || placeholder || '…'}</span>
  }
  const done = (ok: boolean) => { setEdit(false); if (ok && v !== value) onCommit(v) }
  return <input className={`inline-input ${className ?? ''}`} autoFocus list={list} value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onBlur={() => done(true)}
    onKeyDown={(e) => { if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false) }} onFocus={(e) => e.currentTarget.select()} />
}

