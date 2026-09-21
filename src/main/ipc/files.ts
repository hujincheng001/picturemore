import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc'
import type { ProbeResponse } from '../../shared/types'
import { probePaths } from '../files'

/**
 * `files:probe` 的 IPC 注册。
 *
 * 逻辑本体在 `src/main/files.ts`（不依赖 electron，可脱离 Electron 单测），
 * 这里只做转发。
 */
export function registerFilesIpc(): void {
  ipcMain.handle(
    IPC.probe,
    async (_evt, payload: { paths: string[]; limit?: number }): Promise<ProbeResponse> => {
      const raw = Array.isArray(payload?.paths) ? payload.paths : []
      return probePaths(raw, payload?.limit)
    }
  )
}
