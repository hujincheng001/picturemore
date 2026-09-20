import sharp from 'sharp'
import { probe } from './probe'
import { encode } from './encode'
import type { EncodeInput, EncodeOptions } from './encode'
import { MAX_ATTEMPTS, bestAttempt, nextQuality, qualityFloor, targetBytes } from './plan'
import { assertSameDimensions } from './verify'
import { canSharpDecodeHeic, decodeHeic } from './heic'
import type { Attempt, CompressResult, OutputFormat, ProbeResult } from './types'

export interface CompressInput {
  buf: Buffer
  /** 体积缩小百分比，SPEC §4.3 规定取值区间 [20, 90] */
  shrinkPercent: number
  outputFormat: OutputFormat
  /** 调用方已经探测过的结果，避免这里重复解一次容器 */
  probe: ProbeResult
}

export interface CompressOutput {
  data: Buffer
  result: CompressResult
}

/** 输出格式到文件扩展名。命名逻辑在 naming.ts，这里只提供映射 */
export const EXT: Record<Exclude<OutputFormat, 'keep'>, string> = {
  jpeg: 'jpg',
  png: 'png',
  webp: 'webp'
}

/**
 * 把用户的格式选择落成实际的输出格式。
 *
 * `keep` 不是"原样输出"，而是"输出一个同类但能压小的格式"：
 * HEIC 与 AVIF 在 sharp 的预编译二进制里写不回去（M0-1），
 * 所以落到 JPG。这也是 SPEC §4.3 里唯一能对 HEIC 生效的路径。
 */
export function targetFormat(src: ProbeResult, want: OutputFormat): Exclude<OutputFormat, 'keep'> {
  if (want !== 'keep') return want
  switch (src.format) {
    case 'png':
      return 'png'
    case 'webp':
      return 'webp'
    case 'heic':
    case 'avif':
      return 'jpeg'
    default:
      return 'jpeg'
  }
}

/**
 * 压一张图。整个流程是纯计算，不碰文件系统，由调用方负责写盘。
 *
 * 三条硬断言都在这里落地（SPEC §4.4）：
 * 1. 不 resize —— 靠 encode.ts 不出现 resize 保证，另有 lint 兜底
 * 2. 输出后断言宽高一致，不一致抛 DIMENSION_CHANGED
 * 3. 没压到就如实标 undershot，绝不为了达标牺牲观感
 */
export async function compressOne(input: CompressInput): Promise<CompressOutput> {
  const { buf, shrinkPercent, outputFormat, probe: src } = input
  const format = targetFormat(src, outputFormat)
  const target = targetBytes(buf.length, shrinkPercent)

  // sharp 的预编译二进制解不了 HEVC（M0-1），HEIC 的像素只能走 heic-decode
  const useRaw = src.format === 'heic' && !(await canSharpDecodeHeic())

  const base: EncodeInput = useRaw
    ? await (async () => {
        const decoded = await decodeHeic(buf)
        return {
          kind: 'raw' as const,
          buf: decoded.data,
          width: decoded.width,
          height: decoded.height
        }
      })()
    : { kind: 'buffer', buf }

  const opts: EncodeOptions = {
    // heic-decode 不做色彩管理，解出的像素是原生 P3 数值却没有标签（M0-3）。
    // 补挂 sharp 内置的 p3，实测色彩等价（原色矩阵与 Apple 的原厂 profile 逐位相同）
    // 且不转换像素（平均偏差 0.070/255，见 scripts/verify-icc-attach.mjs）。
    tagAsP3: useRaw,
    // JPG 没有透明通道。SPEC §4 规定拍平到白底
    flattenTo: format === 'jpeg' && src.hasAlpha ? '#FFFFFF' : null
  }

  const best = await pickBest(base, format, buf.length, shrinkPercent, opts)

  // 压不动就别交出更差的结果。SPEC §9：输出比原图还大时原样返回原文件
  let out = best.data
  let quality = best.quality
  let keptOriginal = false
  if (out.length >= buf.length) {
    out = buf
    quality = null
    keptOriginal = true
  }

  const after = await probe(out)
  assertSameDimensions(src, after)

  const result: CompressResult = {
    bytes: out.length,
    width: after.width,
    height: after.height,
    format: after.format,
    quality,
    // 目标没达成就是没达成。keptOriginal 时 out 就是原图，必然大于 target
    undershot: out.length > target,
    flattened: opts.flattenTo !== null,
    keptOriginal
  }

  return { data: out, result }
}

/**
 * 选出要交付的那一次编码结果。
 *
 * 有损格式在 [FLOOR, 95] 上搜索（SPEC §4.3）。候选里挑质量最高的一次 ——
 * 体积目标已经满足了，剩下的自由度全部让给观感，这是承诺二的要求。
 * 一次都没命中目标时用质量底线兜底，宁可不达标也不越过底线。
 *
 * **先试质量底线，再二分**。这一条不是微优化，是把最慢的那一类图救回来的关键：
 * 如果连底线都压不到目标体积，说明再往上抬质量只会更大，当场就能判定 undershot，
 * 一次编码结束。按"从区间中点开始二分"的写法，这类图无论如何都要编码 6 次。
 * 实测 noise-hi / huge-8000 这类高熵图，编码次数从 6 次降到 1 次。
 */
async function pickBest(
  base: EncodeInput,
  format: Exclude<OutputFormat, 'keep'>,
  originalBytes: number,
  shrinkPercent: number,
  opts: EncodeOptions
): Promise<{ data: Buffer; quality: number | null }> {
  if (format === 'png') {
    // PNG 无损，没有质量档可调。SPEC §4.3 要求：颜色数 <= 256 才量化到调色板，
    // 再叠 compressionLevel 9。
    //
    // 不能图省事写成"无 alpha 就上 palette"：照片存成的 PNG 有几十万种颜色，
    // 强行量化到 256 色会压出色带，直接违反承诺二。
    const palette = await hasAtMostColours(base, 256)
    const r = await encode(base, { format: 'png', quality: null, palette }, opts)
    return { data: r.data, quality: null }
  }

  const floor = qualityFloor(shrinkPercent)
  const history: Attempt[] = []
  // 编码结果按质量档缓存，避免"选中哪一档再重编一次"的浪费
  const encoded = new Map<number, Buffer>()

  const attempt = async (q: number): Promise<void> => {
    const r = await encode(base, { format, quality: q, palette: false }, opts)
    encoded.set(q, r.data)
    history.push({ quality: q, bytes: r.data.length })
  }

  await attempt(floor)
  while (history.length < MAX_ATTEMPTS) {
    const q = nextQuality(originalBytes, shrinkPercent, history)
    if (q === null) break
    await attempt(q)
  }

  const pick = bestAttempt(originalBytes, shrinkPercent, history)
  if (pick !== null) {
    const data = encoded.get(pick.quality)
    if (data !== undefined) return { data, quality: pick.quality }
  }

  // 没有候选命中目标：退回质量底线，如实标记 undershot
  const cached = encoded.get(floor)
  if (cached !== undefined) return { data: cached, quality: floor }

  const r = await encode(base, { format, quality: floor, palette: false }, opts)
  return { data: r.data, quality: floor }
}

/** 目标体积，导出给上层做预估用（界面上的"预计"文案） */
export { targetBytes, qualityFloor }

/**
 * 判断图片的颜色数是否不超过 limit。用于决定 PNG 能不能走调色板。
 *
 * 一旦超过 limit 立刻返回，所以照片类图片只扫前几百个像素就结束，
 * 只有真正接近纯色的图才会扫完整个像素数组。
 *
 * 导出是为了能单独测：这个判断错了会静默压出色带，属于看不出但很难看的问题。
 */
export async function hasAtMostColours(input: EncodeInput, limit: number): Promise<boolean> {
  const pipeline =
    input.kind === 'raw'
      ? sharp(input.buf, { raw: { width: input.width, height: input.height, channels: 4 } })
      : sharp(input.buf, { failOn: 'error' })

  const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true })
  const ch = info.channels
  const seen = new Set<number>()

  for (let i = 0; i + ch <= data.length; i += ch) {
    // 有 alpha 就把 alpha 也算进颜色身份，否则透明与不透明会被误判成同色
    const key =
      ch >= 4
        ? ((data[i + 3] << 24) | (data[i] << 16) | (data[i + 1] << 8) | data[i + 2]) >>> 0
        : ((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]) >>> 0
    seen.add(key)
    if (seen.size > limit) return false
  }
  return true
}
