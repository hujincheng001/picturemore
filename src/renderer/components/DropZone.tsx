import type { JSX } from 'react'
import { COPY } from '../lib/copy'

/**
 * 对应原型 `.drop`。
 *
 * 两种形态：
 *   常驻条（有图时）  52px 高，一行「拖入更多图片，或 [选择文件]」
 *   空态             吃掉整个右栏，竖排，字号升到 20px，并露出格式说明
 *
 * 拖拽的高亮反馈落在这里（`.is-over`），但拖拽目标挂在**整个右栏**上 ——
 * 见 FileList.tsx。所以 `over` 是从外面传进来的，这个组件自己不挂事件。
 */

export interface DropZoneProps {
  empty: boolean
  over: boolean
  onPick: () => void
}

export function DropZone({ empty, over, onPick }: DropZoneProps): JSX.Element {
  return (
    <div
      className={[
        // flex-none 与 flex-1 必须互斥地挂在两个分支上：
        // 同时挂在同一个元素上时，谁赢取决于 Tailwind 输出顺序，不是后写的赢。
        'flex items-center justify-center rounded-control border border-dashed transition-colors duration-[140ms]',
        empty ? 'flex-1 flex-col gap-4 text-3' : 'h-[52px] flex-none gap-[10px] text-2',
        over ? 'border-solid border-fg bg-bone-050 text-fg-2' : 'border-strong text-fg-3'
      ].join(' ')}
    >
      <span>{empty ? COPY.dropEmpty : COPY.dropWithFiles}</span>

      <button
        type="button"
        onClick={onPick}
        className="border-b border-strong pb-px text-fg transition-colors duration-[140ms] hover:border-fg"
      >
        {COPY.pickFile}
      </button>

      {/* 格式说明只在空态出现，常驻条上不放（原型 .drop-hint 默认 display:none） */}
      {empty && <span className="text-1 text-fg-3">{COPY.dropFormats}</span>}
    </div>
  )
}
