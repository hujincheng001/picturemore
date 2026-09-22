import type { JSX } from 'react'
import type { OutputFormat } from '../../shared/types'
import { DestinationPicker } from './DestinationPicker'
import { EstimateLine } from './EstimateLine'
import { FormatPicker } from './FormatPicker'
import { PrimaryButton } from './PrimaryButton'
import { QualityNote } from './QualityNote'
import { ShrinkSlider } from './ShrinkSlider'

/**
 * 对应原型 `.pane`。左栏 328px：滑块 → 输出格式 → 存放位置 → 承诺与预估 → 操作。
 *
 * 组件本身不持有状态：全部通过 props 传入。Task 13 接 store 时只换外层，
 * 这里不用动。这样也让它能脱离 store 单独比对原型。
 *
 * 空列表时整个左栏由外层隐藏（原型 `.body.is-empty .pane{display:none}`），
 * 所以这里不处理空态。
 */

export interface ControlPaneProps {
  shrinkPercent: number
  onShrinkChange: (value: number) => void

  outputFormat: OutputFormat
  onOutputFormatChange: (value: OutputFormat) => void

  outputDir: string
  onPickOutputDir: () => void

  /** 列表里带透明通道的图片数量，喂给四态文案的优先级 2 */
  alphaCount: number
  totalBytes: number
  itemCount: number

  running: boolean
  progress: number
  finished: boolean
  lastOutputDir: string | null
  error: string | null
  notice: string | null
  onRun: () => void
}

export function ControlPane(props: ControlPaneProps): JSX.Element {
  return (
    <aside
      className="flex flex-col gap-[26px] overflow-y-auto border-r border-line px-8 py-7 [scrollbar-color:var(--color-border-strong)_transparent] [scrollbar-width:thin]"
      aria-label="压缩设置"
    >
      <ShrinkSlider value={props.shrinkPercent} onChange={props.onShrinkChange} />

      <FormatPicker value={props.outputFormat} onChange={props.onOutputFormatChange} />

      <DestinationPicker dir={props.outputDir} onPick={props.onPickOutputDir} />

      <div className="flex flex-col gap-[10px]">
        <QualityNote
          outputFormat={props.outputFormat}
          alphaCount={props.alphaCount}
          shrinkPercent={props.shrinkPercent}
        />
        <EstimateLine totalBytes={props.totalBytes} shrinkPercent={props.shrinkPercent} />
      </div>

      <PrimaryButton
        itemCount={props.itemCount}
        running={props.running}
        progress={props.progress}
        finished={props.finished}
        lastOutputDir={props.lastOutputDir}
        error={props.error}
        notice={props.notice}
        onClick={props.onRun}
      />
    </aside>
  )
}
