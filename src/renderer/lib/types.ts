import type { ImageFormat, ItemState } from '../../shared/types'

/**
 * 渲染层的列表项。
 *
 * 字段照抄 `SPEC.md` §7 的 `ImageItem`，**另加三个**：
 * `path` / `width` / `height`。
 *
 * 为什么必须加：`task:start` 的 `StartTaskPayload.items` 要的是
 * `{ id, path, bytes, format, width, height, hasAlpha }`（SPEC §6.2），
 * 而 §7 的 `ImageItem` 里没有 `path` / `width` / `height` —— 按 §7 定义的话，
 * 渲染层根本拼不出那个 payload。三个字段在 `probe` 返回的 `ImageFileMeta` 里都有，
 * 直接带上即可，不需要额外一次 IPC。
 *
 * 放在 lib 而不是 store 里，是因为 FileRow / FileList 也要用它。
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

  /** 源文件绝对路径，拼 StartTaskPayload 要用 */
  path: string
  width: number
  height: number
}
