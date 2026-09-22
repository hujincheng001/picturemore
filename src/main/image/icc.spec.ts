import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import sharp from 'sharp'
import { classifyIcc, classifyIccName, iccProfileName, shouldTagAsP3 } from './icc'

/**
 * ICC 识别。**用的都是真实 profile，不是造的字节。**
 *
 * 起因：HEIC 的像素走 `heic-decode`（不做色彩管理），我们补挂一个 P3 标签。
 * 但 Android 拍的 HEIC 通常是 sRGB，挂 P3 会让画面偏艳。所以要先认出源文件自带的是哪种。
 *
 * 手上没有 Android HEIC 样张，所以**验的是判据本身**：
 * 拿 Apple 的 Display P3（从 iPhone fixture 里读）、sharp 内置的 sP3C 与 sRGB
 * 三份真 profile，确认分类正确。缺的只是「Android 机型确实带 sRGB ICC」这个数据事实。
 */

const FIXTURES = resolve(__dirname, '../../../tests/fixtures')

/** 用 sharp 内置 profile 编一张小图，再把 ICC 读回来 */
async function builtinProfile(name: 'p3' | 'srgb'): Promise<Buffer> {
  const png = await sharp({
    create: { width: 8, height: 8, channels: 3, background: '#888888' }
  })
    .withIccProfile(name)
    .png()
    .toBuffer()
  const m = await sharp(png).metadata()
  if (m.icc === undefined) throw new Error(`sharp 没写出 ${name} 的 ICC`)
  return m.icc
}

describe('iccProfileName：从真实 profile 里读出名字', () => {
  it('Apple 的 Display P3（mluc 编码）', async () => {
    // Apple 用的是多语言 Unicode 类型，不是老的 desc —— 只处理一种会漏掉一半
    const m = await sharp(readFileSync(join(FIXTURES, 'iphone-portrait.heic'))).metadata()
    expect(iccProfileName(m.icc ?? null)).toBe('Display P3')
  })

  it('sharp 内置的 P3', async () => {
    expect(iccProfileName(await builtinProfile('p3'))).toBe('sP3C')
  })

  it('sharp 内置的 sRGB', async () => {
    expect(iccProfileName(await builtinProfile('srgb'))).toBe('sRGB')
  })
})

describe('iccProfileName：坏输入不能崩', () => {
  it('null / 空 / 太短都返回 null', () => {
    expect(iccProfileName(null)).toBeNull()
    expect(iccProfileName(Buffer.alloc(0))).toBeNull()
    expect(iccProfileName(Buffer.alloc(50))).toBeNull()
    expect(iccProfileName(Buffer.alloc(200))).toBeNull()
  })

  it('标签数荒谬时不继续读', () => {
    // 一段全 0xFF 的垃圾，标签数会读成一个巨大的值
    const junk = Buffer.alloc(512, 0xff)
    expect(iccProfileName(junk)).toBeNull()
  })

  it('标签偏移越界时不越界读', () => {
    const junk = Buffer.alloc(512)
    junk.writeUInt32BE(3, 128) // 3 个标签
    // 第一个标签签名写成 desc，偏移指向文件外
    junk.write('desc', 132, 'latin1')
    junk.writeUInt32BE(999_999, 136)
    junk.writeUInt32BE(100, 140)
    expect(iccProfileName(junk)).toBeNull()
  })
})

describe('classifyIcc', () => {
  it('三种真实 profile 各归各类', async () => {
    const m = await sharp(readFileSync(join(FIXTURES, 'iphone-portrait.heic'))).metadata()
    expect(classifyIcc(m.icc ?? null)).toBe('display-p3')
    expect(classifyIcc(await builtinProfile('p3'))).toBe('display-p3')
    expect(classifyIcc(await builtinProfile('srgb'))).toBe('srgb')
  })

  it('没有 ICC 时是 none', () => {
    expect(classifyIcc(null)).toBe('none')
    expect(classifyIcc(Buffer.alloc(0))).toBe('none')
  })

  it('认不出来时是 other，**不当成 sRGB**', () => {
    // 关键：认不出就当成 sRGB 的话，iPhone 那种 profile 一旦解析失败
    // 就会停止挂 P3，画面会变淡 —— 那是把主路径改坏
    expect(classifyIccName('Some Weird Profile')).toBe('other')
    expect(classifyIccName('Adobe RGB (1998)')).toBe('other')
  })

  it('ICC 存在但名字读不出来时是 none，与「没有 ICC」同路', () => {
    /*
     * 这是分类改成「按名字」之后的一个语义收敛：
     * 「有 ICC 但读不出名字」和「根本没有 ICC」都落到 `none`。
     *
     * 两者在 shouldTagAsP3 里都走「挂」，行为完全一样，所以不需要区分 ——
     * 而区分它们要往 ProbeResult 里再加一个字段，不划算。
     */
    expect(classifyIcc(Buffer.alloc(512, 0xff))).toBe('none')
    expect(classifyIcc(Buffer.from('不是 ICC', 'utf-8'))).toBe('none')
    expect(classifyIccName(null)).toBe('none')
  })
})

describe('shouldTagAsP3：判据是保守的', () => {
  it('明确是 sRGB 才不挂', () => {
    expect(shouldTagAsP3('srgb')).toBe(false)
  })

  it('其余情况都维持原行为（挂）', () => {
    // 这条保证改动**只可能修好 Android，不会弄坏 iPhone**：
    // display-p3 是主力输入；none / other 认不出来，维持现状最安全
    expect(shouldTagAsP3('display-p3')).toBe(true)
    expect(shouldTagAsP3('none')).toBe(true)
    expect(shouldTagAsP3('other')).toBe(true)
  })
})

describe('端到端：iPhone 那条路径不能因为这次改动而丢标签', () => {
  /*
   * 这是本组最重要的一条。改动的目的是「sRGB 的 HEIC 不挂 P3」，
   * 但主力输入是 iPhone 的 Display P3 —— 如果识别逻辑出错导致它也不挂了，
   * 画面会变淡，那是把主路径改坏，比原来的 bug 更严重。
   *
   * 所以直接验产物：压完之后输出里还得有 P3 标签。
   */
  it('iPhone HEIC 压出来的 JPG 仍带 P3 标签', async () => {
    const { compressOne } = await import('./compress')
    const { probe } = await import('./probe')

    const buf = readFileSync(join(FIXTURES, 'iphone-portrait.heic'))
    const pr = await probe(buf)
    // 前提：这张图的 ICC 确实是 P3（probe 存的是 profile 名，SPEC §6.2）
    expect(pr.icc).toBe('Display P3')
    expect(classifyIccName(pr.icc)).toBe('display-p3')

    const { data } = await compressOne({ buf, shrinkPercent: 70, outputFormat: 'keep', probe: pr })
    const out = await sharp(data).metadata()

    expect(out.icc, '输出丢了 ICC').toBeDefined()
    const name = (iccProfileName(out.icc ?? null) ?? '').toLowerCase()
    expect(name, `输出的 ICC 不是 P3：${name}`).toContain('p3')
  }, 120_000)
})
