import { describe, it, expect } from 'vitest'
import { resolveOutputPath } from './naming'

const none = (): boolean => false
const base = { outputDir: 'D:\\out', targetExt: 'jpg', exists: none }

describe('resolveOutputPath', () => {
  it('普通情况直接用原名换扩展名', () => {
    const r = resolveOutputPath({ ...base, sourcePath: 'D:\\in\\a.heic' })
    expect(r).toBe('D:\\out\\a.jpg')
  })

  it('目标已存在时追加 (2)', () => {
    const exists = (p: string): boolean => p === 'D:\\out\\a.jpg'
    const r = resolveOutputPath({ ...base, sourcePath: 'D:\\in\\a.heic', exists })
    expect(r).toBe('D:\\out\\a (2).jpg')
  })

  it('连续冲突时序号递增', () => {
    const exists = (p: string): boolean => ['D:\\out\\a.jpg', 'D:\\out\\a (2).jpg'].includes(p)
    const r = resolveOutputPath({ ...base, sourcePath: 'D:\\in\\a.heic', exists })
    expect(r).toBe('D:\\out\\a (3).jpg')
  })

  it('输出路径等于源路径时必须改名，绝不原地覆盖', () => {
    const r = resolveOutputPath({
      sourcePath: 'D:\\in\\a.jpg',
      outputDir: 'D:\\in',
      targetExt: 'jpg',
      exists: none,
    })
    expect(r).not.toBe('D:\\in\\a.jpg')
    expect(r).toBe('D:\\in\\a (2).jpg')
  })

  it('多个点的文件名只替换最后一个扩展名', () => {
    const r = resolveOutputPath({ ...base, sourcePath: 'D:\\in\\my.photo.v2.heic' })
    expect(r).toBe('D:\\out\\my.photo.v2.jpg')
  })

  it('无扩展名的文件也处理得了', () => {
    const r = resolveOutputPath({ ...base, sourcePath: 'D:\\in\\noext' })
    expect(r).toBe('D:\\out\\noext.jpg')
  })
})
