import { BrowserWindow, dialog, ipcMain } from 'electron'
import { IPC } from '../../shared/ipc'

/**
 * 两个跟系统对话框打交道的通道。
 *
 * 全部走主进程：渲染进程不碰文件系统（红线三）。
 *
 * 原来还有一个 `dialog:revealInFolder`（在文件夹里定位新文件）。它在 SPEC §6.1
 * 的通道表里，但原型与 DESIGN.md 都没有对应控件、渲染层一次也没调过 ——
 * 一个没人调的通道纯粹是暴露给渲染层的多余系统能力，已按用户决定删掉。
 * 见 docs/decisions.md 的 T20-2。
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
}
