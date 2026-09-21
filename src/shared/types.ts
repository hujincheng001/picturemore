/**
 * 跨进程契约。三个进程（main / preload / renderer）共用这一份。
 *
 * 内容照抄 `SPEC.md` §6.2，**不要改字段名或字段类型** —— 任何改动都会同时
 * 影响三个进程。唯一动过的是 `ImageFileMeta.id` 的注释：SPEC 写的是 nanoid，
 * 但 `AGENTS.md` 明确禁止引入 nanoid，改用 `crypto.randomUUID()`。
 * 类型本身（`string`）没有变。
 */

import type { ReasonCode } from './reasons'

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

/**
 * `files:probe` 的返回。
 *
 * 为什么带 `dropped`：单批有 100 张的上限，而**一次拖入可能是几千个文件**
 * （拖一个装了几千张图的文件夹）。展开是主进程做的，只有它知道到底有多少张，
 * 所以由它截断并回报被忽略的数量 —— 渲染层要是先拿全量再截，就得先把几千个文件
 * 都读一遍，白白慢几十秒。
 */
export interface ProbeResponse {
  metas: ImageFileMeta[]
  /** 因为超过上限而被忽略的张数 */
  dropped: number
}

/**
 * `task:start` 的返回。
 *
 * 启动前的失败（输出目录建不了、不可写）**不抛异常，走返回值** ——
 * 抛异常的话错误码要穿过 Electron 的 IPC 序列化，`code` 属性能不能活下来
 * 取决于版本，靠不住。结构化返回是确定的。
 */
export interface TaskStartResult {
  taskId: string
  /** 启动前就失败的原因；null 表示这批已经跑起来了 */
  error: ReasonCode | null
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
  /**
   * 整批被中止的原因（SPEC §9：「磁盘空间不足 → 中止整批并提示」）。
   *
   * 有值时说明这批没跑完：后面那些图**没有处理过**，不是失败，
   * 界面要据此区分「这批跑完了但有 N 张失败」和「这批中途停了」。
   */
  aborted?: string
}

export interface Settings {
  outputDir: string | null
  shrinkPercent: number
  outputFormat: OutputFormat
  lastDir: string | null
}
