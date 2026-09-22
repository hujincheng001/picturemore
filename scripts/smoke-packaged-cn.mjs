/**
 * 打包产物的「中文路径」冒烟。
 *
 * **为什么需要单独一条**：NSIS 的默认安装位置是
 * `%LOCALAPPDATA%\Programs\图压压` —— **路径里有中文**。
 * 而 `npm run smoke:packaged` 一直跑在 `release-xxx/win-unpacked` 这种纯 ASCII 路径下，
 * 等于从来没验过用户实际会遇到的那个路径。
 *
 * 这一类问题的典型表现是：**开发机上一切正常，装到用户机上直接白屏或崩**，
 * 而且报错往往指向别处（「找不到模块」而不是「路径编码有问题」）。
 * 涉及中文路径的地方至少有三处：Electron 主进程、`app.asar` 的解包、以及
 * sharp 的原生模块加载 —— 每一处都可能出问题。
 *
 * 做法：把 `win-unpacked` 复制到一个**中文 + 空格**的目录，在那里跑一遍完整的打包冒烟，
 * 跑完删掉。用中文**加空格**是为了同时覆盖两种路径陷阱。
 *
 * 用法：
 *   npm run smoke:packaged:cn
 *   node scripts/smoke-packaged-cn.mjs release-107/win-unpacked
 *
 * 默认源目录是 `release/win-unpacked`。
 */

import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = resolve(ROOT, process.argv[2] ?? 'release/win-unpacked')

/**
 * 临时目的地。
 *
 * ⚠️ **放在工作区内部，不要放到外面去。**
 * 名字刻意同时含中文与空格 —— 前者覆盖编码，后者覆盖没加引号的拼接。
 * 这一条验的是「应用能不能在中文路径下跑」，与「在不在工作区里」无关，
 * 而写工作区外面会让宿主的沙箱弹一次确认卡。验收脚本不该每次都让用户点一下。
 *
 * 目录名以 `.` 开头且已在 .gitignore 里，跑完即删。
 */
const DEST_ROOT = resolve(ROOT, '.smoke-cn')
const DEST = resolve(DEST_ROOT, '中文 路径', '图压压 测试')

/**
 * 逐文件递归复制。
 *
 * ⚠️ **不要用 `fs.cpSync`** —— 在这个目录上它会让 Node 进程直接**段错误**
 * （退出码 139，没有任何报错，只看到脚本跑到一半就没了）。
 * 实测：`cpSync` 崩，逐文件 `copyFileSync` 正常（121 个文件 / 395MB）。
 * 疑与那 235MB 的 `图压压.exe` 或 `app.asar` 有关，未深究 —— 绕开即可。
 */
function copyTree(from, to) {
  mkdirSync(to, { recursive: true })
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const src = join(from, entry.name)
    const dst = join(to, entry.name)
    if (entry.isDirectory()) copyTree(src, dst)
    else copyFileSync(src, dst)
  }
}

if (!existsSync(SOURCE)) {
  console.error(`[cn] 源目录不存在：${SOURCE}`)
  console.error('    先跑 npm run build 出包，或显式传入 win-unpacked 的路径。')
  process.exit(1)
}
if (!existsSync(resolve(SOURCE, '图压压.exe'))) {
  console.error(`[cn] 源目录里没有 图压压.exe：${SOURCE}`)
  process.exit(1)
}

console.log(`[cn] 源：${SOURCE}`)
console.log(`[cn] 复制到中文路径：${DEST}`)

rmSync(DEST_ROOT, { recursive: true, force: true })
copyTree(SOURCE, DEST)
const bytes = readdirSync(DEST).length
console.log(`[cn] 复制完成（${bytes} 个顶层项），开始跑打包冒烟\n`)

let code = 1
try {
  code = await new Promise((resolveExit) => {
    /*
     * 必须剥掉 NODE_OPTIONS 与 ELECTRON_RUN_AS_NODE。
     *
     * 宿主的 shell 会给子进程注入 `--require` 预载 shim（本机备忘里的第一条坑）。
     * 直接继承的话，子 Node 会再加载一遍 shim，实测**直接段错误**（退出码 139），
     * 而且没有任何有用的报错 —— 只看到脚本「跑到一半就没了」。
     */
    const env = { ...process.env, CODEBUDDY_SAFE_DELETE_ENABLED: '0' }
    delete env['NODE_OPTIONS']
    delete env['ELECTRON_RUN_AS_NODE']

    const child = spawn(process.execPath, [resolve(ROOT, 'scripts/smoke-packaged.mjs'), DEST], {
      cwd: ROOT,
      stdio: 'inherit',
      env
    })
    child.on('close', (c) => {
      resolveExit(c ?? 1)
    })
  })
} finally {
  // 不管成没成都清掉 —— 这是一个临时副本，约 400MB
  try {
    rmSync(DEST_ROOT, { recursive: true, force: true })
    console.log(`\n[cn] 已清理 ${DEST_ROOT}`)
  } catch (e) {
    console.error(`\n[cn] 清理失败（重启后可删）：${DEST_ROOT}`)
    console.error(`     ${e.message}`)
  }
}

if (code !== 0) {
  console.error('\n[cn] 中文路径下冒烟失败 —— 默认安装路径就是这种，必须修')
} else {
  console.log('\n[cn] 中文 + 空格路径下全部通过')
}
process.exitCode = code
setTimeout(() => process.exit(code), 5000).unref()
