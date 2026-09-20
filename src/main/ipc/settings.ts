import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc'
import type { Settings } from '../../shared/types'
import { readSettings, writeSettings } from '../settings'

/**
 * 设置的读写。存储实现在 `src/main/settings.ts`（手写 JSON，不引 electron-store）。
 */

export function registerSettingsIpc(): void {
  ipcMain.handle(IPC.settingsGet, (): Settings => readSettings())

  ipcMain.handle(IPC.settingsSet, (_evt, patch: Partial<Settings>): Settings => {
    // 逐字段校验在 writeSettings 里做，这里不信任渲染层传来的形状
    const safe: Partial<Settings> = {}
    if (patch !== null && typeof patch === 'object') {
      if ('outputDir' in patch) safe.outputDir = patch.outputDir ?? null
      if ('shrinkPercent' in patch) safe.shrinkPercent = patch.shrinkPercent
      if ('outputFormat' in patch) safe.outputFormat = patch.outputFormat
      if ('lastDir' in patch) safe.lastDir = patch.lastDir ?? null
    }
    return writeSettings(safe)
  })
}
