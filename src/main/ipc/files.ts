import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc'
import type { ImageFileMeta } from '../../shared/types'
import { probePaths } from '../files'

/**
 * `files:probe` 的 IPC 注册。
 *
 * 逻辑本体在 `src/main/files.ts`（不依赖 electron，可脱离 Electron 单测），
 * 这里只做转发。
 */
export function registerFilesIpc(): void {
  ipcMain.handle(IPC.probe, async (_evt, payload: { paths: string[] }): Promise<ImageFileMeta[]> => {
    const raw = Array.isArray(payload?.paths) ? payload.paths : []
    return probePaths(raw)
  })
}
