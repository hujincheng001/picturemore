import { describe, it, expect } from 'vitest'
import { estimateBytes, formatBytes, sliderRatio } from './format'

/**
 * 体积格式化。输出格式必须与 prototype/index.html 的 `fmtSize` 一致：
 * 大于等于 1MB 保留一位小数，否则换算成整数 KB。
 *
 * 这个函数看着简单，但它决定了界面上每一个数字的样子，
 * 而且 MB/KB 的分界是最容易写错的地方。
 */

const MB = 1024 * 1024

describe('formatBytes', () => {
  it('1MB 及以上保留一位小数', () => {
    expect(formatBytes(MB)).toBe('1.0 MB')
    expect(formatBytes(4.2 * MB)).toBe('4.2 MB')
    expect(formatBytes(34.2 * MB)).toBe('34.2 MB')
    expect(formatBytes(1024 * MB)).toBe('1024.0 MB')
  })

  it('不到 1MB 换算成整数 KB', () => {
    expect(formatBytes(1024)).toBe('1 KB')
    expect(formatBytes(45 * 1024)).toBe('45 KB')
    // 0.9999MB 仍然是 KB
    expect(formatBytes(MB - 1)).toBe('1024 KB')
  })

  it('分界点刚好在 1MB', () => {
    // 这是最容易写错的地方：>= 还是 >
    expect(formatBytes(MB - 1)).toContain('KB')
    expect(formatBytes(MB)).toContain('MB')
  })

  it('0 与非法值回退成 0 KB，不产出 NaN', () => {
    // 读不了的文件 bytes 是 0，界面不能显示 "NaN KB"
    expect(formatBytes(0)).toBe('0 KB')
    expect(formatBytes(-1)).toBe('0 KB')
    expect(formatBytes(Number.NaN)).toBe('0 KB')
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe('0 KB')
  })

  it('四舍五入到整数 KB', () => {
    // 1536 字节 = 1.5KB -> 2KB
    expect(formatBytes(1536)).toBe('2 KB')
  })
})

describe('estimateBytes', () => {
  it('按缩小百分比算', () => {
    expect(estimateBytes(1000, 20)).toBe(800)
    expect(estimateBytes(1000, 65)).toBe(350)
    expect(estimateBytes(1000, 90)).toBe(100)
  })

  it('结果取整，不产出小数', () => {
    // 3333 * 0.35 = 1166.55
    expect(estimateBytes(3333, 65)).toBe(1167)
  })

  it('0% 时等于原体积', () => {
    expect(estimateBytes(12345, 0)).toBe(12345)
  })
})

describe('sliderRatio', () => {
  it('把 20-90 映射到 0-1', () => {
    expect(sliderRatio(20, 20, 90)).toBe(0)
    expect(sliderRatio(90, 20, 90)).toBe(1)
    expect(sliderRatio(55, 20, 90)).toBeCloseTo(0.5, 6)
  })

  it('65% 对应原型里的 64.29% 填充', () => {
    // 原型的刻度位置就是按这个算的：(65-20)/(90-20) = 0.642857
    expect((sliderRatio(65, 20, 90) * 100).toFixed(2)).toBe('64.29')
  })

  it('70% 安全线对应 71.43%', () => {
    // 原型里那条刻度写死在 left: calc(71.43% - 3px)
    expect((sliderRatio(70, 20, 90) * 100).toFixed(2)).toBe('71.43')
  })
})
