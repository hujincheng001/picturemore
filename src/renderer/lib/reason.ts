import type { ReasonCode } from '../../shared/reasons'

/**
 * 原因码到文案的映射。
 *
 * ⚠️ **SPEC 只给了其中两条。** 这是本次开发里唯一一处「按规矩不能自己编」的文案缺口。
 *
 * | 原因码 | 文案 | 来源 |
 * |---|---|---|
 * | `CORRUPT` | 「文件已损坏，无法读取」 | SPEC §9 明确给出 |
 * | `HEIC_DECODE_FAILED` | 「这台机器上的 HEIC 解码器打不开这张图」 | SPEC §9 明确给出 |
 * | `ENOENT` / `EACCES` / 其余 | **无** | SPEC §9 只说「行内显示原因」，没给字符串；§8.4 文案表里也没有 |
 *
 * AGENTS.md 的规矩是「文案只能取自 §8.4 文案表，不得自造词」以及「都不覆盖就问用户，
 * 不要猜」。所以这里**刻意不填**那两条，缺的那几种情况界面只留 `title`（原因码本身，
 * 便于排查）不显示中文。等确认文案后在这里补一行即可。
 *
 * 见 docs/decisions.md 的 T9-3 与 T12-2。
 */

const REASON_TEXT: Partial<Record<ReasonCode, string>> = {
  CORRUPT: '文件已损坏，无法读取',
  HEIC_DECODE_FAILED: '这台机器上的 HEIC 解码器打不开这张图'
}

export function reasonText(code: string | undefined): string | null {
  if (code === undefined) return null
  return REASON_TEXT[code as ReasonCode] ?? null
}
