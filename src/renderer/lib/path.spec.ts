import { describe, it, expect } from 'vitest'
import { defaultOutputDir, dirOf } from './path'

/**
 * 路径处理。渲染进程拿不到 node:path，全靠字符串，所以两种分隔符都要覆盖。
 *
 * 这段逻辑错了不会有任何报错，只会把文件存到奇怪的地方 —— 典型的静默故障。
 */

describe('dirOf', () => {
  it('认 Windows 反斜杠', () => {
    expect(dirOf('D:\\照片\\2026-09\\IMG_2043.HEIC')).toBe('D:\\照片\\2026-09')
  })

  it('认 POSIX 正斜杠', () => {
    expect(dirOf('/home/u/pics/a.jpg')).toBe('/home/u/pics')
  })

  it('混用分隔符时取最后一个', () => {
    expect(dirOf('D:\\照片/sub/a.jpg')).toBe('D:\\照片/sub')
  })

  it('没有分隔符时原样返回', () => {
    // 拖进来的可能是相对路径或纯文件名
    expect(dirOf('a.jpg')).toBe('a.jpg')
  })

  it('只有根分隔符时原样返回，不产出空串', () => {
    // i <= 0 的边界。返回空串的话，后面拼出来的路径会变成 "/processed" 这种
    expect(dirOf('/a.jpg')).toBe('/a.jpg')
  })
})

describe('defaultOutputDir', () => {
  it('Windows 路径产出 Windows 形式的 processed', () => {
    expect(defaultOutputDir('D:\\照片\\IMG_1.HEIC')).toBe('D:\\照片\\processed')
  })

  it('POSIX 路径产出 POSIX 形式的 processed', () => {
    expect(defaultOutputDir('/home/u/pics/a.jpg')).toBe('/home/u/pics/processed')
  })

  it('分隔符跟着输入走，不混着来', () => {
    // 混着的路径显示给用户会很怪，复制到别处也可能不认
    const win = defaultOutputDir('D:\\a\\b.jpg')
    expect(win.includes('/')).toBe(false)

    const posix = defaultOutputDir('/a/b.jpg')
    expect(posix.includes('\\')).toBe(false)
  })

  it('目录已带尾部分隔符时不重复加', () => {
    expect(defaultOutputDir('D:\\照片\\a.jpg')).toBe('D:\\照片\\processed')
  })

  it('纯文件名（没有目录）也能产出合理结果', () => {
    expect(defaultOutputDir('a.jpg')).toBe('a.jpg/processed')
  })
})
