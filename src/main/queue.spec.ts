import { describe, it, expect } from 'vitest'
import { Pool, CANCELLED, defaultConcurrency } from './queue'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

describe('Pool 并发上限', () => {
  it('并发数不超过上限，且确实用满了上限', async () => {
    const pool = new Pool(3)
    let live = 0
    let peak = 0

    await Promise.all(
      Array.from({ length: 12 }, () =>
        pool.run(async () => {
          live++
          peak = Math.max(peak, live)
          await sleep(20)
          live--
        })
      )
    )

    expect(peak).toBeLessThanOrEqual(3)
    // 只断言上限的话，一个"串行执行"的实现也能通过，所以要同时断言用满了
    expect(peak).toBe(3)
    expect(live).toBe(0)
  })

  it('上限为 1 时退化成串行', async () => {
    const pool = new Pool(1)
    const order: number[] = []

    await Promise.all(
      [1, 2, 3].map((n) =>
        pool.run(async () => {
          order.push(n)
          await sleep(10)
        })
      )
    )

    expect(order).toEqual([1, 2, 3])
  })

  it('跑完之后槽位全部归还', async () => {
    const pool = new Pool(2)
    await Promise.all(Array.from({ length: 5 }, () => pool.run(() => sleep(5))))
    expect(pool.running).toBe(0)
    expect(pool.pending).toBe(0)
  })

  it('非法上限直接抛错，不留下半个坏池子', () => {
    expect(() => new Pool(0)).toThrow(RangeError)
    expect(() => new Pool(-1)).toThrow(RangeError)
    expect(() => new Pool(1.5)).toThrow(RangeError)
  })
})

describe('Pool 取消', () => {
  it('cancelPending 让排队中的任务以 CANCELLED 拒绝', async () => {
    const pool = new Pool(1)
    const running = pool.run(() => sleep(50))
    const queued = pool.run(() => sleep(10))

    // 关键：取消之前就要把处理器挂上。
    // cancelPending 是同步拒绝，如果跨了宏任务才有人处理，Node 会报 unhandled rejection。
    // 生产代码同理，批量场景一律用 allSettled（见 queue.ts 的说明）。
    const settled = Promise.allSettled([running, queued])

    expect(pool.pending).toBe(1)
    pool.cancelPending()

    const [a, b] = await settled
    expect(a.status).toBe('fulfilled')
    expect(b.status).toBe('rejected')
    expect((b as PromiseRejectedResult).reason.message).toBe(CANCELLED)
  })

  it('已在跑的任务不受取消影响，正常跑完', async () => {
    const pool = new Pool(1)
    let finished = false

    const running = pool.run(async () => {
      await sleep(30)
      finished = true
      return 'ok'
    })
    const queued = pool.run(() => sleep(10))
    const settled = Promise.allSettled([running, queued])

    pool.cancelPending()

    const [a, b] = await settled
    expect(a.status).toBe('fulfilled')
    expect((a as PromiseFulfilledResult<string>).value).toBe('ok')
    expect(finished).toBe(true)
    expect(b.status).toBe('rejected')
  })

  it('取消后池子可以继续用（用户清空列表后又拖进一批图）', async () => {
    const pool = new Pool(2)

    const first = Array.from({ length: 4 }, () => pool.run(() => sleep(30)))
    // 前 2 个已经在跑，后 2 个会被取消
    const settledFirst = Promise.allSettled(first)
    pool.cancelPending()

    const results = await settledFirst
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(2)
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2)

    // 关键：新一批任务必须能正常跑，不能因为取消过一次就永久拒绝
    const second = await Promise.all([1, 2, 3].map((n) => pool.run(async () => n * 2)))
    expect(second).toEqual([2, 4, 6])
    expect(pool.running).toBe(0)
  })

  it('没有排队任务时取消是空操作', async () => {
    const pool = new Pool(2)
    pool.cancelPending()
    await expect(pool.run(async () => 'still works')).resolves.toBe('still works')
  })

  it('取消不影响后续任务的槽位计数', async () => {
    const pool = new Pool(1)
    const running = pool.run(() => sleep(20))
    const queued = pool.run(() => sleep(10))
    const settled = Promise.allSettled([running, queued])

    pool.cancelPending()
    const [, b] = await settled
    expect(b.status).toBe('rejected')

    // 被取消的任务没有占过槽位，所以这里必须能立刻拿到槽位
    await expect(pool.run(async () => 'ok')).resolves.toBe('ok')
    expect(pool.running).toBe(0)
  })
})

describe('Pool 错误传播', () => {
  it('任务抛错时异常照常抛出，槽位不泄漏', async () => {
    const pool = new Pool(1)
    await expect(
      pool.run(async () => {
        throw new Error('BOOM')
      })
    ).rejects.toThrow('BOOM')

    expect(pool.running).toBe(0)
    // 槽位没漏，后续任务照常
    await expect(pool.run(async () => 'ok')).resolves.toBe('ok')
  })

  it('一个任务失败不影响同批其他任务', async () => {
    const pool = new Pool(2)
    const results = await Promise.allSettled([
      pool.run(async () => 'a'),
      pool.run(async () => {
        throw new Error('BOOM')
      }),
      pool.run(async () => 'c')
    ])
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected', 'fulfilled'])
  })
})

describe('defaultConcurrency', () => {
  it('落在 [4, 8] 区间内', () => {
    const n = defaultConcurrency()
    expect(Number.isInteger(n)).toBe(true)
    expect(n).toBeGreaterThanOrEqual(4)
    expect(n).toBeLessThanOrEqual(8)
  })
})
