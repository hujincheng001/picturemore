/**
 * 渲染层的边界守卫。
 *
 * SPEC.md §14.1 要求「加 ESLint `no-restricted-imports` 禁止 renderer 引用 sharp」。
 * 项目里没有 ESLint（AGENTS.md 的依赖白名单里也没有它），所以用一个等价的小脚本。
 *
 * 为什么这条值得单独守：**渲染层引用这些模块不会在开发时报错**。
 * - `sharp` / `electron` / `node:*` 在 Vite 的 client 构建里会被当成普通包处理，
 *   打包可能成功，运行时才崩（`require is not defined` 之类）
 * - 真崩了也是白屏，排查起来要从头找
 *
 * 渲染进程能用的只有 `window.pictureMore`（preload 的白名单）与 shared 里的纯类型。
 * 这是红线三的静态防线 —— 冒烟脚本会在运行时验一次，但那个要起 Electron 才跑得到。
 *
 * 用法：node scripts/check-renderer-boundary.mjs
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = 'src/renderer'

/**
 * 禁止出现在渲染层的模块。
 *
 * `electron` 与 `node:*` 是红线三；`sharp` 与 `heic-decode` 是主进程专属的重活；
 * `@img/*` 是 sharp 的预编译二进制包。
 */
const FORBIDDEN = [
  { pattern: /from\s+['"]electron['"]/, why: '红线三：渲染层拿不到 electron' },
  { pattern: /from\s+['"]node:/, why: '红线三：渲染层不碰 Node 内置模块' },
  { pattern: /from\s+['"]sharp['"]/, why: 'sharp 只能在主进程用（SPEC §14.1）' },
  { pattern: /from\s+['"]heic-decode['"]/, why: '解码只能在主进程做' },
  { pattern: /from\s+['"]@img\//, why: 'sharp 的原生二进制包' },
  { pattern: /require\s*\(\s*['"](?:electron|sharp|node:)/, why: '同上，且渲染层没有 require' },
  // 相对路径往上跳出 renderer 也算越界：shared 是允许的，main / preload 不是
  { pattern: /from\s+['"]\.\.\/\.\.\/main\//, why: '不能引用主进程实现' },
  { pattern: /from\s+['"]\.\.\/\.\.\/preload\//, why: '不能引用 preload 实现' }
]

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (/\.tsx?$/.test(full)) out.push(full)
  }
  return out
}

let files
try {
  files = walk(ROOT)
} catch {
  console.log(`[lint:renderer-boundary] ${ROOT} 尚不存在，跳过`)
  process.exit(0)
}

const hits = []
for (const file of files) {
  readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .forEach((line, i) => {
      for (const rule of FORBIDDEN) {
        if (rule.pattern.test(line)) {
          hits.push(`${relative('.', file)}:${i + 1}: ${line.trim()}\n      → ${rule.why}`)
        }
      }
    })
}

if (hits.length > 0) {
  console.error('[lint:renderer-boundary] 渲染层引用了不该引用的模块：')
  for (const h of hits) console.error('  ' + h)
  process.exit(1)
}

console.log(`[lint:renderer-boundary] 通过，扫描 ${files.length} 个文件，零命中`)
