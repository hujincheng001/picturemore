import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc'

/**
 * 批量压缩的两个通道。
 *
 * **本 Task（9）只登记通道，不实现编排。** 计划把编排放在 Task 13：
 * 它需要并发池、逐张进度推送、§9 的 17 条边界处理一起落地，
 * 单独提前实现会让 Task 13 的验收失去意义。
 *
 * 这里刻意抛错而不是静默返回成功：静默返回会让渲染层以为任务跑完了，
 * 是最难查的一类 bug。
 */

const NOT_IMPLEMENTED = 'TASK_ORCHESTRATION_NOT_IMPLEMENTED'

export function registerTaskIpc(): void {
  ipcMain.handle(IPC.taskStart, (): never => {
    throw new Error(NOT_IMPLEMENTED)
  })

  ipcMain.handle(IPC.taskCancel, (): never => {
    throw new Error(NOT_IMPLEMENTED)
  })
}
