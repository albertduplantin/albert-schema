import type { Lang, Paper, TitleBlock } from './types'
import { MARGIN, PAPER_SIZE } from './geometry'
import { tr } from './i18n'

interface Props {
  paper: Paper
  title: TitleBlock
  lang: Lang
}

const TB_W = 640
const TB_H = 100

/** Cadre, repères de zones et cartouche. */
export default function Sheet({ paper, title, lang }: Props) {
  const { w, h } = PAPER_SIZE[paper]
  const cols = Math.floor((w - 2 * MARGIN) / 120)
  const rows = Math.floor((h - 2 * MARGIN) / 120)
  const cw = (w - 2 * MARGIN) / cols
  const rh = (h - 2 * MARGIN) / rows
  const tx = w - MARGIN - TB_W
  const ty = h - MARGIN - TB_H
  const cell = (x: number, y: number, cwid: number, ch: number, label: string, value: string, big = false) => (
    <g key={label}>
      <rect x={x} y={y} width={cwid} height={ch} strokeWidth={1} />
      <text x={x + 4} y={y + 10} fontSize={7} fill="#666" stroke="none">{label}</text>
      <text x={x + 6} y={y + ch - 8} fontSize={big ? 20 : 13} fill="currentColor" stroke="none">{value}</text>
    </g>
  )
  return (
    <g stroke="currentColor" fill="none" strokeWidth={1.5}>
      <rect x={0} y={0} width={w} height={h} fill="#fff" stroke="none" />
      <rect x={MARGIN} y={MARGIN} width={w - 2 * MARGIN} height={h - 2 * MARGIN} strokeWidth={2} />
      {Array.from({ length: cols }, (_, i) => (
        <g key={'c' + i}>
          <path d={`M${MARGIN + i * cw} 0V${MARGIN}M${MARGIN + i * cw} ${h - MARGIN}V${h}`} strokeWidth={1} />
          <text x={MARGIN + (i + 0.5) * cw} y={14} fontSize={10} textAnchor="middle" fill="currentColor" stroke="none">{i + 1}</text>
        </g>
      ))}
      {Array.from({ length: rows }, (_, i) => (
        <g key={'r' + i}>
          <path d={`M0 ${MARGIN + i * rh}H${MARGIN}M${w - MARGIN} ${MARGIN + i * rh}H${w}`} strokeWidth={1} />
          <text x={10} y={MARGIN + (i + 0.5) * rh + 4} fontSize={10} textAnchor="middle" fill="currentColor" stroke="none">{String.fromCharCode(65 + i)}</text>
        </g>
      ))}
      <rect x={tx} y={ty} width={TB_W} height={TB_H} strokeWidth={2} fill="#fff" />
      {cell(tx, ty, TB_W, 50, tr(lang, 'title'), title.title, true)}
      {cell(tx, ty + 50, 200, 50, tr(lang, 'company'), title.company)}
      {cell(tx + 200, ty + 50, 160, 50, tr(lang, 'author'), title.author)}
      {cell(tx + 360, ty + 50, 120, 50, tr(lang, 'date'), title.date)}
      {cell(tx + 480, ty + 50, 70, 50, tr(lang, 'revision'), title.revision)}
      {cell(tx + 550, ty + 50, 90, 50, tr(lang, 'sheetNo'), title.sheet)}
    </g>
  )
}
