import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import heicDecode from 'heic-decode'
import sharp, { type Sharp } from 'sharp'
import { compressOne } from './compress'
import { probe } from './probe'
import type { OutputFormat } from '../../shared/types'

/**
 * 「100% 缩放看不出差别」的量化检查（SPEC §10.3 的手工验收项）。
 *
 * 黄金测试断言的是**参数**（p <= 70 时 quality >= 82），这一条断言的是**结果**：
 * 把输出解回像素，和原图逐点比。参数对不代表结果对 —— 编码器换个版本、
 * metadata 配方改一下，quality 还是 82 但画面可能已经变了。
 *
 * 四组断言，阈值全部来自实测（见 docs/decisions.md 的 T19-1），不是拍的。
 */

const FIXTURES = resolve(__dirname, '../../../tests/fixtures')

interface Raw {
  data: Buffer
  width: number
  height: number
  channels: number
}

/**
 * 解码成 raw，用于逐像素比较。
 *
 * 通道数必须和输出对齐，否则比不了：
 * - 输出带 alpha → 原图也解成 RGBA
 * - 输出不带 alpha 而原图带 → 按引擎的方式（白底 flatten）拍平后再比，
 *   不能直接丢 alpha，那是两回事，比出来的是假差异
 */
async function toRaw(buf: Buffer, wantAlpha: boolean): Promise<Raw> {
  const pr = await probe(buf)

  let pipe: Sharp
  if (pr.format === 'heic') {
    const r = await heicDecode({ buffer: buf })
    pipe = sharp(Buffer.from(r.data.buffer, r.data.byteOffset, r.data.byteLength), {
      raw: { width: r.width, height: r.height, channels: 4 }
    })
  } else {
    pipe = sharp(buf)
  }

  if (!wantAlpha) {
    if (pr.hasAlpha) pipe = pipe.flatten({ background: '#FFFFFF' })
    // HEIC 固定按 4 通道解出来，即使源本身没有 alpha 也要显式去掉
    pipe = pipe.removeAlpha()
  }

  const { data, info } = await pipe.raw().toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height, channels: info.channels }
}

interface Diff {
  mean: number
  p99: number
  max: number
  /** 差值超过 8/255 的像素占比。8 是肉眼在纯色区域能开始分辨的量级 */
  over8: number
}

function diff(a: Raw, b: Raw): Diff {
  if (a.data.length !== b.data.length) {
    throw new Error(`像素数不一致：${a.data.length} vs ${b.data.length}`)
  }
  const hist = new Array<number>(256).fill(0)
  let sum = 0
  let max = 0
  let over8 = 0
  let n = 0

  for (let i = 0; i < a.data.length; i++) {
    const d = Math.abs((a.data[i] ?? 0) - (b.data[i] ?? 0))
    sum += d
    if (d > max) max = d
    if (d > 8) over8++
    hist[d] = (hist[d] ?? 0) + 1
    n++
  }

  // 99 分位：直方图从大到小累加，找到累计超过 1% 的那个差值
  let acc = 0
  let p99 = 0
  for (let d = 255; d >= 0; d--) {
    acc += hist[d] ?? 0
    if (acc > n * 0.01) {
      p99 = d
      break
    }
  }

  return { mean: sum / n, p99, max, over8: over8 / n }
}

async function measure(file: string, shrinkPercent: number, format: OutputFormat = 'keep') {
  const buf = readFileSync(join(FIXTURES, file))
  const pr = await probe(buf)
  const { data, result } = await compressOne({ buf, shrinkPercent, outputFormat: format, probe: pr })

  const wantAlpha = result.format === 'png' || result.format === 'webp' ? pr.hasAlpha : false
  const src = await toRaw(buf, wantAlpha)
  const out = await toRaw(data, wantAlpha)

  const d = diff(src, out)
  console.log(
    `        ${file} @${shrinkPercent}%：体积 ${(((data.length - buf.length) / buf.length) * 100).toFixed(1)}%，` +
      `均值 ${d.mean.toFixed(3)}/255，p99 ${d.p99}，最大 ${d.max}，超 8 的像素 ${(d.over8 * 100).toFixed(4)}%`
  )

  return {
    diff: d,
    sameSize: src.width === out.width && src.height === out.height,
    shrunk: data.length < buf.length
  }
}

describe('压得动的时候必须一个像素都不差', () => {
  // 这三张都能被无损地压下去：纯色走调色板 PNG、带 alpha 的走拍平、平灰 JPEG 在 q82 下无损。
  // 阈值是**精确的 0**，不是「足够小」—— 能无损却引入差异就是缺陷。
  for (const file of ['flat-solid.png', 'alpha-cutout.png', 'oriented-6.jpg']) {
    it(file, async () => {
      const m = await measure(file, 70)
      expect(m.sameSize, '宽高被改了').toBe(true)
      expect(m.shrunk, '这张本该被压小').toBe(true)
      expect(m.diff.mean, `${file} 出现了像素差异`).toBe(0)
      expect(m.diff.max, `${file} 出现了像素差异`).toBe(0)
    }, 120_000)
  }
})

describe.skipIf(!existsSync(join(FIXTURES, 'iphone-portrait.heic')))(
  '真实照片在安全线内看不出差别',
  () => {
    // 这是最有说服力的一组：iPhone 实拍、41.5% 的体积缩减、99% 的像素差不超过 6/255。
    // 阈值留了余量（实测 1.44 / 6 / 0.17%），但仍远低于「看得出来」的量级。
    for (const p of [45, 70]) {
      it(`iphone-portrait.heic @ ${p}%`, async () => {
        const m = await measure('iphone-portrait.heic', p)
        expect(m.sameSize, '宽高被改了').toBe(true)
        expect(m.shrunk, '这张本该被压小').toBe(true)
        expect(m.diff.mean, '平均差过大，能看出压缩痕迹').toBeLessThan(3)
        expect(m.diff.p99, '99 分位差过大').toBeLessThanOrEqual(8)
        expect(m.diff.over8, '超阈值像素占比过高').toBeLessThan(0.01)
      }, 120_000)
    }
  }
)

describe.skipIf(!existsSync(join(FIXTURES, 'iphone-portrait.heic')))(
  '安全线内再往下拉滑块不会继续掉画质',
  () => {
    /*
     * 实测：45% 与 70% 的输出**完全相同**（均值 1.440、体积 -41.5%）。
     *
     * 因为这张图压不到 45% 那个目标，引擎停在质量底线上就收了 ——
     * 这正是「感知无损」承诺的实现方式：宁可压不到目标，也不越过底线。
     *
     * 反过来说，如果哪天有人把底线调低去迎合滑块，这条会立刻红。
     */
    it('45% 与 70% 的画质损失相同', async () => {
      const low = await measure('iphone-portrait.heic', 45)
      const mid = await measure('iphone-portrait.heic', 70)
      expect(
        Math.abs(low.diff.mean - mid.diff.mean),
        '45% 比 70% 掉得更多，说明滑块越界后仍在牺牲画质'
      ).toBeLessThan(0.1)
    }, 120_000)
  }
)

describe.skipIf(!existsSync(join(FIXTURES, 'iphone-portrait.heic')))(
  '越过安全线画质确实会掉',
  () => {
    /*
     * 守的是「70% 那条线不是随便画的」—— 不这么验的话，把线挪到 95% 测试也照样绿。
     *
     * 实测：70% → 85% 时
     *   均值    1.440 → 1.984
     *   超 8 的像素  0.172% → 0.740%（4.3 倍）
     *   体积     -41.5% → -70.8%
     *
     * 用「超 8 的像素占比」而不是均值做主判据：它直接对应「多少像素的差异到了
     * 肉眼可能分辨的量级」，比均值更贴近「看不看得出」这个问题。
     */
    it('85% 超阈值的像素明显多于 70%', async () => {
      const safe = await measure('iphone-portrait.heic', 70)
      const over = await measure('iphone-portrait.heic', 85)
      expect(over.diff.over8, '越过安全线后没有更多像素出现可见差异').toBeGreaterThan(
        safe.diff.over8 * 3
      )
      expect(over.diff.mean, '越过安全线后平均差反而变小了').toBeGreaterThan(safe.diff.mean)
    }, 120_000)
  }
)

describe('压不动的时候不牺牲画质', () => {
  // 纯噪声是不可压的。滑块拉到 45% 时，目标体积根本达不到，
  // 引擎会停在质量底线上而不是继续降质 —— 所以 45% 和 70% 的差异应当很接近。
  //
  // 这条同时是给用户的解释：为什么噪声图拉低滑块也压不动多少。
  it('noise-hi.jpg 在 45% 与 70% 下的画质损失基本相同', async () => {
    const low = await measure('noise-hi.jpg', 45)
    const mid = await measure('noise-hi.jpg', 70)

    expect(low.sameSize).toBe(true)
    const relative = Math.abs(low.diff.mean - mid.diff.mean) / mid.diff.mean
    expect(
      relative,
      `45% 与 70% 的画质损失差了 ${(relative * 100).toFixed(1)}%，说明滑块越界后仍在牺牲画质`
    ).toBeLessThan(0.15)
  }, 180_000)
})
