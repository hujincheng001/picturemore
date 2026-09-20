import type { JSX } from 'react'
import { COPY } from '../lib/copy'

/** 对应原型 `.top`。产品名在左上角，全宽标题行左对齐 */
export function AppHeader(): JSX.Element {
  return (
    <header className="flex h-16 flex-none items-baseline gap-[9px] border-b border-line px-8">
      <span className="text-3 font-medium tracking-[-0.02em]">{COPY.wordmark}</span>
      <span className="text-1 tracking-[0.05em] text-fg-3">{COPY.wordmarkSub}</span>
    </header>
  )
}
