/**
 * 测量：500 行列表到底慢不慢，值不值得上虚拟化。
 *
 * SPEC §9 写着「拖入 500 张 | 允许，但列表虚拟化（>100 行时启用）」。
 * 但 500 个 DOM 节点对 Chromium 来说未必是问题，而虚拟化要手写（不能引库），
 * 会碰行渲染与 pop 动效。所以先量再决定。
 *
 * 跑法（先 npm run build）：
 *   node scripts/measure-500.mjs
 */

import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { connect, evaluate, sleep, waitForPage } from './lib/cdp.mjs'

const require = createRequire(import.meta.url)
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 9335
const COUNT = 500

const BULK_DIR = resolve(ROOT, 'tests/fixtures/_bulk500')
const SOURCE = resolve(ROOT, 'tests/fixtures/tiny-1x1.png')

if (!existsSync(resolve(ROOT, 'out/main/index.js'))) {
  console.error('[measure] 先跑 npx electron-vite build')
  process.exit(1)
}

// 造 500 张 90 字节的小图。用极小的文件，把 I/O 的影响压到最低，
// 这样量到的差异主要来自渲染
rmSync(BULK_DIR, { recursive: true, force: true })
mkdirSync(BULK_DIR, { recursive: true })
for (let i = 0; i < COUNT; i++) {
  copyFileSync(SOURCE, resolve(BULK_DIR, `img-${String(i).padStart(4, '0')}.png`))
}

const env = { ...process.env }
delete env['NODE_OPTIONS']
delete env['ELECTRON_RUN_AS_NODE']

const child = spawn(require('electron'), ['.', `--remote-debugging-port=${PORT}`], {
  cwd: ROOT,
  stdio: ['ignore', 'pipe', 'pipe'],
  env
})

let code = 1
try {
  const target = await waitForPage(PORT, {
    onTick: () => {
      if (child.exitCode !== null) throw new Error(`应用提前退出，码 ${child.exitCode}`)
    }
  })
  const cdp = await connect(target.webSocketDebuggerUrl)
  await cdp.send('Runtime.enable')

  // 从干净状态开始
  await evaluate(cdp, `window.pictureMore.setSettings({ outputDir: null })`)
  await cdp.send('Page.reload')
  await cdp.send('Runtime.enable')
  for (let i = 0; i < 60; i++) {
    if ((await evaluate(cdp, `document.querySelector('main[aria-label="图片列表"]') !== null`)) === true) break
    await sleep(250)
  }

  console.log(`\n[measure] 拖入 ${COUNT} 张图…`)
  const t0 = Date.now()
  for (const type of ['dragEnter', 'dragOver', 'drop']) {
    await cdp.send('Input.dispatchDragEvent', {
      type,
      x: 640,
      y: 300,
      data: { items: [], files: [BULK_DIR], dragOperationsMask: 1 }
    })
  }

  // 等列表就位。
  // ⚠️ 不能等「DOM 里有 500 个 li」—— 启用虚拟化之后只会渲染可见的那十几行。
  // 要读界面上真实的张数（元信息行的「共 N 张」），那才是用户看到的东西。
  let listed = 0
  for (let i = 0; i < 240; i++) {
    listed = await evaluate(
      cdp,
      `(() => {
        const span = [...document.querySelectorAll('main span')].find((el) => /^共 \\d+ 张/.test(el.textContent || ''))
        const m = span && span.textContent.match(/共 (\\d+) 张/)
        return m ? Number(m[1]) : 0
      })()`
    )
    if (listed === COUNT) break
    await sleep(100)
  }
  const tList = Date.now() - t0

  // 等首屏稳定（两帧）
  await evaluate(cdp, `new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`)

  const stats = await evaluate(
    cdp,
    `(() => {
      const ul = document.querySelector('main ul')
      return {
        renderedRows: document.querySelectorAll('main li').length,
        domNodes: document.getElementsByTagName('*').length,
        scrollHeight: ul?.scrollHeight ?? 0,
        heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null
      }
    })()`
  )

  console.log(`\n[measure] 结果：`)
  console.log(`  列表就位耗时：${tList}ms（含 ${COUNT} 次文件读盘 + 解容器）`)
  console.log(`  界面上报出的张数：${listed}`)
  console.log(`  实际渲染的行数：${stats.renderedRows}（虚拟化之后只渲染可见部分）`)
  console.log(`  DOM 节点总数：${stats.domNodes}`)
  console.log(`  列表滚动高度：${stats.scrollHeight}px（期望 ${COUNT * 44}px）`)
  console.log(`  JS 堆：${stats.heapMB === null ? '不可读' : stats.heapMB + ' MB'}`)

  if (listed !== COUNT) {
    console.error(`  ⚠️ 界面上报出 ${listed} 张，期望 ${COUNT} 张`)
    code = 1
  }
  if (stats.scrollHeight !== COUNT * 44) {
    console.error(`  ⚠️ 滚动高度 ${stats.scrollHeight}px 不等于 ${COUNT} x 44px，占位算错了`)
    code = 1
  }

  // 滚动一次，看有没有掉帧，同时确认**滚动之后渲染的是不同的行**
  // —— 后者才是虚拟化的正确性检查：滚动只改占位高度、不换行的话，
  // 用户滚下去会看到一片空白
  const scrollResult = await evaluate(
    cdp,
    `(async () => {
      const ul = document.querySelector('main ul')
      if (!ul) return null
      const firstName = () => document.querySelector('main li span')?.textContent ?? ''
      const before = firstName()
      const t = performance.now()
      for (let i = 0; i < 20; i++) {
        ul.parentElement.scrollTop = (ul.scrollHeight - ul.parentElement.clientHeight) * (i / 20)
        await new Promise((r) => requestAnimationFrame(r))
      }
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      const after = firstName()
      ul.parentElement.scrollTop = 0
      return { cost: Math.round(performance.now() - t), before, after }
    })()`
  )
  if (scrollResult === null) {
    console.error('  ⚠️ 找不到列表容器')
    code = 1
  } else {
    console.log(
      `  滚动 20 帧耗时：${scrollResult.cost}ms（每帧约 ${Math.round(scrollResult.cost / 20)}ms）`
    )
    const swapped = scrollResult.before !== scrollResult.after
    console.log(
      `  ${swapped ? '通过' : '失败'}  滚动后渲染的是不同的行（${scrollResult.before} -> ${scrollResult.after}）`
    )
    if (!swapped) code = 1
  }

  // 单选一行移除，看单点更新快不快
  const removeCost = await evaluate(
    cdp,
    `(async () => {
      const btn = document.querySelector('main li button')
      if (!btn) return null
      const t = performance.now()
      btn.click()
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      return Math.round(performance.now() - t)
    })()`
  )
  console.log(`  移除一行到重绘完成：${removeCost}ms`)

  cdp.close()
  code = 0
} catch (e) {
  console.error(`[measure] 异常：${e.message}`)
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
  rmSync(BULK_DIR, { recursive: true, force: true })
}

process.exitCode = code
setTimeout(() => process.exit(code), 8000).unref()
