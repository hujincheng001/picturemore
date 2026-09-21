/**
 * IPC 通道名。三个进程共用，禁止在别处写字符串字面量。
 *
 * 对应 `SPEC.md` §6.1 的通道表。
 */

export const IPC = {
  /** R→M `{ paths }` → `ImageFileMeta[]` */
  probe: 'files:probe',
  /** R→M → `{ paths } | null` */
  pickImages: 'dialog:pickImages',
  /** R→M → `{ dir } | null` */
  pickOutputDir: 'dialog:pickOutputDir',
  /** R→M `StartTaskPayload` → `{ taskId }` */
  taskStart: 'task:start',
  /** R→M `{ taskId }` → void */
  taskCancel: 'task:cancel',
  /** R→M → `Settings` */
  settingsGet: 'settings:get',
  /** R→M `Partial<Settings>` → `Settings` */
  settingsSet: 'settings:set',
  /** M→R `TaskProgressEvent` */
  taskProgress: 'task:progress',
  /** M→R `TaskDoneEvent` */
  taskDone: 'task:done'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
