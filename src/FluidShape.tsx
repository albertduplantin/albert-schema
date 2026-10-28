import { useEffect, useRef, useState } from 'react'
import type { PlacedSymbol, SymbolDef } from './types'
import type { SimResult } from './sim/engine'
import { cylinderSvg, cylRest, valveIndex, valveSvg, type Detector } from './symbols/fluidDraw'

/** Valeur qui rejoint progressivement sa cible : le tiroir d'un distributeur glisse, le piston d'un vérin avance au lieu de sauter. */
function useEased(target: number, rate: number): number {
  const [v, setV] = useState(target)
  const cur = useRef(target)
  useEffect(() => {
    let raf = 0
    let last = performance.now()
    const tick = (t: number) => {
      const dt = Math.min(0.1, (t - last) / 1000)
      last = t
      const d = target - cur.current
      if (Math.abs(d) < 0.002) { cur.current = target; setV(target); return }
      const step = Math.sign(d) * Math.min(Math.abs(d), rate * dt)
      cur.current += step
      setV(cur.current)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, rate])
  return v
}

/** Distributeur ou vérin dessiné dynamiquement : cases qui glissent, piston qui avance, chambres rouges (pression) ou bleues (échappement). */
export function FluidShape({ s, def, sim, detectors }: { s: PlacedSymbol; def: SymbolDef; sim: SimResult | null; detectors?: Detector[] }) {
  const f = def.fluid
  const pot = (id: string) => sim?.potentialOf[`${s.id}:${id}`]
  const valveTarget = f?.k === 'valve' ? valveIndex(f, !!sim?.valveA[s.id], !!sim?.valveB[s.id]) : 1
  const cylTarget = f?.k === 'cyl' ? (sim?.cylPos[s.id] ?? cylRest(def)) : 0
  const vpos = useEased(valveTarget, 9) // une case en environ 0,11 s
  const cpos = useEased(cylTarget, 2.2)
  let html = ''
  if (f?.k === 'valve') html = valveSvg(def, { pos: vpos, pot: (id) => (sim ? pot(id) : null), a: sim ? !!sim.valveA[s.id] : false, b: sim ? !!sim.valveB[s.id] : false, label: s.label, tagOff: s.tagOff, tagText: s.tagText })
  else if (f?.k === 'cyl') html = cylinderSvg(def, { detectors, p: cpos, potCap: sim ? pot(f.cap) : null, potRod: sim && f.rod ? pot(f.rod) : null })
  return <g data-solof={s.id} dangerouslySetInnerHTML={{ __html: html.replace(/var\(--bg\)/g, '#fff') }} />
}
