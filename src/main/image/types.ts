export type ImageFormat = 'heic' | 'jpeg' | 'png' | 'webp' | 'avif' | 'gif' | 'tiff' | 'unknown'
export type OutputFormat = 'keep' | 'jpeg' | 'png' | 'webp'

export interface ProbeResult {
  format: ImageFormat
  width: number
  height: number
  bytes: number
  hasAlpha: boolean
  orientation: number
  icc: string | null
}

export interface Attempt {
  quality: number
  bytes: number
}

export interface CompressResult {
  bytes: number
  width: number
  height: number
  format: string
  quality: number | null
  /** 没压到目标体积。界面需要如实告知，绝不静默交付 */
  undershot: boolean
  /** 透明通道被拍平到白底（仅 JPG） */
  flattened: boolean
  /**
   * 输出没有比原图小，于是原样返回了原文件字节。
   *
   * 这个字段是 SPEC §9 逼出来的：那一节给「输出比原图还大」和「压不到目标体积」
   * 配了两句不同文案（「这张已经压到底了」/「质量已到下限，只压到 {x}」），
   * 光靠 undershot 一个布尔区分不了，界面就没法选对句子。
   * SPEC §4.2 的 CompressResult 定义里没有它，属于按 §9 的需求补的字段。
   */
  keptOriginal: boolean
}
