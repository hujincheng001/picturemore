/**
 * heic-decode 2.1.0 不自带类型声明，这里按 lib.js 的实际实现手写一份最小声明。
 *
 * 不装 @types/heic-decode：SPEC.md §15 限定运行时依赖只有 sharp / heic-decode / zustand，
 * 且 @types 包在离线环境下未必可获取。声明文件零运行时成本，是更稳的做法。
 *
 * 实现依据 node_modules/heic-decode/lib.js：
 *   decodeBuffer({ buffer }) -> decodeImage(data[0]) -> { width, height, data }
 *   data 是 new Uint8ClampedArray(width * height * 4)，即 8 位 RGBA。
 */
declare module 'heic-decode' {
  export interface HeicDecodeResult {
    width: number
    height: number
    /** 8 位 RGBA，长度 = width * height * 4 */
    data: Uint8ClampedArray
  }

  export interface HeicDecodeOptions {
    buffer: Buffer | Uint8Array
  }

  /**
   * 解码 HEIC 主图。
   *
   * 抛出条件（供调用方判断错误类型）：
   * - `TypeError: input buffer is not a HEIC image`（brand 不在 mif1/msf1/heic/heix/hevc/hevx 内）
   * - `Error: HEIF image not found`
   * - `Error: HEIF processing error`
   */
  function heicDecode(options: HeicDecodeOptions): Promise<HeicDecodeResult>

  export default heicDecode
}
