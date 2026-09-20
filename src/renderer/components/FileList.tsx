import { useCallback, useEffect, useRef, useState, type DragEvent, type JSX } from 'react'
import type { ImageItem } from '../lib/types'
import { VIRTUALIZE_ABOVE, visibleRange } from '../lib/virtual'
import { DropZone } from './DropZone'
import { FileRow } from './FileRow'
import { ListMeta } from './ListMeta'
import s from './FileList.module.css'

/**
 * 右栏整体。对应原型 `.list-pane`：拖拽区 + 列表元信息 + 文件清单。
 *
 * **拖拽目标挂在整个右栏上，高亮反馈落在 DropZone 上**（计划 Task 12 Step 2）。
 * 这样用户把文件丢在列表中间也能接住，而不是必须精准命中那 52px 的条。
 *
 * **超过 100 行启用虚拟化**（SPEC §9）。实测 500 行时滚动与单点更新都没问题
 * （每帧 16ms，正好 60fps），但首屏渲染占了那一次 1163ms 里的一大半，
 * 拖入大批图时会卡一下。行高固定 44px，所以不需要动态测量。
 *
 * 短列表（<= 100 行）走原路全渲染 —— 这也是断言 `main li` 数量的冒烟检查能继续用的原因。
 */

export interface FileListProps {
  items: ImageItem[]
  running: boolean
  /** 拖入或选择之后拿到的绝对路径，交给上层去 probe */
  onPaths: (paths: string[]) => void
  onPickFiles: () => void
  onRemove: (id: string) => void
  onClear: () => void
}

export function FileList({
  items,
  running,
  onPaths,
  onPickFiles,
  onRemove,
  onClear
}: FileListProps): JSX.Element {
  const [over, setOver] = useState(false)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const empty = items.length === 0
  const totalBytes = items.reduce((sum, it) => sum + (it.readable ? it.bytes : 0), 0)
  const virtual = items.length > VIRTUALIZE_ABOVE

  // 容器高度：首帧量一次，之后跟着窗口尺寸变。
  // 量不到高度时 visibleRange 会退化成全渲染，不会闪空白
  useEffect(() => {
    const el = scrollRef.current
    if (el === null) return
    setViewportHeight(el.clientHeight)
    const ro = new ResizeObserver(() => {
      setViewportHeight(el.clientHeight)
    })
    ro.observe(el)
    return () => {
      ro.disconnect()
    }
  }, [empty])

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (el !== null) setScrollTop(el.scrollTop)
  }, [])

  const range = virtual
    ? visibleRange(items.length, scrollTop, viewportHeight)
    : { start: 0, end: items.length, padTop: 0, padBottom: 0 }
  const visibleItems = items.slice(range.start, range.end)

  const handleDrop = (e: DragEvent<HTMLElement>): void => {
    e.preventDefault()
    setOver(false)
    // Electron 32 起 File.path 已移除，路径只能从 preload 的 webUtils 拿（SPEC §14.2）
    const paths = window.pictureMore.getDroppedPaths([...e.dataTransfer.files])
    if (paths.length > 0) onPaths(paths)
  }

  return (
    <main
      className={['flex min-h-0 flex-col', empty ? 'p-8' : 'px-8 py-7'].join(' ')}
      aria-label="图片列表"
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={(e) => {
        // 指针在子元素之间移动也会触发 dragleave，不判断的话高亮会闪
        const next = e.relatedTarget as Node | null
        if (next === null || !e.currentTarget.contains(next)) setOver(false)
      }}
      onDrop={handleDrop}
    >
      <DropZone empty={empty} over={over} onPick={onPickFiles} />

      {!empty && (
        <>
          <ListMeta
            count={items.length}
            totalBytes={totalBytes}
            running={running}
            onClear={onClear}
          />
          <div className={s.files} ref={scrollRef} onScroll={handleScroll}>
            {/*
              上下用 padding 占位而不是插两个 spacer 元素：
              ul 里塞 div 是非法结构，而 padding 不影响行的正常流。
              行高固定 44px，所以 padding 一定是整数行，不会出现半行错位。
            */}
            <ul style={virtual ? { paddingTop: range.padTop, paddingBottom: range.padBottom } : undefined}>
              {visibleItems.map((it) => (
                <FileRow key={it.id} item={it} onRemove={onRemove} />
              ))}
            </ul>
          </div>
        </>
      )}
    </main>
  )
}
