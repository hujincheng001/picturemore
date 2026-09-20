import type { JSX } from 'react'
import type { OutputFormat } from '../../shared/types'
import { COPY } from '../lib/copy'

/**
 * 对应原型 `.fmts`。用 radiogroup 语义而不是普通按钮组：
 * 键盘可以用方向键在选项间移动，这是原生 radio 的行为，也是 SPEC §10.3
 * 「键盘走完整个流程」要求的。
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
  return (
    <div className="flex flex-col gap-[10px]">
      <span className="text-1 text-fg-3">{COPY.formatLabel}</span>
      <div className="flex flex-wrap gap-[6px]" role="radiogroup" aria-label={COPY.formatLabel}>
        {OPTIONS.map((o) => {
          const checked = o.value === value
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={checked}
              onClick={() => {
                onChange(o.value)
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
