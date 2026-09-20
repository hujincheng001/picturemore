import { describe, it, expect } from 'vitest'
import { reasonFromError } from './reasons'

/**
 * 把异常映射成原因码。
 *
 * 主进程只吐码不吐文案（SPEC §8.4 要求文案集中管理），所以这张映射表是
 * 「技术错误」到「用户能看懂的原因」之间唯一的一道桥。
 * 映射错了不会报错，只会让用户看到错误的原因。
 */

describe('reasonFromError', () => {
  it('认 Node fs 的错误码', () => {
    expect(reasonFromError(Object.assign(new Error('x'), { code: 'ENOENT' }))).toBe('ENOENT')
    expect(reasonFromError(Object.assign(new Error('x'), { code: 'EACCES' }))).toBe('EACCES')
    // EPERM 在 Windows 上更常见，归到同一类
    expect(reasonFromError(Object.assign(new Error('x'), { code: 'EPERM' }))).toBe('EACCES')
  })

  it('把目录当成「不是文件」', () => {
    expect(reasonFromError(Object.assign(new Error('x'), { code: 'EISDIR' }))).toBe('NOT_A_FILE')
  })

  it('磁盘满与只读归到写失败', () => {
    expect(reasonFromError(Object.assign(new Error('x'), { code: 'ENOSPC' }))).toBe('WRITE_FAILED')
    expect(reasonFromError(Object.assign(new Error('x'), { code: 'EROFS' }))).toBe('WRITE_FAILED')
  })

  it('认图像引擎自己抛的错', () => {
    expect(reasonFromError(Object.assign(new Error('x'), { code: 'HEIC_DECODE_FAILED' }))).toBe(
      'HEIC_DECODE_FAILED'
    )
    // 尺寸被改了说明源文件本身有问题
    expect(reasonFromError(Object.assign(new Error('x'), { code: 'DIMENSION_CHANGED' }))).toBe(
      'CORRUPT'
    )
    expect(reasonFromError(Object.assign(new Error('x'), { code: 'TIMEOUT' }))).toBe('TIMEOUT')
  })

  it('认不出来的落到 UNKNOWN', () => {
    expect(reasonFromError(new Error('随便什么'))).toBe('UNKNOWN')
    expect(reasonFromError(Object.assign(new Error('x'), { code: 'EWHATEVER' }))).toBe('UNKNOWN')
  })

  it('非 Error 的输入也不炸', () => {
    // 抛出来的可能压根不是 Error（比如 reject('字符串')）
    expect(reasonFromError(null)).toBe('UNKNOWN')
    expect(reasonFromError(undefined)).toBe('UNKNOWN')
    expect(reasonFromError('boom')).toBe('UNKNOWN')
    expect(reasonFromError(42)).toBe('UNKNOWN')
  })
})
