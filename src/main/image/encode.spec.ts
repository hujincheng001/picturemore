import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import sharp from 'sharp'
import { encode } from './encode'
import type { EncodeInput, EncodeOptions } from './encode'

const F = resolve(__dirname, '../../../tests/fixtures')

const file = (name: string): Buffer => readFileSync(resolve(F, name))
const has = (name: string): boolean => existsSync(resolve(F, name))

/** 默认选项：不标 P3、不拍平。ICC 没有开关，一律保留（SPEC §4.3） */
const plain: EncodeOptions = { tagAsP3: false, flattenTo: null }

/** 生成一张小的不透明 raw RGBA，用来单独验证 raw 输入路径，避免动辄解 24MP */
function makeRaw(w: number, h: number): Buffer {
  const buf = Buffer.alloc(w * h * 4)
  for (let i = 0; i < buf.length; i += 4) {
    buf[i] = 200
    buf[i + 1] = 100
    buf[i + 2] = 50
    buf[i + 3] = 255
  }
  return buf
}

describe('encode 基本输出', () => {
  it('JPG 输出宽高与输入一致', async () => {
    const r = await encode(
      { kind: 'buffer', buf: file('noise-hi.jpg') },
      { format: 'jpeg', quality: 85, palette: false },
      plain
    )
    expect(r.width).toBe(4000)
    expect(r.height).toBe(3000)
    expect(r.format).toBe('jpeg')
  })

  it('透明 PNG 转 JPG 时被拍平，输出没有 alpha', async () => {
    const src = file('alpha-cutout.png')
    expect((await sharp(src).metadata()).hasAlpha).toBe(true)

    const r = await encode(
      { kind: 'buffer', buf: src },
      { format: 'jpeg', quality: 85, palette: false },
      { tagAsP3: false, flattenTo: '#FFFFFF' }
    )
    const out = await sharp(r.data).metadata()
    expect(r.format).toBe('jpeg')
    expect(out.hasAlpha).toBe(false)
    expect(out.width).toBe(1200)
    expect(out.height).toBe(1200)
  })

  it('PNG 不拍平时保留 alpha', async () => {
    const r = await encode(
      { kind: 'buffer', buf: file('alpha-cutout.png') },
      { format: 'png', quality: null, palette: false },
      plain
    )
    expect((await sharp(r.data).metadata()).hasAlpha).toBe(true)
  })

  it('PNG 调色板路径可用且尺寸不变', async () => {
    const r = await encode(
      { kind: 'buffer', buf: file('flat-solid.png') },
      { format: 'png', quality: null, palette: true },
      plain
    )
    expect(r.format).toBe('png')
    expect(r.width).toBe(2000)
    expect(r.height).toBe(1500)
  })

  it('WebP 输出尺寸不变', async () => {
    const r = await encode(
      { kind: 'buffer', buf: file('sample.webp') },
      { format: 'webp', quality: 80, palette: false },
      plain
    )
    expect(r.format).toBe('webp')
    expect(r.width).toBe(2400)
    expect(r.height).toBe(1600)
  })

  it('1x1 的极小图也能走通', async () => {
    const r = await encode(
      { kind: 'buffer', buf: file('tiny-1x1.png') },
      { format: 'jpeg', quality: 90, palette: false },
      plain
    )
    expect(r.width).toBe(1)
    expect(r.height).toBe(1)
  })

  it('没有质量档时 JPG 走默认 85，不报错', async () => {
    const r = await encode(
      { kind: 'buffer', buf: file('noise-hi.jpg') },
      { format: 'jpeg', quality: null, palette: false },
      plain
    )
    expect(r.format).toBe('jpeg')
  })
})

describe('encode 的元信息处理（M0-4 配方）', () => {
  it('orientation 被保留，不会被抹成 1', async () => {
    const src = file('oriented-6.jpg')
    expect((await sharp(src).metadata()).orientation).toBe(6)

    const r = await encode(
      { kind: 'buffer', buf: src },
      { format: 'jpeg', quality: 85, palette: false },
      plain
    )
    expect((await sharp(r.data).metadata()).orientation).toBe(6)
  })

  it('ICC 字节级原样保留（SPEC §4.3 的硬性要求）', async () => {
    const src = file('oriented-6.jpg')
    const before = (await sharp(src).metadata()).icc
    expect(before).toBeDefined()

    const r = await encode(
      { kind: 'buffer', buf: src },
      { format: 'jpeg', quality: 85, palette: false },
      plain
    )
    const after = (await sharp(r.data).metadata()).icc
    expect(after).toBeDefined()
    expect(Buffer.compare(Buffer.from(after!), Buffer.from(before!))).toBe(0)
  })

  it('三种输出格式都保住 ICC，没有哪条分支漏掉', async () => {
    const src = file('oriented-6.jpg')
    const before = Buffer.from((await sharp(src).metadata()).icc!)

    for (const fmt of ['jpeg', 'png', 'webp'] as const) {
      const r = await encode(
        { kind: 'buffer', buf: src },
        { format: fmt, quality: fmt === 'png' ? null : 85, palette: false },
        plain
      )
      const after = (await sharp(r.data).metadata()).icc
      expect(`${fmt}:${after ? Buffer.compare(Buffer.from(after), before) : 'missing'}`).toBe(
        `${fmt}:0`
      )
    }
  })

  it('EXIF 被剥掉但 orientation 留下（这正是 withExif({}) 的作用）', async () => {
    const src = file('oriented-6.jpg')
    const srcMeta = await sharp(src).metadata()
    expect(srcMeta.exif).toBeDefined()
    expect(srcMeta.exif!.length).toBeGreaterThan(150)

    const r = await encode(
      { kind: 'buffer', buf: src },
      { format: 'jpeg', quality: 85, palette: false },
      plain
    )
    const outMeta = await sharp(r.data).metadata()
    expect(outMeta.orientation).toBe(6)
    // 其余 EXIF 不该被原样带过去
    if (outMeta.exif) expect(outMeta.exif.length).toBeLessThan(srcMeta.exif!.length)
  })

  it('tagAsP3 给无标签的 raw 挂上 480 字节的 P3 profile', async () => {
    const input: EncodeInput = { kind: 'raw', buf: makeRaw(8, 6), width: 8, height: 6 }
    const r = await encode(
      input,
      { format: 'jpeg', quality: 90, palette: false },
      { tagAsP3: true, flattenTo: null }
    )
    const icc = (await sharp(r.data).metadata()).icc
    expect(icc).toBeDefined()
    expect(icc!.length).toBe(480)
  })

  it('tagAsP3 为 false 时 raw 输出不带 ICC', async () => {
    const input: EncodeInput = { kind: 'raw', buf: makeRaw(8, 6), width: 8, height: 6 }
    const r = await encode(
      input,
      { format: 'jpeg', quality: 90, palette: false },
      { tagAsP3: false, flattenTo: null }
    )
    expect((await sharp(r.data).metadata()).icc).toBeUndefined()
  })

  it('raw 输入输出尺寸就是传入的尺寸，一个像素都不多', async () => {
    const input: EncodeInput = { kind: 'raw', buf: makeRaw(13, 7), width: 13, height: 7 }
    const r = await encode(
      input,
      { format: 'png', quality: null, palette: false },
      { tagAsP3: false, flattenTo: null }
    )
    expect(r.width).toBe(13)
    expect(r.height).toBe(7)
  })
})

describe('encode 的尺寸不变量（红线）', () => {
  const cases: Array<[string, number, number]> = [
    ['noise-hi.jpg', 4000, 3000],
    ['flat-solid.png', 2000, 1500],
    ['alpha-cutout.png', 1200, 1200],
    ['tiny-1x1.png', 1, 1],
    ['oriented-6.jpg', 1200, 900],
    ['sample.webp', 2400, 1600],
    ['sample.avif', 1600, 1200]
  ]

  for (const [name, w, h] of cases) {
    it(`${name} 在三种输出格式下宽高都不变`, async () => {
      const buf = file(name)
      for (const fmt of ['jpeg', 'png', 'webp'] as const) {
        const r = await encode(
          { kind: 'buffer', buf },
          { format: fmt, quality: fmt === 'png' ? null : 80, palette: false },
          { tagAsP3: false, flattenTo: fmt === 'jpeg' ? '#FFFFFF' : null }
        )
        expect(`${name}->${fmt}:${r.width}x${r.height}`).toBe(`${name}->${fmt}:${w}x${h}`)
      }
    })
  }
})

describe('encode 的 HEIC raw 路径', () => {
  it.skipIf(!has('iphone-portrait.heic'))(
    '竖拍 HEIC 解出 raw 后编码，尺寸与显示方向一致且挂上 P3',
    async () => {
      const { default: heicDecode } = await import('heic-decode')
      const decoded = await heicDecode({ buffer: file('iphone-portrait.heic') })
      const raw = Buffer.from(
        decoded.data.buffer,
        decoded.data.byteOffset,
        decoded.data.byteLength
      )

      const r = await encode(
        { kind: 'raw', buf: raw, width: decoded.width, height: decoded.height },
        { format: 'jpeg', quality: 85, palette: false },
        { tagAsP3: true, flattenTo: null }
      )

      expect(r.width).toBe(decoded.width)
      expect(r.height).toBe(decoded.height)
      // 竖拍：宽 < 高，说明方向已由 heic-decode 应用过，encode 没有把它转回去
      expect(r.width).toBeLessThan(r.height)

      const meta = await sharp(r.data).metadata()
      expect(meta.icc).toBeDefined()
      expect(meta.icc!.length).toBe(480)
      // HEIC 路径不得写 orientation，否则二次旋转
      expect(meta.orientation === undefined || meta.orientation === 1).toBe(true)
    },
    30_000
  )
})
