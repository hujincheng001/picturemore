import sharp from 'sharp'
import heicDecode from 'heic-decode'
import { ImageEngineError } from './verify'

let cached: boolean | null = null

/**
 * sharp 的预编译二进制不含 HEVC 解码器，读不了 HEIC（SPEC.md §5）。
 *
 * 判定方式必须看能力声明，不能靠"喂一段假文件头看是否抛错"：
 * M0 实测 sharp(buf).metadata() 对 HEIC 是成功的（只解析容器头），
 * 只有真正碰像素的编码才会失败。所以假文件头探不出来。
 */
export async function canSharpDecodeHeic(): Promise<boolean> {
  if (cached !== null) return cached
  const suffixes: string[] = sharp.format.heif?.input?.fileSuffix ?? []
  // 预编译版只有 .avif（AVIF 是 AV1 编码）。出现别的后缀说明这台机器能解 HEVC。
  cached = suffixes.some((s) => s !== '.avif')
  return cached
}

/**
 * 用 heic-decode（libheif-js WASM）把 HEIC 解成 raw RGBA。
 *
 * 注意两点（M0 实测结论，见 docs/decisions.md）：
 * 1. 返回的像素已经应用过方向（容器 irot / EXIF orientation），
 *    调用方不得再写 orientation 标签，否则二次旋转。
 * 2. libheif-js 不带色彩管理，像素是文件原生原色（iPhone 是 Display P3），
 *    需要由调用方挂上对应 ICC。
 */
export async function decodeHeic(buf: Buffer): Promise<{
  data: Buffer
  width: number
  height: number
}> {
  try {
    const r = await heicDecode({ buffer: buf })
    // 零拷贝：r.data 的底层 ArrayBuffer 是 JS 堆上的，不受 WASM 生命周期影响
    const data = Buffer.from(r.data.buffer, r.data.byteOffset, r.data.byteLength)
    return { data, width: r.width, height: r.height }
  } catch (e) {
    throw new ImageEngineError('HEIC_DECODE_FAILED', `HEIC 解码失败：${(e as Error).message}`)
  }
}
