import { useEffect, type JSX } from 'react'
import { AppHeader } from './components/AppHeader'
import { ControlPane } from './components/ControlPane'
import { FileList } from './components/FileList'
import { TokenProbe } from './components/TokenProbe'
import { useAppStore } from './store/useAppStore'

/**
 * 窗口外壳 + 全链路接线。
 *
 * 三件事在这里汇合：
 * 1. 初始化时读一次设置（缩小比例、输出格式、存放位置）
 * 2. 订阅 task:progress / task:done 两条主进程推送
 * 3. 空列表时退化成单栏（原型 `.body.is-empty`）
 */
export default function App(): JSX.Element {
  const items = useAppStore((s) => s.items)
  const dropped = useAppStore((s) => s.dropped)
  const running = useAppStore((s) => s.running)
  const progress = useAppStore((s) => s.progress)
  const finished = useAppStore((s) => s.finished)
  const lastOutputDir = useAppStore((s) => s.lastOutputDir)
  const error = useAppStore((s) => s.error)
  const shrinkPercent = useAppStore((s) => s.shrinkPercent)
  const outputFormat = useAppStore((s) => s.outputFormat)
  const outputDir = useAppStore((s) => s.outputDir)

  const init = useAppStore((s) => s.init)
  const addPaths = useAppStore((s) => s.addPaths)
  const pickFiles = useAppStore((s) => s.pickFiles)
  const pickOutputDir = useAppStore((s) => s.pickOutputDir)
  const removeItem = useAppStore((s) => s.removeItem)
  const clear = useAppStore((s) => s.clear)
  const setShrinkPercent = useAppStore((s) => s.setShrinkPercent)
  const setOutputFormat = useAppStore((s) => s.setOutputFormat)
  const run = useAppStore((s) => s.run)

  useEffect(() => {
    void init()
  }, [init])

  // 订阅主进程推送。**必须在 cleanup 里退订**：dev 模式下 React 严格模式会把
  // effect 跑两遍，不退订就会注册两个监听器，进度回调执行两次（SPEC §14.2）。
  useEffect(() => {
    const offProgress = window.pictureMore.onProgress((e) => {
      useAppStore.getState().applyProgress(e)
    })
    const offDone = window.pictureMore.onDone((e) => {
      useAppStore.getState().finishTask(e)
    })
    return () => {
      offProgress()
      offDone()
    }
  }, [])

  const totalBytes = items.reduce((sum, it) => sum + (it.readable ? it.bytes : 0), 0)
  const alphaCount = items.filter((it) => it.hasAlpha).length
  const empty = items.length === 0

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
            outputDir={outputDir}
            onPickOutputDir={() => {
              void pickOutputDir()
            }}
            alphaCount={alphaCount}
            totalBytes={totalBytes}
            itemCount={items.length}
            running={running}
            progress={progress}
            finished={finished}
            lastOutputDir={lastOutputDir}
            error={error}
            onRun={() => {
              void run()
            }}
          />
        )}

        <FileList
          items={items}
          dropped={dropped}
          running={running}
          onPaths={(paths) => {
            void addPaths(paths)
          }}
          onPickFiles={() => {
            void pickFiles()
          }}
          onRemove={removeItem}
          onClear={() => {
            void clear()
          }}
        />
      </div>

      {/* 设计 token 的校验锚点，视觉上移出屏幕，见组件文件的说明 */}
      <TokenProbe />
    </div>
  )
}
