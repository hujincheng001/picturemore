import { describe, it, expect } from 'vitest'
import type { ReasonCode } from '../../shared/reasons'
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

  it('2026-09-22 补齐的那几条也都有文案', () => {
    // 原来这几条返回 null，结果是失败行的体积格**空白** —— 一行既没体积也没原因，
    // 用户只知道「这张不行」。静默比说得不够准更糟
    expect(reasonText('ENOENT')).toBe('找不到这个文件')
    expect(reasonText('EACCES')).toBe('没有读取权限')
    expect(reasonText('NOT_A_FILE')).toBe('这不是文件')
    expect(reasonText('TIMEOUT')).toBe('处理超时了')
    expect(reasonText('WRITE_FAILED')).toBe('写不进去')
    expect(reasonText('DISK_FULL')).toBe('磁盘满了')
  })

  it('**每一个原因码都有文案**，不留空白格', () => {
    // 这条是不变量，比逐个断言具体文字更能兜住「新加了原因码却忘了配文案」
    const all: ReasonCode[] = [
      'ENOENT',
      'EACCES',
      'NOT_A_FILE',
      'CORRUPT',
      'HEIC_DECODE_FAILED',
      'TIMEOUT',
      'WRITE_FAILED',
      'DISK_FULL',
      'UNKNOWN'
    ]
    for (const code of all) {
      const text = reasonText(code)
      expect(text, `${code} 没有文案，失败行会空着`).not.toBeNull()
      expect((text ?? '').length, `${code} 的文案是空的`).toBeGreaterThan(0)
    }
  })

  it('undefined 与未知码都返回 null', () => {
    expect(reasonText(undefined)).toBeNull()
    expect(reasonText('NOPE')).toBeNull()
    expect(reasonText('')).toBeNull()
  })

  it('文案里没有 em-dash 与 emoji（写作纪律）', () => {
    const all: ReasonCode[] = [
      'ENOENT',
      'EACCES',
      'NOT_A_FILE',
      'CORRUPT',
      'HEIC_DECODE_FAILED',
      'TIMEOUT',
      'WRITE_FAILED',
      'DISK_FULL',
      'UNKNOWN'
    ]
    for (const code of all) {
      const text = reasonText(code) ?? ''
      expect(text.includes('\u2014'), code).toBe(false)
      expect(text.includes('\u2013'), code).toBe(false)
      expect((text.match(/·/g) ?? []).length, code).toBeLessThanOrEqual(1)
      expect(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(text), code).toBe(false)
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
