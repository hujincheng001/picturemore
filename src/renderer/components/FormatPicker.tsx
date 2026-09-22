import { useRef, type JSX, type KeyboardEvent } from 'react'
import type { OutputFormat } from '../../shared/types'
import { COPY } from '../lib/copy'

/**
 * 对应原型 `.fmts`。用 radiogroup 语义而不是普通按钮组。
 *
 * **完整的 radiogroup 键盘模式**（ARIA Authoring Practices）：
 * - 整个组只占**一个 Tab 停靠点** —— 只有选中的那个 `tabIndex=0`，其余是 -1
 * - 方向键在选项间移动，**移动的同时选中**（radiogroup 的约定）
 * - Home / End 跳到第一个 / 最后一个
 *
 * ⚠️ 之前这里只写了 `role="radio"`，但**没有 roving tabindex、也没接方向键** ——
 * 于是四个选项全进了 Tab 序列，方向键按下去毫无反应。
 * 注释里却写着「键盘可以用方向键在选项间移动，这是原生 radio 的行为」——
 * **`role="radio"` 挂在 `<button>` 上不会带来任何原生行为**，那只是给辅助技术的声明。
 * 代码承诺了没做的事，比不承诺更糟：读注释的人会以为不用管。
 *
 * 见 docs/decisions.md 的 T25-1。
 */

const OPTIONS: ReadonlyArray<{ value: OutputFormat; label: string }> = [
  { value: 'keep', label: COPY.formatKeep },
  { value: 'jpeg', label: COPY.formatJpeg },
  { value: 'png', label: COPY.formatPng },
  { value: 'webp', label: COPY.formatWebp }
]

export interface FormatPickerProps {
  value: OutputFormat
  onChange: (value: OutputFormat) => void
}

export function FormatPicker({ value, onChange }: FormatPickerProps): JSX.Element {
  const refs = useRef<Array<HTMLButtonElement | null>>([])

  /** 选中并聚焦第 index 项。方向键与 Home/End 都走这里 */
  const selectAt = (index: number): void => {
    const option = OPTIONS[index]
    if (option === undefined) return
    onChange(option.value)
    refs.current[index]?.focus()
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    const last = OPTIONS.length - 1
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        e.preventDefault()
        selectAt(index === last ? 0 : index + 1)
        break
      case 'ArrowLeft':
      case 'ArrowUp':
        e.preventDefault()
        selectAt(index === 0 ? last : index - 1)
        break
      case 'Home':
        e.preventDefault()
        selectAt(0)
        break
      case 'End':
        e.preventDefault()
        selectAt(last)
        break
      default:
        break
    }
  }

  return (
    <div className="flex flex-col gap-[10px]">
      <span className="text-1 text-fg-3">{COPY.formatLabel}</span>
      <div className="flex flex-wrap gap-[6px]" role="radiogroup" aria-label={COPY.formatLabel}>
        {OPTIONS.map((o, index) => {
          const checked = o.value === value
          return (
            <button
              key={o.value}
              ref={(el) => {
                refs.current[index] = el
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              // roving tabindex：整组只有一个 Tab 停靠点
              tabIndex={checked ? 0 : -1}
              onClick={() => {
                onChange(o.value)
              }}
              onKeyDown={(e) => {
                handleKeyDown(e, index)
              }}
              className={[
                'h-8 rounded-control border px-[11px] text-1 transition-colors duration-[140ms]',
                checked
                  ? 'border-fg bg-bone-050 text-fg'
                  : 'border-strong text-fg-3 hover:border-fg-3 hover:text-fg-2'
              ].join(' ')}
            >
              {o.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
