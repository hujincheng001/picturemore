import type {
  ProbeResponse,
  Settings,
  StartTaskPayload,
  TaskStartResult,
  TaskDoneEvent,
  TaskProgressEvent
} from './types'

/**
 * `window.pictureMore` 的形状。preload 实现它，渲染层消费它。
 *
 * 放在 shared 而不是从 preload 推导，是为了让渲染层的类型图里不出现 `electron`：
 * 渲染进程拿不到 electron，类型里也不该引用它。
 */
export interface PictureMoreApi {
  /**
   * 读一批路径的元信息。
   *
   * `limit` 是**还能再收几张**（不是总数）。主进程展开目录之后按它截断，
   * 并把被忽略的张数放在 `dropped` 里回报。
   */
  probe(paths: string[], limit?: number): Promise<ProbeResponse>
  pickImages(): Promise<{ paths: string[] } | null>
  pickOutputDir(): Promise<{ dir: string } | null>

  start(payload: StartTaskPayload): Promise<TaskStartResult>
  cancel(taskId: string): Promise<void>

  getSettings(): Promise<Settings>
  setSettings(patch: Partial<Settings>): Promise<Settings>

  /** 拖拽入图的绝对路径。取不到路径的文件会被跳过，不抛错 */
  getDroppedPaths(files: readonly File[]): string[]

  /** 返回取消订阅的函数。必须在组件卸载时调用，否则严格模式下会注册两次 */
  onProgress(cb: (e: TaskProgressEvent) => void): () => void
  onDone(cb: (e: TaskDoneEvent) => void): () => void
}
