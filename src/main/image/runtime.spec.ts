import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { configureImageRuntime } from './runtime'

/** sharp.cache() 返回的是 { memory: {current,high,max}, files: {...}, items: {...} } */
const maxes = () => {
  const c = sharp.cache()
  return { memory: c.memory.max, files: c.files.max, items: c.items.max }
}

describe('configureImageRuntime', () => {
  it('关掉 sharp 的内部缓存（SPEC §14 的 OOM 处置）', () => {
    configureImageRuntime()
    // max 全为 0 就是缓存关闭
    expect(maxes()).toEqual({ memory: 0, files: 0, items: 0 })
  })

  it('重复调用是安全的', () => {
    expect(() => {
      configureImageRuntime()
      configureImageRuntime()
    }).not.toThrow()
    expect(maxes()).toEqual({ memory: 0, files: 0, items: 0 })
  })
})
