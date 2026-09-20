import type { CSSProperties, JSX } from 'react'
import { COPY } from '../lib/copy'
import { sliderRatio } from '../lib/format'
import { SAFE_PERCENT } from '../lib/note'
import s from './ShrinkSlider.module.css'

/**
 * 对应原型 `.field`（第一个）+ `.slider-wrap` + `.scale`。
 *
 * 两条关键逻辑：
 * 1. 已填充比例 = (value - 20) / (90 - 20)，通过 CSS 变量 `--pct` 传给轨道渐变
 * 2. 越过 70% 安全线时，填充色与百分数同时转琥珀（DESIGN.md §8）
 *
 * 滑块拖动**不发 IPC**，预估量在前端算（SPEC §7）。
 */

const MIN = 20
const MAX = 90
const STEP = 5

export interface ShrinkSliderProps {
  value: number
  onChange: (value: number) => void
}

export function ShrinkSlider({ value, onChange }: ShrinkSliderProps): JSX.Element {
  const over = value > SAFE_PERCENT
  const style = {
    '--pct': `${(sliderRatio(value, MIN, MAX) * 100).toFixed(2)}%`,
    '--fill': over ? 'var(--color-caution)' : 'var(--color-ink-900)'
  } as CSSProperties

  return (
    <div className="flex flex-col gap-[10px]">
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-1 text-fg-3">{COPY.shrinkLabel}</span>
        <output
          htmlFor="shrink-percent"
          className={[
            'text-4 leading-none tracking-[-0.035em] tabular-nums transition-colors duration-[180ms]',
            over ? 'text-caution' : 'text-fg'
          ].join(' ')}
        >
          {value}%
        </output>
      </div>

      <div className="relative">
        <input
          id="shrink-percent"
          className={s.slider}
          style={style}
          type="range"
          min={MIN}
          max={MAX}
          step={STEP}
          value={value}
          aria-label={COPY.shrinkAria}
          aria-valuetext={`${COPY.shrinkLabel} ${value}%`}
          onChange={(e) => {
            onChange(Number(e.target.value))
          }}
        />
        {/* 70% 安全线的刻度，纯装饰 */}
        <span className={s.safeTick} aria-hidden="true" />
      </div>

      <div className="-mt-2 flex justify-between text-1 text-fg-3" aria-hidden="true">
        <span>{COPY.scaleLow}</span>
        <span>{COPY.scaleHigh}</span>
      </div>
    </div>
  )
}
