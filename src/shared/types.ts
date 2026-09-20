/**
 * 跨进程契约。三个进程（main / preload / renderer）共用这一份。
 *
 * 内容照抄 `SPEC.md` §6.2，**不要改字段名或字段类型** —— 任何改动都会同时
 * 影响三个进程。唯一动过的是 `ImageFileMeta.id` 的注释：SPEC 写的是 nanoid，
 * 但 `AGENTS.md` 明确禁止引入 nanoid，改用 `crypto.randomUUID()`。
 * 类型本身（`string`）没有变。
 */

export type ImageFormat = 'heic' | 'jpeg' | 'png' | 'webp' | 'avif' | 'gif' | 'tiff' | 'unknown'
export type OutputFormat = 'keep' | 'jpeg' | 'png' | 'webp'
export type ItemState = 'pending' | 'working' | 'done' | 'undershot' | 'failed'

export interface ImageFileMeta {
  /** `crypto.randomUUID()`，渲染层主键 */
  id: string
  /** 仅文件名，用于展示 */
  name: string
  /**
   * 源文件绝对路径。
   *
   * SPEC §6.2 的定义里**没有**这个字段，但 `task:start` 的 `StartTaskPayload.items`
   * 要的就是 `{ id, path, ... }` —— 渲染层拿不到 path 就拼不出那个 payload。
   * 这里按 §6.2 的既有风格补一个字段（加法，不改动任何已有字段的名字与类型）。
   *
   * 另一条路是让渲染层把传进去的 paths 按下标 zip 回来，但那是个隐式耦合：
   * 哪天 probe 过滤掉一张图，对应关系就静默错位了。显式带上更稳。
   */
  path: string
  ext: string
  bytes: number
  format: ImageFormat
  width: number
  height: number
  hasAlpha: boolean
  readable: boolean
  /** readable=false 时的原因 */
  reason?: string
}

export interface StartTaskPayload {
  taskId: string
  items: Array<{
    id: string
    path: string
    bytes: number
    format: ImageFormat
    width: number
    height: number
    hasAlpha: boolean
  }>
  /** 20-90 */
  shrinkPercent: number
  outputFormat: OutputFormat
  outputDir: string
}

export interface TaskProgressEvent {
  taskId: string
  itemId: string
  index: number
  total: number
  state: ItemState
  outBytes?: number
  outName?: string
  width?: number
  height?: number
  quality?: number | null
  reason?: string
}

export interface TaskDoneEvent {
  taskId: string
  done: number
  undershot: number
  failed: number
  outputDir: string
}

export interface Settings {
  outputDir: string | null
  shrinkPercent: number
  outputFormat: OutputFormat
  lastDir: string | null
}
