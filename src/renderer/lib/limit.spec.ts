import { describe, it, expect } from 'vitest'
import { MAX_BATCH, takeWithinLimit } from './limit'

/**
 * 单批上限。用户 2026-09-21 的决定：一次最多 100 张。
 *
 * 这段的错法都是差一：正好 100 张时该不该再收、超出的算不算 dropped。
 * 不会报错，只会让界面上的数字对不上 —— 而「以为全压了其实只压了一部分」
 * 是静默丢数据，比报错更糟。
 */

describe('MAX_BATCH', () => {
  it('是 100', () => {
    expect(MAX_BATCH).toBe(100)
  })
})

describe('takeWithinLimit', () => {
  it('还有名额时全收，没有忽略', () => {
    const r = takeWithinLimit(0, [1, 2, 3])
    expect(r.accepted).toEqual([1, 2, 3])
    expect(r.dropped).toBe(0)
  })

  it('名额不足时截断，并如实报出忽略的数量', () => {
    const r = takeWithinLimit(98, [1, 2, 3, 4, 5])
    expect(r.accepted).toEqual([1, 2])
    expect(r.dropped).toBe(3)
  })

  it('正好凑满上限时不算忽略', () => {
    // 边界：99 已有 + 1 新增 = 100，正好满，不该报忽略
    const r = takeWithinLimit(99, [1])
    expect(r.accepted).toEqual([1])
    expect(r.dropped).toBe(0)
  })

  it('已经满了时一张都不收', () => {
    const r = takeWithinLimit(MAX_BATCH, [1, 2])
    expect(r.accepted).toEqual([])
    expect(r.dropped).toBe(2)
  })

  it('已超额时也不崩（比如上限被调小过）', () => {
    const r = takeWithinLimit(150, [1, 2])
    expect(r.accepted).toEqual([])
    expect(r.dropped).toBe(2)
  })

  it('空输入返回空', () => {
    const r = takeWithinLimit(50, [])
    expect(r.accepted).toEqual([])
    expect(r.dropped).toBe(0)
  })

  it('不修改传进来的数组', () => {
    const incoming = [1, 2, 3]
    takeWithinLimit(101, incoming)
    expect(incoming).toEqual([1, 2, 3])
  })

  it('自定义上限也生效', () => {
    const r = takeWithinLimit(1, [1, 2, 3], 2)
    expect(r.accepted).toEqual([1])
    expect(r.dropped).toBe(2)
  })

  it('接收数 + 忽略数 永远等于新增数', () => {
    // 不变量：不能既收了又算作忽略，也不能悄悄吞掉几张
    for (const existing of [0, 1, 50, 99, 100, 120]) {
      for (const n of [0, 1, 5, 100, 300]) {
        const incoming = Array.from({ length: n }, (_, i) => i)
        const r = takeWithinLimit(existing, incoming)
        expect(
          r.accepted.length + r.dropped,
          `existing=${existing} n=${n} 时数量对不上`
        ).toBe(n)
        expect(r.accepted.length).toBeLessThanOrEqual(Math.max(0, MAX_BATCH - existing))
      }
    }
  })
})
