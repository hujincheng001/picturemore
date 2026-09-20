import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { IPC } from '../../shared/ipc'

/**
 * 三个跟系统对话框 / 文件管理器打交道的通道。
 *
 * 全部走主进程：渲染进程不碰文件系统，也不该直接调 shell（红线三）。
 */

/** 拖拽区承诺支持的格式，取自 SPEC §8.4「HEIC、JPG、PNG、WebP」 */
const IMAGE_EXTENSIONS = ['heic', 'heif', 'jpg', 'jpeg', 'png', 'webp']
const FILTER_NAME = 'HEIC、JPG、PNG、WebP'

export function registerDialogIpc(): void {
  ipcMain.handle(IPC.pickImages, async (evt): Promise<{ paths: string[] } | null> => {
    const win = BrowserWindow.fromWebContents(evt.sender)
    const opts: Electron.OpenDialogOptions = {
      title: FILTER_NAME,
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: FILTER_NAME, extensions: IMAGE_EXTENSIONS }]
    }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (r.canceled || r.filePaths.length === 0) return null
    return { paths: r.filePaths }
  })

  ipcMain.handle(IPC.pickOutputDir, async (evt): Promise<{ dir: string } | null> => {
    const win = BrowserWindow.fromWebContents(evt.sender)
    const opts: Electron.OpenDialogOptions = {
      properties: ['openDirectory', 'createDirectory']
    }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (r.canceled || r.filePaths.length === 0) return null
    const dir = r.filePaths[0]
    return dir === undefined ? null : { dir }
  })

  ipcMain.handle(IPC.revealInFolder, async (_evt, payload: { path: string }): Promise<void> => {
    const p = payload?.path
    if (typeof p !== 'string' || p.length === 0) return
    // showItemInFolder 是同步的，且失败时不抛错（路径不存在就静默）
    shell.showItemInFolder(p)
  })
}
