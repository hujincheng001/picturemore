import type { JSX } from 'react'
import { COPY } from '../lib/copy'
import { formatBytes } from '../lib/format'
import { rowNote } from '../lib/note'
import { reasonText } from '../lib/reason'
import type { ImageItem } from '../lib/types'
import s from './FileRow.module.css'

/**
 * 对应原型 `.file`。一行有文件名、体积、可选的提示、移除。移除是**文字**不是图标。
 *
 * 五种行的呈现：
 *   pending / working  只显示原体积；working 整行降到 30% 不透明
 *   done               显示 `4.2 MB → 1.5 MB`，结果那一半淡入落位
 *   undershot          同上，另加一格提示（见下）
 *   failed             体积那一格换成原因文案；SPEC 没给文案的原因码只留 title
 *
 * **提示格只在有话说时才渲染**（`rowNote` 返回非 null）。没有提示的行仍是三格 ——
 * 文件名那格是 `flex:1`，会吸收这点差异，体积与移除不会跳位。
 *
 * 关于版式：原型 `.file` 只有三格，没有提示的位置。但原型**只画了 happy path**，
 * 「压不到目标」这个状态它从未覆盖，所以补一格不是偏离原型，是填原型没画的洞。
 * 见 docs/decisions.md 的 T12-2 与 T22-1。
 */

export interface FileRowProps {
  item: ImageItem
  onRemove: (id: string) => void
}

export function FileRow({ item, onRemove }: FileRowProps): JSX.Element {
  const busy = item.state === 'working'
  const failed = item.state === 'failed' || !item.readable
  const done = item.state === 'done' || item.state === 'undershot'
  const failText = reasonText(item.reason)
  const note = rowNote(item)

  return (
    <li
      className={[s.file, busy ? s.busy : ''].join(' ')}
      data-state={item.state}
      data-reason={item.reason}
    >
      <span className={s.fname} title={item.name}>
        {item.name}
      </span>

      <span className={s.fsize} title={failed && failText === null ? item.reason : undefined}>
        {failed ? (
          // 读不了就没有体积可言，这一格让给原因。SPEC 没给文案的原因码留空
          (failText ?? '')
        ) : (
          <>
            {formatBytes(item.bytes)}
            {done && item.outBytes !== undefined && (
              <>
                <span className={s.arw}>{COPY.arrow}</span>
                <span className={`${s.out} ${s.outPop}`}>{formatBytes(item.outBytes)}</span>
              </>
            )}
          </>
        )}
      </span>

      {/* 压不到目标时的行内说明。琥珀色 —— 全站唯一有彩色，只在「有件事你得知道」时出现 */}
      {note !== null && <span className={s.note}>{note}</span>}

      <button
        type="button"
        className={s.rm}
        aria-label={COPY.removeAria(item.name)}
        onClick={() => {
          onRemove(item.id)
        }}
      >
        {COPY.remove}
      </button>
    </li>
  )
}
