/**
 * 体积格式化。输出格式与 prototype/index.html 的 `fmtSize` 完全一致：
 * 大于等于 1MB 保留一位小数，否则换算成整数 KB。
 */

const MB = 1024 * 1024

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB'
  const mb = bytes / MB
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(mb * 1024)} KB`
}

/** 按缩小百分比算预估体积。前端算，不走 IPC（SPEC §7） */
export function estimateBytes(totalBytes: number, shrinkPercent: number): number {
  return Math.round(totalBytes * (1 - shrinkPercent / 100))
}

/** 滑块的 20-90 映射到 0-1，用于画已填充的轨道 */
export function sliderRatio(value: number, min: number, max: number): number {
  return (value - min) / (max - min)
}
