import { useState, type JSX } from 'react'
import type { OutputFormat } from '../shared/types'
import { AppHeader } from './components/AppHeader'
import { ControlPane } from './components/ControlPane'
import { FileList } from './components/FileList'
import type { ImageItem } from './lib/types'

/**
 * Task 11 / 12 的验证外壳。
 *
 * 这里搭的是「窗口 + 标题行 + 左栏 + 右栏」，数据是一组写死的样例，
 * 为的是让两个栏位都能在真实渲染环境里被逐项比对（原型 `.window` / `.top` / `.pane` / `.list-pane`）。
 *
 * 样例刻意照抄原型里那 11 个文件，连总体积（34.2 MB）都对上，这样截图能直接叠着看。
 *
 * store 接线、IPC 串通、真实拖拽都是 Task 13 的事，届时这个文件会被整体替换。
 */
const MB = 1024 * 1024

/** 原型里那 11 个文件，连体积都照抄，总体积正好 34.2 MB */
const SAMPLE: ImageItem[] = [
  ['1', 'IMG_2043.HEIC', 4.2, 'heic', false],
  ['2', 'IMG_2044.HEIC', 3.8, 'heic', false],
  ['3', 'IMG_2045.HEIC', 5.1, 'heic', false],
  ['4', '微信图片_20260918.jpg', 2.1, 'jpeg', false],
  ['5', '身份证正面.jpg', 3.4, 'jpeg', false],
  ['6', '屏幕截图_2026-09-19.png', 1.2, 'png', false],
  ['7', '收据_IMG_2046.jpg', 2.6, 'jpeg', false],
  ['8', '头像抠图.png', 1.8, 'png', true],
  ['9', '毕业证.jpg', 3.0, 'jpeg', false],
  ['10', '银行卡正面.jpg', 2.4, 'jpeg', false],
  ['11', 'IMG_2047.HEIC', 4.6, 'heic', false]
].map(([id, name, mb, format, hasAlpha]) => ({
  id: id as string,
  name: name as string,
  bytes: Math.round((mb as number) * MB),
  format: format as ImageItem['format'],
  hasAlpha: hasAlpha as boolean,
  readable: true,
  state: 'pending' as const
}))

export default function App(): JSX.Element {
  const [shrinkPercent, setShrinkPercent] = useState(65)
  const [outputFormat, setOutputFormat] = useState<OutputFormat>('keep')
  const [items, setItems] = useState<ImageItem[]>(SAMPLE)

  const totalBytes = items.reduce((sum, it) => sum + (it.readable ? it.bytes : 0), 0)
  const alphaCount = items.filter((it) => it.hasAlpha).length
  const empty = items.length === 0

  return (
    <div className="flex h-[min(768px,calc(100vh-96px))] w-[min(980px,100%)] flex-col overflow-hidden rounded-window border border-strong bg-surface shadow-[0_1px_2px_rgba(20,20,20,.03),0_20px_52px_-26px_rgba(20,20,20,.24)]">
      <AppHeader />

      <div className="grid min-h-0 flex-1" style={{ gridTemplateColumns: empty ? '1fr' : '328px 1fr' }}>
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
            itemCount={items.length}
            running={false}
            progress={0}
            finished={false}
            onRun={() => undefined}
          />
        )}

        <FileList
          items={items}
          running={false}
          onPaths={() => undefined}
          onPickFiles={() => undefined}
          onRemove={(id) => {
            setItems((prev) => prev.filter((it) => it.id !== id))
          }}
          onClear={() => {
            setItems([])
          }}
        />
      </div>

      <div id="token-probe" aria-hidden="true" style={{ position: 'absolute', left: '-9999px', top: 0 }}>
        <div id="probe-bone" className="bg-bone-200 text-fg-3 rounded-control" />
        <div id="probe-surface" className="bg-surface text-fg rounded-window" />
        <div id="probe-caution" className="text-caution rounded-inline" />
        <div id="probe-type" className="text-4 font-mono" />
        <div id="probe-strong" className="border border-strong" />
        <div id="probe-hover" className="bg-hover text-fg-2" />
      </div>
    </div>
  )
}
