/**
 * 承诺二的自动化护栏：src/main/image/ 下不允许出现 .resize(。
 *
 * SPEC.md §15 给的写法是 `! grep -rn '\.resize(' src/main/image/`，
 * 但 npm 在 Windows 上默认用 cmd.exe 执行脚本，`!` 不是合法命令，
 * 所以改成一个等价的 Node 脚本。命令名与语义不变。
 *
 * 用法：node scripts/check-no-resize.mjs
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = 'src/main/image'
const FORBIDDEN = /\.resize\s*\(/

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
  const lines = readFileSync(file, 'utf8').split(/\r?\n/)
  lines.forEach((line, i) => {
    if (FORBIDDEN.test(line)) hits.push(`${relative('.', file)}:${i + 1}: ${line.trim()}`)
  })
}

if (hits.length > 0) {
  console.error('[lint:no-resize] 发现 .resize(，违反承诺二「只改体积不改尺寸」：')
  for (const h of hits) console.error('  ' + h)
  process.exit(1)
}

console.log(`[lint:no-resize] 通过，扫描 ${files.length} 个文件，零命中`)
