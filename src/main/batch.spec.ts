import { describe, it, expect } from 'vitest'
import type { ReasonCode } from '../shared/reasons'
import { runBatch, type BatchItem } from './batch'
import { Pool } from './queue'

/**
 * 批量编排。抽出来就是为了测这里 —— 中止逻辑与计数是最容易悄悄算错的地方：
 * 少算一张、把跳过的算成失败、中止后剩下的行停在「处理中」。
 *
 * 这些都不会抛错，只会让用户看到错的数字和一直转圈的行。
 */

interface Item extends BatchItem {
  id: string
}

const makeItems = (n: number): Item[] => Array.from({ length: n }, (_, i) => ({ id: `i${i}` }))

/** 收集 onProgress 的调用，便于断言「每张恰好一个终态」 */
function recorder(): {
  calls: Array<{ id: string; state: string; reason?: ReasonCode }>
  onProgress: (item: Item, _i: number, state: string, reason?: ReasonCode) => void
} {
  const calls: Array<{ id: string; state: string; reason?: ReasonCode }> = []
  return {
    calls,
    onProgress: (item, _i, state, reason) => {
      calls.push(reason === undefined ? { id: item.id, state } : { id: item.id, state, reason })
    }
  }
}

const diskFull = (): Error => Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' })
const corrupt = (): Error => Object.assign(new Error('bad'), { code: 'DIMENSION_CHANGED' })

describe('runBatch 的正常路径', () => {
  it('全部成功时计数正确', async () => {
    const rec = recorder()
    const s = await runBatch(makeItems(5), new Pool(2), {
      processOne: async () => 'done',
      onProgress: rec.onProgress
    })
    expect(s).toEqual({ done: 5, undershot: 0, failed: 0, aborted: null, skipped: 0 })
  })

  it('undershot 单独计数，且算进「已完成」', async () => {
    const rec = recorder()
    const s = await runBatch(makeItems(4), new Pool(2), {
      processOne: async (item) => (item.id === 'i0' || item.id === 'i2' ? 'undershot' : 'done'),
      onProgress: rec.onProgress
    })
    expect(s.done).toBe(2)
    expect(s.undershot).toBe(2)
    expect(s.failed).toBe(0)
  })

  it('每张恰好一个终态，且都先经过 working', async () => {
    const rec = recorder()
    await runBatch(makeItems(6), new Pool(3), {
      processOne: async () => 'done',
      onProgress: rec.onProgress
    })

    for (const item of makeItems(6)) {
      const mine = rec.calls.filter((c) => c.id === item.id)
      expect(mine[0]?.state, `${item.id} 应以 working 开始`).toBe('working')
      const terminal = mine.filter((c) => c.state !== 'working')
      expect(terminal, `${item.id} 应该恰好有一个终态`).toHaveLength(1)
    }
  })
})

describe('runBatch 的单张失败', () => {
  it('一张失败不中断整批', async () => {
    const rec = recorder()
    const s = await runBatch(makeItems(5), new Pool(2), {
      processOne: async (item) => {
        if (item.id === 'i2') throw corrupt()
        return 'done'
      },
      onProgress: rec.onProgress
    })
    expect(s.done).toBe(4)
    expect(s.failed).toBe(1)
    expect(s.aborted).toBeNull()
  })

  it('失败的那张带上原因码', async () => {
    const rec = recorder()
    await runBatch(makeItems(3), new Pool(1), {
      processOne: async (item) => {
        if (item.id === 'i1') throw corrupt()
        return 'done'
      },
      onProgress: rec.onProgress
    })
    const failed = rec.calls.find((c) => c.state === 'failed')
    expect(failed?.id).toBe('i1')
    expect(failed?.reason).toBe('CORRUPT')
  })

  it('读不了图这种错不该拖累整批', async () => {
    // 一张坏图让后面几百张都不处理，是比失败本身更糟的结果
    const rec = recorder()
    const s = await runBatch(makeItems(10), new Pool(2), {
      processOne: async (item) => {
        if (item.id === 'i0' || item.id === 'i5') {
          throw Object.assign(new Error('x'), { code: 'ENOENT' })
        }
        return 'done'
      },
      onProgress: rec.onProgress
    })
    expect(s.done).toBe(8)
    expect(s.failed).toBe(2)
    expect(s.aborted).toBeNull()
  })
})

describe('runBatch 的整批中止（SPEC §9：磁盘满中止整批）', () => {
  it('磁盘满时中止，并带上原因', async () => {
    const rec = recorder()
    const s = await runBatch(makeItems(10), new Pool(1), {
      processOne: async (item) => {
        if (item.id === 'i0') throw diskFull()
        return 'done'
      },
      onProgress: rec.onProgress
    })
    expect(s.aborted).toBe('DISK_FULL')
  })

  it('中止后不再启动新的（否则白白烧几分钟）', async () => {
    const rec = recorder()
    let attempted = 0
    await runBatch(makeItems(20), new Pool(1), {
      processOne: async (item) => {
        attempted++
        if (item.id === 'i0') throw diskFull()
        return 'done'
      },
      onProgress: rec.onProgress
    })
    // 并发为 1 时，第一张失败之后队列里那 19 张都不该被处理
    expect(attempted).toBe(1)
  })

  it('没轮到的行也必须交代清楚，不能停在「处理中」', async () => {
    const rec = recorder()
    await runBatch(makeItems(10), new Pool(1), {
      processOne: async (item) => {
        if (item.id === 'i0') throw diskFull()
        return 'done'
      },
      onProgress: rec.onProgress
    })

    // 每一张都要有终态
    for (const item of makeItems(10)) {
      const terminal = rec.calls.filter((c) => c.id === item.id && c.state !== 'working')
      expect(terminal, `${item.id} 没有终态`).toHaveLength(1)
    }
  })

  it('没轮到的那些带上中止原因，方便界面如实说明', async () => {
    const rec = recorder()
    await runBatch(makeItems(5), new Pool(1), {
      processOne: async (item) => {
        if (item.id === 'i0') throw diskFull()
        return 'done'
      },
      onProgress: rec.onProgress
    })
    const rest = rec.calls.filter((c) => c.id !== 'i0' && c.state === 'failed')
    expect(rest).toHaveLength(4)
    expect(rest.every((c) => c.reason === 'DISK_FULL')).toBe(true)
  })

  it('并发正在跑的那几张照常跑完，结果计入 done', async () => {
    // 编码没法中断，硬砍会留下半个文件 —— 所以在跑的那几张必须让它跑完
    const rec = recorder()
    const s = await runBatch(makeItems(10), new Pool(3), {
      processOne: async (_item, index) => {
        if (index === 0) throw diskFull()
        // 让在跑的几张多花点时间，保证它们是在中止之前就启动的
        await new Promise((r) => setTimeout(r, 10))
        return 'done'
      },
      onProgress: rec.onProgress
    })
    // 并发 3：第 0 张抛错时，另外两张已经在跑，它们会跑完
    expect(s.done).toBe(2)
    expect(s.aborted).toBe('DISK_FULL')
    // 总数守恒
    expect(s.done + s.undershot + s.failed).toBe(10)
  })

  it('计数守恒：done + undershot + failed 永远等于总数', async () => {
    const rec = recorder()
    const s = await runBatch(makeItems(7), new Pool(2), {
      processOne: async (item) => {
        if (item.id === 'i1') throw diskFull()
        return item.id === 'i3' ? 'undershot' : 'done'
      },
      onProgress: rec.onProgress
    })
    expect(s.done + s.undershot + s.failed).toBe(7)
  })
})

describe('runBatch 与用户取消的配合', () => {
  it('cancelPending 之后剩下的算跳过，不算失败', async () => {
    // 用户清列表时不该在完成提示里看到一堆「失败」
    const rec = recorder()
    const pool = new Pool(1)
    const promise = runBatch(makeItems(10), pool, {
      processOne: async (_item, index) => {
        if (index === 0) pool.cancelPending()
        return 'done'
      },
      onProgress: rec.onProgress
    })
    const s = await promise
    expect(s.skipped).toBeGreaterThan(0)
    expect(s.aborted).toBeNull()
  })
})

describe('runBatch 的边界', () => {
  it('空列表直接返回全零', async () => {
    const rec = recorder()
    const s = await runBatch([], new Pool(2), {
      processOne: async () => 'done',
      onProgress: rec.onProgress
    })
    expect(s).toEqual({ done: 0, undershot: 0, failed: 0, aborted: null, skipped: 0 })
    expect(rec.calls).toHaveLength(0)
  })

  it('单张列表也能跑通', async () => {
    const rec = recorder()
    const s = await runBatch(makeItems(1), new Pool(1), {
      processOne: async () => 'done',
      onProgress: rec.onProgress
    })
    expect(s.done).toBe(1)
  })
})
