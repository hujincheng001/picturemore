import { BrowserWindow } from 'electron'
import { join } from 'node:path'

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 980,
    height: 768,
    minWidth: 880,
    minHeight: 620,
    backgroundColor: '#EFEDE8',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // 两条红线，永远不动（SPEC.md §0.3）
      contextIsolation: true,
      nodeIntegration: false
      // sandbox 保持默认 true。Task 9 会实测 webUtils 是否可用，
      // 不可用才显式设 false，两条红线不受影响。
    }
  })

  win.once('ready-to-show', () => win.show())

  // 本产品没有任何外部链接，一律不开新窗口
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  // 也不允许主窗口自己导航走
  win.webContents.on('will-navigate', (event) => event.preventDefault())

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl !== undefined) {
    void win.loadURL(devUrl)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}
