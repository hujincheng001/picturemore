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
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { basename, dirname, extname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'
import sharp from 'sharp'
import { connect, evaluate as cdpEvaluate, getJson, waitForPage } from './lib/cdp.mjs'

const require = createRequire(import.meta.url)
const PORT = 9333
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MAIN = resolve(ROOT, 'out/main/index.js')
const RENDERER = resolve(ROOT, 'out/renderer/index.html')

if (!existsSync(MAIN) || !existsSync(RENDERER)) {
  console.error(`[smoke] 找不到构建产物，先跑 npx electron-vite build`)
  process.exit(1)
}

/**
 * 开跑前把状态清干净，让每次都是「全新安装」。
 *
 * 不清会踩两个坑，都是同一类毛病 —— **断言依赖了上一轮留下的状态**：
 * 1. `tests/fixtures/processed` 里积下 `x (2).jpg`、`x (3).jpg`，产物校验只能靠排序猜
 * 2. `%APPDATA%\picturemore\settings.json` 里存着上一轮的存放位置，
 *    于是批次会写到那个目录去，而不是默认的 `<第一张图目录>/processed`
 *
 * 清设置文件等于模拟首次启动，这正是验收测试该有的起点。
 * 应用名来自 package.json 的 `name`（不是 productName），所以路径是 picturemore。
 */
const APP_SETTINGS = resolve(process.env['APPDATA'] ?? '', 'picturemore', 'settings.json')

rmSync(resolve(ROOT, 'tests/fixtures/processed'), { recursive: true, force: true })
rmSync(resolve(ROOT, 'tests/fixtures/_samedir'), { recursive: true, force: true })
rmSync(resolve(ROOT, 'tests/fixtures/_dropcase'), { recursive: true, force: true })
rmSync(APP_SETTINGS, { force: true })

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

async function main() {
  const failures = []

  const target = await waitForPage(PORT, {
    onTick: () => {
      if (child.exitCode !== null) {
        throw new Error(`Electron 提前退出，退出码 ${child.exitCode}\n${stderrChunks.join('')}`)
      }
    }
  })
  const cdp = await connect(target.webSocketDebuggerUrl)
  await cdp.send('Runtime.enable')

  const evaluate = (expression) => cdpEvaluate(cdp, expression)

  /*
   * 等 React 真正挂载完再开始检查。
   *
   * `waitForPage` 只保证「有一个可调试的页面」，那时 index.html 可能刚解析完、
   * React 还没渲染。不等的话前面的检查会量到空 DOM —— 而且**不会报错**，
   * 只会报出一堆「元素不存在」，看起来像应用坏了。
   *
   * 这个竞态之前一直存在，只是恰好没触发；加了虚拟化之后主进程产物变大，
   * 启动慢了一点就露出来了。属于「迟早会红一次然后被当 flaky」的那类问题。
   */
  let mounted = false
  for (let i = 0; i < 80; i++) {
    mounted = await evaluate(
      `(document.getElementById('root')?.childElementCount ?? 0) > 0`
    )
    if (mounted === true) break
    await sleep(150)
  }
  if (!mounted) {
    console.error('[smoke] 等 12s 后渲染层仍未挂载')
    return 1
  }

  // ---- 0. 全程监听网络请求（承诺一：运行时零联网）----
  // 比「拔网线」更严格：拔网线只能证明断网时能用，这里能证明**根本没有发出请求**。
  // 必须在任何交互之前打开，否则会漏掉早期的请求。
  const requests = []
  await cdp.send('Network.enable')
  cdp.on('Network.requestWillBeSent', (p) => {
    requests.push(p.request?.url ?? '(unknown)')
  })

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

  // ---- 6. 空态（应用启动时的初始状态）----
  // 应用启动时列表是空的，所以这里量的是真实的初始态，不是模拟出来的。
  // DESIGN.md §4：主体退化为单栏，左栏整个隐藏，拖拽区吃掉整个右侧。
  const emptyState = await evaluate(`(() => {
    const pane = document.querySelector('aside[aria-label="压缩设置"]')
    const main = document.querySelector('main[aria-label="图片列表"]')
    const drop = main ? main.firstElementChild : null
    const cs = drop ? getComputedStyle(drop) : null
    return {
      paneGone: pane === null,
      dropText: drop ? drop.textContent : null,
      dropFlexDir: cs ? cs.flexDirection : null,
      dropFlexGrow: cs ? cs.flexGrow : null,
      dropFontSize: cs ? cs.fontSize : null,
      mainPadding: main ? getComputedStyle(main).padding : null,
      fileCount: document.querySelectorAll('main li').length,
      metaGone: main ? main.children.length === 1 : false
    }
  })()`)

  console.log('\n[smoke] 空态检查（应用初始状态）：')
  const EMPTY_EXPECT = {
    paneGone: true,
    dropText: '把图片拖到这里选择文件HEIC、JPG、PNG、WebP。一张也行，几十张也行',
    dropFlexDir: 'column',
    dropFlexGrow: '1',
    dropFontSize: '20px',
    mainPadding: '32px',
    fileCount: 0,
    metaGone: true
  }
  checkMap(EMPTY_EXPECT, emptyState, '空态', failures)

  // ---- 7. 截图：空态 ----
  const SHOT_DIR = resolve(ROOT, 'tests/fixtures')
  try {
    const emptyShot = resolve(SHOT_DIR, '_shot-app-empty.png')
    await shootPage(cdp, emptyShot)
    console.log(`\n[smoke] 截图：应用（空态） → ${emptyShot}`)
  } catch (e) {
    // 截图失败不算验收失败，它是给人看的辅助产物
    console.log(`\n[smoke] 截图跳过：${e.message}`)
  }

  // ---- 8. 真实拖拽入图 ----
  // 走 CDP 的拖拽事件，带上真实的文件路径。这条链路是完整的：
  // dataTransfer.files -> preload 的 webUtils.getPathForFile -> IPC probe -> store。
  // 用真实文件而不是构造 File 对象，是因为 webUtils 只认磁盘上的文件。
  const DROP_FILES = ['oriented-6.jpg', 'flat-solid.png', 'alpha-cutout.png'].map((f) =>
    resolve(ROOT, 'tests/fixtures', f)
  )

  console.log('\n[smoke] 拖拽入图：')
  try {
    for (const type of ['dragEnter', 'dragOver', 'drop']) {
      await cdp.send('Input.dispatchDragEvent', {
        type,
        x: 640,
        y: 300,
        data: { items: [], files: DROP_FILES, dragOperationsMask: 1 }
      })
    }
    // 等 probe 回来（要读盘 + 解容器）
    let listed = 0
    for (let i = 0; i < 60; i++) {
      listed = await evaluate(`document.querySelectorAll('main li').length`)
      if (listed === DROP_FILES.length) break
      await sleep(250)
    }
    const ok = listed === DROP_FILES.length
    if (!ok) failures.push(`拖拽后列表应有 ${DROP_FILES.length} 行，实际 ${listed} 行`)
    console.log(`  ${ok ? '通过' : '失败'}  拖入 ${DROP_FILES.length} 个文件，列表出现 ${listed} 行`)
  } catch (e) {
    failures.push(`拖拽失败：${e.message}`)
    console.log(`  失败  ${e.message}`)
  }

  // ---- 9. 布局是否与原型对齐 ----
  // 原型是唯一视觉基准，但「肉眼无差异」这种标准没法自动守。
  // 这里量的是能从原型 CSS 里逐条读出来的硬指标（尺寸、间距、字号、圆角、颜色），
  // 它们一旦被改就会和 prototype/index.html 对不上。
  const layoutExpr = `(() => {
    const px = (el, p) => el ? getComputedStyle(el)[p] : null
    const pane = document.querySelector('aside[aria-label="压缩设置"]')
    const header = document.querySelector('header')
    const win = document.querySelector('#root > div')
    const value = document.querySelector('output')
    const picker = document.querySelector('[aria-label="更改图片存放位置"]')
    const cta = pane ? pane.lastElementChild.querySelector('button') : null
    const main = document.querySelector('main[aria-label="图片列表"]')
    const drop = main ? main.firstElementChild : null
    const meta = main ? main.children[1] : null
    const unchecked = document.querySelector('[role="radio"][aria-checked="false"]')
    const checked = document.querySelector('[role="radio"][aria-checked="true"]')
    const row = document.querySelector('main li')
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
      /**
       * 百分数显示是否与滑块同步。
       *
       * 刻意**不**断言具体数值：缩小比例是持久化设置，打包版与开发版共用同一个
       * settings.json（都是 %APPDATA%\picturemore），别的脚本跑过之后这里就不是 65 了。
       * 要守的不变量是「显示跟着滑块走」，以及滑块自己的取值范围与原型一致。
       */
      valueMatchesSlider: (() => {
        const slider = document.querySelector('input[type="range"]')
        if (value === null || slider === null) return null
        return value.textContent === slider.value + '%'
      })(),
      sliderMin: (() => document.querySelector('input[type="range"]')?.getAttribute('min') ?? null)(),
      sliderMax: (() => document.querySelector('input[type="range"]')?.getAttribute('max') ?? null)(),
      sliderStep: (() => document.querySelector('input[type="range"]')?.getAttribute('step') ?? null)(),
      radioHeight: px(checked, 'height'),
      radioRadius: px(checked, 'borderRadius'),
      radioCount: document.querySelectorAll('[role="radio"]').length,
      radioBorderWidth: unchecked ? getComputedStyle(unchecked).borderTopWidth : null,
      radioBorderColor: unchecked ? getComputedStyle(unchecked).borderTopColor : null,
      radioColor: unchecked ? getComputedStyle(unchecked).color : null,
      radioCheckedBorder: checked ? getComputedStyle(checked).borderTopColor : null,
      radioCheckedBg: checked ? getComputedStyle(checked).backgroundColor : null,
      pickerHeight: px(picker, 'height'),
      ctaHeight: px(cta, 'height'),
      ctaText: cta ? cta.textContent : null,

      listPanePadTop: px(main, 'paddingTop'),
      listPanePadX: px(main, 'paddingLeft'),
      dropHeight: px(drop, 'height'),
      dropBorderStyle: drop ? getComputedStyle(drop).borderTopStyle : null,
      dropBorderRadius: drop ? getComputedStyle(drop).borderTopLeftRadius : null,
      dropText: drop ? drop.textContent : null,
      metaText: meta ? meta.firstElementChild.textContent : null,
      metaPadBottom: px(meta, 'paddingBottom'),
      fileHeight: px(row, 'height'),
      fileCount: document.querySelectorAll('main li').length,
      fileFirstName: row ? row.firstElementChild.textContent : null,
      removeOpacity: px(document.querySelector('main li button'), 'opacity'),
      removeText: (() => {
        const el = document.querySelector('main li button')
        return el ? el.textContent : null
      })()
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
    valueMatchesSlider: true,
    sliderMin: '20',
    sliderMax: '90',
    sliderStep: '5',
    radioHeight: '32px',
    radioRadius: '6px',
    radioCount: 4,
    // 未选中：1px 发丝线 #D8D4CC + 三级灰字 #6B6963
    radioBorderWidth: '1px',
    radioBorderColor: 'rgb(216, 212, 204)',
    radioColor: 'rgb(107, 105, 99)',
    // 选中：边框转主字色 + 骨白底 #FBFAF8
    radioCheckedBorder: 'rgb(20, 20, 20)',
    radioCheckedBg: 'rgb(251, 250, 248)',
    pickerHeight: '40px',
    ctaHeight: '48px',
    ctaText: `压缩这 ${DROP_FILES.length} 张`,

    listPanePadTop: '28px',
    listPanePadX: '32px',
    dropHeight: '52px',
    dropBorderStyle: 'dashed',
    dropBorderRadius: '6px',
    dropText: '拖入更多图片，或选择文件',
    fileHeight: '44px',
    fileCount: DROP_FILES.length,
    fileFirstName: 'oriented-6.jpg',
    removeOpacity: '0',
    removeText: '移除'
  }

  console.log('\n[smoke] 布局检查（对照 prototype/index.html）：')
  console.log(`  视口 ${layout.viewportWidth}x${layout.viewportHeight}`)
  checkMap(LAYOUT_EXPECT, layout, '布局', failures)

  // ---- 10. 截图：有图状态 ----
  try {
    const appShot = resolve(SHOT_DIR, '_shot-app.png')
    await shootPage(cdp, appShot)
    console.log(`\n[smoke] 截图：应用（有图） → ${appShot}`)
  } catch (e) {
    console.log(`\n[smoke] 截图跳过：${e.message}`)
  }

  // ---- 11. 跑一批，然后校验输出文件 ----
  // 这是 SPEC §10.2 的那条端到端冒烟：点 CTA → 等完成 → 断言输出目录里有文件
  // 且宽高与原图一致。承诺二（尺寸不变）在这里得到端到端的验证。
  console.log('\n[smoke] 端到端跑一批：')
  try {
    const clicked = await evaluate(`(() => {
      const cta = [...document.querySelectorAll('aside button')].find((b) => /^压缩这/.test(b.textContent))
      if (!cta) return false
      cta.click()
      return true
    })()`)
    if (!clicked) throw new Error('找不到 CTA 按钮')

    // 等所有行落到终态
    let states = []
    for (let i = 0; i < 240; i++) {
      states = await evaluate(
        `[...document.querySelectorAll('main li')].map((li) => li.dataset.state)`
      )
      if (states.length > 0 && states.every((s) => s === 'done' || s === 'undershot' || s === 'failed')) {
        break
      }
      await sleep(500)
    }
    console.log(`  行状态：${states.join(', ')}`)
    const bad = states.filter((s) => s === 'failed')
    if (bad.length > 0) failures.push(`端到端跑完有 ${bad.length} 张 failed`)

    // 校验输出：每张输入都要有对应输出，且宽高一致
    const outDir = resolve(ROOT, 'tests/fixtures/processed')
    for (const src of DROP_FILES) {
      const stem = basename(src, extname(src))
      const candidates = existsSync(outDir)
        ? readdirSync(outDir).filter((f) => f.startsWith(stem + '.') || f.startsWith(`${stem} (`))
        : []
      if (candidates.length === 0) {
        failures.push(`输出目录里没有 ${stem} 的产物`)
        console.log(`  失败  ${stem} 没有产物`)
        continue
      }
      const outName = candidates.sort().at(-1)
      const srcMeta = await sharp(src).metadata()
      const outMeta = await sharp(resolve(outDir, outName)).metadata()
      const same = srcMeta.width === outMeta.width && srcMeta.height === outMeta.height
      if (!same) {
        failures.push(
          `${stem} 尺寸被改了：${srcMeta.width}x${srcMeta.height} -> ${outMeta.width}x${outMeta.height}`
        )
      }
      console.log(
        `  ${same ? '通过' : '失败'}  ${stem} ${srcMeta.width}x${srcMeta.height} -> ${outName} ${outMeta.width}x${outMeta.height}`
      )
    }
  } catch (e) {
    failures.push(`端到端跑批失败：${e.message}`)
    console.log(`  失败  ${e.message}`)
  }

  // ---- 12. 截图：跑完之后 ----
  // 结果落位（`4.2 MB → 1.5 MB`）是这个产品最核心的一帧，单独留一张。
  try {
    const doneShot = resolve(SHOT_DIR, '_shot-app-done.png')
    await shootPage(cdp, doneShot)
    console.log(`\n[smoke] 截图：应用（跑完） → ${doneShot}`)
  } catch (e) {
    console.log(`\n[smoke] 截图跳过：${e.message}`)
  }

  // ---- 13. 文件夹展开一层 + 非图片静默过滤（SPEC §9）----
  // 造一个文件夹：2 张图 + 1 个 txt。拖进去之后应该只多出 2 行，txt 静默消失、不报错。
  console.log('\n[smoke] 文件夹展开与非图片过滤：')
  try {
    const caseDir = resolve(ROOT, 'tests/fixtures/_dropcase')
    mkdirSync(caseDir, { recursive: true })
    copyFileSync(resolve(ROOT, 'tests/fixtures/tiny-1x1.png'), resolve(caseDir, 'a.png'))
    copyFileSync(resolve(ROOT, 'tests/fixtures/oriented-6.jpg'), resolve(caseDir, 'b.jpg'))
    writeFileSync(resolve(caseDir, 'note.txt'), 'not an image')

    const before = await evaluate(`document.querySelectorAll('main li').length`)
    for (const type of ['dragEnter', 'dragOver', 'drop']) {
      await cdp.send('Input.dispatchDragEvent', {
        type,
        x: 640,
        y: 300,
        data: { items: [], files: [caseDir], dragOperationsMask: 1 }
      })
    }
    let after = before
    for (let i = 0; i < 60; i++) {
      after = await evaluate(`document.querySelectorAll('main li').length`)
      if (after > before) break
      await sleep(250)
    }
    // 文件夹里 2 张图应该都进来，txt 应该被静默丢掉
    const ok = after - before === 2
    if (!ok) failures.push(`拖入文件夹应新增 2 行（文件夹里 2 图 1 txt），实际新增 ${after - before}`)
    console.log(`  ${ok ? '通过' : '失败'}  拖入文件夹：新增 ${after - before} 行（期望 2，txt 被静默过滤）`)

    const names = await evaluate(`[...document.querySelectorAll('main li')].map((li) => li.firstElementChild.textContent)`)
    const hasTxt = names.some((n) => n.endsWith('.txt'))
    if (hasTxt) failures.push('非图片文件 .txt 出现在列表里，应该被静默过滤')
    console.log(`  ${hasTxt ? '失败' : '通过'}  列表里没有 .txt（当前：${names.join(', ')}）`)
  } catch (e) {
    failures.push(`文件夹展开检查失败：${e.message}`)
    console.log(`  失败  ${e.message}`)
  }

  // ---- 14. 单批上限 100 张 ----
  // 用户 2026-09-21 的决定。这条必须端到端验：上限在主进程展开目录之后执行，
  // 而「以为全压了其实只压了一部分」是静默丢数据，比报错更糟。
  console.log('\n[smoke] 单批上限 100 张：')
  try {
    // 先清空，好让名额从 0 算起
    await evaluate(
      `[...document.querySelectorAll('button')].find((b) => b.textContent === '清空列表')?.click()`
    )
    await sleep(400)

    // 造 500 张小图
    const bulkDir = resolve(ROOT, 'tests/fixtures/_bulk500')
    rmSync(bulkDir, { recursive: true, force: true })
    mkdirSync(bulkDir, { recursive: true })
    const tiny = resolve(ROOT, 'tests/fixtures/tiny-1x1.png')
    for (let i = 0; i < 500; i++) {
      copyFileSync(tiny, resolve(bulkDir, `img-${String(i).padStart(4, '0')}.png`))
    }

    for (const type of ['dragEnter', 'dragOver', 'drop']) {
      await cdp.send('Input.dispatchDragEvent', {
        type,
        x: 640,
        y: 300,
        data: { items: [], files: [bulkDir], dragOperationsMask: 1 }
      })
    }

    // 等元信息行报出张数
    let meta = ''
    for (let i = 0; i < 240; i++) {
      meta = await evaluate(
        `[...document.querySelectorAll('main span')].map((el) => el.textContent).find((t) => /^共 \\d+ 张/.test(t || '')) ?? ''`
      )
      if (/^共 \d+ 张/.test(meta)) break
      await sleep(250)
    }

    const rows = await evaluate(`document.querySelectorAll('main li').length`)
    const rowsOk = rows === 100
    if (!rowsOk) failures.push(`单批上限应为 100 行，实际 ${rows} 行`)
    console.log(`  ${rowsOk ? '通过' : '失败'}  列表 ${rows} 行（期望 100）`)

    // 提示里必须报出被忽略的张数，否则用户以为全压了
    const metaOk = /^共 100 张 · .+（已忽略 400 张）$/.test(meta)
    if (!metaOk) failures.push(`上限提示不对：实际「${meta}」`)
    console.log(`  ${metaOk ? '通过' : '失败'}  元信息 = ${meta}`)

    rmSync(bulkDir, { recursive: true, force: true })
  } catch (e) {
    failures.push(`单批上限检查失败：${e.message}`)
    console.log(`  失败  ${e.message}`)
  }

  // ---- 14b. 窗口尺寸适配（SPEC §10.3「窗口缩到最小尺寸不破版」）----
  // 最小尺寸是 BrowserWindow 的 880x620（src/main/window.ts），内容区要再小一圈。
  // 这里不写死内容区的像素值（取决于窗口边框与显示缩放），而是断言
  // 「任何尺寸下都必须成立」的不变量：不横向溢出、窗口不超出视口、右栏仍有可用宽度。
  console.log('\n[smoke] 窗口尺寸适配：')
  const SIZES = [
    { w: 864, h: 581, name: '最小窗口的内容区' },
    { w: 980, h: 768, name: '设计尺寸' },
    { w: 1440, h: 900, name: '大窗口' }
  ]
  try {
    for (const size of SIZES) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: size.w,
        height: size.h,
        deviceScaleFactor: 1,
        mobile: false
      })
      await sleep(250)

      const r = await evaluate(`(() => {
        const de = document.documentElement
        const win = document.querySelector('#root > div')
        const pane = document.querySelector('aside[aria-label="压缩设置"]')
        const main = document.querySelector('main[aria-label="图片列表"]')
        const box = (el) => el ? el.getBoundingClientRect() : null
        const wb = box(win)
        const pb = box(pane)
        const mb = box(main)
        // 把左栏滚到底，看 CTA 能不能露出来
        if (pane) pane.scrollTop = pane.scrollHeight
        const cta = pane ? [...pane.querySelectorAll('button')].find((b) => /^(压缩这|再压一次)/.test(b.textContent)) : null
        const cb = box(cta)
        const ctaVisible = cb !== null && cb.width > 0 && cb.top >= 0 && cb.bottom <= window.innerHeight
        return {
          docScrollW: de.scrollWidth,
          docClientW: de.clientWidth,
          winW: wb ? Math.round(wb.width) : null,
          winH: wb ? Math.round(wb.height) : null,
          paneW: pb ? Math.round(pb.width) : null,
          paneScrollable: pane ? pane.scrollHeight > pane.clientHeight : null,
          mainW: mb ? Math.round(mb.width) : null,
          ctaVisible,
          // 有没有元素横向溢出视口
          overflowing: [...document.querySelectorAll('#root *')].filter((el) => {
            const b = el.getBoundingClientRect()
            return b.width > 0 && b.right > de.clientWidth + 1
          }).length
        }
      })()`)

      const noHScroll = r.docScrollW <= r.docClientW
      const winFits = r.winW <= size.w && r.winH <= size.h
      const mainUsable = r.mainW >= 300
      const noOverflow = r.overflowing === 0

      if (!noHScroll) failures.push(`${size.name}（${size.w}x${size.h}）出现横向滚动：${r.docScrollW} > ${r.docClientW}`)
      if (!winFits) failures.push(`${size.name}（${size.w}x${size.h}）窗口超出视口：${r.winW}x${r.winH}`)
      if (!mainUsable) failures.push(`${size.name}（${size.w}x${size.h}）右栏只剩 ${r.mainW}px，太窄`)
      if (!noOverflow) failures.push(`${size.name}（${size.w}x${size.h}）有 ${r.overflowing} 个元素横向溢出`)
      if (!r.ctaVisible) failures.push(`${size.name}（${size.w}x${size.h}）左栏滚到底后 CTA 仍不可见`)

      console.log(
        `  ${noHScroll && winFits && mainUsable && noOverflow && r.ctaVisible ? '通过' : '失败'}  ` +
          `${size.name} ${size.w}x${size.h}：窗口 ${r.winW}x${r.winH}，左栏 ${r.paneW}，右栏 ${r.mainW}，` +
          `左栏可滚=${r.paneScrollable}，CTA 可达=${r.ctaVisible}，溢出元素 ${r.overflowing}`
      )
    }
  } catch (e) {
    failures.push(`窗口尺寸适配检查失败：${e.message}`)
    console.log(`  失败  ${e.message}`)
  }

  // ---- 15. 输出到原图所在目录，原图必须原封不动 ----
  // SPEC §9：「用户选了原图所在目录 + 保持原格式 → resolveOutputPath 追加 (2)，绝不覆盖」。
  // 这条既有单测（naming.spec.ts 6 条），也有这里的端到端：拿哈希比对原图有没有被动过。
  console.log('\n[smoke] 输出到原图目录：')
  try {
    const caseDir = resolve(ROOT, 'tests/fixtures/_samedir')
    rmSync(caseDir, { recursive: true, force: true })
    mkdirSync(caseDir, { recursive: true })

    // 用 jpg 与 png 各一张：输出格式保持原格式时，候选名会与源文件同名，
    // 正好触发防覆盖分支。HEIC 不适用（它必然输出成 .jpg，不会撞名）
    const sources = ['oriented-6.jpg', 'flat-solid.png'].map((f) => {
      const dst = resolve(caseDir, f)
      copyFileSync(resolve(ROOT, 'tests/fixtures', f), dst)
      return dst
    })
    const hashOf = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')
    const before = new Map(sources.map((p) => [p, hashOf(p)]))

    // 把存放位置改成这个目录。store 在 init 时读设置，所以改完要重新加载页面
    await evaluate(
      `window.pictureMore.setSettings({ outputDir: ${JSON.stringify(caseDir)} })`
    )
    await cdp.send('Page.reload')
    await cdp.send('Runtime.enable')
    for (let i = 0; i < 60; i++) {
      const ready = await evaluate(`document.querySelector('main[aria-label="图片列表"]') !== null`)
      if (ready === true) break
      await sleep(250)
    }

    // 拖入这两张
    for (const type of ['dragEnter', 'dragOver', 'drop']) {
      await cdp.send('Input.dispatchDragEvent', {
        type,
        x: 640,
        y: 300,
        data: { items: [], files: sources, dragOperationsMask: 1 }
      })
    }
    let rows = 0
    for (let i = 0; i < 60; i++) {
      rows = await evaluate(`document.querySelectorAll('main li').length`)
      if (rows === sources.length) break
      await sleep(250)
    }
    if (rows !== sources.length) throw new Error(`拖入后只有 ${rows} 行`)

    // 确认存放位置确实切到了原图目录
    const shown = await evaluate(
      `document.querySelector('[aria-label="更改图片存放位置"]').textContent`
    )
    const dirOk = shown.includes(caseDir)
    if (!dirOk) failures.push(`存放位置没有切到原图目录，显示的是「${shown}」`)
    console.log(`  ${dirOk ? '通过' : '失败'}  存放位置 = ${shown}`)

    // 跑
    await evaluate(`[...document.querySelectorAll('aside button')].find((b) => /^压缩这/.test(b.textContent)).click()`)
    let states = []
    for (let i = 0; i < 240; i++) {
      states = await evaluate(`[...document.querySelectorAll('main li')].map((li) => li.dataset.state)`)
      if (states.length > 0 && states.every((s) => s === 'done' || s === 'undershot' || s === 'failed')) break
      await sleep(500)
    }
    console.log(`        行状态：${states.join(', ')}`)

    // 原图哈希必须一模一样
    for (const p of sources) {
      const same = hashOf(p) === before.get(p)
      if (!same) failures.push(`原图被改动了：${basename(p)}`)
      console.log(`  ${same ? '通过' : '失败'}  原图未改动：${basename(p)}`)
    }

    // 目录里应该多出带 (2) 后缀的产物，而不是把原图覆盖掉
    const produced = readdirSync(caseDir).filter((f) => /\(2\)/.test(f))
    const producedOk = produced.length === sources.length
    if (!producedOk) {
      failures.push(`应产出 ${sources.length} 个 (2) 后缀的文件，实际 ${produced.length} 个`)
    }
    console.log(
      `  ${producedOk ? '通过' : '失败'}  产出 ${produced.length} 个防覆盖文件：${produced.join(', ') || '(无)'}`
    )
  } catch (e) {
    failures.push(`输出到原图目录的检查失败：${e.message}`)
    console.log(`  失败  ${e.message}`)
  }

  // ---- 15b. 运行时零联网（承诺一）----
  // 比 SPEC §11 说的「拔网线」更严格：拔网线只能证明断网时能用，
  // 这里能证明**根本没有发出过外部请求**。
  //
  // 放在上一节之后是有意的：上面那次 Page.reload 会产生一批 file:// 请求，
  // 正好用来证明监听本身是活的（如果 requests 是空的，说明监听没生效，
  // 「零外部请求」就成了空断言）。
  console.log('\n[smoke] 运行时零联网：')
  {
    const external = requests.filter((u) => !/^(file|devtools|blob|data):/.test(u))
    const kinds = [...new Set(requests.map((u) => u.split(':')[0]))]

    // 监听本身要活着，否则下面的 0 没有意义
    const alive = requests.length > 0
    if (!alive) failures.push('一个请求都没监听到，说明 Network 监听没生效，零外部请求这个结论不成立')
    console.log(`  ${alive ? '通过' : '失败'}  监听到 ${requests.length} 个请求（证明监听是活的）`)

    const ok = external.length === 0
    if (!ok) {
      failures.push(`出现了 ${external.length} 个外部请求：${external.slice(0, 5).join(', ')}`)
    }
    console.log(`  ${ok ? '通过' : '失败'}  外部请求 ${external.length} 个（承诺一：运行时零联网）`)
    console.log(`        请求协议：${kinds.join(', ') || '(无)'}`)
  }

  // ---- 16. 键盘可达性 ----
  // SPEC §10.3 要求「键盘走完整个流程（Tab / Space / Enter / 方向键调滑块）」。
  // 这里验 Tab 顺序能覆盖全部可交互元素，以及聚焦时有可见的焦点环。
  console.log('\n[smoke] 键盘：')
  try {
    const pressTab = async () => {
      for (const type of ['rawKeyDown', 'keyUp']) {
        await cdp.send('Input.dispatchKeyEvent', {
          type,
          windowsVirtualKeyCode: 9,
          nativeVirtualKeyCode: 9,
          code: 'Tab',
          key: 'Tab'
        })
      }
      await sleep(60)
    }

    // 从文档开头开始走
    await evaluate(`document.activeElement && document.activeElement.blur()`)
    const visited = []
    for (let i = 0; i < 12; i++) {
      await pressTab()
      const info = await evaluate(`(() => {
        const el = document.activeElement
        if (!el || el === document.body) return null
        const cs = getComputedStyle(el)
        return {
          tag: el.tagName,
          type: el.getAttribute('type'),
          role: el.getAttribute('role'),
          name: el.getAttribute('aria-label') || (el.textContent || '').trim().slice(0, 10),
          outline: cs.outlineStyle + ' ' + cs.outlineWidth,
          ring: cs.boxShadow
        }
      })()`)
      if (info === null) break
      visited.push(info)
    }

    // 必须有可聚焦元素，且滑块与格式选项要能被 Tab 到
    const reachable = visited.map((v) => `${v.tag}${v.type ? ':' + v.type : ''}${v.role ? '[' + v.role + ']' : ''}`)
    console.log(`        顺序：${reachable.join(' -> ') || '(空)'}`)

    const hasSlider = visited.some((v) => v.type === 'range')
    const hasRadio = visited.some((v) => v.role === 'radio')
    const hasButton = visited.some((v) => v.tag === 'BUTTON')
    if (!hasSlider) failures.push('Tab 顺序里没有滑块')
    if (!hasRadio) failures.push('Tab 顺序里没有输出格式选项')
    if (!hasButton) failures.push('Tab 顺序里没有按钮')
    console.log(`  ${hasSlider ? '通过' : '失败'}  滑块可 Tab 到`)
    console.log(`  ${hasRadio ? '通过' : '失败'}  格式选项可 Tab 到`)
    console.log(`  ${hasButton ? '通过' : '失败'}  按钮可 Tab 到`)

    // 焦点反馈：全局 :focus-visible 给 2px 实线环（index.css）。
    // 用按钮验 —— 滑块是刻意例外，见下面的说明。
    const buttonFocused = visited.find((v) => v.tag === 'BUTTON')
    if (buttonFocused !== undefined) {
      const ok = /solid/.test(buttonFocused.outline)
      if (!ok) failures.push(`按钮聚焦时没有可见焦点环：outline=${buttonFocused.outline}`)
      console.log(`  ${ok ? '通过' : '失败'}  按钮聚焦有可见焦点环（outline: ${buttonFocused.outline}）`)
    }

    // 滑块是**有意的例外**：原型的 `.slider:focus-visible{outline:none}` 把外框去掉了，
    // 改成在拇指上加一圈 box-shadow（`.slider:focus-visible::-webkit-slider-thumb`）。
    // 所以这里断言的是「外框确实被去掉了」，而不是「有外框」。
    const sliderFocused = visited.find((v) => v.type === 'range')
    if (sliderFocused !== undefined) {
      const ok = /none/.test(sliderFocused.outline)
      if (!ok) failures.push(`滑块不应该有外框（原型的焦点环在拇指上）：outline=${sliderFocused.outline}`)
      console.log(`  ${ok ? '通过' : '失败'}  滑块外框已按原型去掉（outline: ${sliderFocused.outline}）`)
    }
  } catch (e) {
    failures.push(`键盘检查失败：${e.message}`)
    console.log(`  失败  ${e.message}`)
  }

  // ---- 17. 页面确实加载了构建产物 ----
  const title = await evaluate(
    `({ title: document.title, url: location.href, hasRoot: !!document.getElementById('root') })`
  )
  console.log(`\n[smoke] 页面状态：title="${title.title}" url="${title.url}"`)
  if (!title.hasRoot) failures.push('渲染进程没有 #root 挂载点，index.html 可能没加载')

  // ---- 18. 原型截图 ----
  // 放在最后：导航过去之后这一页就是原型了，应用那边再也测不了。
  try {
    const protoShot = await shootPrototype(cdp)
    console.log(`[smoke] 截图：原型 → ${protoShot}`)
  } catch (e) {
    console.log(`[smoke] 原型截图跳过：${e.message}`)
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

/** 逐项比对并打日志。数字与字符串混着写，统一转成字符串比 */
function checkMap(expect, actual, label, failures) {
  for (const [key, want] of Object.entries(expect)) {
    const got = actual[key]
    const ok = String(got) === String(want)
    if (!ok) failures.push(`${label} ${key}：期望 ${want}，实际 ${got}`)
    console.log(`  ${ok ? '通过' : '失败'}  ${key} = ${got}`)
  }
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
 * 截原型页面。**必须在所有针对应用的检查跑完之后调用** —— 它把这一页导航走了。
 *
 * 为什么用导航而不是开新 target：Electron 的调试端点不支持 `Target.createTarget`
 * （浏览器级端点会返回 "Not supported"），为了截一张图去开第二个 BrowserWindow 又太侵入。
 */
async function shootPrototype(cdp) {
  const protoShot = resolve(ROOT, 'tests/fixtures/_shot-prototype.png')
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

  // 再切到原型的「空列表」预览截一张，和应用的空态对照
  try {
    await cdp.send('Runtime.evaluate', {
      expression: `document.getElementById('pvEmpty').click()`
    })
    await sleep(250)
    const protoEmpty = resolve(ROOT, 'tests/fixtures/_shot-prototype-empty.png')
    await shootPage(cdp, protoEmpty)
  } catch {
    // 原型结构变了也不该让冒烟红，这只是辅助产物
  }

  return protoShot
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
