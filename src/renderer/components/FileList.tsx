import { useState, type DragEvent, type JSX } from 'react'
import type { ImageItem } from '../lib/types'
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
 * 列表是全渲染的。曾经写过一版虚拟化（>100 行启用），但单批上限收到 100 张之后
 * 它永远不会触发，属于不可达代码，就删掉了 —— 见 docs/decisions.md 的 T18-1。
 * 上限若将来放宽，`git log` 里有那版实现。
 */

export interface FileListProps {
  items: ImageItem[]
  /** 最近一次加入时因为超过单批上限而被忽略的张数 */
  dropped: number
  /** 拖入或选择之后拿到的绝对路径，交给上层去 probe */
  onPaths: (paths: string[]) => void
  onPickFiles: () => void
  onRemove: (id: string) => void
  onClear: () => void
}

export function FileList({
  items,
  dropped,
  onPaths,
  onPickFiles,
  onRemove,
  onClear
}: FileListProps): JSX.Element {
  const [over, setOver] = useState(false)

  const empty = items.length === 0
  const totalBytes = items.reduce((sum, it) => sum + (it.readable ? it.bytes : 0), 0)

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
            dropped={dropped}
            onClear={onClear}
          />
          <ul className={s.files}>
            {items.map((it) => (
              <FileRow key={it.id} item={it} onRemove={onRemove} />
            ))}
          </ul>
        </>
      )}
    </main>
  )
}
