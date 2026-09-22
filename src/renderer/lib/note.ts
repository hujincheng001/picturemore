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

/**
 * 行内提示：这张没压到目标时该说什么（SPEC §9）。
 *
 * 两种情况分开说，判据用 `outBytes === bytes`：
 * - 相等 → 输出就是原文件，说明「再压只会更大」，即 keptOriginal
 * - 不等 → 压下去了但没到目标，质量已触底
 *
 * **为什么用体积相等来判断，而不是再加一个字段**：`keptOriginal` 的定义就是
 * 「返回原文件字节」，两者语义完全等价。而且万一某个无损格式恰好压出同样大小，
 * 显示「已经压到底了」也依然是对的 —— 体积确实没变。
 *
 * 返回 null 表示这一行没什么要额外说的，调用方据此决定要不要渲染那一格。
 */
export function rowNote(item: {
  state: string
  bytes: number
  outBytes?: number | undefined
}): string | null {
  if (item.state !== 'undershot') return null

  const out = item.outBytes
  if (out === undefined) return null
  if (out === item.bytes) return COPY.undershotKept

  // bytes 为 0 是读不了的图，不该走到这里；真走到了也别产出 NaN
  if (item.bytes <= 0) return COPY.undershotKept

  return COPY.undershotFloor(Math.round((out / item.bytes) * 100))
}
