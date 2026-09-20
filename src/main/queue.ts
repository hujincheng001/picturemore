import { cpus } from 'node:os'

/**
 * 有界并发池。批量压缩靠它把并发压到机器扛得住的范围内。
 *
 * 为什么不是 `Promise.all` 直接铺开：SPEC §14 记着「8000x6000 的图同时跑 8 张
 * 会吃满内存」。一张 48MP 的图光裸 RGBA 就是 192MB，不限并发会直接把进程撑爆。
 */

/** 并发数：`clamp(cpus - 1, 4, 8)`（SPEC §4.8） */
export function defaultConcurrency(): number {
  return Math.min(8, Math.max(4, cpus().length - 1))
}

/** 被 cancelPending 跳过的任务抛这个。上层靠 message 判断，不要改成别的字符串 */
export const CANCELLED = 'CANCELLED'

interface Waiter {
  resolve: () => void
  reject: (e: Error) => void
}

export class Pool {
  private active = 0
  private waiting: Waiter[] = []

  constructor(private readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new RangeError(`并发上限必须是正整数，收到 ${limit}`)
    }
  }

  /** 当前在跑的任务数 */
  get running(): number {
    return this.active
  }

  /** 排队等槽位的任务数 */
  get pending(): number {
    return this.waiting.length
  }

  /**
   * 跳过队列里所有还没开始的任务，它们会以 CANCELLED 拒绝。
   *
   * 已经在跑的任务不受影响，会正常跑完 —— 这是 SPEC §4.8 的要求，
   * 也是唯一安全的做法：编码跑到一半没法中断，硬砍只会留下半个文件。
   *
   * 这个操作**不是一次性的**：取消之后池子可以继续接收新任务（用户清空列表后
   * 又拖进一批图是常见操作）。所以这里只清空等待队列，不设任何粘性标志位。
   *
   * ⚠️ 调用方必须在调用它之前就给所有 `run()` 返回的 promise 挂上处理函数，
   * 否则拒绝会跨宏任务才被处理，Node 报 unhandled rejection。
   * 批量场景请一律用 `Promise.allSettled`，不要用 `Promise.all` + 事后逐个 await。
   */
  cancelPending(): void {
    const w = this.waiting
    this.waiting = []
    for (const item of w) {
      item.reject(new Error(CANCELLED))
    }
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire()
    try {
      return await task()
    } finally {
      this.release()
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active++
      return Promise.resolve()
    }
    return new Promise<void>((resolve, reject) => {
      this.waiting.push({ resolve, reject })
    })
  }

  /**
   * 归还槽位。
   *
   * 有等待者时直接把槽位转交（active 不变），而不是先减再加 ——
   * 后者会在两个微任务之间出现一个空窗，让"并发不超过上限"的断言变得不可靠。
   */
  private release(): void {
    const next = this.waiting.shift()
    if (next !== undefined) {
      next.resolve()
      return
    }
    this.active--
  }
}
