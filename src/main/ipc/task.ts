import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { constants, existsSync } from 'node:fs'
import { basename } from 'node:path'
import { ipcMain, type WebContents } from 'electron'
import { IPC } from '../../shared/ipc'
import { reasonFromError } from '../../shared/reasons'
import type { StartTaskPayload, TaskDoneEvent, TaskProgressEvent } from '../../shared/types'
import { CANCELLED, Pool, defaultConcurrency } from '../queue'
import { EXT, compressOne, probe, resolveOutputPath, targetFormat } from '../image'
import { writeSettings } from '../settings'
import { timeoutFor, withTimeout } from '../timeout'

/**
 * 批量压缩的编排。全部留在主进程（红线三：渲染进程不碰文件系统）。
 *
 * 单张的流程：读文件 → probe → compressOne → 定输出名 → 写盘 → 推一行进度。
 * 每张完成立刻推，不等整批（SPEC §4.8）；单张失败不中断整批，标记该张后继续。
 *
 * 超时策略在 `src/main/timeout.ts`（不依赖 electron，可单测）。
 */

interface ActiveTask {
  pool: Pool
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

      let done = 0
      let undershot = 0
      let failed = 0

      const results = await Promise.allSettled(
        items.map((item, index) =>
          pool.run(async () => {
            const progress = (
              state: TaskProgressEvent['state'],
              extra: Partial<TaskProgressEvent> = {}
            ): void => {
              sendProgress(evt.sender, {
                taskId,
                itemId: item.id,
                index,
                total: items.length,
                state,
                ...extra
              })
            }

            progress('working')

            try {
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

              progress(result.undershot ? 'undershot' : 'done', {
                outBytes: result.bytes,
                outName: basename(outPath),
                width: result.width,
                height: result.height,
                quality: result.quality
              })

              if (result.undershot) undershot++
              else done++
            } catch (e) {
              failed++
              progress('failed', { reason: reasonFromError(e) })
            }
          })
        )
      )

      active.delete(taskId)

      // 被 cancelPending 跳过的那些以 CANCELLED 拒绝，不计入 failed ——
      // 用户本来就在清列表，把它们算成失败会在完成提示里给出错误数字。
      const cancelled = results.filter(
        (r) => r.status === 'rejected' && (r.reason as Error | undefined)?.message === CANCELLED
      ).length

      sendDone(evt.sender, {
        taskId,
        done: done + undershot,
        undershot,
        failed,
        outputDir
      })

      // cancelled 只用于日志，界面上那几行已经被用户清掉了
      if (cancelled > 0) console.info(`[task] ${taskId} 跳过 ${cancelled} 张`)

      return { taskId }
    }
  )

  ipcMain.handle(IPC.taskCancel, (_evt, payload: { taskId: string }): void => {
    // 已在跑的当前张跑完，队列里未开始的直接跳过（SPEC §4.8）。
    // 编码跑到一半没法中断，硬砍只会留下半个文件。
    active.get(payload?.taskId)?.pool.cancelPending()
  })
}
