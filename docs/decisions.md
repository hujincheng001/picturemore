# 决策记录

> 每个"为什么这么写"都记在这里。M0 的结论是实测得到的，不是推断。
> 复现方式：`node scripts/verify-heic.mjs` 与 `node scripts/verify-metadata.mjs`。
> 环境：Windows · Node 22.22.2 · sharp 0.35.4 · heic-decode 2.1.0 · libheif-js（heic-decode 内嵌 WASM）
> 记录时间：2026-09-19

---

## M0-1 sharp 能不能读 HEIC

**结论：metadata 能读，像素解不了。必须走 `heic-decode` 兜底。**

`sharp.format.heif` 的输出里 `input.fileSuffix` 只有 `[".avif"]`，没有任何 HEIC 后缀。实测两张 iPhone HEIC：

| 操作 | 结果 |
|---|---|
| `sharp(buf).metadata()` | **成功**，返回 `4284x5712`（显示尺寸）、`format=heif`、`orientation=undefined` |
| `sharp(buf).jpeg()` | **失败**，`heif: Decoder plugin generated an error: Unspecified (7.0)` |

即：sharp 能解析 HEIF 容器头部，但预编译的 libvips 没有 HEVC 解码器，碰不到像素。

**对代码的影响**：

- `probe.ts` 可以先用 `sharp(buf).metadata()` 拿到 HEIC 的尺寸与格式，不必一上来就解像素。
- 只要涉及像素（编码、算体积），HEIC 必须走 `heic-decode` → raw RGBA → `sharp(raw, { raw })`。
- `canSharpDecodeHeic()` 不能用"喂一段假文件头看是否抛错"来判断（`metadata()` 对 HEIC 不抛错）。应当判断 `sharp.format.heif.input.fileSuffix` 里有没有非 avif 的项。

---

## M0-2 heic-decode 返回的 raw 是否已应用方向

**结论：已应用。HEIC 输入绝不能写 orientation 标签。**

不看肉眼，解容器：主图 item 的 `ispe`（存储尺寸）与 `irot`（旋转）直接从字节里读出来，再和 heic-decode 的返回值比。

| fixture | 主图 ispe | 主图 irot | heic-decode 返回 | 判定 |
|---|---|---|---|---|
| iphone-portrait.heic | 5712x4284 | 270 度 | 4284x5712 | 宽高已交换，方向已应用 |
| iphone-landscape.heic | 5712x4284 | 0 度 | 5712x4284 | 本图无变换，无从判断，也无所谓 |

portrait 那张解出的 raw 编码成 JPEG 后用系统看图工具打开，画面正立（吊灯在上、地面在下），与容器结论一致。

**对代码的影响**：

```ts
// HEIC 路径：orientation 传 null，绝不能再写 6
const orientation = needsDecode ? null : src.orientation;
```

若写了，照片会二次旋转 90 度躺倒。这条同时解释为什么 §4.5 禁止用 `.rotate()`：`.rotate()` 会真旋转像素、宽高互换，触发 `DIMENSION_CHANGED`。

**10-bit HEIC**：容器里 `pixi` 声明主图为 `8/8/8 bit`，两张 fixture 都不是 10-bit，无法实测。但 heic-decode 的 `display()` 固定输出 8-bit RGBA（`Uint8ClampedArray`，4 通道），所以即便遇到 10-bit 源，出来的也是 8-bit，不会崩。**待办：找一张 10-bit HEIC 补测，记在这里。**

---

## M0-3 HEIC 的色彩配置：libheif-js 不带色彩管理

**结论：heic-decode 吐出的是 Display P3 数值且不带任何标签，必须由我们挂上 P3。**

主图 item 的 `colr` 属性是一段 536 字节的 ICC，`rXYZ = (0.5151, 0.2412, -0.0011)`，是标准 **Display P3**（sRGB 的红原色是 0.4360，P3 是 0.5151）。

同时确认 libheif-js 的 WASM 里**没有 lcms / CMS 符号**（`cmsOpenProfileFromMem`、`lcms`、`cmsCreateTransform` 全部零命中），所以它不可能按 ICC 做色域转换。它只按 `nclx` 的矩阵做 YCbCr→RGB，出来的 RGB 数值就是文件的原生原色，也就是 P3。

**如果什么都不挂**，看图软件会按 sRGB 解释 P3 数值。实测偏差（400px 采样）：

| fixture | 平均通道偏差 | 最大偏差 | 偏差 > 8 的像素占比 |
|---|---|---|---|
| iphone-portrait | 1.95 / 255 | 34 | 1.56% |
| iphone-landscape | 1.80 / 255 | 68 | 1.59% |

平均不到 1%，但饱和区域（照片里的红底年画）能到 34-68，肉眼可见偏淡。

**做法**：HEIC 路径在编码前挂上 sharp 内置的 Display P3 profile：

```ts
p = p.withIccProfile('p3');   // 输入无 ICC 时，sharp 只挂标签，不动像素（实测平均改动 0.073/255，最大 1，属舍入）
```

**为什么不是转成 sRGB**：sharp 没有"把无标签输入按某个 profile 解释"的 API（见 M0-4），转不过去。而挂 P3 标签既满足 SPEC §4.5 的"保留 ICC"，又完全不碰像素，符合承诺二。

**已知缺口**：这里假定 HEIC 一律是 Display P3。iPhone 确实如此，但 Android 的 HEIC 可能是 sRGB（BT.709）。若遇到，会被错挂成 P3，在带色彩管理的看图软件里显得略艳。
**升级路径**：`scripts/lib/heif.mjs` 里已经有一份可用的 HEIF 盒子解析器（`pitm` / `iinf` / `iprp` / `ipco` / `ipma`），能取到主图真正关联的 `colr`。将来若要精确，把它搬进 `src/main/image/heic.ts`，按容器里的 `colr` 决定挂 p3 还是 srgb 还是 nclx 声明。v1 不做，先按 P3 处理。

---

## M0-4 metadata 的确切写法（本 Task 最重要的产出）

**结论：`keepIccProfile().withExif({})`，不要用 `withMetadata()`。**

### 实测矩阵 · 普通 JPG（900x600，EXIF 3254 字节，orientation 6）

| 写法 | orientation | exif | icc | 字节 | 判定 |
|---|---|---|---|---|---|
| A 不写任何 metadata | 丢 | 无 | 丢 | 1951 | 不通过 |
| B `withMetadata()` | 6 | 3254B | 480B | 5707 | 不通过（EXIF 全留） |
| C `keepIccProfile + withMetadata({orientation})` | 6 | 3254B | 480B | 5707 | 不通过 |
| D `keepExif()` | 6 | 3254B | 无 | 5209 | 不通过 |
| E `withExif({})` | 6 | 126B | 无 | 2081 | 不通过（ICC 丢） |
| **F `keepIccProfile().withExif({})`** | **6** | **126B** | **480B** | **2579** | **通过** |

F 同时满足 SPEC §4.5 的三条：方向在、ICC 在、其余 EXIF 清掉（3254 → 126 字节，内嵌缩略图一并消失）。

### 跨格式 × 方向矩阵

`keepIccProfile().withExif({})` 在 JPEG / PNG / WebP 三种输出、orientation 1/3/6/8 四种取值下，**12 个组合全部通过**：方向原样保留、EXIF 由约 195 字节缩到 120-126 字节、ICC 字节级原样。

### 为什么不用 `withMetadata()`

读 sharp 0.35.4 的源码（`node_modules/sharp/dist/output.cjs`）：

```js
function withMetadata (options) {
  this.keepMetadata();
  this.withIccProfile('srgb');   // ← 无条件把输出 profile 设成 srgb
  ...
}
```

`withIccProfile('srgb')` 会把输出 ICC 换成 sRGB。**关键实测：它换标签但不转换像素。**

用一张真正的 Display P3 输入（HEIC raw 挂 p3 得到，ICC 与 sharp 内置 p3 字节相同）跑 H 写法：

```
输入 ICC == 内置 p3   ? true
输出 ICC == 输入 ICC  ? false
输出 ICC == 内置 p3   ? false
输出 ICC == 内置 srgb ? true
像素平均改动           0.000
```

即：**像素还是 P3 数值，标签变成了 sRGB**。这是最坏的组合，会让 P3 图在带色彩管理的软件里明显偏淡。所以 `withMetadata()` 一律不用。

### 方向为什么不需要显式写

`withExif({})` 写一份全新的最小 EXIF，而 libvips 会把输入读到的 `VIPS_META_ORIENTATION` 一起写进去。实测 12 个组合方向全部原样保留，所以 `encode.ts` 不需要 `withMetadata({ orientation })`。

另外实测 `withExif({ IFD0: { Orientation: '6' } })` **无效**，libvips 会把它覆盖成 1。要显式指定方向，只有 `withMetadata()` 一条路，而那会牺牲 ICC。两者不可兼得，取 ICC。

### 最终写法（Task 6 的 `encode.ts` 照抄这一段）

```ts
let p = sharp(input, rawOpts);

// 承诺二：绝不 resize、绝不 rotate
if (flattenTo) p = p.flatten({ background: flattenTo });

p = p.keepIccProfile().withExif({});   // 保留 ICC + 方向，清掉其余 EXIF

// 仅 HEIC 输入：raw 没有 ICC，挂上 Display P3（只挂标签，不动像素）
if (tagAsP3) p = p.withIccProfile('p3');

// 不要调用 withMetadata()，它会把 ICC 换成 sRGB 且不转换像素
```

---

## M0-5 产品层面的新发现（不在原文档里，需要留意）

**HEIC 转出来可能比原图更大。**

两张 iPhone HEIC 的原文件分别是 2.54MB / 2.93MB。解出的 24MP raw 用 `jpeg({ quality: 85 })` 编码后是 **2.56MB / 3.11MB**，比原图还大。

原因不是编码写得差，是 HEVC 对照片的压缩效率本来就高于 JPEG。这意味着：

- 「保持原格式」对 HEIC 无意义（sharp 写不了 HEIC），实际输出只能是 JPG，且**在低压缩档位下体积会不降反升**。
- §10.1 的黄金断言第 2 条「输出字节 <= 输入字节」对 HEIC 输入会很频繁地不成立，`compressOne` 会走「返回原文件字节」分支，标 `undershot`。
- 但这不符合用户预期：他选 HEIC 就是想把图压小。返回原文件等于没干活。

**处置**：不在 Task 0 改设计。Task 7 的黄金测试会暴露真实数据，届时把 HEIC 的实际压缩曲线测出来，再决定是放宽目标体积算法还是给 HEIC 输入单独设质量底线。**这一条需要在 Task 7 结束时向用户汇报。**

---

## 待办与开放项

| 项 | 状态 |
|---|---|
| 10-bit HEIC 实测 | 未覆盖，两张 fixture 都是 8-bit。需要一张 10-bit 样张 |
| Android HEIC（可能是 sRGB 而非 P3） | 未覆盖。当前一律按 P3 处理 |
| HEIC 的压缩率天花板 | 见 M0-5，Task 7 实测后决定 |
| `heic-decode` 的 `Uint8ClampedArray` 与 sharp 的 `Buffer` | `Buffer.from(r.data)` 会复制一次 96MB（24MP x 4）。Task 7 若发现内存吃紧，改成 `Buffer.from(r.data.buffer, r.data.byteOffset, r.data.byteLength)` 零拷贝 |

---

## 环境备忘

- 两张真实 HEIC fixture 已就位：`tests/fixtures/iphone-portrait.heic`（5712x4284 存储 + irot 270）、`tests/fixtures/iphone-landscape.heic`
- `scripts/lib/heif.mjs` 是 M0 用的 HEIF 盒子解析器，**不属于产品代码**，只被两个验证脚本引用
- 项目初始化时还没有 git 仓库，Task 0 结束时补上 `git init`
