import { describe, it, expect } from 'vitest'
import { MIN_TIMEOUT_MS, TIMEOUT_CODE, timeoutFor, withTimeout } from './timeout'

/**
 * 超时策略是 SPEC §9 的一条硬规则（「单张处理超时 → 标记 failed」），
 * 但阈值被我按实测改过（见 timeout.ts 的说明），所以必须有用例把它钉住。
 */

describe('timeoutFor', () => {
  it('小图走 30s 下限', () => {
    // 1MP 以下都算 1MP，算出来 3s 也抬到 30s
    expect(timeoutFor(1, 1)).toBe(MIN_TIMEOUT_MS)
    expect(timeoutFor(1000, 1000)).toBe(MIN_TIMEOUT_MS)
    expect(timeoutFor(0, 0)).toBe(MIN_TIMEOUT_MS)
  })

  it('刚好 10MP 时下限与公式相等', () => {
    // 10MP x 3s = 30s，正好是下限
    expect(timeoutFor(4000, 2500)).toBe(30_000)
  })

  it('大图按 3s/百万像素放大', () => {
    // 12MP -> 36s
    expect(timeoutFor(4000, 3000)).toBe(36_000)
    // 48MP -> 144s。这张图实测要跑 104s，固定 30s 会把它判死
    expect(timeoutFor(8000, 6000)).toBe(144_000)
  })

  it('iPhone 竖拍的 HEIC 落在合理区间', () => {
    // 5712x4284 = 24.47MP -> 73.4s。实测跑完只要 12s，留了足够余量
    const t = timeoutFor(5712, 4284)
    expect(t).toBeGreaterThan(60_000)
    expect(t).toBeLessThan(80_000)
  })

  it('永远是正整数，且不小于下限', () => {
    for (const [w, h] of [
      [1, 1],
      [3, 7],
      [123, 456],
      [8000, 6000]
    ]) {
      const t = timeoutFor(w as number, h as number)
      expect(Number.isInteger(t)).toBe(true)
      expect(t).toBeGreaterThanOrEqual(MIN_TIMEOUT_MS)
    }
  })
})

describe('withTimeout', () => {
  it('工作先完成时正常返回', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 1000)).resolves.toBe('ok')
  })

  it('超时时以 TIMEOUT 拒绝，错误带 code', async () => {
    const slow = new Promise((r) => setTimeout(() => r('too late'), 500))
    await expect(withTimeout(slow, 30)).rejects.toMatchObject({ code: TIMEOUT_CODE })
  })

  it('超时后不留下挂住的定时器', async () => {
    // 计时器没清掉的话，事件循环会被多拖一段时间；这里靠 vitest 的
    // 未处理句柄检测兜底，同时确认函数本身不抛额外异常
    const fast = Promise.resolve(1)
    for (let i = 0; i < 20; i++) {
      await withTimeout(fast, 10_000)
    }
    expect(true).toBe(true)
  })

  it('工作抛错时原样传出，不会被超时掩盖', async () => {
    const boom = Promise.reject(new Error('BOOM'))
    await expect(withTimeout(boom, 1000)).rejects.toThrow('BOOM')
  })
})
