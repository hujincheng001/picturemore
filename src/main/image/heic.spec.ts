import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { canSharpDecodeHeic, decodeHeic } from './heic'
import { ImageEngineError } from './verify'

const P = 'tests/fixtures/iphone-portrait.heic'
const has = existsSync(P)

describe('heic', () => {
  it('sharp 预编译版读不了 HEIC（预期为 false）', async () => {
    expect(await canSharpDecodeHeic()).toBe(false)
  })

  it.skipIf(!has)('heic-decode 能解出正确尺寸的 RGBA', async () => {
    const r = await decodeHeic(readFileSync(P))
    expect(r.width).toBeGreaterThan(1000)
    expect(r.height).toBeGreaterThan(1000)
    expect(r.data.length).toBe(r.width * r.height * 4)
  })

  it.skipIf(!has)('竖拍 HEIC 解出来的宽高已是显示方向（宽 < 高）', async () => {
    // M0 结论：容器 ispe 是 5712x4284 + irot 270，解出来必须是 4284x5712
    const r = await decodeHeic(readFileSync(P))
    expect(r.width).toBeLessThan(r.height)
  })

  it('不是 HEIC 的输入会抛 HEIC_DECODE_FAILED', async () => {
    await expect(decodeHeic(Buffer.from('not an image at all'))).rejects.toThrow(ImageEngineError)
  })
})
