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
  /** 质量底线挡住了目标体积，实际没压到。界面需要如实告知 */
  undershot: boolean
  /** 透明通道被拍平到白底（仅 JPG） */
  flattened: boolean
}
