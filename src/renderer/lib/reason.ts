import type { ReasonCode } from '../../shared/reasons'
import { COPY } from './copy'

/**
 * 原因码到文案的映射。
 *
 * SPEC §9 只给了两条确切文案，另外说「文件不存在 / 无读权限」要「行内显示原因」
 * 却没给字符串，§8.4 文案表里也没有。
 *
 * **2026-09-22 把缺的补齐了。** 用户已把「需要拍板的决定直接做」的授权给到最高级，
 * 所以不再挂着等确认。原来那几条返回 null，结果是失败行的体积格**空白** ——
 * 一行既没有体积也没有原因，用户只知道「这张不行」，不知道是找不到、没权限还是别的。
 * 静默比说得不够准更糟。
 *
 * | 原因码 | 文案 | 来源 |
 * |---|---|---|
 * | `CORRUPT` | 文件已损坏，无法读取 | SPEC §9 原文 |
 * | `HEIC_DECODE_FAILED` | 这台机器上的 HEIC 解码器打不开这张图 | SPEC §9 原文 |
 * | 其余 | 见下表 | 2026-09-22 补，已同步进 SPEC §8.4 |
 *
 * 写作纪律照旧：直白、具体、不夸张，零 em-dash、零 emoji、中黑点最多一个。
 */

const REASON_TEXT: Partial<Record<ReasonCode, string>> = {
  // SPEC §9 原文
  CORRUPT: '文件已损坏，无法读取',
  HEIC_DECODE_FAILED: '这台机器上的 HEIC 解码器打不开这张图',
  // 以下为 2026-09-22 补
  ENOENT: '找不到这个文件',
  EACCES: '没有读取权限',
  NOT_A_FILE: '这不是文件',
  TIMEOUT: '处理超时了',
  WRITE_FAILED: '写不进去',
  DISK_FULL: '磁盘满了',
  // 兜底：认不出来的也不能留空
  UNKNOWN: '读不了这张图'
}

export function reasonText(code: string | undefined): string | null {
  if (code === undefined) return null
  return REASON_TEXT[code as ReasonCode] ?? null
}

/**
 * 批次级错误 → 底部那行显示的文案。
 *
 * **与 `reasonText` 分开**：同一个原因码在「单行」和「整批」两种语境下要说的话不一样。
 * `EACCES` 在行内是「这张读不了」，在整批是「这个文件夹写不进去」。
 *
 * 这三条是用户 2026-09-21 确认的（原本 DESIGN.md 与 SPEC §8.4 都没有错误态）。
 * 兜底那句保证**任何原因码都有话说** —— 静默失败比说得不够准更糟。
 */
export function batchErrorText(code: string | null): string | null {
  if (code === null || code === '') return null
  if (code === 'DISK_FULL') return COPY.errorDiskFull
  if (code === 'WRITE_FAILED' || code === 'EACCES' || code === 'ENOENT' || code === 'NOT_A_FILE') {
    return COPY.errorWriteFailed
  }
  return COPY.errorFallback
}
