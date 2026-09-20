import { registerDialogIpc } from './dialog'
import { registerFilesIpc } from './files'
import { registerSettingsIpc } from './settings'
import { registerTaskIpc } from './task'

/**
 * 一次性注册全部 IPC 处理器。由 `src/main/index.ts` 在 `whenReady` 里调用一次。
 *
 * 重复注册同名通道会让 Electron 抛错，所以这个函数只应该被调用一次。
 */
export function registerIpc(): void {
  registerFilesIpc()
  registerDialogIpc()
  registerSettingsIpc()
  registerTaskIpc()
}
