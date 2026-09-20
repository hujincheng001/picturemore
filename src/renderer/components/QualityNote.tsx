import type { JSX } from 'react'
import type { OutputFormat } from '../../shared/types'
import { noteFor, noteIsCaution, noteText } from '../lib/note'

/**
 * 对应原型 `.note`。四态文案的判定逻辑在 `lib/note.ts`（纯函数，可单测），
 * 这里只负责渲染和上色。
 *
 * 组件里不出现文案字面量：SPEC §8.4 要求文案集中管理。
 */

export interface QualityNoteProps {
  outputFormat: OutputFormat
  alphaCount: number
  shrinkPercent: number
}

export function QualityNote({
  outputFormat,
  alphaCount,
  shrinkPercent
}: QualityNoteProps): JSX.Element {
  const kind = noteFor(outputFormat, alphaCount, shrinkPercent)
  const caution = noteIsCaution(kind)

  return (
    <p
      className={[
        'text-1 leading-[1.75]',
        caution ? 'text-caution' : 'text-fg-3'
      ].join(' ')}
    >
      {noteText(kind, alphaCount)}
    </p>
  )
}
