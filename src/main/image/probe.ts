import sharp from 'sharp'
// sharp 的类型走 `export = sharp` + `declare namespace sharp`，
// 默认导入只拿到值绑定，取不到命名空间里的类型，所以 Metadata 必须具名导入。
import type { Metadata } from 'sharp'
import { canSharpDecodeHeic, decodeHeic } from './heic'
import { ImageEngineError } from './verify'
import type { ImageFormat, ProbeResult } from './types'

const MAP: Record<string, ImageFormat> = {
  jpeg: 'jpeg',
  jpg: 'jpeg',
  png: 'png',
  webp: 'webp',
  avif: 'avif',
  gif: 'gif',
  tiff: 'tiff'
}

/** HEIF 容器里既有 HEIC（HEVC）也有 AVIF（AV1），靠 compression 字段区分 */
function formatOf(m: Metadata): ImageFormat {
  if (m.format === 'heif') return m.compression === 'av1' ? 'avif' : 'heic'
  return MAP[m.format] ?? 'unknown'
}

export async function probe(buf: Buffer): Promise<ProbeResult> {
  try {
    // 对 HEIC 这一步也是成功的：libvips 能解析容器头，拿到的是显示尺寸
    const m = await sharp(buf).metadata()
    return {
      format: formatOf(m),
      width: m.width ?? 0,
      height: m.height ?? 0,
      bytes: buf.length,
      hasAlpha: m.hasAlpha ?? false,
      // HEIC 的方向在容器里（irot），sharp 读不到，但它已经把尺寸算成显示尺寸了
      orientation: m.orientation ?? 1,
      icc: m.icc ? 'present' : null
    }
  } catch (e) {
    // 兜底：连容器头都读不了，可能是这台机器缺 HEIF 支持
    if (await canSharpDecodeHeic()) throw e
    try {
      const r = await decodeHeic(buf)
      return {
        format: 'heic',
        width: r.width,
        height: r.height,
        bytes: buf.length,
        // libheif-js 固定解成 RGBA，但 HEIC 未必真有透明通道，
        // 这里按"无 alpha"处理，避免把不透明的图误判成需要拍平
        hasAlpha: false,
        orientation: 1,
        icc: null
      }
    } catch {
      throw new ImageEngineError('PROBE_FAILED', `读不出这张图：${(e as Error).message}`)
    }
  }
}
