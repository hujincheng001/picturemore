/**
 * 长列表的可见窗口计算。
 *
 * 抽成纯函数是因为这类代码的错法都是**差一**：少渲染一行、多渲染一行、
 * 滚动到底部时最后一行被切掉。这些都不会报错，只会让用户觉得「列表怪怪的」。
 *
 * 行高是固定值（原型 `.file` 写死 44px），所以不需要动态测量 —— 这也是
 * 这里能写成纯函数的前提。
 */

/** 行高，与 prototype/index.html 的 `.file` 一致 */
export const ROW_HEIGHT = 44

/** 上下各多渲染几行，避免快速滚动时出现空白 */
export const OVERSCAN = 8

/** 超过这个行数才启用虚拟化（SPEC §9：>100 行时启用） */
export const VIRTUALIZE_ABOVE = 100

export interface VisibleRange {
  /** 第一个要渲染的行下标（含） */
  start: number
  /** 最后一个要渲染的行下标（不含） */
  end: number
  /** 上方占位高度 */
  padTop: number
  /** 下方占位高度 */
  padBottom: number
}

/**
 * 算出当前应该渲染哪一段。
 *
 * `viewportHeight` 为 0 时（还没量到容器高度）退化成渲染全部 ——
 * 宁可多渲染一次，也不要因为容器高度未知而渲染出空列表。
 */
export function visibleRange(
  total: number,
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number = ROW_HEIGHT,
  overscan: number = OVERSCAN
): VisibleRange {
  if (total <= 0) return { start: 0, end: 0, padTop: 0, padBottom: 0 }

  // 容器高度还没量到时不能裁，否则首帧是空的
  if (viewportHeight <= 0) return { start: 0, end: total, padTop: 0, padBottom: 0 }

  /*
   * first 必须夹到 [0, total - 1]。
   *
   * 不夹的话，滚动事件给出略超范围的值（比如列表刚变短、或者惯性滚动到末尾）
   * 会让 first 远大于 total：start 涨到几万，end 却被 min(total) 夹在 500，
   * 于是 start > end —— 渲染出空白，还配一个几万像素高的占位。
   * 这个 bug 是虚拟化里最典型的一个，靠不变量用例（start <= end、占位自洽）抓到的。
   */
  const rawFirst = Number.isFinite(scrollTop) ? Math.floor(scrollTop / rowHeight) : 0
  const first = Math.min(total - 1, Math.max(0, rawFirst))

  const visibleCount = Math.ceil(viewportHeight / rowHeight)

  const start = Math.max(0, first - overscan)
  const end = Math.min(total, first + visibleCount + overscan)

  return {
    start,
    end,
    padTop: start * rowHeight,
    padBottom: (total - end) * rowHeight
  }
}
