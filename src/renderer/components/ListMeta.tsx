import type { JSX } from 'react'
import { COPY } from '../lib/copy'
import { formatBytes } from '../lib/format'

/**
 * 对应原型 `.meta`。左边「共 {n} 张 · {size}」，右边「清空列表」。
 *
 * 空列表时整个不渲染（原型里是 `metaEl.hidden = true`）。
 * 处理中禁掉清空，避免用户在批次跑到一半时清列表 —— SPEC §9 要求先 cancel 再清，
 * 那套编排在 Task 13，这里只保证按钮不会在错误时机被点到。
 */

export interface ListMetaProps {
  count: number
  totalBytes: number
  running: boolean
  onClear: () => void
}

export function ListMeta({ count, totalBytes, running, onClear }: ListMetaProps): JSX.Element {
  return (
    <div className="mt-[22px] flex flex-none items-baseline justify-between gap-4 border-b border-line pb-[9px] text-1 tabular-nums text-fg-3">
      <span>{COPY.listMeta(count, formatBytes(totalBytes))}</span>
      <button
        type="button"
        onClick={onClear}
        disabled={running}
        className="border-b border-transparent text-1 text-fg-3 transition-colors duration-[140ms] enabled:hover:border-strong enabled:hover:text-fg disabled:cursor-default"
      >
        {COPY.clearList}
      </button>
    </div>
  )
}
