/**
 * 合成测试图（SPEC.md §10.0 的 A 类，8 张）
 *
 * B 类的两张真实 HEIC 无法合成，必须人工放进 tests/fixtures/：
 *   iphone-portrait.heic / iphone-landscape.heic
 * 缺失时相关测试会 skip，不影响其余用例。
 *
 * 用法：npm run fixtures
 */
import sharp from 'sharp'
import { mkdirSync } from 'node:fs'

const OUT = 'tests/fixtures'
mkdirSync(OUT, { recursive: true })

/** 高噪点图，最难压，用来验证 undershot */
const noise = (w, h, ch) => {
  const buf = Buffer.alloc(w * h * ch)
  for (let i = 0; i < buf.length; i++) buf[i] = (Math.random() * 256) | 0
  return sharp(buf, { raw: { width: w, height: h, channels: ch } })
}

const done = []

// 1. 高噪点 JPG
await noise(4000, 3000, 3).jpeg({ quality: 95 }).toFile(`${OUT}/noise-hi.jpg`)
done.push('noise-hi.jpg 4000x3000')

// 2. 纯色 PNG，最容易压，用来验证 palette 路径
await sharp({ create: { width: 2000, height: 1500, channels: 3, background: '#3A7BD5' } })
  .png()
  .toFile(`${OUT}/flat-solid.png`)
done.push('flat-solid.png 2000x1500')

// 3. 带 alpha 的 PNG，用来验证 flatten
await sharp({
  create: { width: 1200, height: 1200, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0.5 } }
})
  .png()
  .toFile(`${OUT}/alpha-cutout.png`)
done.push('alpha-cutout.png 1200x1200')

// 4. 1x1 像素图，最小边界
await sharp({ create: { width: 1, height: 1, channels: 3, background: '#000' } })
  .png()
  .toFile(`${OUT}/tiny-1x1.png`)
done.push('tiny-1x1.png 1x1')

// 5. 超大图，验证并发与内存
await noise(8000, 6000, 3).jpeg({ quality: 90 }).toFile(`${OUT}/huge-8000.jpg`)
done.push('huge-8000.jpg 8000x6000')

// 6. WebP 输入
await noise(2400, 1600, 3).webp({ quality: 90 }).toFile(`${OUT}/sample.webp`)
done.push('sample.webp 2400x1600')

// 7. AVIF 输入，验证输入侧
await noise(1600, 1200, 3).avif({ quality: 60 }).toFile(`${OUT}/sample.avif`)
done.push('sample.avif 1600x1200')

// 8. 带 orientation 标签的 JPG，验证方向保留
await sharp({ create: { width: 1200, height: 900, channels: 3, background: '#888' } })
  .withMetadata({ orientation: 6 })
  .jpeg({ quality: 90 })
  .toFile(`${OUT}/oriented-6.jpg`)
done.push('oriented-6.jpg 1200x900 orientation=6')

console.log('合成 fixture 完成：')
for (const d of done) console.log('  ' + d)
console.log('')
console.log('B 类（需人工放入）：iphone-portrait.heic / iphone-landscape.heic')
