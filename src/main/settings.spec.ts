import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * 设置存储。AGENTS.md 禁止引入 electron-store，所以这里是手写的 JSON 读写。
 *
 * 值得测的是 `coerce`：磁盘上的文件可能被人手改过，也可能被别的版本写过。
 * **读设置失败不该让应用起不来**，所以它必须能容忍各种畸形输入。
 */

// vi.mock 会被提升到 import 之上，所以用 vi.hoisted 把可变状态一起提上去
const state = vi.hoisted(() => ({ userData: '' }))

vi.mock('electron', () => ({
  app: { getPath: (): string => state.userData }
}))

const { readSettings, writeSettings } = await import('./settings')

let workDir = ''
const settingsFile = (): string => join(workDir, 'settings.json')

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), 'pm-settings-'))
  state.userData = workDir
})

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true })
})

beforeEach(() => {
  rmSync(settingsFile(), { force: true })
})

describe('readSettings', () => {
  it('文件不存在时返回默认值', () => {
    // 首次启动走这条路。默认值取自 SPEC §7：缩小 65%、保持原格式
    expect(readSettings()).toEqual({
      outputDir: null,
      shrinkPercent: 65,
      outputFormat: 'keep',
      lastDir: null
    })
  })

  it('文件坏掉时回退到默认值，不抛错', () => {
    // 设置读不出来不该让应用起不来
    writeFileSync(settingsFile(), '{ 这不是合法 JSON')
    expect(readSettings().shrinkPercent).toBe(65)
  })

  it('文件是合法 JSON 但不是对象时也回退', () => {
    writeFileSync(settingsFile(), '"just a string"')
    expect(readSettings().outputDir).toBeNull()
    writeFileSync(settingsFile(), 'null')
    expect(readSettings().outputFormat).toBe('keep')
  })
})

describe('writeSettings', () => {
  it('写进去再读出来是同一个值', () => {
    writeSettings({ outputDir: 'D:\\照片\\processed', shrinkPercent: 45, outputFormat: 'webp' })
    const s = readSettings()
    expect(s.outputDir).toBe('D:\\照片\\processed')
    expect(s.shrinkPercent).toBe(45)
    expect(s.outputFormat).toBe('webp')
  })

  it('局部更新不会把其他字段冲掉', () => {
    writeSettings({ shrinkPercent: 30 })
    writeSettings({ outputFormat: 'png' })
    const s = readSettings()
    expect(s.shrinkPercent).toBe(30)
    expect(s.outputFormat).toBe('png')
  })

  it('返回值就是落盘后的值', () => {
    const returned = writeSettings({ shrinkPercent: 88 })
    expect(returned.shrinkPercent).toBe(88)
  })

  it('真的写到了 app.getPath 给的位置', () => {
    writeSettings({ shrinkPercent: 55 })
    expect(existsSync(settingsFile())).toBe(true)
    expect(JSON.parse(readFileSync(settingsFile(), 'utf-8')).shrinkPercent).toBe(55)
  })
})

describe('coerce：磁盘上的值不可信', () => {
  const put = (raw: unknown): void => writeFileSync(settingsFile(), JSON.stringify(raw))

  it('缩小比例被夹到 20-90', () => {
    put({ shrinkPercent: 5 })
    expect(readSettings().shrinkPercent).toBe(20)
    put({ shrinkPercent: 200 })
    expect(readSettings().shrinkPercent).toBe(90)
  })

  it('缩小比例取整，且拒绝非有限数', () => {
    put({ shrinkPercent: 65.7 })
    expect(readSettings().shrinkPercent).toBe(66)
    put({ shrinkPercent: Number.NaN })
    expect(readSettings().shrinkPercent).toBe(65)
    put({ shrinkPercent: '65' })
    expect(readSettings().shrinkPercent).toBe(65)
  })

  it('非法输出格式回退到 keep', () => {
    put({ outputFormat: 'gif' })
    expect(readSettings().outputFormat).toBe('keep')
    put({ outputFormat: 42 })
    expect(readSettings().outputFormat).toBe('keep')
  })

  it('四个合法输出格式都认得', () => {
    for (const f of ['keep', 'jpeg', 'png', 'webp']) {
      put({ outputFormat: f })
      expect(readSettings().outputFormat, f).toBe(f)
    }
  })

  it('空字符串的路径当成 null', () => {
    // 空串传给后续逻辑会拼出 `/processed` 这种怪路径
    put({ outputDir: '', lastDir: '' })
    const s = readSettings()
    expect(s.outputDir).toBeNull()
    expect(s.lastDir).toBeNull()
  })

  it('多余的字段被丢掉', () => {
    put({ shrinkPercent: 50, 恶意字段: 'x', __proto__: { polluted: true } })
    expect(Object.keys(readSettings()).sort()).toEqual(
      ['lastDir', 'outputDir', 'outputFormat', 'shrinkPercent'].sort()
    )
  })

  it('缺字段时逐个补默认值', () => {
    put({ shrinkPercent: 40 })
    const s = readSettings()
    expect(s.shrinkPercent).toBe(40)
    expect(s.outputFormat).toBe('keep')
    expect(s.outputDir).toBeNull()
    expect(s.lastDir).toBeNull()
  })
})
