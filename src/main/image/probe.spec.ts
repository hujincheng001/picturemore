import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { probe } from './probe'

const F = 'tests/fixtures'
const has = (f: string): boolean => existsSync(`${F}/${f}`)

describe('probe', () => {
  it('读出 PNG 的尺寸与透明通道', async () => {
    const r = await probe(readFileSync(`${F}/alpha-cutout.png`))
    expect(r.format).toBe('png')
    expect(r.width).toBe(1200)
    expect(r.height).toBe(1200)
    expect(r.hasAlpha).toBe(true)
  })

  it('纯色 PNG 无透明通道', async () => {
    const r = await probe(readFileSync(`${F}/flat-solid.png`))
    expect(r.format).toBe('png')
    expect(r.hasAlpha).toBe(false)
  })

  it('读出 JPG 的 orientation 标签', async () => {
    const r = await probe(readFileSync(`${F}/oriented-6.jpg`))
    expect(r.format).toBe('jpeg')
    expect(r.orientation).toBe(6)
  })

  it('1x1 边界图不崩', async () => {
    const r = await probe(readFileSync(`${F}/tiny-1x1.png`))
    expect(r.width).toBe(1)
    expect(r.height).toBe(1)
  })

  it('bytes 等于传入 buffer 的长度', async () => {
    const buf = readFileSync(`${F}/flat-solid.png`)
    expect((await probe(buf)).bytes).toBe(buf.length)
  })

  it.skipIf(!has('sample.avif'))('AVIF 被识别成 avif 而不是 heic', async () => {
    const r = await probe(readFileSync(`${F}/sample.avif`))
    expect(r.format).toBe('avif')
    expect(r.width).toBe(1600)
  })

  it.skipIf(!has('sample.webp'))('WebP 被正确识别', async () => {
    const r = await probe(readFileSync(`${F}/sample.webp`))
    expect(r.format).toBe('webp')
    expect(r.width).toBe(2400)
  })

  it.skipIf(!has('iphone-portrait.heic'))('读出 HEIC 的显示尺寸与格式', async () => {
    const r = await probe(readFileSync(`${F}/iphone-portrait.heic`))
    expect(r.format).toBe('heic')
    // 容器存储是 5712x4284 + irot 270，显示尺寸应为 4284x5712
    expect(r.width).toBeLessThan(r.height)
    expect(r.width).toBeGreaterThan(1000)
  })

  it('不是图片的输入会抛错', async () => {
    await expect(probe(Buffer.from('definitely not an image'))).rejects.toThrow()
  })
})
