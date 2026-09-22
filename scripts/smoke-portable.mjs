/**
 * 便携版（免安装单文件 exe）冒烟。
 *
 * **为什么不能复用 `smoke-packaged.mjs`**：那个跑的是 `win-unpacked` 目录，
 * 而便携版是个**自解压包** —— 双击时它先把内容解到临时目录再从那里启动。
 * 这一步有自己的失败模式（解压不全、路径过长、临时目录被策略拦），
 * 而 `win-unpacked` 那条路完全覆盖不到。
 *
 * 这里只验「能不能起来、能不能干活」，不重复 `smoke-packaged` 那 8 组细项 ——
 * 那些验的是应用本身，两种分发方式共用同一份产物。
 *
 * 用法：
 *   node scripts/smoke-portable.mjs
 *   node scripts/smoke-portable.mjs release-portable/图压压-1.0.7-便携版.exe
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { connect, evaluate, sleep, waitForPage } from './lib/cdp.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function findPortable() {
  if (process.argv[2] !== undefined) return resolve(ROOT, process.argv[2])
  for (const dir of readdirSync(ROOT).filter((d) => d.startsWith('release'))) {
    const full = resolve(ROOT, dir)
    try {
      const hit = readdirSync(full).find((f) => f.includes('便携版') && f.endsWith('.exe'))
      if (hit !== undefined) return join(full, hit)
    } catch {
      // 不是目录就跳过
    }
  }
  return null
}

const EXE = findPortable()
if (EXE === null || !existsSync(EXE)) {
  console.error('[portable] 找不到便携版 exe。先跑 npm run build。')
  process.exit(1)
}

const PORT = 9333
const OUT_DIR = resolve(ROOT, '.tmp/portable-out')
const FIXTURES = resolve(ROOT, 'tests/fixtures')
const DROP = ['flat-solid.png', 'oriented-6.jpg', 'iphone-portrait.heic'].map((f) =>
  resolve(FIXTURES, f)
)

for (const f of DROP) {
  if (!existsSync(f)) {
    console.error(`[portable] 缺少 fixture ${f}，先跑 npm run fixtures`)
    process.exit(1)
  }
}

rmSync(OUT_DIR, { recursive: true, force: true })
// 便携版会往临时目录解压，这里给它一个干净的自定义 TMP，方便事后确认它真的解压过
const SELF_TMP = mkdtempSync(join(tmpdir(), 'pm-portable-'))

console.log(`[portable] exe：${EXE}`)
console.log(`[portable] 体积：${(statSync(EXE).size / 1048576).toFixed(0)} MB`)

const env = { ...process.env, TMP: SELF_TMP, TEMP: SELF_TMP }
delete env['NODE_OPTIONS']
delete env['ELECTRON_RUN_AS_NODE']

const failures = []
const log = (ok, msg) => {
  if (!ok) failures.push(msg)
  console.log(`  ${ok ? '通过' : '失败'}  ${msg}`)
}

console.log('\n[portable] 启动…')
const child = spawn(EXE, [`--remote-debugging-port=${PORT}`], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env
})
const output = []
child.stdout.on('data', (d) => output.push(d.toString()))
child.stderr.on('data', (d) => output.push(d.toString()))

let exitCode = 1
let cdp = null
try {
  const target = await waitForPage(PORT, { timeoutMs: 60_000 })
  cdp = await connect(target.webSocketDebuggerUrl)
  await cdp.send('Runtime.enable')

  // 自解压包起来比 win-unpacked 慢，等久一点
  let boot = { hasApi: false, hasRoot: false }
  for (let i = 0; i < 120; i++) {
    boot = await evaluate(
      cdp,
      `({
        hasApi: typeof window.pictureMore === 'object',
        hasRoot: (document.getElementById('root')?.childElementCount ?? 0) > 0
      })`
    )
    if (boot.hasApi && boot.hasRoot) break
    await sleep(250)
  }

  console.log('\n[portable] 渲染层与 preload：')
  log(boot.hasApi, 'window.pictureMore 已挂载')
  log(boot.hasRoot, '#root 已渲染出内容')

  // 原生依赖：便携版是从临时目录加载的，这条必须单独验
  console.log('\n[portable] 原生依赖（从自解压出来的临时目录加载）：')
  const probed = await evaluate(
    cdp,
    `(async () => {
      try {
        const r = await window.pictureMore.probe(${JSON.stringify(DROP)})
        return { ok: true, metas: r.metas.map((m) => ({ name: m.name, format: m.format, width: m.width, height: m.height, readable: m.readable })) }
      } catch (e) {
        return { ok: false, message: String((e && e.message) || e) }
      }
    })()`
  )
  if (!probed.ok) {
    log(false, `probe 失败：${probed.message}`)
  } else {
    for (const m of probed.metas) {
      log(m.readable, `${m.name} 读出 ${m.format} ${m.width}x${m.height}`)
    }
    log(
      probed.metas.some((m) => m.format === 'heic'),
      'HEIC 能读（WASM 从临时目录加载成功）'
    )
  }

  // 真跑一批
  console.log('\n[portable] 跑一批：')
  const taskId = `portable-smoke-${Date.now()}`
  const payload = {
    taskId,
    // 引擎要 format / width / height / hasAlpha，不是只有路径 —— 必须用 probe 的结果
    items: (probed.metas ?? [])
      .filter((m) => m.readable)
      .map((m, i) => ({
        id: `i${i}`,
        path: DROP[probed.metas.indexOf(m)],
        bytes: 0,
        format: m.format,
        width: m.width,
        height: m.height,
        hasAlpha: false
      })),
    shrinkPercent: 60,
    outputFormat: 'keep',
    outputDir: OUT_DIR
  }
  const res = await evaluate(
    cdp,
    `(async () => {
      try {
        const r = await window.pictureMore.start(${JSON.stringify(payload)})
        return { ok: true, taskId: r.taskId, error: r.error }
      } catch (e) {
        return { ok: false, message: String((e && e.message) || e) }
      }
    })()`
  )
  log(res.ok && res.error === null, `task:start 返回 ${res.taskId ?? res.message ?? '(无)'}`)

  for (let i = 0; i < 120; i++) {
    if (existsSync(OUT_DIR) && readdirSync(OUT_DIR).length >= 3) break
    await sleep(500)
  }
  const files = existsSync(OUT_DIR) ? readdirSync(OUT_DIR) : []
  log(files.length === 3, `输出目录里有 3 个文件（实际 ${files.length}）`)

  // 尺寸不变 —— 承诺二在便携版上同样成立
  const sharp = (await import('sharp')).default
  let dimsOk = true
  for (const f of files) {
    const out = await sharp(join(OUT_DIR, f)).metadata()
    const stem = f.replace(/\.[^.]+$/, '')
    const srcName = DROP.find((p) => p.includes(stem.replace(/ \(\d+\)$/, '')))
    if (srcName === undefined) continue
    const src = await sharp(srcName).metadata()
    const same = out.width === src.width && out.height === src.height
    if (!same) dimsOk = false
    console.log(
      `        ${stem} ${src.width}x${src.height} -> ${out.width}x${out.height}`
    )
  }
  log(dimsOk, '每张输出的宽高都与原图一致')

  exitCode = failures.length === 0 ? 0 : 1
} catch (e) {
  console.error(`[portable] 异常：${e.message}`)
  if (output.length > 0) console.error(output.join(''))
} finally {
  if (cdp !== null) cdp.close()
  if (child.exitCode === null) {
    const closed = new Promise((r) => child.once('close', r))
    child.kill()
    const raced = await Promise.race([closed, sleep(3000).then(() => 'timeout')])
    if (raced === 'timeout') {
      child.kill('SIGKILL')
      await closed
    }
  }
  try {
    rmSync(SELF_TMP, { recursive: true, force: true })
  } catch {
    // 临时目录可能被系统占用，删不掉就算了
  }
}

if (failures.length > 0) {
  console.error(`\n[portable] 失败 ${failures.length} 项：`)
  for (const f of failures) console.error(`  - ${f}`)
} else {
  console.log('\n[portable] 全部通过')
}
process.exitCode = exitCode
setTimeout(() => process.exit(exitCode), 8000).unref()
