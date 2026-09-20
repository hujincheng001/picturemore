import { describe, it, expect } from 'vitest'
import { noteFor, noteText, noteIsCaution } from './note'
import { COPY } from './copy'

describe('noteFor 的优先级', () => {
  it('PNG 压过一切', () => {
    // 选了 PNG + 拖到 80% + 列表里有透明图，仍然只说 PNG 压不动
    expect(noteFor('png', 3, 80)).toBe('png')
    expect(noteFor('png', 0, 20)).toBe('png')
  })

  it('JPG 且有透明图时提示会被拍平', () => {
    expect(noteFor('jpeg', 1, 20)).toBe('alpha')
    // 同时越线时，透明提示优先
    expect(noteFor('jpeg', 1, 80)).toBe('alpha')
  })

  it('JPG 但没有透明图时不提示拍平', () => {
    expect(noteFor('jpeg', 0, 20)).toBe('promise')
  })

  it('越线警告在 70% 以上才出现，70% 本身不算', () => {
    expect(noteFor('keep', 0, 70)).toBe('promise')
    expect(noteFor('keep', 0, 75)).toBe('over-line')
  })

  it('WebP 与保持原格式都不会提示拍平（只有 JPG 没有透明通道）', () => {
    expect(noteFor('webp', 5, 20)).toBe('promise')
    expect(noteFor('keep', 5, 20)).toBe('promise')
  })
})

describe('noteText 用的是文案表里的原句', () => {
  it('四态各自对上 COPY 里的字符串', () => {
    expect(noteText('promise', 0)).toBe(COPY.promise)
    expect(noteText('png', 0)).toBe(COPY.pngDissuade)
    expect(noteText('over-line', 0)).toBe(COPY.overLine)
    expect(noteText('alpha', 2)).toBe(COPY.alphaFlatten(2))
  })

  it('透明提示里的数字会跟着变', () => {
    expect(noteText('alpha', 7)).toContain('7 张')
  })
})

describe('琥珀色只在警示时出现', () => {
  it('只有默认承诺句不是警示', () => {
    expect(noteIsCaution('promise')).toBe(false)
    expect(noteIsCaution('png')).toBe(true)
    expect(noteIsCaution('alpha')).toBe(true)
    expect(noteIsCaution('over-line')).toBe(true)
  })
})

describe('文案的写作纪律', () => {
  const all = [
    COPY.promise,
    COPY.overLine,
    COPY.pngDissuade,
    COPY.alphaFlatten(3),
    COPY.destHint,
    COPY.footer,
    COPY.dropFormats,
    COPY.ctaDefault(5),
    COPY.ctaRunning(2, 5),
    COPY.ctaDone,
    COPY.listMeta(5, '12.0 MB'),
    COPY.doneTip('D:\\out')
  ]

  it('零 em-dash（— 与 – 都不行，中文里也不用「——」）', () => {
    for (const s of all) {
      expect(s.includes('\u2014'), `出现了 em-dash：${s}`).toBe(false)
      expect(s.includes('\u2013'), `出现了 en-dash：${s}`).toBe(false)
    }
  })

  it('中黑点每行最多一个', () => {
    for (const s of all) {
      expect((s.match(/·/g) ?? []).length).toBeLessThanOrEqual(1)
    }
  })

  it('没有 emoji', () => {
    for (const s of all) {
      // eslint-disable-next-line no-control-regex
      expect(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(s), `出现了 emoji：${s}`).toBe(false)
    }
  })
})
