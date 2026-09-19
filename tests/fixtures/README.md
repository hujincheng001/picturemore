# 测试图片

本目录的图片分两类（依据 `SPEC.md` §10.0）。

## A 类：脚本合成（8 张，不入库）

跑 `npm run fixtures` 生成。确定性合成，每次结果一致，因此不进 git（合计约 54MB）。

| 文件 | 尺寸 | 用途 |
|---|---|---|
| `noise-hi.jpg` | 4000x3000 | 高熵噪声，考察有损压缩的极限 |
| `flat-solid.png` | 2000x1500 | 纯色，考察 PNG 调色板压缩 |
| `alpha-cutout.png` | 1200x1200 | 半透明，考察透明通道与拍平 |
| `tiny-1x1.png` | 1x1 | 极小图边界 |
| `huge-8000.jpg` | 8000x6000 | 大图，考察内存与并发 |
| `sample.webp` | 2400x1600 | WebP 输入 |
| `sample.avif` | 1600x1200 | AVIF 输入 |
| `oriented-6.jpg` | 1200x900 | EXIF orientation 6，考察方向保留 |

## B 类：真实 HEIC（2 张，入库）

无法合成，必须由真实设备拍摄。合计约 5.4MB，随仓库分发。

| 文件 | 存储尺寸 | irot | 说明 |
|---|---|---|---|
| `iphone-portrait.heic` | 5712x4284 | 270 | 竖拍。`heic-decode` 解出 4284x5712，方向已应用 |
| `iphone-landscape.heic` | 5712x4284 | 0 | 横拍。解出 5712x4284 |

两张都是 8-bit、Display P3。相关结论见 `docs/decisions.md` 的 M0-2 / M0-3。

## 缺失时的行为

`heic.spec.ts` 与黄金测试里的 HEIC 用例用 `it.skipIf` 守卫，fixture 不在时自动跳过并打印提示，不会让测试变红（`SPEC.md` §10.0）。
