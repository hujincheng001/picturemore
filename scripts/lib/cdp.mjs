/**
 * 极简 CDP 客户端。冒烟脚本用，不引第三方库。
 *
 * 两个脚本共用（`smoke-context-isolation.mjs` 与 `smoke-packaged.mjs`），
 * 所以抽到这里，避免两份实现慢慢漂移。
 */

import { get } from 'node:http'
import { setTimeout as sleep } from 'node:timers/promises'

/**
 * 用 node:http 而不是 fetch 取 CDP 端点列表。
 *
 * fetch 走 undici 的全局连接池，会留下 keep-alive 的 socket 挂住事件循环，
 * 逼得脚本只能在末尾 process.exit() 强杀进程 —— 那正是 Windows 上 libuv
 * 断言和「断言全通过但退出码非 0」的来源。http.get 默认不开 keepAlive，
 * 事件循环能自然排空。
 */
export function getJson(url) {
  return new Promise((resolve, reject) => {
    const req = get(url, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (c) => (body += c))
      res.on('end', () => {
        try {
          resolve(JSON.parse(body))
        } catch (e) {
          reject(e)
        }
      })
    })
    req.on('error', reject)
    req.setTimeout(2000, () => req.destroy(new Error('timeout')))
  })
}

/** 连上某个 target 的 websocket，返回一个够用的 send() */
export function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    let nextId = 1
    const pending = new Map()

    ws.addEventListener('open', () => {
      resolve({
        send(method, params = {}) {
          const id = nextId++
          return new Promise((res, rej) => {
            pending.set(id, { res, rej })
            ws.send(JSON.stringify({ id, method, params }))
          })
        },
        close: () => ws.close()
      })
    })
    ws.addEventListener('error', reject)
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data)
      const entry = pending.get(msg.id)
      if (!entry) return
      pending.delete(msg.id)
      if (msg.error) entry.rej(new Error(msg.error.message))
      else entry.res(msg.result)
    })
  })
}

/**
 * 等调试端点起来并拿到渲染页的 websocket 地址。
 *
 * `onTick` 每轮调一次，调用方可以用它检查子进程有没有提前退出。
 */
export async function waitForPage(port, { timeoutMs = 30_000, onTick } = {}) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (onTick !== undefined) onTick()
    try {
      const targets = await getJson(`http://127.0.0.1:${port}/json/list`)
      const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (page) return page
    } catch {
      // 端口还没起来，继续等
    }
    await sleep(300)
  }
  throw new Error(`等 ${timeoutMs}ms 仍没有可调试的渲染页`)
}

/** 在页面里求值。`awaitPromise` 默认开，好直接等异步逻辑 */
export async function evaluate(cdp, expression, { awaitPromise = true } = {}) {
  const { result } = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise
  })
  if (result.subtype === 'error') throw new Error(result.description)
  return result.value
}

export { sleep }
