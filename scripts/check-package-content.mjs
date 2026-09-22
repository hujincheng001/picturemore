/**
 * 安装包内容核查。
 *
 * `electron-builder.yml` 的 `files` 是**白名单式**的：只放 `out/**` 与 `package.json`。
 * 但白名单写得对不对，只有真解出来看才算数 —— 漏一条排除规则，
 * 源码、测试图（60MB）、原型、技能目录就会静默进包，而**没有任何报错**。
 *
 * 这一条原来只在 Task 14 手工做过一次（核的是 `win-unpacked`）。
 * 固化成脚本，改完 `electron-builder.yml` 跑一下就知道有没有漏。
 *
 * 做法：用 electron-builder 自带的 7za 列出**安装包**的内容
 * （比核 `win-unpacked` 更贴近用户拿到的东西），再对 `app.asar` 单独列一次 ——
 * asar 是自定义格式，7za 读不了，要用 `@electron/asar`。
 *
 * 用法：
 *   node scripts/check-package-content.mjs
 *   node scripts/check-package-content.mjs release-107/图压压-1.0.7-setup.exe
 */

import { existsSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** 安装包路径：命令行参数，或自动找 release/ 下最新的那个 */
function findInstaller() {
  if (process.argv[2] !== undefined) return resolve(ROOT, process.argv[2])
  const dir = resolve(ROOT, 'release')
  if (!existsSync(dir)) return null
  const exe = readdirSync(dir)
    .filter((f) => f.endsWith('.exe'))
    .sort()
    .pop()
  return exe === undefined ? null : join(dir, exe)
}

/** electron-builder 自带的 7za */
function find7za() {
  const base = resolve(process.env['LOCALAPPDATA'] ?? '', 'electron-builder/Cache')
  if (!existsSync(base)) return null
  for (const entry of readdirSync(base)) {
    if (!entry.startsWith('7zip')) continue
    const bin = join(base, entry)
    for (const sub of readdirSync(bin)) {
      const candidate = join(bin, sub, 'bin', '7za.exe')
      if (existsSync(candidate)) return candidate
    }
  }
  return null
}

const INSTALLER = findInstaller()
if (INSTALLER === null || !existsSync(INSTALLER)) {
  console.error('[pkg] 找不到安装包。先跑 npm run build。')
  process.exit(1)
}

const SEVEN_ZIP = find7za()
if (SEVEN_ZIP === null) {
  console.error('[pkg] 找不到 electron-builder 自带的 7za。')
  process.exit(1)
}

console.log(`[pkg] 安装包：${INSTALLER}`)

/**
 * 不该出现在包里的东西。
 *
 * ⚠️ **路径分隔符与位置都要考虑。**
 *
 * 第一版写成 `/\\tests\\/i`（要求前后都有反斜杠），自检一跑就露了：
 * **顶层目录在 7za 清单里是 `tests\fixtures\...`，前面没有反斜杠**，
 * 于是这条规则永远不命中 —— 而顶层正是最该拦的地方。
 *
 * 所以统一用 `(?:^|[\\/\s])名字[\\/]` 这种写法：前面可以是行首、空白或任一种分隔符。
 * 自检（见文件末尾）会拿一份「故意混进违规内容」的清单逐条验证，
 * **规则不命中就报失败** —— 免得哪天改坏了还一直是绿的。
 */
const FORBIDDEN = [
  // `.workbuddy-ai` 前面是点号，不加前缀限制 —— 这个名字本身足够独特
  { pattern: /workbuddy/i, why: '技能目录（9.3MB）' },
  { pattern: /(?:^|[\\/\s])prototype[\\/]/i, why: '原型' },
  { pattern: /(?:^|[\\/\s])tests[\\/]/i, why: '测试图（60MB）' },
  { pattern: /(?:^|[\\/\s])scripts[\\/]/i, why: '开发脚本' },
  { pattern: /(?:^|[\\/\s])docs[\\/]/i, why: '文档' },
  { pattern: /\.ts$/i, why: 'TypeScript 源码' },
  { pattern: /\.spec\./i, why: '测试文件' },
  { pattern: /\.map$/i, why: 'source map' }
]

/** 允许出现在 node_modules 里的运行时依赖（含传递依赖） */
const ALLOWED_PACKAGES = new Set([
  'sharp',
  '@img',
  'detect-libc',
  'semver',
  'heic-decode',
  'libheif-js',
  'zustand'
])

const failures = []

/*
 * 先自检：规则必须真的会命中。
 *
 * **一条永远不命中的规则和没有规则是一样的，而且更危险** —— 它给人虚假的安全感。
 * 第一版就在这里翻过车：`/\\tests\\/i` 要求路径前有反斜杠，而顶层目录没有，
 * 于是「测试图有没有进包」这一条一直在空转。
 *
 * 所以每次跑都先拿一份故意混进违规内容的清单过一遍，有规则不命中就当场失败。
 */
const SELF_TEST = [
  { line: '  ....A  9999  x  .workbuddy-ai\\skills\\foo\\SKILL.md', expect: '技能目录' },
  { line: '  ....A  2222  x  prototype\\index.html', expect: '原型' },
  { line: '  ....A  8888  x  tests\\fixtures\\huge-8000.jpg', expect: '测试图' },
  { line: '  ....A  7777  x  scripts\\smoke.mjs', expect: '开发脚本' },
  { line: '  ....A  6666  x  docs\\decisions.md', expect: '文档' },
  { line: '  ....A  5555  x  src\\main\\index.ts', expect: 'TypeScript 源码' },
  { line: '  ....A  4444  x  src\\main\\index.spec.ts', expect: '测试文件' },
  { line: '  ....A  3333  x  out\\renderer\\index.js.map', expect: 'source map' }
]

console.log('\n[pkg] 自检（规则必须真的会命中）：')
for (const t of SELF_TEST) {
  const rule = FORBIDDEN.find((r) => r.why.startsWith(t.expect))
  const fired = rule !== undefined && rule.pattern.test(t.line)
  if (!fired) failures.push(`规则「${t.expect}」不会命中 ${t.line.trim()} —— 它是空断言`)
  console.log(`  ${fired ? '通过' : '失败'}  ${t.expect} 的规则会命中`)
}

const listing = execFileSync(SEVEN_ZIP, ['l', INSTALLER], { encoding: 'utf8', maxBuffer: 64 << 20 })
const lines = listing.split(/\r?\n/)

console.log('\n[pkg] 不该出现的内容：')
for (const rule of FORBIDDEN) {
  const hits = lines.filter((l) => rule.pattern.test(l))
  const ok = hits.length === 0
  if (!ok) failures.push(`包里出现了${rule.why}（${hits.length} 条）`)
  console.log(`  ${ok ? '通过' : '失败'}  没有${rule.why}${ok ? '' : `（${hits.length} 条）`}`)
}

// node_modules 只该有白名单里的包
const pkgs = new Set()
for (const l of lines) {
  const m = /node_modules\\([^\\]+)/.exec(l)
  if (m !== null) pkgs.add(m[1])
}
const extra = [...pkgs].filter((p) => !ALLOWED_PACKAGES.has(p))
const pkgsOk = extra.length === 0
if (!pkgsOk) failures.push(`node_modules 里有计划外的包：${extra.join(', ')}`)
console.log(
  `  ${pkgsOk ? '通过' : '失败'}  node_modules 只有运行时依赖（${[...pkgs].sort().join(', ')}）`
)

// asar 内部：只该有 out/ 与 package.json
const asarPath = resolve(dirname(INSTALLER), 'win-unpacked', 'resources', 'app.asar')
const asarAlt = resolve(ROOT, 'release/win-unpacked/resources/app.asar')
const asarFile = existsSync(asarPath) ? asarPath : asarAlt

if (!existsSync(asarFile)) {
  console.log('  (跳过 asar 检查：找不到 app.asar，装包后原始目录可能已清理)')
} else {
  const { listPackage } = await import('@electron/asar')
  const list = listPackage(asarFile)
  // asar 的路径以 `\` 开头（如 `\out\main\index.js`），先规整掉
  const top = list
    .filter((f) => !f.includes('node_modules'))
    .map((f) => f.replace(/^\\+/, ''))
    .filter((f) => f.length > 0 && !f.includes('\\'))
  const expected = ['out', 'package.json']
  const asarOk = top.length === expected.length && expected.every((e) => top.includes(e))
  if (!asarOk) failures.push(`app.asar 顶层多了东西：${top.join(', ')}`)
  console.log(`  ${asarOk ? '通过' : '失败'}  app.asar 顶层只有 out 与 package.json（${top.join(', ')}）`)

  const devDeps = ['react', 'react-dom', 'vite', 'electron', 'typescript', 'vitest', 'tailwindcss']
  const leaked = devDeps.filter((d) => list.some((f) => f.includes(`node_modules\\${d}`)))
  const devOk = leaked.length === 0
  if (!devOk) failures.push(`asar 里混进了开发依赖：${leaked.join(', ')}`)
  console.log(`  ${devOk ? '通过' : '失败'}  没有开发依赖混进 asar`)
}

if (failures.length > 0) {
  console.error(`\n[pkg] 失败 ${failures.length} 项：`)
  for (const f of failures) console.error(`  - ${f}`)
  process.exitCode = 1
} else {
  console.log('\n[pkg] 全部通过')
}
