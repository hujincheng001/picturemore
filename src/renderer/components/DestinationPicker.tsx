import type { JSX } from 'react'
import { COPY } from '../lib/copy'

/**
 * 对应原型 `.picker` + `.hint`。
 *
 * 整个 40px 通栏是一个按钮（原型就是这么做的），路径用等宽字左对齐并截断，
 * 右侧「更改」是按钮内部的视觉提示，不是独立按钮。
 */

export interface DestinationPickerProps {
  dir: string
  onPick: () => void
}

export function DestinationPicker({ dir, onPick }: DestinationPickerProps): JSX.Element {
  return (
    <div className="flex flex-col gap-[10px]">
      <span className="text-1 text-fg-3">{COPY.destLabel}</span>

      <button
        type="button"
        onClick={onPick}
        aria-label={COPY.destPickAria}
        className="group flex h-10 w-full items-center gap-[10px] rounded-control border border-strong px-3 transition-colors duration-[140ms] hover:border-fg-3 hover:bg-bone-050"
      >
        <span className="min-w-0 flex-1 truncate text-left font-mono text-1 text-fg-2" title={dir}>
          {dir}
        </span>
        <span className="flex-none border-b border-strong text-1 text-fg-3 transition-colors duration-[140ms] group-hover:border-fg group-hover:text-fg">
          {COPY.destChange}
        </span>
      </button>

      <p className="text-1 leading-[1.65] text-fg-3">{COPY.destHint}</p>
    </div>
  )
}
