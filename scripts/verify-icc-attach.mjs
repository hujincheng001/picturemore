/**
 * 验证 withIccProfile('p3') 到底会不会改像素。
 *
 * 背景：sharp 的文档写的是 "Transform using an ICC profile and attach to the output image"，
 * 字面意思是会做色彩转换。但 M0-3 的记录写的是"只挂标签、不动像素"。两者矛盾，
 * 而这一条直接决定 HEIC（Display P3）路径的正确性，所以单独测一遍并留下可复跑的脚本。
 *
 * 判据：把同一份 raw 分别按"不挂 profile"和"挂 p3"编码，再解回来逐像素比。
 * 差值只有舍入级别（<=2）说明只是挂标签；若是几十的量级说明真的转了色。
 *
 * 用法：npm run verify:icc
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import heicDecode from 'heic-decode'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const HEIC = resolve(ROOT, 'tests/fixtures/iphone-portrait.heic')

const r = await heicDecode({ buffer: readFileSync(HEIC) })
const raw = Buffer.from(r.data.buffer, r.data.byteOffset, r.data.byteLength)
const rawOpts = { raw: { width: r.width, height: r.height, channels: 4 } }

console.log(`源：tests/fixtures/iphone-portrait.heic 解出 ${r.width}x${r.height} RGBA`)

/**
 * 编码后解回 raw，用于逐像素比较。
 *
 * 用 PNG 而不是 JPEG：PNG 无损，解回来的就是编码器写进去的像素。
 * 用 JPEG 的话编解码噪声本身就有 1/255 量级，会把"有没有转色"这个判断淹掉。
 */
async function roundTrip(build) {
  const out = await build(sharp(raw, rawOpts)).png({ compressionLevel: 0 }).toBuffer()
  const meta = await sharp(out).metadata()
  const back = await sharp(out).raw().toBuffer()
  return { meta, back }
}

const plain = await roundTrip((p) => p)
const withP3 = await roundTrip((p) => p.withIccProfile('p3'))
const attachOnly = await roundTrip((p) => p.withIccProfile('p3', { attach: false }))

function diff(a, b) {
  let sum = 0
  let max = 0
  let over8 = 0
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i])
    sum += d
    if (d > max) max = d
    if (d > 8) over8++
  }
  return {
    mean: (sum / a.length).toFixed(3),
    max,
    pct: ((over8 / a.length) * 100).toFixed(2)
  }
}

const size = (m) => (m.icc ? `${m.icc.length} 字节` : '无')

console.log('\n=== 输出 ICC 状态 ===')
console.log('  不挂 profile          : icc =', size(plain.meta))
console.log("  withIccProfile('p3')  : icc =", size(withP3.meta))
console.log('  attach:false          : icc =', size(attachOnly.meta))

const d1 = diff(plain.back, withP3.back)
const d2 = diff(plain.back, attachOnly.back)

console.log('\n=== 像素差异（相对「不挂 profile」）===')
console.log(`  withIccProfile('p3')  : 平均 ${d1.mean}/255  最大 ${d1.max}  >8 的像素 ${d1.pct}%`)
console.log(`  attach:false          : 平均 ${d2.mean}/255  最大 ${d2.max}  >8 的像素 ${d2.pct}%`)

console.log('\n=== 结论 ===')
if (Number(d1.mean) < 1 && d1.max <= 2) {
  console.log("  withIccProfile('p3') 只挂标签，不改像素。M0-3 的记录成立。")
} else {
  console.log(`  withIccProfile('p3') 改变了像素（平均 ${d1.mean}/255，最大 ${d1.max}）。`)
  console.log('  说明它真的做了 sRGB -> P3 的色彩转换，HEIC 路径不能直接这么用。')
}

// 落一份预览，便于人工确认画面没偏色
const preview = await sharp(raw, rawOpts).withIccProfile('p3').jpeg({ quality: 90 }).toBuffer()
const out = resolve(ROOT, 'tests/fixtures/_icc-p3-preview.jpg')
writeFileSync(out, preview)
console.log(`\n预览已写到 ${out}（_ 前缀，已在 .gitignore 里）`)
