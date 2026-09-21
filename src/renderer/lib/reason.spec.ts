import { describe, it, expect } from 'vitest'
import { batchErrorText, reasonText } from './reason'

/**
 * 原因码 → 文案。
 *
 * ⚠️ **这个映射表是故意不全的。**
 *
 * SPEC §9 只给了两条确切文案（`CORRUPT` 与 `HEIC_DECODE_FAILED`），
 * 「文件不存在 / 无读权限」那一条只说「行内显示原因」却没给字符串，§8.4 文案表里也没有。
 * AGENTS.md 的规矩是「不得自造词」「都不覆盖就问用户，不要猜」。
 *
 * 所以这个用例同时守两件事：
 * 1. SPEC 给了的那两条必须原样对上
 * 2. SPEC 没给的必须**保持为空** —— 免得哪天有人顺手编一句填进去
 */

describe('reasonText', () => {
  it('SPEC §9 给了文案的两条原样对上', () => {
    expect(reasonText('CORRUPT')).toBe('文件已损坏，无法读取')
    expect(reasonText('HEIC_DECODE_FAILED')).toBe('这台机器上的 HEIC 解码器打不开这张图')
  })

  it('SPEC 没给文案的保持为空，不要自己编', () => {
    // 这几条要等用户确认文案。填进去会让「不猜」这条规矩失效
    for (const code of ['ENOENT', 'EACCES', 'NOT_A_FILE', 'TIMEOUT', 'WRITE_FAILED', 'UNKNOWN']) {
      expect(reasonText(code), `${code} 不该有文案，SPEC 没给`).toBeNull()
    }
  })

  it('undefined 与未知码都返回 null', () => {
    expect(reasonText(undefined)).toBeNull()
    expect(reasonText('NOPE')).toBeNull()
    expect(reasonText('')).toBeNull()
  })

  it('文案里没有 em-dash 与 emoji（写作纪律）', () => {
    for (const code of ['CORRUPT', 'HEIC_DECODE_FAILED']) {
      const text = reasonText(code) ?? ''
      expect(text.includes('\u2014')).toBe(false)
      expect(text.includes('\u2013')).toBe(false)
      expect(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(text)).toBe(false)
    }
  })
})

describe('batchErrorText', () => {
  /*
   * 批次级错误。这三条是用户 2026-09-21 确认的 ——
   * 原来 DESIGN.md 的 CTA 状态矩阵与 SPEC §8.4 都没有错误态，
   * 结果是输出目录写不进去时点了没反应。
   */

  it('磁盘满单独说', () => {
    expect(batchErrorText('DISK_FULL')).toBe('磁盘满了，后面的图没有处理')
  })

  it('输出目录相关的几种原因说同一句话', () => {
    // EACCES / WRITE_FAILED / ENOENT / NOT_A_FILE 在这个语境下都是「这个文件夹用不了」，
    // 对用户来说没必要区分是权限还是不存在
    for (const code of ['EACCES', 'WRITE_FAILED', 'ENOENT', 'NOT_A_FILE']) {
      expect(batchErrorText(code), code).toBe('这个文件夹写不进去，换一个试试')
    }
  })

  it('任何认不出来的原因都有兜底，不留空白', () => {
    // 静默失败比说得不够准更糟
    for (const code of ['UNKNOWN', 'CORRUPT', 'TIMEOUT', '什么鬼']) {
      expect(batchErrorText(code), code).toBe('这批没有跑完')
    }
  })

  it('没有错误时返回 null，让底部那行去显示常驻声明', () => {
    expect(batchErrorText(null)).toBeNull()
    expect(batchErrorText('')).toBeNull()
  })

  it('文案里没有 em-dash 与 emoji（写作纪律）', () => {
    for (const code of ['DISK_FULL', 'EACCES', 'UNKNOWN']) {
      const text = batchErrorText(code) ?? ''
      expect(text.includes('\u2014')).toBe(false)
      expect(text.includes('\u2013')).toBe(false)
      expect((text.match(/·/g) ?? []).length).toBeLessThanOrEqual(1)
      expect(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(text)).toBe(false)
    }
  })
})
