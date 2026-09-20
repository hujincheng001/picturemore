import sharp from 'sharp'
import type { OutputFormat } from './types'

/**
 * 编码的唯一出口。整个产品里只有这一个地方碰 sharp 的输出管线。
 *
 * 两条产品承诺在这一层必须同时成立：
 * 1. 只改体积，不改展示 —— 不 resize、不 rotate、不重绘。
 * 2. 色彩不能被悄悄改掉 —— ICC 要么原样保留，要么按已知原色如实标注。
 *
 * metadata 的写法是 M0 实测定下来的（见 docs/decisions.md M0-4），
 * **不要凭记忆改成 `withMetadata()`**：它在 sharp 0.35.4 内部会无条件执行
 * `withIccProfile('srgb')`（node_modules/sharp/dist/output.cjs:527），
 * 把 Display P3 图片的 ICC 标签换成 sRGB 却不转换像素 —— 最坏的一种错法。
 */

export type EncodeInput =
  | { kind: 'buffer'; buf: Buffer }
  | { kind: 'raw'; buf: Buffer; width: number; height: number }

export interface EncodePlan {
  format: Exclude<OutputFormat, 'keep'>
  /** null 表示该格式没有质量档（PNG） */
  quality: number | null
  /** PNG 专用。仅当源图颜色数 <= 256 时才由调用方置 true */
  palette: boolean
}

export interface EncodeOptions {
  /**
   * 源没有 ICC，但已知它的原色是 Display P3 时置 true。
   *
   * 唯一的场景是 HEIC：`heic-decode`（libheif-js）不带色彩管理，
   * 解出来的像素是文件原生的 P3 数值，却没有任何标签（M0-3）。
   * 此时必须补挂 P3 标签，否则下游会按 sRGB 解释，画面偏色。
   *
   * 实测确认：输入没有 profile 时，`withIccProfile('p3')` 只挂标签、
   * 不转换像素（平均偏差 0.070/255，最大 2，纯舍入）。
   * 复跑方式见 scripts/verify-icc-attach.mjs。
   */
  tagAsP3: boolean

  /** JPG 输出且源有 alpha 时，把透明拍平到这个底色（SPEC §4 规定用白底） */
  flattenTo: string | null
}

export interface EncodeResult {
  data: Buffer
  width: number
  height: number
  format: string
}

export async function encode(
  input: EncodeInput,
  plan: EncodePlan,
  opts: EncodeOptions
): Promise<EncodeResult> {
  let p =
    input.kind === 'raw'
      ? // HEIC 解出来的裸 RGBA。heic-decode 固定输出 4 通道、已应用方向
        sharp(input.buf, {
          raw: { width: input.width, height: input.height, channels: 4 }
        })
      : sharp(input.buf, { failOn: 'error' })

  // 承诺二：整条管线里不出现 resize / rotate / crop / extend

  if (opts.flattenTo !== null) {
    p = p.flatten({ background: opts.flattenTo })
  }

  if (input.kind === 'buffer') {
    // ICC 一律保留，没有开关。
    //
    // SPEC §4.3 把「保留 ICC」列为硬性要求：丢掉会让 sRGB 之外的图（如 Display P3）
    // 明显偏色。计划草稿里那个 `keepIcc: boolean` 与这条冲突，且是个危险的开关
    // （哪天有人传了 false 就悄悄违反承诺），所以不实现。
    //
    // withExif({}) 让 libvips 把 orientation 原样写回，同时不夹带其余 EXIF。
    // 注意 withExif({ IFD0: { Orientation: '6' } }) 是无效的，libvips 会覆盖成 1。
    p = p.keepIccProfile().withExif({})
  }

  if (opts.tagAsP3) {
    p = p.withIccProfile('p3')
  }

  switch (plan.format) {
    case 'jpeg':
      p = p.jpeg({ quality: plan.quality ?? 85, mozjpeg: true })
      break
    case 'webp':
      p = p.webp({ quality: plan.quality ?? 85, effort: 4 })
      break
    case 'png':
      p = p.png({ compressionLevel: 9, palette: plan.palette })
      break
  }

  const { data, info } = await p.toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height, format: info.format }
}
