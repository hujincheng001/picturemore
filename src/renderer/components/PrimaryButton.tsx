import type { JSX } from 'react'
import { COPY } from '../lib/copy'
import { batchErrorText } from '../lib/reason'
import s from './PrimaryButton.module.css'

/**
 * 对应原型 `.cta` + `.foot`。
 *
 * CTA 三态（SPEC §8.4）：
 *   idle    → 「压缩这 {n} 张」
 *   running → 「处理中 {i} / {n}」，同时 disabled
 *   done    → 「再压一次」
 *
 * **底部那行是四态的**（原型里只在「常驻声明」与「完成提示」之间切换，这里多一个错误态）：
 *   error        → 出错原因
 *   done         → 完成提示
 *   其余         → 常驻声明
 *
 * 错误优先于完成提示：一批被磁盘满中止时，先说「磁盘满了」比说「完成」有用得多。
 * 见 docs/decisions.md 的 T20-3。
 */

export interface PrimaryButtonProps {
  itemCount: number
  running: boolean
  /** 处理中已完成的数量，用于「处理中 {i} / {n}」 */
  progress: number
  /** 这一批是否跑完过，决定是否显示「再压一次」 */
  finished: boolean
  /**
   * 跑完后的输出目录。有值时底部那行换成完成提示
   * （原型：`footEl.textContent = '完成。原图没动，新文件在 ' + path`）
   */
  lastOutputDir: string | null
  /** 批次级错误的原因码。有值时底部那行换成错误提示 */
  error: string | null
  /** 批次级提示（不是错误）。目前只有「拖进来的东西里没有可压缩的图」 */
  notice: string | null
  onClick: () => void
}

export function PrimaryButton({
  itemCount,
  running,
  progress,
  finished,
  lastOutputDir,
  error,
  notice,
  onClick
}: PrimaryButtonProps): JSX.Element {
  const label = running
    ? COPY.ctaRunning(progress, itemCount)
    : finished
      ? COPY.ctaDone
      : COPY.ctaDefault(itemCount)

  // 没有图时不该能点。空列表时左栏整体隐藏，这里只是兜底
  const disabled = running || itemCount === 0

  /*
   * 底部那行的优先级：错误 > 提示 > 完成 > 常驻声明。
   *
   * 错误压过完成提示：一批被磁盘满中止时，先说「磁盘满了」比说「完成」有用得多。
   * 提示压过完成提示：刚拖进来一个空文件夹，用户要的是「为什么没反应」，
   * 而不是上一批的存放位置。
   */
  const errorText = batchErrorText(error)
  const foot = errorText ?? notice ?? (lastOutputDir === null ? COPY.footer : COPY.doneTip(lastOutputDir))
  const caution = errorText !== null

  return (
    <div className="mt-auto flex flex-col gap-3">
      <button type="button" className={s.cta} onClick={onClick} disabled={disabled}>
        {label}
      </button>
      {/*
        错误用琥珀 —— 全站唯一有彩色，只在「有件事你得知道」时出现。
        普通提示与底部声明、完成提示都是中性灰
      */}
      <p
        className={['text-center text-1', caution ? 'text-caution' : 'text-fg-3'].join(' ')}
        role={errorText === null ? undefined : 'status'}
      >
        {foot}
      </p>
    </div>
  )
}
