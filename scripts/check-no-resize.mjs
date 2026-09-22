/**
 * 承诺二的自动化护栏：src/main/image/ 下不允许出现任何会改变像素尺寸的 sharp 调用。
 *
 * SPEC.md §15 给的写法是 `! grep -rn '\.resize(' src/main/image/`，
 * 但 npm 在 Windows 上默认用 cmd.exe 执行脚本，`!` 不是合法命令，
 * 所以改成一个等价的 Node 脚本。命令名与语义不变。
 *
 * **不止 `.resize(`。** SPEC §14.1 单独点出了 `.rotate()`：orientation 为 5/6/7/8 时
 * 它真的旋转像素，宽高互换 —— 而我们的方向处理是「只写 orientation 标签，不动像素」
 * （见 docs/decisions.md 的 M0-2）。`.extract()` 裁剪、`.trim()` 去边同样会改尺寸。
 * 这几个都是「写起来很自然、后果很严重」，所以一起拦。
 *
 * 用法：node scripts/check-no-resize.mjs
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = 'src/main/image'

/** 每一对都是「写法 → 为什么会改尺寸」 */
const FORBIDDEN = [
  { pattern: /\.resize\s*\(/, why: '直接改尺寸，违反承诺二' },
  { pattern: /\.rotate\s*\(/, why: 'orientation 5-8 时真旋转像素，宽高互换（SPEC §14.1）' },
  { pattern: /\.extract\s*\(/, why: '裁剪会改尺寸' },
  { pattern: /\.trim\s*\(/, why: '去边会改尺寸' }
]

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (full.endsWith('.ts')) out.push(full)
  }
  return out
}

let files
try {
  files = walk(ROOT)
} catch {
  // Task 2 之前这个目录还不存在，不算失败
  console.log(`[lint:no-resize] ${ROOT} 尚不存在，跳过`)
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
  console.error('[lint:no-resize] 发现会改变像素尺寸的调用，违反承诺二「只改体积不改尺寸」：')
  for (const h of hits) console.error('  ' + h)
  process.exit(1)
}

console.log(`[lint:no-resize] 通过，扫描 ${files.length} 个文件，零命中`)

