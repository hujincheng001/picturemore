import { describe, it, expect } from 'vitest'
import { qualityFloor, targetBytes, nextQuality, bestAttempt } from './plan'

const ORIGINAL = 4_000_000 // 4MB 原图

describe('qualityFloor', () => {
  it('感知无损区（p <= 70）底线是 82', () => {
    expect(qualityFloor(20)).toBe(82)
    expect(qualityFloor(45)).toBe(82)
    expect(qualityFloor(70)).toBe(82)
  })

  it('越过安全线后底线降到 62', () => {
    expect(qualityFloor(71)).toBe(62)
    expect(qualityFloor(90)).toBe(62)
  })
})

describe('targetBytes', () => {
  it('p=45 时目标为原体积的 55%', () => {
    expect(targetBytes(ORIGINAL, 45)).toBe(2_200_000)
  })

  it('p=70 时目标为原体积的 30%', () => {
    expect(targetBytes(ORIGINAL, 70)).toBe(1_200_000)
  })
})

describe('nextQuality', () => {
  it('第一次尝试返回二分中点', () => {
    expect(nextQuality(ORIGINAL, 45, [])).toBe(Math.round((82 + 95) / 2))
  })

  it('上一轮偏大则压低上界', () => {
    const q = nextQuality(ORIGINAL, 45, [{ quality: 88, bytes: 9_000_000 }])
    expect(q).toBeLessThan(88)
    expect(q).toBeGreaterThanOrEqual(82)
  })

  it('上一轮已达标则抬高下界', () => {
    const q = nextQuality(ORIGINAL, 45, [{ quality: 88, bytes: 1_000_000 }])
    expect(q).toBeGreaterThan(88)
  })

  it('上下界交错时收敛，返回 null', () => {
    // 高分位却更小、低分位却更大，说明目标落在区间之外，不可能命中
    const history = [
      { quality: 88, bytes: 1_000_000 },
      { quality: 84, bytes: 9_000_000 },
    ]
    expect(nextQuality(ORIGINAL, 45, history)).toBeNull()
  })

  it('达到 6 次尝试上限时返回 null', () => {
    const history = Array.from({ length: 6 }, (_, i) => ({ quality: 82 + i, bytes: 9_000_000 }))
    expect(nextQuality(ORIGINAL, 45, history)).toBeNull()
  })

  it('已试过的质量档不再重复返回', () => {
    const history = [
      { quality: 88, bytes: 1_000_000 },
      { quality: 89, bytes: 900_000 },
    ]
    const q = nextQuality(ORIGINAL, 45, history)
    expect(history.map((h) => h.quality)).not.toContain(q)
  })

  it('返回的档位永远落在 [质量底线, 95] 内', () => {
    for (const p of [20, 45, 70, 71, 85, 90]) {
      const floor = qualityFloor(p)
      let history: Array<{ quality: number; bytes: number }> = []
      for (let i = 0; i < 6; i++) {
        const q = nextQuality(ORIGINAL, p, history)
        if (q === null) break
        expect(q).toBeGreaterThanOrEqual(floor)
        expect(q).toBeLessThanOrEqual(95)
        history = [...history, { quality: q, bytes: 9_000_000 }]
      }
    }
  })
})

describe('bestAttempt', () => {
  it('在达标的候选里取质量最高的', () => {
    const history = [
      { quality: 85, bytes: 3_000_000 },
      { quality: 80, bytes: 2_000_000 },
      { quality: 75, bytes: 1_500_000 },
    ]
    expect(bestAttempt(ORIGINAL, 45, history)).toEqual({ quality: 80, bytes: 2_000_000 })
  })

  it('一个都没达标时返回 null', () => {
    const history = [{ quality: 82, bytes: 9_000_000 }]
    expect(bestAttempt(ORIGINAL, 45, history)).toBeNull()
  })
})
