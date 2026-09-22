import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { ImageFileMeta, ProbeResponse, Settings } from '../../shared/types'
import { COPY } from '../lib/copy'
import { MAX_BATCH } from '../lib/limit'
import type { ImageItem } from '../lib/types'
import { useAppStore } from './useAppStore'

/**
 * 渲染层的大脑。之前只有冒烟脚本覆盖过主路径，而这里面的逻辑都不在主路径上：
 * 限额配额的传递、进度的单调性、cancel-then-clear 的顺序、失败时怎么收场。
 *
 * 这些错了都不会报错，只会让界面上的数字不对、或者点了没反应。
 */

/** 造一份 probe 返回值 */
function meta(id: string, over: Partial<ImageFileMeta> = {}): ImageFileMeta {
  return {
    id,
    name: `${id}.jpg`,
    path: `D:\\in\\${id}.jpg`,
    ext: 'jpg',
    bytes: 1000,
    format: 'jpeg',
    width: 100,
    height: 100,
    hasAlpha: false,
    readable: true,
    ...over
  }
}

/** 造一个已经在列表里的项。比 meta 多一个 state —— ImageItem 与 ImageFileMeta 的区别就在这 */
function item(id: string): ImageItem {
  const m = meta(id)
  return {
    id: m.id,
    name: m.name,
    path: m.path,
    bytes: m.bytes,
    format: m.format,
    hasAlpha: m.hasAlpha,
    readable: m.readable,
    state: 'pending',
    width: m.width,
    height: m.height
  }
}

interface Fake {
  probe: ReturnType<typeof vi.fn>
  start: ReturnType<typeof vi.fn>
  cancel: ReturnType<typeof vi.fn>
  getSettings: ReturnType<typeof vi.fn>
  setSettings: ReturnType<typeof vi.fn>
  pickImages: ReturnType<typeof vi.fn>
  pickOutputDir: ReturnType<typeof vi.fn>
}

let fake: Fake

/** 每个用例前把 window.pictureMore 换成假的，并把 store 复位 */
function install(probeResult?: Partial<ProbeResponse>): void {
  fake = {
    probe: vi.fn(async (): Promise<ProbeResponse> => ({ metas: [], dropped: 0, ...probeResult })),
    start: vi.fn(async () => ({ taskId: 't1', error: null })),
    cancel: vi.fn(async () => undefined),
    getSettings: vi.fn(async (): Promise<Settings> => ({
      outputDir: null,
      shrinkPercent: 65,
      outputFormat: 'keep',
      lastDir: null
    })),
    setSettings: vi.fn(async (patch: Partial<Settings>) => ({
      outputDir: null,
      shrinkPercent: 65,
      outputFormat: 'keep',
      lastDir: null,
      ...patch
    })),
    pickImages: vi.fn(async () => null),
    pickOutputDir: vi.fn(async () => null)
  }
  ;(globalThis as { window?: unknown }).window = { pictureMore: fake }

  useAppStore.setState({
    items: [],
    dropped: 0,
    notice: null,
    taskId: null,
    running: false,
    shrinkPercent: 65,
    outputFormat: 'keep',
    outputDir: '',
    progress: 0,
    finished: false,
    lastOutputDir: null,
    error: null
  })
}

beforeEach(() => {
  install()
})

describe('addPaths', () => {
  it('把 probe 结果变成列表项', async () => {
    install({ metas: [meta('a'), meta('b')] })
    await useAppStore.getState().addPaths(['D:\\in\\a.jpg', 'D:\\in\\b.jpg'])
    expect(useAppStore.getState().items.map((i) => i.id)).toEqual(['a', 'b'])
  })

  it('读不了的直接落到 failed，不参与处理', async () => {
    install({ metas: [meta('a'), meta('b', { readable: false, reason: 'CORRUPT' })] })
    await useAppStore.getState().addPaths(['D:\\in\\a.jpg'])
    const items = useAppStore.getState().items
    expect(items[0]?.state).toBe('pending')
    expect(items[1]?.state).toBe('failed')
    expect(items[1]?.reason).toBe('CORRUPT')
  })

  it('传给 probe 的是「还能再收几张」，不是总数', async () => {
    // 这个参数搞反了的话，拖第二个文件夹时会被整批丢掉
    install({ metas: [meta('a'), meta('b')] })
    await useAppStore.getState().addPaths(['D:\\in\\x.jpg'])
    expect(fake.probe).toHaveBeenCalledWith(['D:\\in\\x.jpg'], MAX_BATCH)

    fake.probe.mockClear()
    await useAppStore.getState().addPaths(['D:\\in\\y.jpg'])
    expect(fake.probe).toHaveBeenCalledWith(['D:\\in\\y.jpg'], MAX_BATCH - 2)
  })

  it('列表满了就不再调 probe', async () => {
    install({ metas: [] })
    useAppStore.setState({ items: Array.from({ length: MAX_BATCH }, (_, i) => ({
      id: `x${i}`, name: 'x', path: 'x', bytes: 1, format: 'jpeg',
      hasAlpha: false, readable: true, state: 'pending', width: 1, height: 1
    })) })
    await useAppStore.getState().addPaths(['D:\\in\\x.jpg'])
    expect(fake.probe).not.toHaveBeenCalled()
  })

  it('主进程报的忽略数原样带上', async () => {
    install({ metas: [meta('a'), meta('b'), meta('c')], dropped: 400 })
    await useAppStore.getState().addPaths(['D:\\in\\x.jpg'])
    expect(useAppStore.getState().dropped).toBe(400)
    expect(useAppStore.getState().items).toHaveLength(3)
  })

  it('主进程越界返回时本地兜住，不把列表撑破', async () => {
    // 正常路径上本地截断不会触发（主进程已按限额截过）。
    // 这条模拟的是主进程有 bug 的情况 —— 渲染层不该无条件信任对端，
    // 多返回 200 行的话界面会直接撑破。
    install({
      metas: Array.from({ length: 200 }, (_, i) => meta(`x${i}`)),
      dropped: 0
    })
    useAppStore.setState({
      items: [
        { id: 'pre', name: 'pre', path: 'pre', bytes: 1, format: 'jpeg', hasAlpha: false, readable: true, state: 'pending', width: 1, height: 1 }
      ]
    })
    await useAppStore.getState().addPaths(['D:\\in\\x.jpg'])

    const s = useAppStore.getState()
    expect(s.items.length, '列表被撑破了').toBeLessThanOrEqual(MAX_BATCH)
    expect(s.items.length).toBe(MAX_BATCH)
    // 本地兜住的那些也要算进「已忽略」，不能悄悄吞掉
    expect(s.dropped).toBe(101)
  })

  it('默认输出目录取第一张图所在目录，且只在为空时设', async () => {
    install({ metas: [meta('a')] })
    await useAppStore.getState().addPaths(['D:\\照片\\2026\\a.jpg'])
    expect(useAppStore.getState().outputDir).toBe('D:\\照片\\2026\\processed')

    // 第二次加入不该覆盖用户已经确认过的目录
    useAppStore.setState({ outputDir: 'D:\\out' })
    await useAppStore.getState().addPaths(['D:\\别的\\b.jpg'])
    expect(useAppStore.getState().outputDir).toBe('D:\\out')
  })

  it('加入新图会收回上一批的完成提示', async () => {
    install({ metas: [meta('a')] })
    useAppStore.setState({ lastOutputDir: 'D:\\old', finished: true, error: 'DISK_FULL' })
    await useAppStore.getState().addPaths(['D:\\in\\a.jpg'])
    const s = useAppStore.getState()
    expect(s.lastOutputDir).toBeNull()
    expect(s.finished).toBe(false)
    expect(s.error).toBeNull()
  })

  it('空数组直接返回，不调 IPC', async () => {
    await useAppStore.getState().addPaths([])
    expect(fake.probe).not.toHaveBeenCalled()
  })
})

describe('applyProgress', () => {
  const base = {
    taskId: 't1',
    total: 3,
    state: 'done' as const
  }

  beforeEach(() => {
    install()
    useAppStore.setState({
      items: [meta('a'), meta('b'), meta('c')].map((m) => ({
        id: m.id, name: m.name, path: m.path, bytes: m.bytes, format: m.format,
        hasAlpha: m.hasAlpha, readable: m.readable, state: 'pending' as const,
        width: m.width, height: m.height
      }))
    })
  })

  it('只更新对应的那一行', async () => {
    useAppStore.getState().applyProgress({ ...base, itemId: 'b', index: 1, outBytes: 500 })
    const items = useAppStore.getState().items
    expect(items[0]?.state).toBe('pending')
    expect(items[1]?.state).toBe('done')
    expect(items[1]?.outBytes).toBe(500)
    expect(items[2]?.state).toBe('pending')
  })

  it('进度只增不减', async () => {
    // 并发跑的时候完成顺序是乱的，进度条不能因此往回跳
    useAppStore.getState().applyProgress({ ...base, itemId: 'c', index: 2 })
    expect(useAppStore.getState().progress).toBe(3)
    useAppStore.getState().applyProgress({ ...base, itemId: 'a', index: 0 })
    expect(useAppStore.getState().progress).toBe(3)
  })

  it('失败时带上原因码', async () => {
    useAppStore.getState().applyProgress({ ...base, itemId: 'a', index: 0, state: 'failed', reason: 'CORRUPT' })
    expect(useAppStore.getState().items[0]?.reason).toBe('CORRUPT')
  })

  it('不认识 itemId 时不动任何一行', async () => {
    useAppStore.getState().applyProgress({ ...base, itemId: '不存在', index: 0 })
    expect(useAppStore.getState().items.every((i) => i.state === 'pending')).toBe(true)
  })
})

describe('run', () => {
  beforeEach(() => {
    install()
    useAppStore.setState({
      outputDir: 'D:\\out',
      items: [
        { id: 'a', name: 'a', path: 'D:\\in\\a.jpg', bytes: 1, format: 'jpeg', hasAlpha: false, readable: true, state: 'pending', width: 10, height: 10 },
        { id: 'b', name: 'b', path: 'D:\\in\\b.jpg', bytes: 1, format: 'jpeg', hasAlpha: false, readable: false, state: 'failed', width: 0, height: 0 }
      ]
    })
  })

  it('只把可读的那些放进 payload', async () => {
    await useAppStore.getState().run()
    const payload = fake.start.mock.calls[0]?.[0]
    expect(payload.items.map((i: { id: string }) => i.id)).toEqual(['a'])
  })

  it('带上当前的缩小比例、输出格式与目录', async () => {
    useAppStore.setState({ shrinkPercent: 45, outputFormat: 'webp' })
    await useAppStore.getState().run()
    const payload = fake.start.mock.calls[0]?.[0]
    expect(payload.shrinkPercent).toBe(45)
    expect(payload.outputFormat).toBe('webp')
    expect(payload.outputDir).toBe('D:\\out')
  })

  it('一开始就把 running 置上，避免重复点', async () => {
    const p = useAppStore.getState().run()
    expect(useAppStore.getState().running).toBe(true)
    await p
  })

  it('已经在跑时直接返回', async () => {
    useAppStore.setState({ running: true })
    await useAppStore.getState().run()
    expect(fake.start).not.toHaveBeenCalled()
  })

  it('没有可读的图时不启动', async () => {
    useAppStore.setState({
      items: [{ id: 'b', name: 'b', path: 'b', bytes: 1, format: 'jpeg', hasAlpha: false, readable: false, state: 'failed', width: 0, height: 0 }]
    })
    await useAppStore.getState().run()
    expect(fake.start).not.toHaveBeenCalled()
  })

  it('输出目录为空时不启动', async () => {
    useAppStore.setState({ outputDir: '' })
    await useAppStore.getState().run()
    expect(fake.start).not.toHaveBeenCalled()
  })

  it('启动前的失败走返回值，照样收场并记下原因', async () => {
    // 输出目录不可写之类。不收场的话按钮会一直卡在「处理中」
    fake.start.mockResolvedValueOnce({ taskId: 't1', error: 'EACCES' })
    await useAppStore.getState().run()
    const s = useAppStore.getState()
    expect(s.running).toBe(false)
    expect(s.taskId).toBeNull()
    expect(s.error).toBe('EACCES')
  })

  it('意料之外的异常也要让用户看到，不能静默', async () => {
    // IPC 断了之类。原来这里存的是原始错误字符串，界面拿它没法映射成文案
    fake.start.mockRejectedValueOnce(Object.assign(new Error('boom'), { code: 'ENOENT' }))
    await useAppStore.getState().run()
    expect(useAppStore.getState().error).toBe('ENOENT')
    expect(useAppStore.getState().running).toBe(false)
  })

  it('认不出来的异常也有话说，不留空白', async () => {
    fake.start.mockRejectedValueOnce(new Error('完全看不懂的错误'))
    await useAppStore.getState().run()
    expect(useAppStore.getState().error).toBe('UNKNOWN')
  })

  it('成功启动时 error 保持为 null，等 task:done 收场', async () => {
    await useAppStore.getState().run()
    const s = useAppStore.getState()
    expect(s.error).toBeNull()
    // 还没收到 task:done，所以仍在跑
    expect(s.running).toBe(true)
  })
})

describe('clear', () => {
  it('处理中清列表要先 cancel 再清（SPEC §9）', async () => {
    // 不 cancel 的话已经在跑的那些还会往界面推进度，把行加回一个空列表
    install()
    useAppStore.setState({ running: true, taskId: 't9', items: [item('a')] })
    await useAppStore.getState().clear()
    expect(fake.cancel).toHaveBeenCalledWith('t9')
    expect(useAppStore.getState().items).toEqual([])
    expect(useAppStore.getState().running).toBe(false)
  })

  it('没在跑时不调 cancel', async () => {
    await useAppStore.getState().clear()
    expect(fake.cancel).not.toHaveBeenCalled()
  })

  it('清空后各项状态都复位', async () => {
    useAppStore.setState({
      items: [item('a')],
      dropped: 5,
      progress: 3,
      finished: true,
      lastOutputDir: 'D:\\old',
      error: 'X'
    })
    await useAppStore.getState().clear()
    const s = useAppStore.getState()
    expect(s.items).toEqual([])
    expect(s.dropped).toBe(0)
    expect(s.progress).toBe(0)
    expect(s.finished).toBe(false)
    expect(s.lastOutputDir).toBeNull()
    expect(s.error).toBeNull()
  })
})

describe('finishTask', () => {
  it('正常跑完时记下输出目录', () => {
    useAppStore.getState().finishTask({ taskId: 't', done: 3, undershot: 0, failed: 0, outputDir: 'D:\\out' })
    const s = useAppStore.getState()
    expect(s.running).toBe(false)
    expect(s.finished).toBe(true)
    expect(s.lastOutputDir).toBe('D:\\out')
    expect(s.error).toBeNull()
  })

  it('整批被中止时把原因码留在 error 上', () => {
    useAppStore.getState().finishTask({ taskId: 't', done: 1, undershot: 0, failed: 9, outputDir: 'D:\\out', aborted: 'DISK_FULL' })
    expect(useAppStore.getState().error).toBe('DISK_FULL')
  })
})

describe('init 与设置', () => {
  it('从设置里读初始值', async () => {
    fake.getSettings.mockResolvedValueOnce({
      outputDir: 'D:\\saved',
      shrinkPercent: 30,
      outputFormat: 'png',
      lastDir: null
    })
    await useAppStore.getState().init()
    const s = useAppStore.getState()
    expect(s.outputDir).toBe('D:\\saved')
    expect(s.shrinkPercent).toBe(30)
    expect(s.outputFormat).toBe('png')
  })

  it('outputDir 为 null 时落到空串，不显示 null', async () => {
    await useAppStore.getState().init()
    expect(useAppStore.getState().outputDir).toBe('')
  })

  it('改存放位置会落盘', async () => {
    fake.pickOutputDir.mockResolvedValueOnce({ dir: 'D:\\新目录' })
    await useAppStore.getState().pickOutputDir()
    expect(useAppStore.getState().outputDir).toBe('D:\\新目录')
    expect(fake.setSettings).toHaveBeenCalledWith({ outputDir: 'D:\\新目录' })
  })

  it('用户取消选择时什么都不变', async () => {
    useAppStore.setState({ outputDir: 'D:\\原目录' })
    fake.pickOutputDir.mockResolvedValueOnce(null)
    await useAppStore.getState().pickOutputDir()
    expect(useAppStore.getState().outputDir).toBe('D:\\原目录')
    expect(fake.setSettings).not.toHaveBeenCalled()
  })

  it('滑块与格式只改本地，不发 IPC（SPEC §7）', () => {
    useAppStore.getState().setShrinkPercent(55)
    useAppStore.getState().setOutputFormat('webp')
    expect(useAppStore.getState().shrinkPercent).toBe(55)
    expect(useAppStore.getState().outputFormat).toBe('webp')
    expect(fake.setSettings).not.toHaveBeenCalled()
  })
})

describe('removeItem', () => {
  it('移除一行，并收回「已忽略」提示', () => {
    // 空出名额之后，之前那句「已忽略 N 张」就不再成立了
    useAppStore.setState({ items: [item('a')], dropped: 12 })
    useAppStore.getState().removeItem('a')
    expect(useAppStore.getState().items).toEqual([])
    expect(useAppStore.getState().dropped).toBe(0)
  })
})

describe('拖进来的东西里没有可压缩的图', () => {
  it('一张都没加进来时给提示', () => {
    // 空文件夹、或者只拖了 .txt 之类。界面完全没反应的话用户只会以为程序卡了
    install({ metas: [], dropped: 0 })
    return useAppStore.getState().addPaths(['D:\空文件夹']).then(() => {
      expect(useAppStore.getState().notice).toBe(COPY.emptyDrop)
      expect(useAppStore.getState().items).toEqual([])
    })
  })

  it('加进来一些时不给提示（混着的非图片仍然静默过滤）', () => {
    install({ metas: [meta('a')] })
    return useAppStore.getState().addPaths(['D:\有图\a.jpg', 'D:\有图\note.txt']).then(() => {
      expect(useAppStore.getState().notice).toBeNull()
    })
  })

  it('空数组不触发提示', () => {
    // 没拖东西当然不该说「没有可压缩的图片」
    return useAppStore.getState().addPaths([]).then(() => {
      expect(useAppStore.getState().notice).toBeNull()
    })
  })

  it('开始跑批时提示让位', () => {
    install()
    useAppStore.setState({
      notice: COPY.emptyDrop,
      outputDir: 'D:\out',
      items: [item('a')]
    })
    return useAppStore.getState().run().then(() => {
      expect(useAppStore.getState().notice).toBeNull()
    })
  })

  it('清空列表时提示让位', () => {
    install()
    useAppStore.setState({ notice: COPY.emptyDrop })
    return useAppStore.getState().clear().then(() => {
      expect(useAppStore.getState().notice).toBeNull()
    })
  })

  it('移除一行时提示让位', () => {
    install()
    useAppStore.setState({ notice: COPY.emptyDrop, items: [item('a')] })
    useAppStore.getState().removeItem('a')
    expect(useAppStore.getState().notice).toBeNull()
  })
})
