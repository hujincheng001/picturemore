import type { Attempt } from './types'

/** 感知无损区的上界，越过它用户就要接受放大可见的压缩痕迹 */
export const SAFE_MAX = 70
/** 感知无损区的质量底线。这是"正常观看看不出差别"的工程落点 */
export const FLOOR_PERCEPTUAL = 82
/** 用户主动越线后的质量底线 */
export const FLOOR_VISIBLE = 62
/** 质量上限。再高只是徒增体积 */
export const CEIL = 95
/** 单张最多编码几次。超过就取已试过的最优解 */
export const MAX_ATTEMPTS = 6

export function qualityFloor(shrinkPercent: number): number {
  return shrinkPercent > SAFE_MAX ? FLOOR_VISIBLE : FLOOR_PERCEPTUAL
}

export function targetBytes(originalBytes: number, shrinkPercent: number): number {
  return Math.round(originalBytes * (1 - shrinkPercent / 100))
}

/**
 * 二分搜索下一个要试的质量档。
 * 返回 null 表示已收敛或已达尝试上限，调用方应从 history 里挑最优解。
 */
export function nextQuality(
  originalBytes: number,
  shrinkPercent: number,
  history: Attempt[]
): number | null {
  if (history.length >= MAX_ATTEMPTS) return null

  const target = targetBytes(originalBytes, shrinkPercent)
  const floor = qualityFloor(shrinkPercent)
  let lo = floor
  let hi = CEIL

  for (const a of history) {
    if (a.bytes <= target) lo = Math.max(lo, a.quality + 1)
    else hi = Math.min(hi, a.quality - 1)
  }

  if (lo > hi) return null

  const mid = Math.round((lo + hi) / 2)
  return history.some((a) => a.quality === mid) ? null : mid
}

/**
 * 从 history 里挑最优解：满足体积目标的前提下质量最高。
 * 一个都没达标时返回 null，调用方改用质量底线兜底。
 */
export function bestAttempt(originalBytes: number, shrinkPercent: number, history: Attempt[]): Attempt | null {
  const target = targetBytes(originalBytes, shrinkPercent)
  const hits = history.filter((a) => a.bytes <= target)
  if (hits.length === 0) return null
  return hits.reduce((best, a) => (a.quality > best.quality ? a : best))
}
