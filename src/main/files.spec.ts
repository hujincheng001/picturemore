import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expand, isSupportedExt, metaFor, probePaths } from './files'

/**
 * `files:probe` 的逻辑本体。
 *
 * 这一段最容易静默出错的地方是**展开与过滤**：拖进来一个文件夹、或者混着
 * 几个非图片文件时，多一行少一行都不会报错，只会让用户看到莫名其妙的列表。
 */

const FIXTURES = resolve(__dirname, '../../tests/fixtures')
const has = (f: string): boolean => existsSync(join(FIXTURES, f))

let workDir = ''

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), 'pm-files-'))

  // 一个装了混合内容的文件夹：2 张图 + 1 个 txt + 1 个子目录
  const mixed = join(workDir, 'mixed')
  mkdirSync(mixed)
  copyFileSync(join(FIXTURES, 'tiny-1x1.png'), join(mixed, 'b.png'))
  copyFileSync(join(FIXTURES, 'oriented-6.jpg'), join(mixed, 'a.jpg'))
  writeFileSync(join(mixed, 'note.txt'), 'not an image')
  mkdirSync(join(mixed, 'sub'))
  copyFileSync(join(FIXTURES, 'tiny-1x1.png'), join(mixed, 'sub', 'deep.png'))

  // 空文件
  writeFileSync(join(workDir, 'empty.png'), '')

  // 扩展名是 .png 但内容不是图片
  writeFileSync(join(workDir, 'fake.png'), 'this is definitely not a PNG')
})

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true })
})

describe('isSupportedExt', () => {
  it('认全部支持的扩展名', () => {
    for (const ext of ['heic', 'heif', 'jpg', 'jpeg', 'png', 'webp', 'avif', 'gif', 'tif', 'tiff']) {
      expect(isSupportedExt(`a.${ext}`), ext).toBe(true)
    }
  })

  it('大小写不敏感', () => {
    // iPhone 拍出来是 .HEIC 大写
    expect(isSupportedExt('IMG_2043.HEIC')).toBe(true)
    expect(isSupportedExt('a.JPG')).toBe(true)
  })

  it('不支持的扩展名返回 false', () => {
    for (const ext of ['txt', 'pdf', 'mp4', 'docx', 'exe']) {
      expect(isSupportedExt(`a.${ext}`), ext).toBe(false)
    }
  })

  it('没有扩展名时返回 false', () => {
    expect(isSupportedExt('README')).toBe(false)
    expect(isSupportedExt('a.')).toBe(false)
  })

  it('只看最后一段扩展名', () => {
    expect(isSupportedExt('archive.tar.gz')).toBe(false)
    expect(isSupportedExt('photo.backup.jpg')).toBe(true)
  })
})

describe('expand', () => {
  it('图片文件原样保留', async () => {
    const p = join(FIXTURES, 'oriented-6.jpg')
    expect(await expand(p)).toEqual([p])
  })

  it('非图片文件被静默丢掉', async () => {
    expect(await expand(join(workDir, 'mixed', 'note.txt'))).toEqual([])
  })

  it('目录展开一层，只取图片，按名字排序', async () => {
    const out = await expand(join(workDir, 'mixed'))
    expect(out.map((p) => p.split(/[\\/]/).pop())).toEqual(['a.jpg', 'b.png'])
  })

  it('只展开一层，不递归', async () => {
    // SPEC §9 明写「展开一层」。递归的话用户拖一个盘符根目录就会变成扫描整块盘
    const out = await expand(join(workDir, 'mixed'))
    expect(out.some((p) => p.includes('sub'))).toBe(false)
  })

  it('空目录返回空数组', async () => {
    const emptyDir = join(workDir, 'empty-dir')
    mkdirSync(emptyDir)
    expect(await expand(emptyDir)).toEqual([])
  })

  it('不存在的路径原样返回，留给 metaFor 给出准确原因', async () => {
    const missing = join(workDir, 'nope.jpg')
    expect(await expand(missing)).toEqual([missing])
  })
})

describe('metaFor', () => {
  it('读得出真实图片的元信息', async () => {
    const m = await metaFor(join(FIXTURES, 'oriented-6.jpg'))
    expect(m.readable).toBe(true)
    expect(m.format).toBe('jpeg')
    expect(m.width).toBe(1200)
    expect(m.height).toBe(900)
    expect(m.name).toBe('oriented-6.jpg')
    expect(m.ext).toBe('jpg')
    expect(m.bytes).toBeGreaterThan(0)
    expect(m.reason).toBeUndefined()
  })

  it('带 alpha 的 PNG 能识别出透明通道', async () => {
    const m = await metaFor(join(FIXTURES, 'alpha-cutout.png'))
    expect(m.readable).toBe(true)
    expect(m.hasAlpha).toBe(true)
  })

  it('每张拿到的 id 都不一样', async () => {
    const a = await metaFor(join(FIXTURES, 'tiny-1x1.png'))
    const b = await metaFor(join(FIXTURES, 'tiny-1x1.png'))
    expect(a.id).not.toBe(b.id)
  })

  it('路径不存在 → ENOENT', async () => {
    const m = await metaFor(join(workDir, 'nope.jpg'))
    expect(m.readable).toBe(false)
    expect(m.reason).toBe('ENOENT')
    expect(m.bytes).toBe(0)
    expect(m.width).toBe(0)
  })

  it('目录 → NOT_A_FILE', async () => {
    const m = await metaFor(workDir)
    expect(m.readable).toBe(false)
    expect(m.reason).toBe('NOT_A_FILE')
  })

  it('空文件 → CORRUPT', async () => {
    const m = await metaFor(join(workDir, 'empty.png'))
    expect(m.readable).toBe(false)
    expect(m.reason).toBe('CORRUPT')
  })

  it('扩展名是图片但内容是文本 → CORRUPT', async () => {
    const m = await metaFor(join(workDir, 'fake.png'))
    expect(m.readable).toBe(false)
    expect(m.reason).toBe('CORRUPT')
  })

  it('读不了的时候名字与路径仍然带着，界面要靠它显示是哪一行', async () => {
    const p = join(workDir, 'nope.jpg')
    const m = await metaFor(p)
    expect(m.name).toBe('nope.jpg')
    expect(m.path).toBe(p)
  })

  it.skipIf(!has('iphone-portrait.heic'))('HEIC 读出显示尺寸（宽 < 高）', async () => {
    const m = await metaFor(join(FIXTURES, 'iphone-portrait.heic'))
    expect(m.readable).toBe(true)
    expect(m.format).toBe('heic')
    expect(m.width).toBeLessThan(m.height)
  }, 30_000)
})

describe('probePaths', () => {
  it('文件夹与文件混着传，展开后顺序稳定', async () => {
    const out = await probePaths([
      join(workDir, 'mixed'),
      join(FIXTURES, 'oriented-6.jpg')
    ])
    expect(out.map((m) => m.name)).toEqual(['a.jpg', 'b.png', 'oriented-6.jpg'])
  })

  it('非图片与空字符串都被过滤掉', async () => {
    const out = await probePaths(['', join(workDir, 'mixed', 'note.txt'), join(workDir, 'nope.jpg')])
    // txt 被静默丢掉；不存在的路径会保留下来并给出 ENOENT
    expect(out.map((m) => m.name)).toEqual(['nope.jpg'])
    expect(out[0]?.reason).toBe('ENOENT')
  })

  it('空输入返回空数组', async () => {
    expect(await probePaths([])).toEqual([])
  })

  it('一张失败不影响其余（SPEC §4.8）', async () => {
    const out = await probePaths([
      join(workDir, 'nope.jpg'),
      join(FIXTURES, 'tiny-1x1.png'),
      join(workDir, 'empty.png')
    ])
    expect(out).toHaveLength(3)
    expect(out.map((m) => m.readable)).toEqual([false, true, false])
  })
})
