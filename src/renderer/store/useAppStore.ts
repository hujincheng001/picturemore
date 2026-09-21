import { create } from 'zustand'
import { reasonFromError } from '../../shared/reasons'
import type { OutputFormat, StartTaskPayload, TaskDoneEvent, TaskProgressEvent } from '../../shared/types'
import { MAX_BATCH, takeWithinLimit } from '../lib/limit'
import { defaultOutputDir } from '../lib/path'
import type { ImageItem } from '../lib/types'

/**
 * 全应用状态。形状照抄 `SPEC.md` §7。
 *
 * 三条规则：
 * 1. **滑块拖动不发 IPC。** 预估量在前端算（`totalBytes x (1 - p/100)`）。
 * 2. `task:progress` 按 itemId 定点更新单行，不整表重渲。
 * 3. 空列表时左栏整体隐藏（渲染层的事，见 App.tsx）。
 *
 * 路径处理在 `lib/path.ts`（可单测）。
 */

const DEFAULT_SHRINK = 65

/** 去掉路径里的非法字符，给 taskId 用 */
function newTaskId(): string {
  return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export interface AppState {
  items: ImageItem[]
  /** 最近一次加入时因为超过单批上限而被忽略的张数 */
  dropped: number
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
  dropped: 0,
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
    const prev = get()

    // 上限在主进程展开目录之后执行，所以这里传的是「还能再收几张」，
    // 而不是「一共几张」—— 拖进来一个文件夹时只有主进程知道里面有多少
    const room = Math.max(0, MAX_BATCH - prev.items.length)
    if (room === 0) {
      set({ dropped: 0 })
      return
    }

    const { metas, dropped } = await window.pictureMore.probe(paths, room)

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

    /*
     * 本地再截一次是**跨进程边界的防御**，正常路径上不会触发 ——
     * 主进程的 probe 已经按限额截过了。
     *
     * 留它的理由是：渲染层不该无条件相信对端。万一主进程那边限额算错、
     * 多返回几百行，界面会直接被撑破，而这里能兜住并把多出来的算进「已忽略」。
     */
    const { accepted, dropped: extra } = takeWithinLimit(prev.items.length, fresh)
    const items = [...prev.items, ...accepted]

    // 换了列表就把上一批的完成提示收回去，否则底部那行会自相矛盾
    const outputDir =
      prev.outputDir.length > 0 ? prev.outputDir : defaultOutputDir(paths[0] ?? '')

    set({
      items,
      outputDir,
      dropped: dropped + extra,
      lastOutputDir: null,
      finished: false,
      error: null
    })
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
    set((s) => ({
      items: s.items.filter((it) => it.id !== id),
      // 空出名额了，之前的「已忽略」提示就不再成立
      dropped: 0
    }))
  },

  async clear() {
    // SPEC §9：处理中清空列表要先 cancel 再清，否则已经在跑的那些还会往界面推进度
    const { running, taskId } = get()
    if (running && taskId !== null) {
      await window.pictureMore.cancel(taskId)
    }
    set({
      items: [],
      dropped: 0,
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
      const r = await window.pictureMore.start(payload)
      // 启动前的失败走返回值（输出目录建不了 / 不可写）。
      // 不收场的话按钮会一直卡在「处理中」，而用户看不到任何原因
      if (r.error !== null) {
        set({ running: false, taskId: null, error: r.error })
      }
      // 成功时由 task:done 事件来收场（finishTask）
    } catch (e) {
      // 意料之外的错误（IPC 断了之类）。照样要让用户看到，不能静默
      set({ running: false, taskId: null, error: reasonFromError(e) })
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
      lastOutputDir: e.outputDir,
      // 整批被中止时把原因码留在 error 上。文案要等确认，界面先只记着
      error: e.aborted ?? null
    })
  },

  setError(message) {
    set({ error: message })
  }
}))
