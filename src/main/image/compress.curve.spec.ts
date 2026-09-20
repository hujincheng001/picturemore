import { describe, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { encode } from './encode'
import type { EncodeInput } from './encode'
import { probe } from './probe'
import { canSharpDecodeHeic, decodeHeic } from './heic'
import { targetBytes } from './plan'

/**
 * 压缩率曲线测量。**不是断言测试**，默认跳过，用来回答 M0-5 留下的问题：
 * HEIC 转成 JPG 到底能不能压小？能压到多少？
 *
 * 跑法：
 *   MEASURE=1 npx vitest run src/main/image/compress.curve.spec.ts
 *
 * 输出一张表：每张 fixture 在各个质量档下的输出字节数，以及相对原图的百分比。
 * 这张表是调 FLOOR_PERCEPTUAL / 判断 HEIC 天花板的事实依据，改动前先看它。
 */

const F = resolve(__dirname, '../../../tests/fixtures')
const file = (name: string): Buffer => readFileSync(resolve(F, name))
const has = (name: string): boolean => existsSync(resolve(F, name))

const QUALITIES = [62, 70, 75, 82, 85, 90, 95]

const FILES = [
  'noise-hi.jpg',
  'flat-solid.png',
  'alpha-cutout.png',
  'tiny-1x1.png',
  'huge-8000.jpg',
  'sample.webp',
  'sample.avif',
  'oriented-6.jpg',
  'iphone-portrait.heic',
  'iphone-landscape.heic'
].filter(has)

const pct = (a: number, b: number) => `${((a / b) * 100).toFixed(1)}%`
const kb = (n: number) => `${(n / 1024).toFixed(0)}KB`

describe.skipIf(process.env['MEASURE'] !== '1')('压缩率曲线', () => {
  for (const name of FILES) {
    it(
      name,
      async () => {
        const buf = file(name)
        const src = await probe(buf)

        let base: EncodeInput
        let tagAsP3 = false
        if (src.format === 'heic' && !(await canSharpDecodeHeic())) {
          const d = await decodeHeic(buf)
          base = { kind: 'raw', buf: d.data, width: d.width, height: d.height }
          tagAsP3 = true
        } else {
          base = { kind: 'buffer', buf }
        }

        const flattenTo = src.hasAlpha ? '#FFFFFF' : null

        console.log(`\n=== ${name} ===`)
        console.log(
          `  源：${src.format} ${src.width}x${src.height} ${kb(buf.length)}` +
            `${src.hasAlpha ? ' 有 alpha' : ''}${tagAsP3 ? ' 走 heic-decode raw' : ''}`
        )
        console.log(`  目标体积（p=20 / 45 / 70 / 85）：` +
          [20, 45, 70, 85].map((p) => kb(targetBytes(buf.length, p))).join(' / '))

        const rows: string[] = []
        for (const q of QUALITIES) {
          const r = await encode(base, { format: 'jpeg', quality: q, palette: false }, {
            tagAsP3,
            flattenTo
          })
          rows.push(
            `  q=${String(q).padEnd(2)}  ${kb(r.data.length).padStart(8)}  ${pct(r.data.length, buf.length).padStart(7)}  ${r.width}x${r.height}`
          )
        }
        console.log('  质量档   输出体积   占原图    尺寸')
        console.log(rows.join('\n'))

        const smallest = await encode(base, { format: 'jpeg', quality: QUALITIES[0]!, palette: false }, {
          tagAsP3,
          flattenTo
        })
        console.log(
          `  -> 最低档 q=${QUALITIES[0]} 也只能压到 ${pct(smallest.data.length, buf.length)}` +
            `${smallest.data.length >= buf.length ? '（比原图还大，会走 keptOriginal）' : ''}`
        )
      },
      180_000
    )
  }
})
