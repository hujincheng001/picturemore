/**
 * 数引用：找出「导出了但产品代码里没人用」的符号。
 *
 * 这类问题不报错、不让测试变红 —— 代码本身是对的，只是没人调用。
 * 本项目靠它找出过三处（`revealInFolder` 孤儿通道、`error` 字段未消费、
 * `ProbeResult.icc` 未消费），都不是读代码能看出来的。
 *
 * **判据要准，否则工具会被忽略。** 第一版把「定义文件内使用」也算成孤儿，
 * 30 个结果里 28 个是误报（`*Props` 接口、类型别名、只在同文件里用的函数）。
 * 误报率 93% 的工具和一个永远绿的护栏一样没用 —— 所以现在：
 *
 * - 统计范围包含**定义文件自身**（同文件里用了就是接上了）
 * - 排除声明那一行本身
 * - 测试文件单独算：只被测试引用 = 没接到产品上（但仍会报出来，标成另一类）
 *
 * 用法：node scripts/find-orphans.mjs
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOTS = ['src']

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.tsx?$/.test(full)) out.push(full)
  }
  return out
}

const files = ROOTS.flatMap((r) => walk(r))
const isTest = (f) => /\.spec\.tsx?$/.test(f)

/** 收集每个 export 的具名符号 */
const exported = new Map()
for (const file of files) {
  const src = readFileSync(file, 'utf8')
  const re = /^export (?:async )?(?:function|const|class|interface|type|enum) (\w+)/gm
  for (const m of src.matchAll(re)) {
    if (!exported.has(m[1])) exported.set(m[1], file)
  }
}

const sources = files.map((f) => ({ f, src: readFileSync(f, 'utf8') }))

/**
 * 数一个名字出现了几次，**减去声明本身那一次**。
 *
 * 第一版是「跳过声明那一整行」，太激进了：`export function X(props: XProps)` 这一行
 * 同时是 X 的声明和 XProps 的使用，整行跳过就把 XProps 误判成孤儿了。
 * 所以改成先全数、再减一 —— 声明必然占一次。
 */
function countUses(name, { includeTests }) {
  const re = new RegExp(`\\b${name}\\b`, 'g')
  let n = 0
  for (const { f, src } of sources) {
    if (!includeTests && isTest(f)) continue
    n += (src.match(re) ?? []).length
  }
  return Math.max(0, n - 1)
}

const productOrphans = []
const testOnly = []

for (const [name, def] of exported) {
  const inProduct = countUses(name, { includeTests: false })
  if (inProduct > 0) continue

  const inTests = countUses(name, { includeTests: true })
  if (inTests > 0) testOnly.push({ name, def })
  else productOrphans.push({ name, def })
}

console.log(`[orphans] 扫了 ${exported.size} 个导出\n`)

if (productOrphans.length === 0 && testOnly.length === 0) {
  console.log('产品代码与测试都在用，没有孤儿。')
} else {
  if (productOrphans.length > 0) {
    console.log(`完全没人引用（${productOrphans.length} 个）：`)
    for (const o of productOrphans) console.log(`  ${o.name.padEnd(26)} ${o.def}`)
    console.log('')
  }
  if (testOnly.length > 0) {
    console.log(`只被测试引用（${testOnly.length} 个）—— 没接到产品上，但可能是给未来用的：`)
    for (const o of testOnly) console.log(`  ${o.name.padEnd(26)} ${o.def}`)
    console.log('')
  }
  console.log('注意：只数「名字有没有出现」，不判断是不是真的用上了。')
  console.log('接口与类型别名可能因为写法特殊而漏判，需要人工看一眼。')
}
