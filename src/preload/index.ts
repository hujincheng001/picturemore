import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { PictureMoreApi } from '../shared/api'
import { IPC } from '../shared/ipc'
import type {
  ProbeResponse,
  Settings,
  StartTaskPayload,
  TaskDoneEvent,
  TaskProgressEvent
} from '../shared/types'

/**
 * 渲染进程唯一的对外能力面。
 *
 * 这里是白名单：渲染层拿不到 `ipcRenderer` 本身，只能调下面这些具名方法。
 * `contextIsolation: true` + `nodeIntegration: false` 两条红线永远不动（AGENTS.md）。
 *
 * `webUtils` 的可用性见 `SPEC.md` §6.1 的 M1 验证项：它的官方标注是 renderer 进程模块，
 * 在 `sandbox: true`（Electron 默认）的 preload 里能否拿到需要实测。
 * 冒烟脚本 `scripts/smoke-context-isolation.mjs` 会实际调一次 `getDroppedPaths` 来确认。
 */

const api: PictureMoreApi = {
  probe: (paths: string[], limit?: number): Promise<ProbeResponse> =>
    ipcRenderer.invoke(IPC.probe, { paths, limit }),
  pickImages: (): Promise<{ paths: string[] } | null> => ipcRenderer.invoke(IPC.pickImages),
  pickOutputDir: (): Promise<{ dir: string } | null> => ipcRenderer.invoke(IPC.pickOutputDir),
  revealInFolder: (path: string): Promise<void> => ipcRenderer.invoke(IPC.revealInFolder, { path }),

  start: (payload: StartTaskPayload): Promise<{ taskId: string }> =>
    ipcRenderer.invoke(IPC.taskStart, payload),
  cancel: (taskId: string): Promise<void> => ipcRenderer.invoke(IPC.taskCancel, { taskId }),

  getSettings: (): Promise<Settings> => ipcRenderer.invoke(IPC.settingsGet),
  setSettings: (patch: Partial<Settings>): Promise<Settings> =>
    ipcRenderer.invoke(IPC.settingsSet, patch),

  /**
   * 拖拽入图的路径。
   *
   * Electron 32 起 `File.path` 已被移除，唯一替代是 `webUtils.getPathForFile`。
   * 返回空串表示这个 File 不是磁盘上的真实文件（比如从网页拖来的），跳过即可。
   *
   * 刻意**不**在这里 try/catch：如果 `webUtils` 在沙箱 preload 里根本拿不到
   * （SPEC §6.1 的 M1 验证项），吞掉异常会让拖拽静默失效 —— 用户拖进一堆图，
   * 界面什么都不发生，这是最难查的一类故障。宁可让它响亮地抛出来。
   */
  getDroppedPaths: (files: readonly File[]): string[] => {
    const out: string[] = []
    for (const f of files) {
      const p = webUtils.getPathForFile(f)
      if (typeof p === 'string' && p.length > 0) out.push(p)
    }
    return out
  },

  onProgress: (cb: (e: TaskProgressEvent) => void): (() => void) => {
    const h = (_e: unknown, payload: TaskProgressEvent): void => cb(payload)
    ipcRenderer.on(IPC.taskProgress, h)
    return () => {
      ipcRenderer.off(IPC.taskProgress, h)
    }
  },

  onDone: (cb: (e: TaskDoneEvent) => void): (() => void) => {
    const h = (_e: unknown, payload: TaskDoneEvent): void => cb(payload)
    ipcRenderer.on(IPC.taskDone, h)
    return () => {
      ipcRenderer.off(IPC.taskDone, h)
    }
  }
}

contextBridge.exposeInMainWorld('pictureMore', api)
