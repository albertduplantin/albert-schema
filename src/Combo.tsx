import { useEffect, useRef, useState, type ChangeEvent, type InputHTMLAttributes } from 'react'

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'list'> & { options: (string | number)[] }

/**
 * Champ de saisie avec liste de valeurs usuelles. Contrairement à `<datalist>`, qui ne propose plus que les valeurs proches de
 * celle déjà saisie, la liste montre toujours tous les choix : on peut en changer autant de fois qu'on veut.
 */
export default function Combo({ options, onChange, className, ...rest }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [open])
  const pick = (v: string | number) => {
    onChange?.({ target: { value: String(v) } } as ChangeEvent<HTMLInputElement>)
    setOpen(false)
  }
  return (
    <span className="combo" ref={ref}>
      <input {...rest} className={className} onChange={onChange} onKeyDown={(e) => { if (e.key === 'ArrowDown' && e.altKey) setOpen(true); if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false) } rest.onKeyDown?.(e) }} />
      {options.length > 0 && (
        <button type="button" className="combo-btn" tabIndex={-1} aria-haspopup="listbox" aria-expanded={open} aria-label="▾"
          onMouseDown={(e) => e.preventDefault()} onClick={() => setOpen((v) => !v)}>▾</button>
      )}
      {open && (
        <ul className="combo-list" role="listbox">
          {options.map((o) => (
            <li key={String(o)} role="option" aria-selected={String(rest.value ?? '') === String(o)} className={String(rest.value ?? '') === String(o) ? 'on' : ''}
              onMouseDown={(e) => { e.preventDefault(); pick(o) }}>{String(o)}</li>
          ))}
        </ul>
      )}
    </span>
  )
}
