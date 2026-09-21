/**
 * 打包产物冒烟：验证装出来的应用真的能跑。
 *
 * 为什么需要它：`npm run smoke` 测的是 `out/` 里的构建产物，跑在 node_modules 的
 * Electron 上。而打包之后有两件事会变：
 *   1. sharp 的原生模块从 `app.asar.unpacked/` 里加载（asarUnpack 配错就直接崩）
 *   2. `heic-decode` 的 WASM（libheif-js）从 asar 里读
 * 这两条只有真装一次才能验出来。SPEC §11 的「干净机器验收」里，能在本机自动化的
 * 就是这一部分。
 *
 * 跑法（先 npm run build）：
 *   npm run smoke:packaged
 *
 * 做四件事：启动打包后的 exe → 走 IPC probe → 走 IPC 跑一批 → 校验输出文件宽高。
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { connect, evaluate, sleep, waitForPage } from './lib/cdp.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * 打包产物的位置。默认 `release/win-unpacked`，可以用第一个参数覆盖：
 *
 *   node scripts/smoke-packaged.mjs release-next/win-unpacked
 *
 * 留这个口子是因为 Windows 上偶尔会出现 app.asar 被占用、导致 electron-builder
 * 没法覆盖旧目录（EBUSY），那时只能换个 output 目录出包。见 docs/decisions.md 的 T18-5。
 */
const UNPACKED = resolve(ROOT, process.argv[2] ?? 'release/win-unpacked')
const EXE = resolve(UNPACKED, '图压压.exe')
const PORT = 9444
const OUT_DIR = resolve(UNPACKED, '..', '_smoke-out')
const FIXTURES = ['oriented-6.jpg', 'flat-solid.png', 'iphone-portrait.heic'].map((f) =>
  resolve(ROOT, 'tests/fixtures', f)
)

if (!existsSync(EXE)) {
  console.error(`[packaged] 找不到打包产物 ${EXE}，先跑 npm run build`)
  process.exit(1)
}
for (const f of FIXTURES) {
  if (!existsSync(f)) {
    console.error(`[packaged] 缺少 fixture ${f}`)
    process.exit(1)
  }
}

// 输出目录每次重建，免得上一轮的产物把断言弄乱
rmSync(OUT_DIR, { recursive: true, force: true })
mkdirSync(OUT_DIR, { recursive: true })

/**
 * 启动打包后的应用。
 *
 * 必须清掉 NODE_OPTIONS 与 ELECTRON_RUN_AS_NODE：宿主环境的 shell 会给子进程注入
 * 这两个变量，后者会让 electron.exe 退化成普通 Node，主进程里
 * `require('electron')` 拿到的是 npm 包路径字符串而不是 API。
 * 详见 docs/decisions.md 的「本机开发环境的一个坑」。
 */
const env = { ...process.env }
delete env['NODE_OPTIONS']
delete env['ELECTRON_RUN_AS_NODE']

const child = spawn(EXE, [`--remote-debugging-port=${PORT}`], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env
})

const output = []
child.stdout.on('data', (d) => output.push(d.toString()))
child.stderr.on('data', (d) => output.push(d.toString()))

const failures = []
const log = (ok, text) => {
  if (!ok) failures.push(text)
  console.log(`  ${ok ? '通过' : '失败'}  ${text}`)
}

let exitCode = 1
try {
  console.log('\n[packaged] 启动打包后的应用…')
  const target = await waitForPage(PORT, {
    onTick: () => {
      if (child.exitCode !== null) {
        throw new Error(`应用提前退出，退出码 ${child.exitCode}\n${output.join('')}`)
      }
    }
  })
  const cdp = await connect(target.webSocketDebuggerUrl)
  await cdp.send('Runtime.enable')

  console.log('\n[packaged] 渲染层与 preload：')
  const boot = await evaluate(
    cdp,
    `({ title: document.title, hasApi: typeof window.pictureMore === 'object', hasRoot: !!document.getElementById('root') })`
  )
  log(boot.hasApi, `window.pictureMore 已挂载`)
  log(boot.hasRoot, `#root 已挂载（title="${boot.title}"）`)

  // ---- 联网拦截：CSP 只在打包后才注入 ----
  // `security.ts` 里的 CSP 是 `if (app.isPackaged)` 才挂的，所以这条只能在打包产物上验。
  // 两层保障一起看：connect-src 'none' 的 CSP + onBeforeRequest 的运行时拦截。
  console.log('\n[packaged] 联网拦截（承诺一）：')
  const netCheck = await evaluate(
    cdp,
    `(async () => {
      const out = { attempts: [] }
      for (const url of ['https://example.com/', 'http://127.0.0.1:1/']) {
        try {
          await fetch(url, { mode: 'no-cors' })
          out.attempts.push({ url, blocked: false })
        } catch (e) {
          out.attempts.push({ url, blocked: true, message: String(e && e.message || e) })
        }
      }
      return out
    })()`
  )
  for (const a of netCheck.attempts) {
    log(a.blocked, `${a.url} 被拦截${a.blocked ? `（${a.message}）` : '（没拦住！）'}`)
  }

  // ---- probe：这一步会真正调用 sharp 与 heic-decode ----
  // sharp 的原生模块在 app.asar.unpacked 里，heic-decode 的 WASM 在 asar 里。
  // asarUnpack 配错的话这里就会炸。
  console.log('\n[packaged] 原生依赖（sharp 与 heic-decode）：')
  const probed = await evaluate(
    cdp,
    `(async () => {
      try {
        const r = await window.pictureMore.probe(${JSON.stringify(FIXTURES)})
        return { ok: true, metas: r.metas.map((m) => ({ name: m.name, format: m.format, width: m.width, height: m.height, readable: m.readable, reason: m.reason })), dropped: r.dropped }
      } catch (e) {
        return { ok: false, message: String(e && e.message || e) }
      }
    })()`
  )
  if (!probed.ok) {
    log(false, `probe 失败：${probed.message}`)
  } else {
    for (const m of probed.metas) {
      log(m.readable, `${m.name} 读出 ${m.format} ${m.width}x${m.height}`)
    }
    const heic = probed.metas.find((m) => m.format === 'heic')
    if (heic) {
      // HEIC 的尺寸来自 sharp 读容器头；竖拍要宽 < 高
      log(heic.width < heic.height, `HEIC 竖拍方向正确（${heic.width}x${heic.height}）`)
    }
  }

  // ---- 跑一批：走完整 IPC + 队列 + 编码 + 写盘 ----
  console.log('\n[packaged] 跑一批：')
  const taskId = `packaged-smoke-${Date.now()}`
  const payload = {
    taskId,
    items: (probed.metas ?? [])
      .filter((m) => m.readable)
      .map((m, i) => ({ id: `i${i}`, path: FIXTURES[probed.metas.indexOf(m)], bytes: 0, format: m.format, width: m.width, height: m.height, hasAlpha: false })),
    shrinkPercent: 45,
    outputFormat: 'keep',
    outputDir: OUT_DIR
  }

  const started = await evaluate(
    cdp,
    `(async () => {
      try {
        const r = await window.pictureMore.start(${JSON.stringify(payload)})
        return { ok: true, taskId: r.taskId }
      } catch (e) {
        return { ok: false, message: String(e && e.message || e) }
      }
    })()`
  )
  log(started.ok, started.ok ? `task:start 返回 ${started.taskId}` : `task:start 失败：${started.message}`)

  if (started.ok) {
    // 等输出目录里出现和输入一样多的文件
    let files = []
    for (let i = 0; i < 240; i++) {
      files = existsSync(OUT_DIR) ? readdirSync(OUT_DIR) : []
      if (files.length >= payload.items.length) break
      await sleep(500)
    }
    log(files.length >= payload.items.length, `输出目录里有 ${files.length} 个文件（期望 ${payload.items.length}）`)

    // 承诺二的端到端验证：拿真实输出文件比对宽高
    for (const src of FIXTURES) {
      const stem = basename(src, extname(src))
      const match = files.filter((f) => f.startsWith(stem))
      if (match.length === 0) {
        log(false, `${stem} 没有产物`)
        continue
      }
      const srcMeta = await sharp(src).metadata()
      const outMeta = await sharp(resolve(OUT_DIR, match[0])).metadata()
      log(
        srcMeta.width === outMeta.width && srcMeta.height === outMeta.height,
        `${stem} ${srcMeta.width}x${srcMeta.height} -> ${match[0]} ${outMeta.width}x${outMeta.height}`
      )
    }
  }

  cdp.close()
  exitCode = failures.length === 0 ? 0 : 1
} catch (e) {
  console.error(`[packaged] 异常：${e.message}`)
} finally {
  if (child.exitCode === null) {
    const closed = new Promise((r) => child.once('close', r))
    child.kill()
    const raced = await Promise.race([closed, sleep(3000).then(() => 'timeout')])
    if (raced === 'timeout') {
      child.kill('SIGKILL')
      await closed
    }
  }
}

if (failures.length > 0) {
  console.error(`\n[packaged] 失败 ${failures.length} 项：`)
  for (const f of failures) console.error(`  - ${f}`)
} else {
  console.log('\n[packaged] 全部通过')
}

writeFileSync(resolve(UNPACKED, '..', '_smoke-packaged.log'), output.join(''))
process.exitCode = exitCode
// 兜底：万一还有东西挂住事件循环
setTimeout(() => process.exit(exitCode), 8000).unref()
