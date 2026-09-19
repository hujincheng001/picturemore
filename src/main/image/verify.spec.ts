import { describe, it, expect } from 'vitest'
import { assertSameDimensions, ImageEngineError } from './verify'

describe('assertSameDimensions', () => {
  it('尺寸一致时通过', () => {
    expect(() =>
      assertSameDimensions({ width: 100, height: 200 }, { width: 100, height: 200 })
    ).not.toThrow()
  })

  it('宽度变化时抛 DIMENSION_CHANGED', () => {
    try {
      assertSameDimensions({ width: 100, height: 200 }, { width: 101, height: 200 })
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(ImageEngineError)
      expect((e as ImageEngineError).code).toBe('DIMENSION_CHANGED')
    }
  })

  it('宽高互换时也抛错', () => {
    expect(() => assertSameDimensions({ width: 100, height: 200 }, { width: 200, height: 100 })).toThrow(
      ImageEngineError
    )
  })

  it('高度变化时也抛错', () => {
    expect(() =>
      assertSameDimensions({ width: 100, height: 200 }, { width: 100, height: 199 })
    ).toThrow(ImageEngineError)
  })
})
