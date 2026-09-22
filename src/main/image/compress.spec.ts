import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compressOne, hasAtMostColours, targetFormat } from './compress'
import { probe } from './probe'
import { qualityFloor, targetBytes } from './plan'

const F = resolve(__dirname, '../../../tests/fixtures')
const file = (name: string): Buffer => readFileSync(resolve(F, name))
const has = (name: string): boolean => existsSync(resolve(F, name))

/**
 * 黄金测试（SPEC §10.1）。每次改动都必须全绿。
 *
 * 对每张 fixture，在 p ∈ {20, 45, 70, 85} 各跑一次，断言：
 *   1. 输出宽高 === 输入宽高        ← 承诺二
 *   2. 输出字节 <= 输入字节          ← 压不动就返回原图
 *   3. p <= 70 时 quality >= 82      ← 感知无损底线
 *   4. 输出格式 === 目标格式（除非原样返回了原文件）
 *   5. 有 alpha 的图转 JPG 后 flattened === true
 */
const FILES = [
  'noise-hi.jpg',
  'flat-solid.png',
  'alpha-cutout.png',
  'tiny-1x1.png',
  'huge-8000.jpg',
  'sample.webp',
  'sample.avif',
  'oriented-6.jpg',
  'iphone-portrait.heic'
].filter(has)

const PERCENTS = [20, 45, 70, 85]

/**
 * 单张的测试预算。
 *
 * `huge-8000.jpg` 是 48MP 纯噪声，p=20 时**单独跑要 104s**（见 docs/decisions.md 的 T7-3）：
 * 底线命中目标，二分要跑满 5 到 6 次，每次约 23s。
 *
 * 原来给的是固定的 120s，全量并行时机器负载上来就偶发超时 ——
 * **这类「测试本身很慢」的用例必须给足预算，不能让它变成 flaky**：
 * 一个时红时绿的测试，最后一定会被人当成噪音忽略掉，那比没有测试更糟。
 */
const TIMEOUT_MS: Record<string, number> = {
  'huge-8000.jpg': 300_000,
  'noise-hi.jpg': 180_000,
  'iphone-portrait.heic': 120_000
}
const budgetFor = (name: string): number => TIMEOUT_MS[name] ?? 60_000

describe('compressOne 黄金断言', () => {
  for (const name of FILES) {
    for (const p of PERCENTS) {
      it(`${name} @ ${p}%`, async () => {
        const buf = file(name)
        const src = await probe(buf)
        const { data, result } = await compressOne({
          buf,
          shrinkPercent: p,
          outputFormat: 'keep',
          probe: src
        })

        // 1. 尺寸绝不变（承诺二）
        expect(`${result.width}x${result.height}`).toBe(`${src.width}x${src.height}`)

        // 2. 不产出比原图更大的文件
        expect(data.length).toBeLessThanOrEqual(buf.length)
        expect(result.bytes).toBe(data.length)

        // 3. 质量底线
        if (result.quality !== null) {
          expect(result.quality).toBeGreaterThanOrEqual(qualityFloor(p))
        }

        // 4. 格式：要么是目标格式，要么是原样返回了原文件
        const want = targetFormat(src, 'keep')
        if (result.keptOriginal) {
          expect(result.format).toBe(src.format)
        } else {
          expect(result.format).toBe(want)
        }

        // undershot 的定义就是"没压到目标体积"
        expect(result.undershot).toBe(result.bytes > targetBytes(buf.length, p))
      }, budgetFor(name))
    }
  }

  it(
    '透明 PNG 转 JPG 时标记 flattened，且输出确实是 JPG',
    async () => {
      const buf = file('alpha-cutout.png')
      const src = await probe(buf)
      expect(src.hasAlpha).toBe(true)

      const { result } = await compressOne({
        buf,
        shrinkPercent: 45,
        outputFormat: 'jpeg',
        probe: src
      })
      expect(result.flattened).toBe(true)
      expect(result.format).toBe('jpeg')
      expect(result.width).toBe(src.width)
      expect(result.height).toBe(src.height)
    },
    120_000
  )

  it(
    '不透明的图转 JPG 时不标记 flattened',
    async () => {
      const buf = file('oriented-6.jpg')
      const src = await probe(buf)
      const { result } = await compressOne({
        buf,
        shrinkPercent: 45,
        outputFormat: 'jpeg',
        probe: src
      })
      expect(result.flattened).toBe(false)
    },
    120_000
  )

  it(
    'PNG 输出：纯色图走调色板，照片不走（走会压出色带）',
    async () => {
      // flat-solid 只有一种颜色，应该走调色板
      const flat = file('flat-solid.png')
      const flatSrc = await probe(flat)
      const a = await compressOne({
        buf: flat,
        shrinkPercent: 45,
        outputFormat: 'png',
        probe: flatSrc
      })
      expect(a.result.format).toBe('png')
      expect(a.result.width).toBe(2000)
      expect(a.result.height).toBe(1500)

      // 照片转 PNG 必然变大，所以应该原样返回原文件（而不是交出一个更大的 PNG）
      const noisy = file('noise-hi.jpg')
      const noisySrc = await probe(noisy)
      const b = await compressOne({
        buf: noisy,
        shrinkPercent: 45,
        outputFormat: 'png',
        probe: noisySrc
      })
      expect(b.result.keptOriginal).toBe(true)
      // 原样返回的是源文件，所以格式是 jpeg 不是 png
      expect(b.result.format).toBe('jpeg')
      expect(b.result.width).toBe(4000)
      expect(b.result.height).toBe(3000)
    },
    120_000
  )

  it('颜色数判断：纯色通过，照片不通过', async () => {
    expect(await hasAtMostColours({ kind: 'buffer', buf: file('flat-solid.png') }, 256)).toBe(true)
    expect(await hasAtMostColours({ kind: 'buffer', buf: file('tiny-1x1.png') }, 256)).toBe(true)
    expect(await hasAtMostColours({ kind: 'buffer', buf: file('noise-hi.jpg') }, 256)).toBe(false)
  })

  it('颜色数判断：alpha 不同的同色像素算作不同颜色', async () => {
    // 4 个像素，3 种不同的 RGBA 组合（两个是同一个不透明色，一个是半透明，一个是另一个色）
    const raw = Buffer.from([
      10, 20, 30, 255, 10, 20, 30, 128, 10, 20, 30, 255, 200, 200, 200, 255
    ])
    const input = { kind: 'raw' as const, buf: raw, width: 2, height: 2 }
    // 3 种颜色，所以上限 2 时不通过，上限 3 时通过
    expect(await hasAtMostColours(input, 2)).toBe(false)
    expect(await hasAtMostColours(input, 3)).toBe(true)
  })

  it('颜色数判断：忽略 alpha 就会把半透明误判成同色', async () => {
    // 只有两个像素，RGB 相同但 alpha 不同。按 RGBA 算是 2 种颜色
    const raw = Buffer.from([10, 20, 30, 255, 10, 20, 30, 128])
    const input = { kind: 'raw' as const, buf: raw, width: 2, height: 1 }
    expect(await hasAtMostColours(input, 1)).toBe(false)
    expect(await hasAtMostColours(input, 2)).toBe(true)
  })
})

describe('compressOne 的 HEIC 路径', () => {
  it.skipIf(!has('iphone-portrait.heic'))(
    'HEIC 在 keep 下落到 JPG，尺寸与显示方向一致',
    async () => {
      const buf = file('iphone-portrait.heic')
      const src = await probe(buf)
      const { result } = await compressOne({
        buf,
        shrinkPercent: 45,
        outputFormat: 'keep',
        probe: src
      })

      // heic-decode 已应用方向，probe 给的就是显示尺寸（宽 < 高）
      expect(src.width).toBeLessThan(src.height)
      expect(`${result.width}x${result.height}`).toBe(`${src.width}x${src.height}`)
      expect(result.format).toBe('jpeg')
    },
    120_000
  )

  it.skipIf(!has('iphone-landscape.heic'))(
    '横拍 HEIC 同样保住显示尺寸',
    async () => {
      const buf = file('iphone-landscape.heic')
      const src = await probe(buf)
      const { result } = await compressOne({
        buf,
        shrinkPercent: 45,
        outputFormat: 'keep',
        probe: src
      })
      expect(`${result.width}x${result.height}`).toBe(`${src.width}x${src.height}`)
      expect(result.format).toBe('jpeg')
    },
    120_000
  )
})

describe('targetFormat', () => {
  const fake = (format: string) => ({ format }) as never

  it('用户指定格式时直接用', () => {
    expect(targetFormat(fake('heic'), 'webp')).toBe('webp')
    expect(targetFormat(fake('png'), 'jpeg')).toBe('jpeg')
  })

  it('keep 时按源格式落到能写回去的格式', () => {
    expect(targetFormat(fake('jpeg'), 'keep')).toBe('jpeg')
    expect(targetFormat(fake('png'), 'keep')).toBe('png')
    expect(targetFormat(fake('webp'), 'keep')).toBe('webp')
  })

  it('HEIC 与 AVIF 在 keep 下落到 JPG（sharp 写不回这两个格式）', () => {
    expect(targetFormat(fake('heic'), 'keep')).toBe('jpeg')
    expect(targetFormat(fake('avif'), 'keep')).toBe('jpeg')
  })
})

describe('PNG 到底能不能压动（2026-09-22 实测后补）', () => {
  /*
   * 起因：用户看到界面提示「PNG 体积基本压不下来」之后问「那其他格式转 PNG 是不是都压不动」。
   *
   * 实测（65% 档，全部 fixture 转 PNG）：
   *   flat-solid.png    44KB ->  3KB  -93%
   *   alpha-cutout.png  31KB ->  2KB  -95%
   *   oriented-6.jpg     7KB ->  2KB  -78%   <- 输入是 JPG 也压得动
   *   noise-hi.jpg    11.9MB -> 交原图
   *   sample.webp      3.1MB -> 交原图
   *
   * 分界线是**颜色数**不是输入格式。原提示说「基本压不下来」是错的，
   * 而截图与纯色图恰恰是「发不出去的图」里很大的一类 —— 那句话会直接劝退这部分用户。
   *
   * 这里把「低色数转 PNG 能大幅压缩」这条反直觉的事实钉住。
   */
  it(
    '低色数图转 PNG 能压掉大半（哪怕输入是 JPG）',
    async () => {
      // oriented-6.jpg 是 JPG，但它是低色数的 —— 输入格式不是判据，色数才是
      const buf = file('oriented-6.jpg')
      const src = await probe(buf)
      expect(src.format).toBe('jpeg')

      const { result } = await compressOne({
        buf,
        shrinkPercent: 65,
        outputFormat: 'png',
        probe: src
      })

      expect(result.format).toBe('png')
      expect(result.keptOriginal, '这张图转 PNG 不该压不动').toBe(false)
      const saved = Math.round((1 - result.bytes / buf.length) * 100)
      expect(saved, '只压掉了 ' + saved + '%').toBeGreaterThan(70)
    },
    120_000
  )

  it(
    '纯色图转 PNG 也能压掉大半',
    async () => {
      const buf = file('flat-solid.png')
      const src = await probe(buf)
      const { result } = await compressOne({
        buf,
        shrinkPercent: 65,
        outputFormat: 'png',
        probe: src
      })
      expect(result.keptOriginal).toBe(false)
      expect(1 - result.bytes / buf.length).toBeGreaterThan(0.7)
    },
    120_000
  )
})
