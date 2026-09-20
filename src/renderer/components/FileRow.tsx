import type { JSX } from 'react'
import { COPY } from '../lib/copy'
import { formatBytes } from '../lib/format'
import { reasonText } from '../lib/reason'
import type { ImageItem } from '../lib/types'
import s from './FileRow.module.css'

/**
 * 对应原型 `.file`。一行只有文件名、体积、移除。移除是**文字**不是图标。
 *
 * 四种行的呈现：
 *   pending / working  只显示原体积；working 整行降到 30% 不透明
 *   done               显示 `4.2 MB → 1.5 MB`，结果那一半淡入落位
 *   undershot          同上（体积确实变了，只是没到目标），另在 title 上说明
 *   failed             体积那一格换成原因文案；SPEC 没给文案的原因码只留 title
 *
 * ⚠️ SPEC §9 给「输出比原图还大」和「压不到目标体积」配了两句行内文案
 * （「这张已经压到底了」/「质量已到下限，只压到 {x}」），但**原型这一行没有位置放它们**
 * —— 44px 一行，只有文件名、体积、移除三格。原型是唯一视觉基准，不能自己加一栏。
 * 所以这里只把状态放在 title 上，不擅自改版式。见 docs/decisions.md 的 T12-2。
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
