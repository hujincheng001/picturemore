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
  /** 最近一次加入时因为超过单批上限而被忽略的张数，0 表示没有 */
  dropped: number
  onClear: () => void
}

export function ListMeta({
  count,
  totalBytes,
  dropped,
  onClear
}: ListMetaProps): JSX.Element {
  return (
    <div className="mt-[22px] flex flex-none items-baseline justify-between gap-4 border-b border-line pb-[9px] text-1 tabular-nums text-fg-3">
      <span>
        {COPY.listMeta(count, formatBytes(totalBytes))}
        {/*
          被忽略的张数必须说出来。不说的话用户拖进来 500 张、只压了 100 张，
          会以为全压完了 —— 这是静默丢数据，比报错更糟。
        */}
        {dropped > 0 && <span className="text-caution">{COPY.listDropped(dropped)}</span>}
      </span>
      <button
        type="button"
        onClick={onClear}
        /*
         * **不在处理中禁用。**
         *
         * 原来这里是 `disabled={running}` —— 那是我自己加的，原型里清空按钮
         * 从来不禁用（`prototype/index.html` 的 `#clearBtn` 就是个普通 click），
         * DESIGN.md 也没提禁用态。
         *
         * 而那个禁用把 SPEC §9 的「处理中清空列表 → 先 task:cancel 再清」
         * 变成了**走不到的路径** —— `task:cancel` 从此成了死代码。
         * 一条写在规格里、却因为另一处的擅自加码而永远执行不到的分支，
         * 比没有这条规格更糟：它会让人以为已经处理过了。
         *
         * 清空期间的行为是安全的：cancelPending 跳过没开始的，在跑的几张跑完；
         * 它们推的进度找不到对应行，applyProgress 按 itemId 匹配，匹配不到就什么也不做。
         *
         * 见 docs/decisions.md 的 T27-1。
         */
        className="border-b border-transparent text-1 text-fg-3 transition-colors duration-[140ms] hover:border-strong hover:text-fg"
      >
        {COPY.clearList}
      </button>
    </div>
  )
}
