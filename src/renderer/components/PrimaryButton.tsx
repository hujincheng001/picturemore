import type { JSX } from 'react'
import { COPY } from '../lib/copy'
import s from './PrimaryButton.module.css'

/**
 * 对应原型 `.cta` + `.foot`。
 *
 * 三态（SPEC §8.4）：
 *   idle    → 「压缩这 {n} 张」
 *   running → 「处理中 {i} / {n}」，同时 disabled
 *   done    → 「再压一次」
 *
 * 底部声明常驻，不随状态变。
 */

export interface PrimaryButtonProps {
  itemCount: number
  running: boolean
  /** 处理中已完成的数量，用于「处理中 {i} / {n}」 */
  progress: number
  /** 这一批是否跑完过，决定是否显示「再压一次」 */
  finished: boolean
  onClick: () => void
}

export function PrimaryButton({
  itemCount,
  running,
  progress,
  finished,
  onClick
}: PrimaryButtonProps): JSX.Element {
  const label = running
    ? COPY.ctaRunning(progress, itemCount)
    : finished
      ? COPY.ctaDone
      : COPY.ctaDefault(itemCount)

  // 没有图时不该能点。空列表时左栏整体隐藏，这里只是兜底
  const disabled = running || itemCount === 0

  return (
    <div className="mt-auto flex flex-col gap-3">
      <button type="button" className={s.cta} onClick={onClick} disabled={disabled}>
        {label}
      </button>
      <p className="text-center text-1 text-fg-3">{COPY.footer}</p>
    </div>
  )
}
