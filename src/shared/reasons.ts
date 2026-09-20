/**
 * 单张图处理失败的原因码。
 *
 * 主进程只吐**码**，不吐文案：SPEC §8.4 要求文案集中管理、禁止散落在组件里，
 * 而且这些字符串要显示给用户，属于界面层的事。
 *
 * SPEC §9 只给了其中两种情况的确切文案：
 *   - `CORRUPT`             → 「文件已损坏，无法读取」
 *   - `HEIC_DECODE_FAILED`  → 「这台机器上的 HEIC 解码器打不开这张图」
 *
 * **「文件不存在 / 无读权限」这一条 SPEC 没有给文案**（§9 只说「行内显示原因」）。
 * 这里仍然只吐码（`ENOENT` / `EACCES` / ...），等确认文案后在渲染层补映射。
 * 不要在主进程里编一句中文出来。
 */

export type ReasonCode =
  /** 路径不存在 */
  | 'ENOENT'
  /** 没有读权限 */
  | 'EACCES'
  /** 路径存在但不是文件（比如拖进来一个目录） */
  | 'NOT_A_FILE'
  /** 文件头损坏，读不出图片信息 */
  | 'CORRUPT'
  /** HEIC 解码器打不开 */
  | 'HEIC_DECODE_FAILED'
  /** 处理超时（SPEC §9：>30s 标记 failed） */
  | 'TIMEOUT'
  /** 写输出文件失败 */
  | 'WRITE_FAILED'
  /** 其他未归类的原因 */
  | 'UNKNOWN'

/** 把异常映射成原因码。Node 的 fs 错误自带 `code`，能直接用 */
export function reasonFromError(e: unknown): ReasonCode {
  const code = (e as { code?: unknown } | null)?.code
  if (code === 'ENOENT') return 'ENOENT'
  if (code === 'EACCES' || code === 'EPERM') return 'EACCES'
  if (code === 'EISDIR') return 'NOT_A_FILE'
  if (code === 'ENOSPC' || code === 'EROFS') return 'WRITE_FAILED'
  // 图像引擎自己抛的错带 code
  if (code === 'HEIC_DECODE_FAILED') return 'HEIC_DECODE_FAILED'
  if (code === 'DIMENSION_CHANGED') return 'CORRUPT'
  if (code === 'TIMEOUT') return 'TIMEOUT'
  return 'UNKNOWN'
}
