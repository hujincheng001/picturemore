import { ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { IPC } from '../../shared/ipc'
import { reasonFromError } from '../../shared/reasons'
import type { ImageFileMeta } from '../../shared/types'
import { probe } from '../image'

/**
 * `files:probe`：把一批路径变成列表需要的元信息。
 *
 * 单张失败不影响其余（SPEC §4.8「单张失败不中断整批」）。读不了的就标
 * `readable: false` 并带上原因码，交给界面如实展示，不抛给渲染层。
 */

const SUPPORTED = new Set(['heic', 'heif', 'jpg', 'jpeg', 'png', 'webp', 'avif', 'gif', 'tif', 'tiff'])

async function metaFor(path: string): Promise<ImageFileMeta> {
  const id = randomUUID()
  const name = basename(path)
  const ext = extname(path).replace(/^\./, '').toLowerCase()

  const fail = (reason: string): ImageFileMeta => ({
    id,
    name,
    ext,
    bytes: 0,
    format: 'unknown',
    width: 0,
    height: 0,
    hasAlpha: false,
    readable: false,
    reason
  })

  try {
    const info = await stat(path)
    if (!info.isFile()) return fail('NOT_A_FILE')
    if (info.size === 0) return fail('CORRUPT')

    const buf = await readFile(path)
    const pr = await probe(buf)

    return {
      id,
      name,
      ext,
      bytes: buf.length,
      format: pr.format,
      width: pr.width,
      height: pr.height,
      hasAlpha: pr.hasAlpha,
      readable: true
    }
  } catch (e) {
    const reason = reasonFromError(e)
    // 引擎能读懂容器但读不出尺寸，等同于损坏
    if (reason === 'UNKNOWN') return fail('CORRUPT')
    return fail(reason)
  }
}

/** 扩展名不在支持列表里的一律当成损坏，避免把 .txt 当图片处理 */
export function isSupportedExt(path: string): boolean {
  return SUPPORTED.has(extname(path).replace(/^\./, '').toLowerCase())
}

export function registerFilesIpc(): void {
  ipcMain.handle(IPC.probe, async (_evt, payload: { paths: string[] }): Promise<ImageFileMeta[]> => {
    const paths = Array.isArray(payload?.paths) ? payload.paths : []
    // 逐张处理而不是 Promise.all：一次拖进几百张时，同时打开几百个文件句柄没必要
    const out: ImageFileMeta[] = []
    for (const p of paths) {
      if (typeof p === 'string' && p.length > 0) out.push(await metaFor(p))
    }
    return out
  })
}
