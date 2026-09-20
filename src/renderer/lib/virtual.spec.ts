import { describe, it, expect } from 'vitest'
import { OVERSCAN, ROW_HEIGHT, VIRTUALIZE_ABOVE, visibleRange } from './virtual'

/**
 * 可见窗口计算。这类代码的错法都是差一，而且不报错 —— 只会让列表看起来「怪怪的」。
 * 所以边界要一条条钉住。
 */

/** 覆盖全部行的完整性检查：不重不漏、占位高度自洽 */
function invariant(total: number, scrollTop: number, viewport: number): void {
  const r = visibleRange(total, scrollTop, viewport)
  expect(r.start, 'start 不能为负').toBeGreaterThanOrEqual(0)
  expect(r.end, 'end 不能超过总数').toBeLessThanOrEqual(total)
  expect(r.start, 'start 不能大于 end').toBeLessThanOrEqual(r.end)
  // 占位 + 实际渲染的行数必须正好等于总数
  expect(r.padTop + (r.end - r.start) * ROW_HEIGHT + r.padBottom, '占位与行数之和必须等于总高').toBe(
    total * ROW_HEIGHT
  )
  expect(r.padTop % ROW_HEIGHT, '占位必须是整数行').toBe(0)
  expect(r.padBottom % ROW_HEIGHT, '占位必须是整数行').toBe(0)
}

describe('visibleRange 的边界', () => {
  it('空列表什么都不渲染', () => {
    expect(visibleRange(0, 0, 600)).toEqual({ start: 0, end: 0, padTop: 0, padBottom: 0 })
  })

  it('容器高度还没量到时渲染全部，不能裁成空列表', () => {
    // 首帧 clientHeight 可能是 0，裁了的话列表会闪一下空白
    const r = visibleRange(500, 0, 0)
    expect(r.start).toBe(0)
    expect(r.end).toBe(500)
    expect(r.padTop).toBe(0)
    expect(r.padBottom).toBe(0)
  })

  it('短列表全渲染', () => {
    const r = visibleRange(3, 0, 600)
    expect(r.start).toBe(0)
    expect(r.end).toBe(3)
    expect(r.padTop).toBe(0)
    expect(r.padBottom).toBe(0)
  })

  it('滚到顶部时不越界', () => {
    const r = visibleRange(500, 0, 600)
    expect(r.start).toBe(0)
    expect(r.padTop).toBe(0)
  })

  it('滚到底部时最后一行必须被渲染', () => {
    const total = 500
    const viewport = 600
    const maxScroll = total * ROW_HEIGHT - viewport
    const r = visibleRange(total, maxScroll, viewport)
    // 这是最容易出错的地方：最后一行被切掉的话，用户滚到底会看到缺一行
    expect(r.end).toBe(total)
    expect(r.padBottom).toBe(0)
  })

  it('overscan 让上下各多渲染几行', () => {
    const total = 500
    const viewport = 600
    // 滚到第 50 行处
    const scrollTop = 50 * ROW_HEIGHT
    const r = visibleRange(total, scrollTop, viewport)
    expect(r.start).toBe(50 - OVERSCAN)
    // 可见 600/44 = 14 行，再加下侧 overscan
    expect(r.end).toBe(50 + Math.ceil(viewport / ROW_HEIGHT) + OVERSCAN)
  })

  it('渲染量不随总数增长', () => {
    // 虚拟化的全部意义：500 行和 50000 行渲染的节点数一样
    const a = visibleRange(500, 10 * ROW_HEIGHT, 600)
    const b = visibleRange(50_000, 10 * ROW_HEIGHT, 600)
    expect(b.end - b.start).toBe(a.end - a.start)
  })
})

describe('visibleRange 的不变量', () => {
  it('各种位置都满足完整性', () => {
    const total = 500
    const viewport = 600
    const maxScroll = total * ROW_HEIGHT - viewport
    for (let i = 0; i <= 20; i++) {
      invariant(total, Math.round((maxScroll * i) / 20), viewport)
    }
  })

  it('各种总数都满足完整性', () => {
    for (const total of [1, 2, 99, 100, 101, 500, 5000]) {
      for (const scrollTop of [0, 44, 1000, total * ROW_HEIGHT]) {
        invariant(total, scrollTop, 600)
      }
    }
  })

  it('超出实际滚动范围的位置也不崩', () => {
    // 滚动事件偶尔会给出略超范围的值
    invariant(500, 999_999, 600)
    invariant(500, -100, 600)
  })
})

describe('虚拟化阈值', () => {
  it('阈值是 100（SPEC §9：>100 行时启用）', () => {
    expect(VIRTUALIZE_ABOVE).toBe(100)
  })

  it('行高与原型一致', () => {
    // prototype/index.html 的 .file{height:44px}
    expect(ROW_HEIGHT).toBe(44)
  })
})
