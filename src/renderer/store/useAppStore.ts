import { create } from 'zustand'
import type { OutputFormat, StartTaskPayload, TaskDoneEvent, TaskProgressEvent } from '../../shared/types'
import type { ImageItem } from '../lib/types'

/**
 * 全应用状态。形状照抄 `SPEC.md` §7。
 *
 * 三条规则：
 * 1. **滑块拖动不发 IPC。** 预估量在前端算（`totalBytes x (1 - p/100)`）。
 * 2. `task:progress` 按 itemId 定点更新单行，不整表重渲。
 * 3. 空列表时左栏整体隐藏（渲染层的事，见 App.tsx）。
 */

const DEFAULT_SHRINK = 65

/** 取父目录。渲染进程拿不到 node:path，用字符串处理，两种分隔符都要认 */
function dirOf(p: string): string {
  const i = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'))
  return i > 0 ? p.slice(0, i) : p
}

/** `<第一张图所在目录>/processed`（SPEC §4.6 的默认输出目录） */
function defaultOutputDir(firstPath: string): string {
  const dir = dirOf(firstPath)
  const sep = dir.includes('\\') ? '\\' : '/'
  return dir.endsWith(sep) ? `${dir}processed` : `${dir}${sep}processed`
}

/** 去掉路径里的非法字符，给 taskId 用 */
function newTaskId(): string {
  return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export interface AppState {
  items: ImageItem[]
  taskId: string | null
  running: boolean

  shrinkPercent: number
  outputFormat: OutputFormat
  outputDir: string

  /** 这一批的进度，用于 CTA 的「处理中 {i} / {n}」 */
  progress: number
  /** 跑完过至少一批，CTA 显示「再压一次」 */
  finished: boolean
  /** 跑完后的提示路径；底部那行在它和常驻声明之间切换 */
  lastOutputDir: string | null
  /** 顶部级错误（输出目录不可写之类），由界面如实展示 */
  error: string | null

  init: () => Promise<void>
  addPaths: (paths: string[]) => Promise<void>
  pickFiles: () => Promise<void>
  pickOutputDir: () => Promise<void>
  removeItem: (id: string) => void
  clear: () => Promise<void>

  setShrinkPercent: (v: number) => void
  setOutputFormat: (f: OutputFormat) => void

  run: () => Promise<void>
  applyProgress: (e: TaskProgressEvent) => void
  finishTask: (e: TaskDoneEvent) => void
  setError: (message: string | null) => void
}

export const useAppStore = create<AppState>((set, get) => ({
  items: [],
  taskId: null,
  running: false,
  shrinkPercent: DEFAULT_SHRINK,
  outputFormat: 'keep',
  outputDir: '',
  progress: 0,
  finished: false,
  lastOutputDir: null,
  error: null,

  async init() {
    const s = await window.pictureMore.getSettings()
    set({
      shrinkPercent: s.shrinkPercent,
      outputFormat: s.outputFormat,
      outputDir: s.outputDir ?? ''
    })
  },

  async addPaths(paths) {
    if (paths.length === 0) return
    const metas = await window.pictureMore.probe(paths)

    const fresh: ImageItem[] = metas.map((m) => ({
      id: m.id,
      name: m.name,
      bytes: m.bytes,
      format: m.format,
      hasAlpha: m.hasAlpha,
      readable: m.readable,
      reason: m.reason,
      // 读不了的直接落到 failed，不参与处理（SPEC §9）
      state: m.readable ? 'pending' : 'failed',
      path: m.path,
      width: m.width,
      height: m.height
    }))

    const prev = get()
    const items = [...prev.items, ...fresh]
    // 换了列表就把上一批的完成提示收回去，否则底部那行会自相矛盾
    const outputDir =
      prev.outputDir.length > 0 ? prev.outputDir : defaultOutputDir(paths[0] ?? '')

    set({ items, outputDir, lastOutputDir: null, finished: false, error: null })
  },

  async pickFiles() {
    const r = await window.pictureMore.pickImages()
    if (r !== null) await get().addPaths(r.paths)
  },

  async pickOutputDir() {
    const r = await window.pictureMore.pickOutputDir()
    if (r === null) return
    set({ outputDir: r.dir })
    await window.pictureMore.setSettings({ outputDir: r.dir })
  },

  removeItem(id) {
    set((s) => ({ items: s.items.filter((it) => it.id !== id) }))
  },

  async clear() {
    // SPEC §9：处理中清空列表要先 cancel 再清，否则已经在跑的那些还会往界面推进度
    const { running, taskId } = get()
    if (running && taskId !== null) {
      await window.pictureMore.cancel(taskId)
    }
    set({
      items: [],
      running: false,
      taskId: null,
      progress: 0,
      finished: false,
      lastOutputDir: null,
      error: null
    })
  },

  setShrinkPercent(v) {
    // 只改本地，不碰 IPC
    set({ shrinkPercent: v })
  },

  setOutputFormat(f) {
    set({ outputFormat: f })
  },

  async run() {
    const { items, shrinkPercent, outputFormat, outputDir, running } = get()
    if (running) return

    const targets = items.filter((it) => it.readable)
    if (targets.length === 0 || outputDir.length === 0) return

    const taskId = newTaskId()
    const payload: StartTaskPayload = {
      taskId,
      items: targets.map((it) => ({
        id: it.id,
        path: it.path,
        bytes: it.bytes,
        format: it.format,
        width: it.width,
        height: it.height,
        hasAlpha: it.hasAlpha
      })),
      shrinkPercent,
      outputFormat,
      outputDir
    }

    set({ running: true, taskId, progress: 0, finished: false, error: null })
    try {
      await window.pictureMore.start(payload)
    } catch (e) {
      // 输出目录建不了 / 不可写之类，处理前就该报出来，不让用户白等（SPEC §9）
      set({ running: false, taskId: null, error: (e as Error).message })
    }
  },

  applyProgress(e) {
    set((s) => ({
      items: s.items.map((it) =>
        it.id === e.itemId
          ? {
              ...it,
              state: e.state,
              outBytes: e.outBytes ?? it.outBytes,
              reason: e.reason ?? it.reason
            }
          : it
      ),
      progress: Math.max(s.progress, e.index + 1)
    }))
  },

  finishTask(e) {
    set({
      running: false,
      taskId: null,
      finished: true,
      lastOutputDir: e.outputDir
    })
  },

  setError(message) {
    set({ error: message })
  }
}))
