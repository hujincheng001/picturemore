import { isBatchFatal, reasonFromError, type ReasonCode } from '../shared/reasons'
import { CANCELLED, Pool } from './queue'

/**
 * 批量处理的编排骨架。
 *
 * **刻意不 import electron** —— 这样中止逻辑、计数、以及「没轮到的行怎么交代」
 * 都能脱离 Electron 单测。`src/main/ipc/task.ts` 只负责把真实的
 * 「读文件 → probe → 压缩 → 写盘」注入进来。
 *
 * 抽出来的另一个原因：计数与中止是最容易悄悄算错的地方 ——
 * 少算一张、把跳过的算成失败、中止后剩下的行停在「处理中」。
 * 这些都不会抛错，只会让用户看到错的数字和一直转圈的行。
 */

export interface BatchItem {
  id: string
}

export type ItemOutcome = 'done' | 'undershot'

export interface BatchCallbacks<T extends BatchItem> {
  /** 处理一张。返回 done / undershot；抛错表示这张失败 */
  processOne: (item: T, index: number) => Promise<ItemOutcome>
  /** 状态变化回调。state 为 failed 时 reason 一定有值 */
  onProgress: (
    item: T,
    index: number,
    state: 'working' | ItemOutcome | 'failed',
    reason?: ReasonCode
  ) => void
}

export interface BatchSummary {
  done: number
  undershot: number
  failed: number
  /** 整批被中止的原因；null 表示正常跑完 */
  aborted: ReasonCode | null
  /** 因为中止或用户取消而没轮到的张数 */
  skipped: number
}

export async function runBatch<T extends BatchItem>(
  items: T[],
  pool: Pool,
  cb: BatchCallbacks<T>
): Promise<BatchSummary> {
  let done = 0
  let undershot = 0
  let failed = 0
  let aborted: ReasonCode | null = null
  /** 已经报过终态的行。中止之后靠它把剩下的行也交代清楚 */
  const settled = new Set<string>()

  const results = await Promise.allSettled(
    items.map((item, index) =>
      pool.run(async () => {
        // 已经被中止了就不再启动新的：每张要读盘 + 解容器 + 编码，
        // 明知道写不进去还跑完，只是白白烧几分钟
        if (aborted !== null) {
          throw new Error(CANCELLED)
        }

        cb.onProgress(item, index, 'working')

        try {
          const outcome = await cb.processOne(item, index)
          settled.add(item.id)
          cb.onProgress(item, index, outcome)
          if (outcome === 'undershot') undershot++
          else done++
        } catch (e) {
          const reason = reasonFromError(e)
          failed++
          settled.add(item.id)
          cb.onProgress(item, index, 'failed', reason)

          if (isBatchFatal(reason)) {
            aborted = reason
            // 队列里还没开始的直接跳过；正在跑的几张让它跑完 ——
            // 编码没法中断，硬砍会留下半个文件
            pool.cancelPending()
          }
        }
      })
    )
  )

  // 被 cancelPending 跳过的那些以 CANCELLED 拒绝，不计入 failed ——
  // 用户清列表、或整批被中止时都会走到这里，算成失败会给出错误数字
  const skipped = results.filter(
    (r) => r.status === 'rejected' && (r.reason as Error | undefined)?.message === CANCELLED
  ).length

  /*
   * 中止之后，没轮到的那些行不能就那么停在「处理中」—— 用户会以为还在跑。
   * 给它们补一个终态，带上中止的原因。
   *
   * 用 failed 是因为 ItemState 里没有「未尝试」这一档；而它比留在 pending
   * 或 working 更诚实：这些行确实没有产出文件。
   */
  if (aborted !== null) {
    items.forEach((item, index) => {
      if (settled.has(item.id)) return
      failed++
      cb.onProgress(item, index, 'failed', aborted ?? undefined)
    })
  }

  return { done, undershot, failed, aborted, skipped }
}
