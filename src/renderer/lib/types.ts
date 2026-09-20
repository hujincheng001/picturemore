import type { ImageFormat, ItemState } from '../../shared/types'

/**
 * 渲染层的列表项。形状照抄 `SPEC.md` §7 的 `ImageItem`。
 *
 * 放在 lib 而不是 store 里，是因为 FileRow / FileList 现在就要用它，
 * 而 store 是 Task 13 才建的。Task 13 直接用这个类型，不要再定义一份。
 */
export interface ImageItem {
  id: string
  name: string
  bytes: number
  format: ImageFormat
  hasAlpha: boolean
  readable: boolean
  /** 不可读时的原因码，见 shared/reasons.ts */
  reason?: string
  state: ItemState
  /** 处理完成后的体积 */
  outBytes?: number
}
