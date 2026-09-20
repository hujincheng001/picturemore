/**
 * 骨架冒烟测试：验证 contextIsolation 与 nodeIntegration 的真实生效情况。
 *
 * 为什么需要它：`contextIsolation: true` / `nodeIntegration: false` 是本项目的红线
 * （AGENTS.md「三条绝对不能破的线」第 3 条），但它们是"配置对了才安全"的东西，
 * 光看代码看不出来有没有被别处覆盖。这里启动真实主进程，用 CDP 到渲染进程里
 * 实际取一遍值，确认 Node 能力确实没有泄漏。
 *
 * 前置：先跑 `npx electron-vite build`（脚本会自己检查 out/main/index.js 是否存在）。
 *
 * 用法：npm run smoke
 */

import { spawn } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { get } from 'node:http'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'

const require = createRequire(import.meta.url)
const PORT = 9333
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MAIN = resolve(ROOT, 'out/main/index.js')
const RENDERER = resolve(ROOT, 'out/renderer/index.html')

if (!existsSync(MAIN) || !existsSync(RENDERER)) {
  console.error(`[smoke] 找不到构建产物，先跑 npx electron-vite build`)
  process.exit(1)
}

/** electron 包导出的是可执行文件路径，不是 API */
const electronBin = require('electron')

/** 期望在渲染进程里成立的事实。key 是人类可读的断言名。 */
const PROBES = {
  'window.require 不存在': `typeof window.require`,
  'window.process 不存在': `typeof window.process`,
  'window.module 不存在': `typeof window.module`,
  'window.Buffer 不存在': `typeof window.Buffer`,
  'window.global 不存在': `typeof window.global`,
  'window.pictureMore 已挂载': `typeof window.pictureMore`
}

/** 期望值：前五项必须是 undefined，pictureMore 必须是 object */
const EXPECTED = {
  'window.require 不存在': 'undefined',
  'window.process 不存在': 'undefined',
  'window.module 不存在': 'undefined',
  'window.Buffer 不存在': 'undefined',
  'window.global 不存在': 'undefined',
  'window.pictureMore 已挂载': 'object'
}

/** 白名单里的方法必须都存在。渲染层只能通过这些具名方法拿能力 */
const API_METHODS = [
  'probe',
  'pickImages',
  'pickOutputDir',
  'revealInFolder',
  'start',
  'cancel',
  'getSettings',
  'setSettings',
  'getDroppedPaths',
  'onProgress',
  'onDone'
]

/** 渲染层不该拿到的东西。ipcRenderer 泄漏等于白名单形同虚设 */
const FORBIDDEN_ON_API = ['ipcRenderer', 'require', 'send', 'invoke', 'on', 'once']

/**
 * 构造子进程环境。
 *
 * 必须清掉两个变量，否则 Electron 会以 Node 模式启动（ELECTRON_RUN_AS_NODE=1 时
 * electron.exe 就是普通的 node，`require('electron')` 会命中项目里的 node_modules/electron
 * npm 包并返回一个 exe 路径字符串，主进程随即报 `electron.app is undefined`）。
 *
 * - NODE_OPTIONS：本机开发环境的 shell 被注入了 `--require` 预载 shim，子进程会继承。
 * - ELECTRON_RUN_AS_NODE：同一个环境在 spawn 子进程时注入的。
 *
 * 两者都是宿主环境的产物，与产品代码无关。清掉之后才是真实的运行条件。
 */
function childEnv() {
  const env = { ...process.env, NODE_ENV: 'production' }
  delete env['NODE_OPTIONS']
  delete env['ELECTRON_RUN_AS_NODE']
  return env
}

/**
 * 入口用 `electron .`（走 package.json 的 main），而不是 `electron out/main/index.js`。
 *
 * 这不是风格问题。传脚本文件路径会让 Electron 进 default-app 模式，那种模式下
 * 主脚本里 `require('electron')` 会先命中项目自己的 node_modules/electron（npm 包，
 * 导出的是一个 exe 路径字符串），拿不到 Electron API，报 `electron.app is undefined`。
 * 走 `electron .` 和 electron-vite dev / 打包后的产物保持同一条入口，行为一致。
 */
const child = spawn(electronBin, ['.', `--remote-debugging-port=${PORT}`], {
  cwd: ROOT,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: childEnv()
})

const stderrChunks = []
child.stderr.on('data', (d) => stderrChunks.push(d.toString()))
child.stdout.on('data', (d) => stderrChunks.push(d.toString()))

/**
 * 用 node:http 而不是 fetch 取 CDP 端点列表。
 *
 * fetch 走 undici 的全局连接池，会留下 keep-alive 的 socket 挂住事件循环，
 * 逼得脚本只能在末尾 process.exit() 强杀进程 —— 那正是 Windows 上 libuv
 * 断言和"断言全通过但退出码非 0"的来源。http.get 默认不开 keepAlive，
 * 事件循环能自然排空。
 */
function getJson(url) {
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

/** 等 CDP 端点起来并拿到渲染页的 websocket 地址 */
async function findPageTarget(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Electron 提前退出，退出码 ${child.exitCode}\n${stderrChunks.join('')}`)
    }
    try {
      const targets = await getJson(`http://127.0.0.1:${PORT}/json/list`)
      const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (page) return page
    } catch {
      // 端口还没起来，继续等
    }
    await sleep(300)
  }
  throw new Error(`等 ${timeoutMs}ms 仍没有可调试的渲染页\n${stderrChunks.join('')}`)
}

/** 极简 CDP 客户端：够用即可，不引第三方库 */
function connect(wsUrl) {
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

async function main() {
  const target = await findPageTarget()
  const cdp = await connect(target.webSocketDebuggerUrl)
  await cdp.send('Runtime.enable')

  const failures = []
  const evaluate = async (expression) => {
    const { result } = await cdp.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    })
    if (result.subtype === 'error') throw new Error(result.description)
    return result.value
  }

  // ---- 1. 进程隔离：Node 能力不能泄漏到渲染层 ----
  const isoExpr = `(() => {
    const out = {}
    ${Object.entries(PROBES).map(([label, expr]) => `out[${JSON.stringify(label)}] = ${expr}`).join('\n    ')}
    return out
  })()`
  const actual = await evaluate(isoExpr)

  console.log('\n[smoke] 渲染进程隔离检查：')
  for (const label of Object.keys(PROBES)) {
    const got = actual[label]
    const want = EXPECTED[label]
    const ok = got === want
    if (!ok) failures.push(`${label}：期望 ${want}，实际 ${got}`)
    console.log(`  ${ok ? '通过' : '失败'}  ${label} = ${got}`)
  }

  // ---- 2. 白名单形状：该有的都有，不该有的都没有 ----
  const shape = await evaluate(`(() => {
    const api = window.pictureMore || {}
    const present = ${JSON.stringify(API_METHODS)}.filter((k) => typeof api[k] === 'function')
    const leaked = ${JSON.stringify(FORBIDDEN_ON_API)}.filter((k) => k in api)
    return { present, leaked, keys: Object.keys(api) }
  })()`)

  console.log('\n[smoke] 白名单检查：')
  const missing = API_METHODS.filter((m) => !shape.present.includes(m))
  if (missing.length > 0) failures.push(`window.pictureMore 缺少方法：${missing.join(', ')}`)
  console.log(`  ${missing.length === 0 ? '通过' : '失败'}  方法齐全（${shape.present.length}/${API_METHODS.length}）`)
  if (shape.leaked.length > 0) failures.push(`window.pictureMore 泄漏了：${shape.leaked.join(', ')}`)
  console.log(`  ${shape.leaked.length === 0 ? '通过' : '失败'}  未泄漏 ipcRenderer / require（暴露的键：${shape.keys.join(', ')}）`)

  // ---- 3. webUtils 在沙箱 preload 里到底能不能用（SPEC §6.1 的 M1 验证项）----
  // 拿一个非磁盘来源的 File 去调，只为确认调用链通。返回空数组是正常的，
  // 抛异常才是问题（说明 webUtils 拿不到）。
  const webUtils = await evaluate(`(() => {
    try {
      const r = window.pictureMore.getDroppedPaths([new File(['x'], 'a.jpg')])
      return { ok: true, isArray: Array.isArray(r), length: r.length }
    } catch (e) {
      return { ok: false, message: String(e && e.message || e) }
    }
  })()`)

  console.log('\n[smoke] webUtils 可用性（SPEC §6.1 M1 验证项）：')
  if (webUtils.ok && webUtils.isArray) {
    console.log(`  通过  getDroppedPaths 可调用，返回数组（合成 File 拿到 ${webUtils.length} 个路径，预期 0）`)
  } else {
    failures.push(`webUtils 在沙箱 preload 里不可用：${webUtils.message}`)
    console.log(`  失败  ${webUtils.message}`)
  }

  // ---- 4. IPC 往返：设置读得出来，说明 handle/invoke 通了 ----
  const settings = await evaluate(`(async () => {
    try {
      const s = await window.pictureMore.getSettings()
      return { ok: true, settings: s }
    } catch (e) {
      return { ok: false, message: String(e && e.message || e) }
    }
  })()`)

  console.log('\n[smoke] IPC 往返（settings:get）：')
  if (settings.ok) {
    console.log(`  通过  ${JSON.stringify(settings.settings)}`)
  } else {
    failures.push(`settings:get 失败：${settings.message}`)
    console.log(`  失败  ${settings.message}`)
  }

  // ---- 5. 设计 token 是否真的落到了计算样式上 ----
  // 量的是 App.tsx 里 #token-probe 那几个元素的真实计算值。
  // 只检查 CSS 变量有没有定义是不够的：变量定义了但 Tailwind 没生成工具类，
  // 类名挂在元素上一样没有任何效果。
  const tokenExpr = `(() => {
    const read = (id, props) => {
      const el = document.getElementById(id)
      if (!el) return null
      const cs = getComputedStyle(el)
      const out = {}
      for (const p of props) out[p] = cs[p]
      return out
    }
    return {
      bone: read('probe-bone', ['backgroundColor', 'color', 'borderRadius']),
      surface: read('probe-surface', ['backgroundColor', 'color', 'borderRadius']),
      caution: read('probe-caution', ['color', 'borderRadius']),
      type: read('probe-type', ['fontSize', 'fontFamily']),
      strong: read('probe-strong', ['borderTopColor', 'borderTopWidth']),
      hover: read('probe-hover', ['backgroundColor', 'color'])
    }
  })()`
  const tokens = await evaluate(tokenExpr)

  /** 期望的计算值。色值写成 rgb() 形式，那是 getComputedStyle 的返回格式 */
  const TOKEN_EXPECT = {
    bone: { backgroundColor: 'rgb(239, 237, 232)', color: 'rgb(107, 105, 99)', borderRadius: '6px' },
    surface: { backgroundColor: 'rgb(255, 255, 255)', color: 'rgb(20, 20, 20)', borderRadius: '12px' },
    caution: { color: 'rgb(138, 91, 0)', borderRadius: '4px' },
    type: { fontSize: '36px' },
    strong: { borderTopColor: 'rgb(216, 212, 204)', borderTopWidth: '1px' },
    hover: { backgroundColor: 'rgb(233, 230, 224)', color: 'rgb(58, 56, 53)' }
  }

  console.log('\n[smoke] 设计 token 检查：')
  for (const [key, want] of Object.entries(TOKEN_EXPECT)) {
    const got = tokens[key]
    if (got === null) {
      failures.push(`#probe-${key} 不存在，App.tsx 的 token 探针被删了？`)
      console.log(`  失败  #probe-${key} 不存在`)
      continue
    }
    for (const [prop, expected] of Object.entries(want)) {
      let actual = got[prop]
      // fontFamily 是候选列表，只要求首选字族在里面
      if (prop === 'fontFamily') actual = actual.split(',')[0].replace(/["']/g, '').trim()
      const ok = prop === 'fontFamily' ? actual === 'Cascadia Mono' : actual === expected
      if (!ok) failures.push(`#probe-${key} 的 ${prop}：期望 ${expected}，实际 ${actual}`)
      console.log(`  ${ok ? '通过' : '失败'}  ${key}.${prop} = ${actual}`)
    }
  }

  // ---- 6. 左栏布局是否与原型对齐 ----
  // 原型是唯一视觉基准，但「肉眼无差异」这种标准没法自动守。
  // 这里量的是能从原型 CSS 里逐条读出来的硬指标（尺寸、间距、字号、圆角），
  // 它们一旦被改就会和 prototype/index.html 对不上。
  const layoutExpr = `(() => {
    const px = (el, p) => el ? getComputedStyle(el)[p] : null
    const pane = document.querySelector('aside[aria-label="压缩设置"]')
    const header = document.querySelector('header')
    const win = document.querySelector('#root > div')
    const value = document.querySelector('output')
    const radio = document.querySelector('[role="radio"]')
    const picker = document.querySelector('[aria-label="更改图片存放位置"]')
    const cta = pane ? pane.lastElementChild.querySelector('button') : null
    return {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      windowWidth: px(win, 'width'),
      windowHeight: px(win, 'height'),
      windowRadius: px(win, 'borderRadius'),
      headerHeight: px(header, 'height'),
      headerPadX: px(header, 'paddingLeft'),
      paneWidth: px(pane, 'width'),
      panePadTop: px(pane, 'paddingTop'),
      panePadX: px(pane, 'paddingLeft'),
      paneGap: px(pane, 'rowGap'),
      paneBorderRight: px(pane, 'borderRightWidth'),
      valueFontSize: px(value, 'fontSize'),
      valueText: value ? value.textContent : null,
      radioHeight: px(radio, 'height'),
      radioRadius: px(radio, 'borderRadius'),
      // 未选中的那个格式选项（第一个是选中态，颜色本来就不同）
      radioBorderWidth: (() => {
        const el = document.querySelector('[role="radio"][aria-checked="false"]')
        return el ? getComputedStyle(el).borderTopWidth : null
      })(),
      radioBorderColor: (() => {
        const el = document.querySelector('[role="radio"][aria-checked="false"]')
        return el ? getComputedStyle(el).borderTopColor : null
      })(),
      radioColor: (() => {
        const el = document.querySelector('[role="radio"][aria-checked="false"]')
        return el ? getComputedStyle(el).color : null
      })(),
      radioCount: document.querySelectorAll('[role="radio"]').length,
      radioCheckedBorder: (() => {
        const el = document.querySelector('[role="radio"][aria-checked="true"]')
        return el ? getComputedStyle(el).borderTopColor : null
      })(),
      radioCheckedBg: (() => {
        const el = document.querySelector('[role="radio"][aria-checked="true"]')
        return el ? getComputedStyle(el).backgroundColor : null
      })(),
      pickerHeight: px(picker, 'height'),
      ctaHeight: px(cta, 'height'),
      ctaText: cta ? cta.textContent : null
    }
  })()`
  const layout = await evaluate(layoutExpr)

  /**
   * 每一项都直接对应 prototype/index.html 里的一行 CSS。
   *
   * 窗口尺寸不写死：视口大小取决于操作系统的窗口边框与显示缩放，换台机器就变了。
   * 断言的是原型 CSS 里那条规则本身 —— `min(980px,100%)` 与 `min(768px,calc(100vh - 96px))`，
   * 而 body 有 32px 内边距。
   */
  const LAYOUT_EXPECT = {
    windowWidth: `${Math.min(980, layout.viewportWidth - 64)}px`,
    windowHeight: `${Math.min(768, layout.viewportHeight - 96)}px`,
    windowRadius: '12px',
    headerHeight: '64px',
    headerPadX: '32px',
    paneWidth: '328px',
    panePadTop: '28px',
    panePadX: '32px',
    paneGap: '26px',
    paneBorderRight: '1px',
    valueFontSize: '36px',
    valueText: '65%',
    radioHeight: '32px',
    radioRadius: '6px',
    // 未选中：1px 发丝线 #D8D4CC + 三级灰字 #6B6963
    radioBorderWidth: '1px',
    radioBorderColor: 'rgb(216, 212, 204)',
    radioColor: 'rgb(107, 105, 99)',
    // 选中：边框转主字色 + 骨白底 #FBFAF8
    radioCheckedBorder: 'rgb(20, 20, 20)',
    radioCheckedBg: 'rgb(251, 250, 248)',
    pickerHeight: '40px',
    ctaHeight: '48px',
    ctaText: '压缩这 11 张'
  }

  console.log('\n[smoke] 左栏布局检查（对照 prototype/index.html）：')
  console.log(`  视口 ${layout.viewportWidth}x${layout.viewportHeight}`)
  for (const [key, want] of Object.entries(LAYOUT_EXPECT)) {
    const got = layout[key]
    // 数字与字符串混着写，统一转成字符串比
    const ok = String(got) === String(want)
    if (!ok) failures.push(`左栏 ${key}：期望 ${want}，实际 ${got}`)
    console.log(`  ${ok ? '通过' : '失败'}  ${key} = ${got}`)
  }
  // 四个格式选项：保持原格式 / JPG / PNG / WebP
  const radioOk = layout.radioCount === 4
  if (!radioOk) failures.push(`格式选项数量：期望 4，实际 ${layout.radioCount}`)
  console.log(`  ${radioOk ? '通过' : '失败'}  radioCount = ${layout.radioCount}`)

  // ---- 7. 页面确实加载了构建产物 ----
  const title = await evaluate(
    `({ title: document.title, url: location.href, hasRoot: !!document.getElementById('root') })`
  )
  console.log(`\n[smoke] 页面状态：title="${title.title}" url="${title.url}" #root=${title.hasRoot}`)
  if (!title.hasRoot) failures.push('渲染进程没有 #root 挂载点，index.html 可能没加载')

  // ---- 7. 截图，供和原型并排比对 ----
  // AGENTS.md 的标准是「肉眼能看出差异就是没做完」，硬指标（尺寸/间距/字号）覆盖不到
  // 对齐、错位、配色这类问题。这里把应用和原型按同一个视口各截一张，
  // 落到 tests/fixtures/_shot-*.png（下划线前缀，已在 .gitignore 里）。
  const shotDir = resolve(ROOT, 'tests/fixtures')
  try {
    const shots = await captureScreenshots(cdp, target, PORT)
    console.log('\n[smoke] 截图：')
    for (const [name, file] of Object.entries(shots)) {
      console.log(`  已写出  ${name} → ${file}`)
    }
  } catch (e) {
    // 截图失败不算验收失败，它是给人看的辅助产物
    console.log(`\n[smoke] 截图跳过：${e.message}`)
  }

  cdp.close()

  if (failures.length > 0) {
    console.error(`\n[smoke] 失败 ${failures.length} 项：`)
    for (const f of failures) console.error(`  - ${f}`)
    return 1
  }
  console.log('\n[smoke] 全部通过')
  return 0
}

/** 截图用的统一视口。原型和应用用同一个尺寸才谈得上并排比对 */
const SHOT_VIEWPORT = { width: 980, height: 768 }

async function shootPage(cdp, file) {
  await cdp.send('Page.enable')
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    ...SHOT_VIEWPORT,
    deviceScaleFactor: 1,
    mobile: false
  })
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(file, Buffer.from(data, 'base64'))
}

/**
 * 截两张：应用当前页，以及原型页面。
 *
 * 原型的截图靠把同一页导航过去再截 —— Electron 的调试端点不支持
 * `Target.createTarget`（浏览器级端点会返回 "Not supported"），
 * 而为了截一张图去开第二个 BrowserWindow 又太侵入。反正这时候应用的检查已经跑完了。
 */
async function captureScreenshots(cdp, appTarget, port) {
  const dir = resolve(ROOT, 'tests/fixtures')
  const appShot = resolve(dir, '_shot-app.png')
  const protoShot = resolve(dir, '_shot-prototype.png')

  await shootPage(cdp, appShot)

  const protoUrl = pathToFileURL(resolve(ROOT, 'prototype/index.html')).href
  await cdp.send('Page.navigate', { url: protoUrl })

  // 等原型页面加载完
  for (let i = 0; i < 40; i++) {
    const { result } = await cdp.send('Runtime.evaluate', {
      expression: `document.readyState === 'complete' && document.querySelector('.window') !== null`,
      returnByValue: true
    })
    if (result.value === true) break
    await sleep(150)
  }
  await sleep(300)

  await shootPage(cdp, protoShot)

  return { '应用': appShot, '原型': protoShot }
}

let code = 1
try {
  code = await main()
} catch (e) {
  console.error(`[smoke] 异常：${e.message}`)
} finally {
  await shutdown()
}

/**
 * 收尾：等 Electron 真的退出，再用 process.exitCode 而不是 process.exit()。
 *
 * 为什么不能 `child.kill()` 之后立刻 `process.exit()`：Windows 上 libuv 会在退出时
 * 断言 `!(handle->flags & UV_HANDLE_CLOSING)`（src\win\async.c:76）——子进程句柄
 * 还在关闭过程中，事件循环就被掐断了。表现是 stderr 刷一行 Assertion failed、
 * 退出码非 0，哪怕所有断言都通过了。等 close 事件 + 让循环自然排空即可。
 */
async function shutdown() {
  if (child.exitCode === null) {
    const closed = new Promise((resolve) => child.once('close', resolve))
    child.kill()
    const raced = await Promise.race([closed, sleep(3000).then(() => 'timeout')])
    if (raced === 'timeout') {
      child.kill('SIGKILL')
      await closed
    }
  }
  process.exitCode = code
  // 兜底：万一还有别的东西挂住事件循环，8 秒后强制退出。unref 保证正常情况下不生效。
  setTimeout(() => process.exit(code), 8000).unref()
}
