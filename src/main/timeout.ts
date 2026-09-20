/**
 * 单张处理的超时策略。
 *
 * **刻意不 import electron** —— 这样它能脱离 Electron 单测。
 *
 * SPEC §9 写的是「单张处理超时（>30s）→ 标记 failed」。但实测下来 30s 不够：
 * 一张 48MP 的纯噪声图在 p=20 时要跑 104s（底线命中目标，二分跑满 5 到 6 次，
 * 每次约 23s），而 24MP 的 iPhone HEIC 在 p=20 时是 12s。按固定的 30s
 * 会把本来跑得完的大图判死。
 *
 * 所以改成按像素数缩放，并保留 30s 作为下限。它的作用是兜住真正的卡死，
 * 不是卡正常的大图。见 docs/decisions.md 的 T13-1。
 */

export const MIN_TIMEOUT_MS = 30_000
export const MS_PER_MEGAPIXEL = 3_000

/** `max(30s, 3s x 百万像素)`：24MP → 72s，48MP → 144s */
export function timeoutFor(width: number, height: number): number {
  const megapixels = Math.max(1, (width * height) / 1_000_000)
  return Math.max(MIN_TIMEOUT_MS, Math.round(megapixels * MS_PER_MEGAPIXEL))
}

export const TIMEOUT_CODE = 'TIMEOUT'

/**
 * 给一段异步工作加超时。超时抛的错带 `code: 'TIMEOUT'`，交给 reasonFromError 归类。
 *
 * ⚠️ 已知取舍：底层的编码没法中断，超时只是「不再等它」，那张仍可能在后台跑完
 * 并落盘。因为阈值给得宽，正常情况不会触发。
 */
export function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`单张处理超过 ${ms}ms`) as Error & { code: string }
      err.code = TIMEOUT_CODE
      reject(err)
    }, ms)
  })
  return Promise.race([work, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer)
  })
}
