import type { Lang, Paper, TitleBlock } from './types'
import { MARGIN, PAPER_SIZE, TB_H, TB_W } from './geometry'
import { tr } from './i18n'

interface Props {
  paper: Paper
  title: TitleBlock
  lang: Lang
}

/** Cadre, repères de zones et cartouche. */
export default function Sheet({ paper, title, lang }: Props) {
  const { w, h } = PAPER_SIZE[paper]
  const cols = Math.floor((w - 2 * MARGIN) / 80)
  const rows = Math.floor((h - 2 * MARGIN) / 80)
  const cw = (w - 2 * MARGIN) / cols
  const rh = (h - 2 * MARGIN) / rows
  const tx = w - MARGIN - TB_W
  const ty = h - MARGIN - TB_H
  const cell = (x: number, y: number, cwid: number, ch: number, label: string, value: string, big = false) => (
    <g key={label}>
      <rect x={x} y={y} width={cwid} height={ch} strokeWidth={1} />
      <text x={x + 3} y={y + 8} fontSize={5.5} fill="#666" stroke="none">{label}</text>
      <text x={x + 4} y={y + ch - 6} fontSize={big ? 14 : 10} fill="currentColor" stroke="none">{value}</text>
    </g>
  )
  return (
    <g stroke="currentColor" fill="none" strokeWidth={1.2}>
      <rect x={0} y={0} width={w} height={h} fill="#fff" stroke="none" />
      <rect x={MARGIN} y={MARGIN} width={w - 2 * MARGIN} height={h - 2 * MARGIN} strokeWidth={2} />
      {Array.from({ length: cols }, (_, i) => (
        <g key={'c' + i}>
          <path d={`M${MARGIN + i * cw} 0V${MARGIN}M${MARGIN + i * cw} ${h - MARGIN}V${h}`} strokeWidth={1} />
          <text x={MARGIN + (i + 0.5) * cw} y={10} fontSize={8} textAnchor="middle" fill="currentColor" stroke="none">{i + 1}</text>
        </g>
      ))}
      {Array.from({ length: rows }, (_, i) => (
        <g key={'r' + i}>
          <path d={`M0 ${MARGIN + i * rh}H${MARGIN}M${w - MARGIN} ${MARGIN + i * rh}H${w}`} strokeWidth={1} />
          <text x={7} y={MARGIN + (i + 0.5) * rh + 4} fontSize={8} textAnchor="middle" fill="currentColor" stroke="none">{String.fromCharCode(65 + i)}</text>
        </g>
      ))}
      <rect x={tx} y={ty} width={TB_W} height={TB_H} strokeWidth={2} fill="#fff" />
      {cell(tx, ty, TB_W, 38, tr(lang, 'title'), title.title, true)}
      {cell(tx, ty + 38, 160, 38, tr(lang, 'company'), title.company)}
      {cell(tx + 160, ty + 38, 160, 38, tr(lang, 'project'), title.project ?? '')}
      {cell(tx + 320, ty + 38, 160, 38, tr(lang, 'docNumber'), title.docNumber ?? '')}
      {cell(tx, ty + 76, 120, 38, tr(lang, 'author'), title.author)}
      {cell(tx + 120, ty + 76, 120, 38, tr(lang, 'approver'), title.approver ?? '')}
      {cell(tx + 240, ty + 76, 90, 38, tr(lang, 'date'), title.date)}
      {cell(tx + 330, ty + 76, 55, 38, tr(lang, 'revision'), title.revision)}
      {cell(tx + 385, ty + 76, 95, 38, tr(lang, 'sheetNo'), title.sheet)}
    </g>
  )
}
