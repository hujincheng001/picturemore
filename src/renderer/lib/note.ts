import type { OutputFormat } from '../../shared/types'
import { COPY } from './copy'

/**
 * 四态文案的判定。优先级从上到下，命中即停（DESIGN.md §7）。
 *
 * 抽成纯函数放在 lib 里，而不是写在组件内部，是为了能脱离 React 直接测：
 * 这四条的顺序是有讲究的（PNG 劝阻必须压过越线警告，否则用户把滑块拖到 80%
 * 又选了 PNG 时，看到的是"能看出压缩痕迹"而不是"PNG 根本压不动"），
 * 顺序错了不会有任何报错，只会给错提示。
 */

export const SAFE_PERCENT = 70

export type NoteKind = 'png' | 'alpha' | 'over-line' | 'promise'

export function noteFor(
  outputFormat: OutputFormat,
  alphaCount: number,
  shrinkPercent: number
): NoteKind {
  if (outputFormat === 'png') return 'png'
  if (outputFormat === 'jpeg' && alphaCount > 0) return 'alpha'
  if (shrinkPercent > SAFE_PERCENT) return 'over-line'
  return 'promise'
}

/** 琥珀色只在「这样压会看出痕迹」时出现（AGENTS.md 硬性约束） */
export function noteIsCaution(kind: NoteKind): boolean {
  return kind !== 'promise'
}

export function noteText(kind: NoteKind, alphaCount: number): string {
  switch (kind) {
    case 'png':
      return COPY.pngDissuade
    case 'alpha':
      return COPY.alphaFlatten(alphaCount)
    case 'over-line':
      return COPY.overLine
    case 'promise':
      return COPY.promise
  }
}
