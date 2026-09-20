import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { OutputFormat, Settings } from '../shared/types'

/**
 * 极小的设置持久化。
 *
 * `AGENTS.md` 明确禁止引入 `electron-store`，运行时依赖只能是 sharp / heic-decode / zustand，
 * 所以这里手写一个读写 JSON 的存储。设置项一共四个，不值得为它拉一个依赖。
 *
 * 文件落在 `app.getPath('userData')/settings.json`，读失败一律回退到默认值：
 * 设置读不出来不该让应用起不来。
 */

/** 默认值取自 `SPEC.md` §7：缩小 65%、保持原格式 */
const DEFAULTS: Settings = {
  outputDir: null,
  shrinkPercent: 65,
  outputFormat: 'keep',
  lastDir: null
}

const FORMATS: readonly OutputFormat[] = ['keep', 'jpeg', 'png', 'webp']

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

/** 逐字段校验。磁盘上的东西可能是手改过的，不能直接信 */
function coerce(raw: unknown): Settings {
  if (raw === null || typeof raw !== 'object') return { ...DEFAULTS }
  const o = raw as Record<string, unknown>

  const shrink =
    typeof o['shrinkPercent'] === 'number' && Number.isFinite(o['shrinkPercent'])
      ? Math.min(90, Math.max(20, Math.round(o['shrinkPercent'])))
      : DEFAULTS.shrinkPercent

  const format = FORMATS.includes(o['outputFormat'] as OutputFormat)
    ? (o['outputFormat'] as OutputFormat)
    : DEFAULTS.outputFormat

  const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null)

  return {
    outputDir: str(o['outputDir']),
    shrinkPercent: shrink,
    outputFormat: format,
    lastDir: str(o['lastDir'])
  }
}

export function readSettings(): Settings {
  const file = settingsPath()
  if (!existsSync(file)) return { ...DEFAULTS }
  try {
    return coerce(JSON.parse(readFileSync(file, 'utf-8')))
  } catch {
    // 文件坏了就当没有，不要让设置拖垮启动
    return { ...DEFAULTS }
  }
}

export function writeSettings(patch: Partial<Settings>): Settings {
  const next = coerce({ ...readSettings(), ...patch })
  const file = settingsPath()
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(next, null, 2), 'utf-8')
  } catch {
    // 写不进去（磁盘满、权限）也不该中断当前操作，内存里的值仍然返回
  }
  return next
}
