import { useState, type JSX } from 'react'
import type { OutputFormat } from '../shared/types'
import { AppHeader } from './components/AppHeader'
import { ControlPane } from './components/ControlPane'
import { COPY } from './lib/copy'

/**
 * Task 11 的验证外壳。
 *
 * 这里只搭了「窗口 + 标题行 + 左栏」这一段，目的是让左栏能在真实渲染环境里
 * 被逐项比对（原型 `.window` / `.top` / `.body` / `.pane`）。
 * 右栏、store 接线、IPC 串通都是 Task 12 / 13 的事，届时这个文件会被整体替换。
 *
 * 里面的 `#token-probe` 块是 Task 10 留下的 token 校验探针，见那个文件的说明。
 */
export default function App(): JSX.Element {
  // 临时本地状态：Task 13 换成 useAppStore
  const [shrinkPercent, setShrinkPercent] = useState(65)
  const [outputFormat, setOutputFormat] = useState<OutputFormat>('keep')

  // 这里先塞一组假数据，好让左栏真的渲染出来供比对（空列表时左栏是隐藏的）。
  const itemCount: number = 11
  const totalBytes: number = Math.round(34.2 * 1024 * 1024)
  const alphaCount: number = 1
  const empty = itemCount === 0

  return (
    <div className="flex h-[min(768px,calc(100vh-96px))] w-[min(980px,100%)] flex-col overflow-hidden rounded-window border border-strong bg-surface shadow-[0_1px_2px_rgba(20,20,20,.03),0_20px_52px_-26px_rgba(20,20,20,.24)]">
      <AppHeader />

      <div
        className="grid min-h-0 flex-1"
        style={{ gridTemplateColumns: empty ? '1fr' : '328px 1fr' }}
      >
        {!empty && (
          <ControlPane
            shrinkPercent={shrinkPercent}
            onShrinkChange={setShrinkPercent}
            outputFormat={outputFormat}
            onOutputFormatChange={setOutputFormat}
            outputDir="D:\\照片\\2026-09\\processed"
            onPickOutputDir={() => {
              void window.pictureMore.pickOutputDir()
            }}
            alphaCount={alphaCount}
            totalBytes={totalBytes}
            itemCount={itemCount}
            running={false}
            progress={0}
            finished={false}
            onRun={() => undefined}
          />
        )}

        <main className="flex min-h-0 flex-col px-8 py-7" aria-label="图片列表">
          {/* 右栏是 Task 12 的事，这里先放一句占位，好让左栏的宽度与分隔线可见 */}
          <p className="text-1 text-fg-3">{COPY.dropEmpty}</p>
        </main>
      </div>

      <div
        id="token-probe"
        aria-hidden="true"
        style={{ position: 'absolute', left: '-9999px', top: 0 }}
      >
        {/* primitive → semantic 映射：骨白底 + 三级灰字 + 控件圆角 */}
        <div id="probe-bone" className="bg-bone-200 text-fg-3 rounded-control" />
        {/* 语义层：白底 + 主字色 + 窗口圆角 */}
        <div id="probe-surface" className="bg-surface text-fg rounded-window" />
        {/* 全站唯一有彩色，只在警示时出现 */}
        <div id="probe-caution" className="text-caution rounded-inline" />
        {/* 字号四档的最大档 + 等宽字族 */}
        <div id="probe-type" className="text-4 font-mono" />
        {/* 发丝线 */}
        <div id="probe-strong" className="border border-strong" />
        {/* 悬停底色与次强调字色 */}
        <div id="probe-hover" className="bg-hover text-fg-2" />
      </div>
    </div>
  )
}
