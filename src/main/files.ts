import { randomUUID } from 'node:crypto'
import { readFile, readdir, stat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { reasonFromError } from '../shared/reasons'
import type { ImageFileMeta, ProbeResponse } from '../shared/types'
import { probe } from './image'

/**
 * `files:probe` 的逻辑本体。
 *
 * **刻意不 import electron** —— 这样它能脱离 Electron 单测，和 `src/main/image/`
 * 遵循同一条原则。注册 IPC 的那几行留在 `src/main/ipc/files.ts`。
 *
 * 单张失败不影响其余（SPEC §4.8「单张失败不中断整批」）。读不了的就标
 * `readable: false` 并带上原因码，交给界面如实展示，不抛给渲染层。
 */

const SUPPORTED = new Set([
  'heic',
  'heif',
  'jpg',
  'jpeg',
  'png',
  'webp',
  'avif',
  'gif',
  'tif',
  'tiff'
])

/** 扩展名不在支持列表里的一律当成非图片，静默过滤掉（SPEC §9「拖入非图片文件」） */
export function isSupportedExt(path: string): boolean {
  return SUPPORTED.has(extname(path).replace(/^\./, '').toLowerCase())
}

/**
 * 把一个输入路径展开成一组图片文件路径。
 *
 * - 目录 → 展开一层，取里面的图片文件（SPEC §9「拖入文件夹」）
 * - 图片文件 → 原样保留
 * - 其他 → 丢掉，不报错（SPEC §9「拖入非图片文件」）
 *
 * 只展开一层是 SPEC 明写的，不要改成递归 —— 用户拖进来一个盘符根目录时，
 * 递归会变成扫描整块盘。
 */
export async function expand(path: string): Promise<string[]> {
  try {
    const info = await stat(path)
    if (!info.isDirectory()) {
      return isSupportedExt(path) ? [path] : []
    }

    const entries = await readdir(path, { withFileTypes: true })
    return entries
      .filter((e) => e.isFile() && isSupportedExt(e.name))
      .map((e) => join(path, e.name))
      .sort()
  } catch {
    // 路径根本不存在：留给 metaFor 去给出准确的原因码
    return [path]
  }
}

/** 读一张图，产出列表需要的元信息。任何失败都变成 `readable: false` + 原因码 */
export async function metaFor(path: string): Promise<ImageFileMeta> {
  const id = randomUUID()
  const name = basename(path)
  const ext = extname(path).replace(/^\./, '').toLowerCase()

  const fail = (reason: string): ImageFileMeta => ({
    id,
    name,
    path,
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
      path,
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

/**
 * 把一批输入路径展开并逐张读元信息。
 *
 * `limit` 是**还能再收几张**（不是总数）。展开之后立刻截断再读盘 ——
 * 拖进来一个装了几千张图的文件夹时，先读全量再截会白白慢几十秒。
 *
 * 返回值带 `dropped`，让界面能如实告诉用户「有 N 张被忽略了」，
 * 而不是让用户以为全压了。
 */
export async function probePaths(raw: string[], limit?: number): Promise<ProbeResponse> {
  const paths: string[] = []
  for (const p of raw) {
    if (typeof p === 'string' && p.length > 0) paths.push(...(await expand(p)))
  }

  const room = typeof limit === 'number' && Number.isFinite(limit) ? Math.max(0, limit) : paths.length
  const taken = paths.slice(0, room)
  const dropped = paths.length - taken.length

  // 逐张处理而不是 Promise.all：一次拖进几百张时，同时打开几百个文件句柄没必要
  const metas: ImageFileMeta[] = []
  for (const p of taken) {
    metas.push(await metaFor(p))
  }
  return { metas, dropped }
}
