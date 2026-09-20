import { app, BrowserWindow } from 'electron'
import { createMainWindow } from './window'
import { applySecurityPolicies } from './security'
import { configureImageRuntime } from './image'

// 单实例：第二次启动只把已有窗口拉到前面，不开新窗口
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows()
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.whenReady().then(() => {
    // 关掉 sharp 内部缓存（SPEC §14），必须在处理任何一张图之前调用
    configureImageRuntime()
    applySecurityPolicies()
    createMainWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
