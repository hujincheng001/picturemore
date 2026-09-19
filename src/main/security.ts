import { app, session } from 'electron'

/**
 * 承诺一：图片内容永不离开用户机器，运行时零网络请求。
 *
 * 这里在会话层拦掉一切非本地请求。它是最后一道闸，前面还有
 * 依赖白名单与 CSP。三层都拦，是因为任何一层单独失效都不该让数据出网。
 */
export function applySecurityPolicies(): void {
  // dev 模式下 electron-vite 从 http://localhost:xxxx 提供渲染层，
  // 必须放行，否则 npm run dev 直接白屏。打包后这个变量不存在。
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  const devWsUrl = devUrl === undefined ? null : devUrl.replace(/^http/, 'ws')

  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const url = details.url
    const allowed =
      url.startsWith('file://') ||
      url.startsWith('devtools://') ||
      url.startsWith('blob:') ||
      url.startsWith('data:') ||
      (devUrl !== undefined && (url.startsWith(devUrl) || (devWsUrl !== null && url.startsWith(devWsUrl))))

    if (!allowed) console.warn('[blocked]', url)
    callback({ cancel: !allowed })
  })

  // 生产环境的 CSP 通过响应头注入（SPEC.md §6.3）。
  // dev 不注入，否则 Vite 的 HMR 会被 connect-src 'none' 拦掉。
  if (app.isPackaged) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            [
              "default-src 'self'",
              "script-src 'self'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob:",
              "connect-src 'none'",
              "font-src 'self'"
            ].join('; ')
          ]
        }
      })
    })
  }
}
