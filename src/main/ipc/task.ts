import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { constants, existsSync } from 'node:fs'
import { basename } from 'node:path'
import { ipcMain, type WebContents } from 'electron'
import { IPC } from '../../shared/ipc'
import type { StartTaskPayload, TaskDoneEvent, TaskProgressEvent } from '../../shared/types'
import { runBatch } from '../batch'
import { Pool, defaultConcurrency } from '../queue'
import { EXT, compressOne, probe, resolveOutputPath, targetFormat } from '../image'
import { writeSettings } from '../settings'
import { timeoutFor, withTimeout } from '../timeout'

/**
 * 批量压缩的 IPC 入口。全部留在主进程（红线三：渲染进程不碰文件系统）。
 *
 * 这一层只做三件事：建输出目录、把「读文件 → probe → 压缩 → 写盘」注入进编排、
 * 把结果转成 IPC 事件。**编排本身在 `src/main/batch.ts`**（不依赖 electron，
 * 中止逻辑与计数都单测过），超时策略在 `src/main/timeout.ts`。
 */

interface ActiveTask {
  pool: Pool
}

/** 每张的输出信息，进度事件要用。键是 itemId */
interface OutputMeta {
  name: string
  bytes: number
  width: number
  height: number
  quality: number | null
}

const active = new Map<string, ActiveTask>()

function sendProgress(sender: WebContents, payload: TaskProgressEvent): void {
  // 窗口可能在批次跑完之前就被关了
  if (!sender.isDestroyed()) sender.send(IPC.taskProgress, payload)
}

function sendDone(sender: WebContents, payload: TaskDoneEvent): void {
  if (!sender.isDestroyed()) sender.send(IPC.taskDone, payload)
}

export function registerTaskIpc(): void {
  ipcMain.handle(
    IPC.taskStart,
    async (evt, payload: StartTaskPayload): Promise<{ taskId: string }> => {
      const { taskId, items, shrinkPercent, outputFormat, outputDir } = payload

      // 输出目录：不存在就建，建不了或不可写就当场报错，不让用户白等（SPEC §9）
      await mkdir(outputDir, { recursive: true })
      await access(outputDir, constants.W_OK)

      // 记住这次的选择，下次启动沿用
      writeSettings({ outputDir, shrinkPercent, outputFormat })

      const pool = new Pool(defaultConcurrency())
      active.set(taskId, { pool })

      const lastOutput = new Map<string, OutputMeta>()

      const summary = await runBatch(items, pool, {
        processOne: async (item) => {
          const buf = await readFile(item.path)
          const probed = await probe(buf)
          const { data, result } = await withTimeout(
            compressOne({ buf, shrinkPercent, outputFormat, probe: probed }),
            timeoutFor(item.width, item.height)
          )

          const outPath = resolveOutputPath({
            sourcePath: item.path,
            outputDir,
            targetExt: EXT[targetFormat(probed, outputFormat)],
            exists: existsSync
          })

          await writeFile(outPath, data)

          // 输出名与真实体积留在旁边，onProgress 里带上
          lastOutput.set(item.id, {
            name: basename(outPath),
            bytes: result.bytes,
            width: result.width,
            height: result.height,
            quality: result.quality
          })
          return result.undershot ? 'undershot' : 'done'
        },

        onProgress: (item, index, state, reason) => {
          const meta = lastOutput.get(item.id)
          sendProgress(evt.sender, {
            taskId,
            itemId: item.id,
            index,
            total: items.length,
            state,
            ...(meta === undefined
              ? {}
              : {
                  outBytes: meta.bytes,
                  outName: meta.name,
                  width: meta.width,
                  height: meta.height,
                  quality: meta.quality
                }),
            ...(reason === undefined ? {} : { reason })
          })
        }
      })

      active.delete(taskId)

      sendDone(evt.sender, {
        taskId,
        done: summary.done + summary.undershot,
        undershot: summary.undershot,
        failed: summary.failed,
        outputDir,
        ...(summary.aborted === null ? {} : { aborted: summary.aborted })
      })

      if (summary.skipped > 0) {
        console.info(
          `[task] ${taskId} 跳过 ${summary.skipped} 张${summary.aborted === null ? '' : `（${summary.aborted}）`}`
        )
      }

      return { taskId }
    }
  )

  ipcMain.handle(IPC.taskCancel, (_evt, payload: { taskId: string }): void => {
    // 已在跑的当前张跑完，队列里未开始的直接跳过（SPEC §4.8）。
    // 编码跑到一半没法中断，硬砍只会留下半个文件。
    active.get(payload?.taskId)?.pool.cancelPending()
  })
}
