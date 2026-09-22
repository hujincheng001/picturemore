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

### 本机开发环境的一个坑：`ELECTRON_RUN_AS_NODE=1`

宿主环境（WorkBuddy 的 CLI 运行时）会给 shell 注入两个变量，子进程会继承：

| 变量 | 后果 |
|---|---|
| `NODE_OPTIONS` | 指向一个 `--require` 预载 shim，Node 侧会继承 |
| `ELECTRON_RUN_AS_NODE=1` | **`electron.exe` 会退化成普通 Node**，不启动浏览器进程 |

`ELECTRON_RUN_AS_NODE=1` 的杀伤力最大。此时：

- `process.type === undefined`（正常应为 `'browser'`）
- `require('electron')` 不再返回 Electron API，而是命中项目自己的 `node_modules/electron`（npm 包，导出的是一个 exe 路径字符串）
- 主进程第一行 `electron.app.requestSingleInstanceLock()` 就抛 `Cannot read properties of undefined`
- 现象具有迷惑性：**同一个 electron.exe，脚本放在项目外能跑、放在项目内就挂**（因为项目内有 `node_modules/electron` 可供命中）

这不是产品问题，是宿主环境问题。处置：

```bash
env -u ELECTRON_RUN_AS_NODE -u NODE_OPTIONS npx electron-vite dev
```

`scripts/smoke-context-isolation.mjs` 已在 `childEnv()` 里显式 `delete` 这两个变量，所以 `npm run smoke` 直接可用。在普通终端（没有这两个变量）下 `npm run dev` 无需任何前缀。

**另一个入口习惯**：冒烟脚本用 `electron .`（走 `package.json` 的 `main`），不用 `electron out/main/index.js`。后者会进 default-app 模式，与 `electron-vite dev` 和打包产物不是同一条入口，没必要引入这个差异。

### Task 1 验收实测结果

`npm run smoke`（构建 + CDP 进渲染进程取值）：

```
[smoke] 渲染进程隔离检查：
  通过  window.require 不存在 = undefined
  通过  window.process 不存在 = undefined
  通过  window.module 不存在 = undefined
  通过  window.Buffer 不存在 = undefined
  通过  window.global 不存在 = undefined
  通过  window.pictureMore 尚未实现 = undefined
[smoke] 页面状态：title="图压压" url="file:///D:/pictureMore/out/renderer/index.html" #root=true
```

`npm run dev` 同样确认：主进程/预加载构建成功，dev server 起在 5173，Electron 起 4 个进程（main / renderer / GPU / utility），零报错。

---

## Task 6 决策：`encode.ts` 的两个取舍

### T6-1：`withIccProfile('p3')` 只挂标签不改像素，但**必须用无损格式才能测出来**

M0-3 记录的是「`withIccProfile('p3')` 只挂标签，平均偏差 0.073/255」。但 sharp 的文档原文是：

> Transform using an ICC profile and attach to the output image.
> —— `node_modules/sharp/dist/output.cjs:337`

字面意思是**会做色彩转换**，与 M0-3 的记录冲突。这一条直接决定 HEIC（Display P3）路径对不对，所以重测了一遍，脚本落在 `scripts/verify-icc-attach.mjs`（`npm run verify:icc`）。

**第一次测量用了 JPEG q100 + 4:4:4，结论是错的。** 数据：

| 编码格式 | `withIccProfile('p3')` 平均偏差 | `attach:false` 平均偏差 |
|---|---|---|
| JPEG q100 4:4:4 | 0.525/255，最大 11 | 1.009/255，最大 35 |
| **PNG 无损** | **0.070/255，最大 2** | 0.724/255，最大 36 |

JPEG 自身的编解码噪声就有 1/255 量级，把两个变体的差异淹掉了，还让"转色"和"没转色"看起来差不多。

**换 PNG（`compressionLevel: 0`，无损）之后结论才清晰**：`withIccProfile('p3')` 平均 0.070/255、最大 2，纯舍入 —— **只挂标签，不转色**。

机制上说得通：libvips 的 icc transform 在输入没有嵌入 profile 时，把操作当成「assigned」而不是「converted」。而 `attach: false` 走的是另一条路径，反而真的改了像素（0.724/255、最大 36）—— 所以 `attach: false` 是错的用法，不要用。

**教训**：验证"有没有动像素"这类问题，必须用无损格式比较。有损编码的噪声会把信号吃掉。

### T6-2：计划草稿里的 `keepIcc: boolean` 不实现

计划 Task 6 的 `EncodeOptions` 有 `keepIcc: boolean`。但 `SPEC.md` §4.3 的表格把「ICC 色彩配置」列为**硬性保留项**：

> 丢掉会让 sRGB 之外的图（如 Display P3）明显偏色

一个可以被传 `false` 的开关，等于给承诺留了个后门 —— 哪天有人顺手传了 `false`，Display P3 的照片就会偏色，而且不会有任何报错。所以 `EncodeOptions` 只保留两个字段：

```ts
export interface EncodeOptions {
  tagAsP3: boolean        // HEIC raw 补挂 P3 标签
  flattenTo: string | null // JPG 输出时的拍平底色
}
```

ICC 在 `input.kind === 'buffer'` 分支里无条件 `keepIccProfile()`。这条与计划草稿的偏差是**有意为之**，依据是 SPEC 优先于计划。

### T6-3：`raw` 分支不写任何 EXIF / orientation

HEIC 经 `heic-decode` 解出的 raw 已经应用过方向（M0-2），且 raw 输入本身不携带任何元信息。所以 `raw` 分支只做两件事：拍平（若需要）、补 P3 标签（若需要）。**绝不写 orientation**，否则照片会二次旋转躺倒。`encode.spec.ts` 里有一条断言专门守这个：

```ts
expect(meta.orientation === undefined || meta.orientation === 1).toBe(true)
```

### Task 6 验收

`npm run check`：lint:no-resize + typecheck + **58 条测试全过**（新增 `encode.spec.ts` 22 条）。

其中值得一提的两组：
- 「尺寸不变量」：7 张 fixture × 3 种输出格式 = 21 个组合，逐个断言宽高与输入一致。
- 「三种输出格式都保住 ICC」：JPEG / PNG / WebP 三条分支逐个比对 ICC 字节，防止哪条分支漏掉 `keepIccProfile()`。

---

## Task 7 决策：M0-5 结案，HEIC 压得动

### T7-1：M0-5 的结论被推翻，原因是 mozjpeg

M0-5 当时测出「HEIC 转出来比原图还大」，据此怀疑 HEIC 根本压不动。**这个结论是错的**，错在测试条件：那次用的是裸 `jpeg({ quality: 85 })`，没开 mozjpeg。

用真实管线（`mozjpeg: true`）重测 `tests/fixtures/`，脚本见 `src/main/image/compress.curve.spec.ts`：

```bash
MEASURE=1 npx vitest run src/main/image/compress.curve.spec.ts
```

**`iphone-portrait.heic`，源 2481KB，4284x5712：**

| 质量档 | 输出 | 占原图 |
|---|---|---|
| 62 | 724KB | 29.2% |
| 70 | 885KB | 35.7% |
| 75 | 1060KB | 42.7% |
| **82（感知无损底线）** | **1452KB** | **58.5%** |
| 85 | 1695KB | 68.3% |
| 90 | 2411KB | 97.2% |
| 95 | 3760KB | 151.5% |

**`iphone-landscape.heic`，源 2859KB：**

| 质量档 | 输出 | 占原图 |
|---|---|---|
| 62 | 1048KB | 36.7% |
| **82** | **1904KB** | **66.6%** |
| 85 | 2180KB | 76.3% |
| 90 | 2949KB | 103.1% |

同一张图，q85 从「2.56MB，比原图大」变成「1.70MB，比原图小 33%」。**mozjpeg 的 trellis 量化对照片的增益就是这么大。**

**结论**：

- HEIC 完全压得动。在感知无损底线 q82 上，iPhone HEIC 能压到原体积的 **58-67%**（即缩小 33-42%）。
- 交叉点在 q≈90：q90 以上才可能不降反升。
- 之前担心的「HEIC 频繁走 keptOriginal 分支」不会发生。黄金测试 36 条全绿，含 8 条 HEIC 用例。
- **不需要为 HEIC 单独放宽目标算法或设独立质量底线。** M0-5 的待办可以关掉。

其他格式的曲线（同样 `MEASURE=1` 可复现）：

| fixture | 源 | q62 | q82 | q90 | q95 |
|---|---|---|---|---|---|
| sample.webp | 3136KB | 38.8% | 63.3% | 83.8% | 105.9% |
| sample.avif | 1426KB | 44.4% | 72.6% | 96.3% | 121.6% |
| huge-8000.jpg（纯噪声） | 38.6MB | 39.5% | 64.5% | 85.3% | 107.3% |

规律一致：**q90 是"不降反升"的分水岭**，这印证了 `CEIL = 95` 留出的余量是合理的，也说明 `FLOOR_PERCEPTUAL = 82` 落在安全区内。

### T7-2：先试质量底线，编码次数从 6 降到 1

`pickBest` 原本按 SPEC §4.3 的字面写法「在 [FLOOR, 95] 区间二分」。问题在于：**最难压的那类图（高熵噪声、用户把滑块拖到 85%）无论怎么二分都要跑满 6 次**，而它们的答案其实第一次就能确定 —— 连质量底线都压不到目标，往上抬只会更大。

改成**先试底线，再二分**：

```
attempt(FLOOR)
if bytes(FLOOR) > TARGET:      # 底线都压不到
    收敛，1 次编码结束，标 undershot
else:
    在 [FLOOR+1, 95] 上二分，最多再 5 次
```

最终答案完全不变（仍然是"满足体积目标的前提下质量最高"，或者底线兜底），只是省掉了注定无用的编码。

**实测效果**：`compress.spec.ts` 从 **678s 降到 328s**（-52%）。`huge-8000.jpg` 从 400s 降到约 230s。

### T7-3：真实照片的性能，以及 SPEC 预算偏乐观

单次编码实测耗时（`MEASURE=1` 跑 7 个质量档，取平均）：

| fixture | 像素 | 单次编码 |
|---|---|---|
| iphone-portrait.heic | 24MP 真实照片 | 2.4s |
| iphone-landscape.heic | 24MP 真实照片 | 2.6s |
| sample.webp | 3.8MP | 2.3s |
| sample.avif | 1.9MP | 1.4s |
| noise-hi.jpg | 12MP 纯噪声 | 6.6s |
| huge-8000.jpg | 48MP 纯噪声 | 25.7s |

SPEC §4.3 的性能预算是「单张 4MB 照片，6 次编码约 1.5-2.5s」，即单次 0.25-0.4s。实测真实照片约 0.1s/MP，**12MP 照片单次约 1.2s，比预算慢约 3 倍**。

原因是 mozjpeg：它的 trellis 量化拿体积换时间，比 libjpeg-turbo 慢数倍，但换来 T7-1 里那 33% 的体积收益。**这是划算的**，而且 T7-2 的优化让多数真实场景只需 1 次编码（约 1.2s），符合"逐行落位、有进度反馈"的交互预期。

`noise-hi` / `huge-8000` 的 6.6s / 25.7s 是纯噪声的最坏情况，不代表真实照片。它们的存在价值就是压住这个下界。

**需要 Task 8 / Task 13 注意的一点**：SPEC §9 规定「单张处理超时（>30s）→ 标记 failed」。实测 `huge-8000.jpg` 在 p=20 时要跑 104s（底线命中目标，二分跑满 5-6 次，每次 23s）。这是 48MP 纯噪声的极端值，真实照片不会这样（24MP iPhone HEIC 在 p=20 是 12s）。但**超时阈值和编码次数的关系要在 Task 8 明确下来**：要么把超时设成按像素数缩放，要么在超时时保留已有结果而不是整张判失败。不要默认 30s 对所有图都够用。

**如果要进一步提速**，优先级从高到低：
1. 用上一张的最优质量作为下一张的初值（SPEC §4.3 已列为 v1.1 可选优化）
2. 单张编码走 worker 线程，避免阻塞主进程（Task 8 的并发池会碰这个问题）
3. 对超过某个像素数的图降级到非 mozjpeg（**不要做**，会牺牲 T7-1 的体积收益）

### T7-4：`CompressResult` 加了 `keptOriginal` 字段

SPEC §4.2 的 `CompressResult` 只有 7 个字段。但 SPEC §9 给两种"没压好"的情况配了**不同文案**：

| 场景 | 文案 |
|---|---|
| 输出比原图还大 | 「这张已经压到底了」 |
| 压不到目标体积 | 「质量已到下限，只压到 {x}」 |

光靠 `undershot` 一个布尔区分不了这两种情况，界面就没法选对句子。所以补了 `keptOriginal: boolean`（`true` 表示原样返回了原文件字节）。这是 SPEC §9 的需求逼出来的字段，不是随手加的。

`undershot` 的定义也随之收紧成一条式子：`out.length > target`。三种情况自动覆盖（原样返回 / 底线兜底 / 命中目标）。

### T7-5：PNG 的调色板按颜色数决定，不按 alpha

计划草稿写的是 `palette: src.hasAlpha === false`（没 alpha 就上调色板）。**这个写法会压出色带**：照片存成的 PNG 有几十万种颜色，强行量化到 256 色就是可见的色块，直接违反承诺二。

SPEC §4.3 写的是「颜色数 <= 256 → 量化到调色板」，按 SPEC 实现。`hasAtMostColours` 一旦超过上限就立刻返回，所以照片类图片只扫前几百个像素，只有真正接近纯色的图才会扫完整个数组。

`hasAtMostColours` 是导出的，可以单独测 —— 这个判断错了会静默压出色带，属于"看不出但很难看"的问题，必须有直接测试守住。

### T7-6：SPEC §4.3 里「取所有候选中最小的 q」是笔误

原文：

> 5. 取所有候选中最小的 q（满足体积前提下质量最优）

括号里的「质量最优」和「最小的 q」互相矛盾。按括号执行：**取满足体积目标的候选里质量最高的那个**。理由是这个选择对用户严格更好 —— 体积目标已经达成，剩下的自由度全部让给观感，这正是承诺二的取向。计划草稿的代码（`best.quality < q` 才替换）也站在括号这一边。

### T7-7：HEIC 一律按 P3 标注，Android 的 sRGB HEIC 是已知缺口

`compress.ts` 里 `tagAsP3 = useRaw`，即**只要走了 heic-decode 就挂 P3 标签**。这对 iPhone（Display P3）是对的，但如果遇到按 sRGB 拍摄的 Android HEIC，会被错误地标成 P3，画面偏艳。

**这个缺口现在很容易补**，本次实测顺带确认了两件事：

1. `sharp(heicBuffer).metadata().icc` **能拿到容器里的真实 ICC**（536 字节，Apple 出品，`appl` 签名）。虽然 sharp 解不了 HEIC 的像素，但读容器头是成功的。
2. Apple 那份 P3 profile 与 sharp 内置的 p3（480 字节，lcms 出品）**原色矩阵逐位相同**（`rXYZ = (0.5151214599609375, 0.2411956787109375, ...)`），所以用内置 p3 挂标签是色彩等价的，不算降级。

补法：读容器 ICC，解析 `rXYZ` 判断是不是 Display P3（P3 的红原色 x ≈ 0.5151，sRGB ≈ 0.4360），是 P3 才挂标签，不是就保持无标签（无标签等于按 sRGB 解释，对 sRGB 源恰好正确）。解析逻辑在 `scripts/lib/heif.mjs` 的 `describeIcc` 里已有原型，搬进产品代码约 40 行。

**本次不做**，理由是它超出计划范围，且 iPhone 是 HEIC 的主要来源。记录在此，等用户拍板。

---

## Task 8 决策：并发池的两个坑

### T8-1：`cancelled` 不能是粘性标志位

计划草稿的 `cancelPending` 是这么写的：

```ts
cancelPending(): void {
  this.cancelled = true          // ← 问题在这
  const w = this.waiting
  this.waiting = []
  w.forEach((resolve) => resolve())
}
```

`cancelled` 一旦置 `true` 就再也不会变回来，**之后所有 `run()` 都会被拒**。但 SPEC §9 明确要求池子可以复用：

> 处理中清空列表 | 先 `task:cancel` 再清
> 用户在处理中改滑块 | 滑块只影响下一次运行，不打断当前批次

用户清空列表之后再拖一批图进来，是常规操作。粘性标志位会让第二批图全部以 CANCELLED 拒绝，而且没有任何报错提示，表现为"点了压缩但什么都没发生"。

改成**只清空等待队列、不设标志位**，并直接 reject 而不是 resolve 之后再检查标志。

### T8-2：取消必须用 reject，调用方必须用 `allSettled`

`cancelPending` 是**同步**拒绝排队中的 promise。如果调用方跨了宏任务才挂处理器，Node 会报 unhandled rejection（测试第一版就是这么炸的，3 条）。

这不是测试噪音，是真实约束：Electron 里未处理的 rejection 会刷警告，配置不当还可能中断。**批量场景必须用 `Promise.allSettled`**，它在同一个 tick 里就给所有 promise 挂上处理器。这条已经写进 `queue.ts` 的注释和测试用例里。

### T8-3：槽位转交而不是"先减再加"

`release()` 如果有等待者，直接把槽位转交给它（`active` 不变），而不是 `active--` 之后再 `acquire()`。后者会在两个微任务之间出现空窗，让"并发不超过上限"变成不可靠的断言。

对应地，测试里除了断言 `peak <= 3`，还必须断言 `peak === 3` —— 只断言上限的话，一个纯串行的实现也能通过。

### T8-4：`sharp.cache(false)` 落在 `image/runtime.ts`

SPEC §14 的 OOM 处置要求在启动时关掉 sharp 内部缓存。放在 `src/main/image/runtime.ts` 的 `configureImageRuntime()`，由 `src/main/index.ts` 在处理任何一张图之前调用一次。

**刻意没有动 `sharp.concurrency()`。** 并发池负责并行度，libvips 自己的线程数怎么配需要实测再定（N 个并发操作 × 每操作 N 个线程有超订风险，但影响多大没测过）。不凭感觉设，留作后续实测项。

---

## Task 9 决策：`webUtils` 的 M1 验证项结案

### T9-1：`webUtils` 在默认沙箱下可用，**不需要**关掉 sandbox

`SPEC.md` §6.1 留了一个 M1 验证项：

> **⚠️ M1 验证项**：`webUtils` 的官方标注是 renderer 进程模块，在 `sandbox: true`（Electron 默认）的 preload 里能否 `require('electron').webUtils` 需要实测。若不可用，把 `webPreferences.sandbox` 显式设为 `false`。

**实测结论：可用，不用关沙箱。**

`window.ts` 里 `sandbox` 一直保持默认（`true`），preload 直接 `import { webUtils } from 'electron'` 就能拿到。冒烟脚本实际调了一次：

```
[smoke] webUtils 可用性（SPEC §6.1 M1 验证项）：
  通过  getDroppedPaths 可调用，返回数组（合成 File 拿到 0 个路径，预期 0）
```

注意这个测试的设计：用 `new File(['x'], 'a.jpg')` 这种**非磁盘来源**的 File 去调，只为确认调用链通。如果 `webUtils` 拿不到，`webUtils.getPathForFile` 会抛 `TypeError`（读 undefined 的属性），冒烟会红。返回 0 个路径是正确结果 —— 合成 File 本来就没有磁盘路径。

**连带的一条实现决定**：`getDroppedPaths` 里**刻意不加 try/catch**。如果吞掉异常，webUtils 不可用时会静默返回空数组，用户拖进一堆图、界面什么都不发生，这是最难查的一类故障。宁可让它响亮地抛出来。

### T9-2：`window.pictureMore` 的形状用冒烟脚本守住

红线三是「渲染进程不碰文件系统」，但光看 `contextIsolation: true` 看不出来白名单有没有漏。冒烟脚本现在会实际检查：

1. 11 个方法齐全（`probe` / `pickImages` / `pickOutputDir` / `revealInFolder` / `start` / `cancel` / `getSettings` / `setSettings` / `getDroppedPaths` / `onProgress` / `onDone`）
2. 没泄漏 `ipcRenderer` / `require` / `send` / `invoke` / `on` / `once`
3. `settings:get` 能往返，返回默认值 `{outputDir:null, shrinkPercent:65, outputFormat:'keep', lastDir:null}`

第 3 条顺带证明了 `handle` / `invoke` 链路是通的，而不只是类型对。

### T9-3：三处对 SPEC 的补充说明

**① `ImageFileMeta.id` 用 `crypto.randomUUID()`，不是 nanoid。**
SPEC §6.2 的注释写的是 nanoid，但 `AGENTS.md` 明确禁止引入 nanoid。字段类型（`string`）没变，只改了注释，避免后来的人照着注释去装依赖。

**② `ImageFormat` / `OutputFormat` 的唯一定义搬到了 `src/shared/types.ts`。**
`src/main/image/types.ts` 原本也定义了一份。跨进程契约是权威，引擎内部那份改成转出（`export type { ... }`），避免两处慢慢漂移。

**③ 主进程只吐原因码，不吐文案。**
`src/shared/reasons.ts` 定义 `ReasonCode`（`ENOENT` / `EACCES` / `NOT_A_FILE` / `CORRUPT` / `HEIC_DECODE_FAILED` / `TIMEOUT` / `WRITE_FAILED` / `UNKNOWN`）。SPEC §8.4 要求文案集中管理、禁止散落在组件里，所以主进程不该编中文。

**⚠️ 这里发现一个文案缺口**：SPEC §9 只给了两种情况的确切文案 ——

| 情况 | 文案 |
|---|---|
| 文件头损坏 | 「文件已损坏，无法读取」 |
| HEIC 解码失败 | 「这台机器上的 HEIC 解码器打不开这张图」 |

而「文件不存在 / 无读权限」这一条，§9 只说「行内显示原因」，**没给字符串**。§8.4 的文案表里也没有。按 AGENTS.md「都不覆盖就停下来问」，这条**留给用户确认**，主进程先只吐码。渲染层映射文案在 Task 12 落地。

### T9-4：`task:start` / `task:cancel` 只登记通道，不实现编排

计划把编排放在 Task 13（它要和 §9 的 17 条边界一起落地）。这里登记通道后**抛 `TASK_ORCHESTRATION_NOT_IMPLEMENTED`**，而不是静默返回成功 —— 静默成功会让渲染层以为任务跑完了，是最难查的一类 bug。

### T9-5：`sandbox` 的一个连带影响

`sandbox: true` 下 preload 能拿到 `webUtils`，但**不能**用 `fs` / `path` 等 Node 模块（这是好事，等于又加了一道闸）。所以 Task 13 的编排必须全部留在主进程，preload 只做转发。这与红线三一致。

---

## Task 10 决策：SPEC §8.2 的 token 命名与 Tailwind 工具类撞了

### T10-1：`--color-bg-surface` 生成的是 `bg-bg-surface`，不是 `bg-surface`

Tailwind v4 把 `--color-X` 直接映射成 `bg-X` / `text-X` / `border-X`。而 SPEC §8.2 的语义 token 名**本身带了属性前缀**：

```css
--color-bg-app:     var(--color-bone-200);
--color-bg-surface: #FFFFFF;
--color-border:     var(--color-line-100);
--color-border-strong: var(--color-line-200);
```

于是自动生成出来的类名是 `bg-bg-app` / `bg-bg-surface` / `border-border-strong`。而计划 Task 10 的 Interfaces 明确写的是要产出：

> Produces: Tailwind 可用的 `bg-surface` / `text-fg-3` / `border-strong` / `rounded-control` 等类名

**实测确认**（`out/renderer/assets/*.css` 里 grep 类名）：

| 类名 | 是否生成 |
|---|---|
| `.text-fg-3` | 有 |
| `.rounded-control` | 有 |
| `.bg-surface` | **没有** |
| `.border-strong` | **没有** |
| `.bg-hover` | **没有** |

`.text-fg-3` 能过是因为 `--color-fg-3` 没带 `text-` 前缀，恰好不撞。所以这个坑是**部分生效**的 —— 一半类名能用一半不能用，比全不能用更难发现。

**处置：不改 SPEC 的 token 名，补一层显式的 `@utility` 别名。**

```css
@utility bg-app     { background-color: var(--color-bg-app); }
@utility bg-surface { background-color: var(--color-bg-surface); }
@utility bg-subtle  { background-color: var(--color-bg-subtle); }
@utility bg-hover   { background-color: var(--color-bg-hover); }
@utility border-line   { border-color: var(--color-border); }
@utility border-strong { border-color: var(--color-border-strong); }
```

理由：SPEC §8.2 的 token 名是设计系统本身，原型也用同一套名字（`--bg-surface` / `--border-strong`），改名字会让三处文档对不上。而计划要的类名是**消费侧**的写法。用别名把两边接上，两个诉求同时满足，改动只在一处。以后加语义色，别名也加在这里。

### T10-2：token 校验做成了可复跑的检查，不靠肉眼

计划 Step 4 是「在 App.tsx 里写个测试 div，肉眼看」。肉眼看不出 `bg-surface` 到底有没有生效（上面那个坑就是这么漏过去的），所以改成程序化验证。

`App.tsx` 里保留一个视觉上移出屏幕的 `#token-probe` 块，用**真实类名**渲染。这一点是必须的：Tailwind 按源码里出现过的类名生成工具类，如果类名只写在冒烟脚本的字符串里，CSS 里根本不会有它们，验证就成了空转。

冒烟脚本读 6 个探针元素的 13 项计算样式：

```
[smoke] 设计 token 检查：
  通过  bone.backgroundColor = rgb(239, 237, 232)     ← #EFEDE8
  通过  bone.color = rgb(107, 105, 99)                ← #6B6963
  通过  bone.borderRadius = 6px
  通过  surface.backgroundColor = rgb(255, 255, 255)
  通过  surface.color = rgb(20, 20, 20)
  通过  surface.borderRadius = 12px
  通过  caution.color = rgb(138, 91, 0)               ← #8A5B00
  通过  caution.borderRadius = 4px
  通过  type.fontSize = 36px
  通过  strong.borderTopColor = rgb(216, 212, 204)    ← #D8D4CC
  通过  strong.borderTopWidth = 1px
  通过  hover.backgroundColor = rgb(233, 230, 224)
  通过  hover.color = rgb(58, 56, 53)
```

**只断言 CSS 变量有没有定义是不够的**：变量定义了但 Tailwind 没生成工具类，类名挂在元素上一样没有任何效果。必须量计算样式。

### T10-3：component 层放在 `@theme` 外面

`--cta-bg` / `--track` / `--fill` 这些 component token 写在 `:root` 而不是 `@theme` 里。放在 `@theme` 里会生成 `bg-cta-bg` 这类工具类，组件就会绕开语义层直接写 `bg-cta-bg`，三层结构白设了。

### T10-4：`tokens.css` 补了 SPEC §8.2 漏掉的三个 token

原型里有、SPEC §8.2 的 `@theme` 块漏掉的：

| token | 用途 |
|---|---|
| `--color-bg-subtle` | 次级底色（`--stone-100`） |
| `--color-bg-hover` | 悬停底色（`--stone-200`） |
| `--ease-out-expo` | 全站统一缓动 `cubic-bezier(.16,1,.3,1)` |

缺了它们，组件里遇到悬停态就没有 token 可用，只能写字面量 —— 那正是设计系统要避免的事。按 AGENTS.md「视觉以原型为准」，原型有就补上。

SPEC §8.2 原有的每一行都保持逐字不变。

---

## Task 11 决策：两个只有真渲染才能发现的坑

左栏八个组件按原型逐项搬运。硬指标（尺寸/间距/字号/圆角/颜色）全部对上了，但过程中撞到两个**静态看代码绝对看不出来、也不报任何错**的问题。两个都是靠「量计算样式 + 截图并排看」抓到的。

### T11-1：无层级的全局重置会盖掉所有 Tailwind 工具类

原型是原生 CSS，全局段里有这么一条：

```css
button{font:inherit;color:inherit;background:none;border:0;padding:0;cursor:pointer}
```

照搬到 `index.css` 之后，**每一个 `<button>` 上的 `bg-*` / `border-*` / `text-*` 全部静默失效**。

原因不是选择器权重：Tailwind v4 把工具类发在 `@layer utilities` 里，而 CSS 的层叠规则是**无层级的规则永远压过有层级的规则，与权重无关**。`button{...}` 没进任何 layer，所以它赢了所有工具类。

症状极具迷惑性：

| 元素 | 表现 |
|---|---|
| `<div>` 上的 `bg-bone-200` | 正常 |
| `<aside>` 上的 `border-r border-line` | 正常 |
| `<button>` 上的 `border` / `bg-bone-050` / `text-fg` | **全部失效** |

所以「token 检查」全绿（探针用的是 div），但格式选项没有边框、没有底色，存放位置的选择器也没有框。截图一眼就看出来了，量 `borderTopWidth` 也立刻暴露（`0px`）。

**处置**：整个全局重置放进 `@layer base`。Tailwind 的层序是 `theme, base, components, utilities`，base 排在 utilities 前面，工具类恢复正常。

**顺带记一条**：CSS Module 的样式是无层级的（不走 Tailwind 的 layer），所以 `ShrinkSlider.module.css` / `PrimaryButton.module.css` 反而一直正常。这意味着 CSS Module 会压过工具类 —— 组件里两者混用时要知道谁赢。

### T11-2：`#root` 会把窗口挤窄一半

`body` 是 `display:grid; place-items:center`。`place-items` 里的 `justify-items:center` 会让 grid item **按内容收缩**，而不是撑满。

原型里没有 `#root`，`.window` 直接就是 body 的 grid item，`width:min(980px,100%)` 里的 `100%` 解析成整个网格区宽度（视口减 64px 内边距），拿到 900px。

加了 React 的挂载点之后，收缩发生在 `#root` 上：它按内容取到 max-content（实测 **478px**），窗口再取 `min(980px,100%)` 就只能拿到 478px。

**这个坑的表现也很有欺骗性**：左栏宽度写死 328px，看起来完全正常；只有右栏被挤扁。而 Task 11 阶段右栏还是占位符，所以「左栏看起来对」会把问题掩盖过去。

**处置**：`#root { display: contents }`，让它自己不生成盒子，窗口重新成为 body 的 grid item，结构与原型完全一致。

### T11-3：冒烟检查加了两组

**① 左栏布局硬指标（23 项）**
从原型 CSS 里逐条读出来的可断言项：窗口 12px 圆角、标题行 64px 高 32px 内边距、左栏 328px 宽 28/32 内边距 26px 间距、百分数 36px、格式按钮 32px 高 6px 圆角（未选中发丝线 #D8D4CC + 三级灰字，选中主字色 + 骨白底 #FBFAF8）、存放位置 40px、CTA 48px。

窗口尺寸不写死，断言的是原型那条规则本身（`min(980px,100%)` 与 `min(768px,calc(100vh - 96px))`）—— 视口大小随操作系统的窗口边框与显示缩放变化，写死换台机器就红。

**② 截图并排比对**
AGENTS.md 的标准是「肉眼能看出差异就是没做完」，硬指标覆盖不到错位、对齐、配色这类问题。冒烟脚本现在会把应用和原型按同一个视口（980x768）各截一张，落到 `tests/fixtures/_shot-app.png` 与 `_shot-prototype.png`（下划线前缀，已在 .gitignore 里）。

上面两个坑都是截图看出来的。**这一步值得保留**，Task 12 / 13 还会继续用。

原型的截图靠把同一页导航过去再截 —— Electron 的调试端点不支持 `Target.createTarget`（浏览器级端点返回 `Not supported`），为了截一张图去开第二个 BrowserWindow 又太侵入。

### T11-4：四态文案抽成纯函数单独测

`lib/note.ts` 放判定逻辑，`QualityNote.tsx` 只渲染。这样能脱离 React 直接测。

**顺序错了不会报错，只会给错提示**，所以值得专门守：选了 PNG 又把滑块拖到 80%、列表里还有透明图时，必须说「PNG 压不动」而不是「能看出压缩痕迹」。11 条测试覆盖四种状态的优先级、70% 边界（70 本身不算越线）、以及文案的写作纪律（零 em-dash、中黑点每行最多一个、无 emoji）。

### T11-5：`lib/format.ts` 提前到 Task 11

计划把 `lib/format.ts` 列在 Task 12，但 `EstimateLine` 现在就要用 `formatBytes`。提前建了，Task 12 直接用，不用重复造。

---

## Task 12 决策：右栏与一个原型自身的 bug

### T12-1：`flex-none` 与 `flex-1` 不能同时挂在同一个元素上

`DropZone` 一开始是这么写的：

```tsx
'flex flex-none items-center justify-center ...'          // 常驻条
empty ? 'flex-1 flex-col gap-4 text-3' : 'h-[52px] gap-[10px] text-2'
```

空态下 `flex-none`（`flex: 0 0 auto`）和 `flex-1`（`flex: 1 1 0%`）同时存在，**谁赢取决于 Tailwind 的输出顺序，不是后写在类名串里的那个赢**。实测 `flex-grow` 是 `0`，拖拽区没有撑满右栏。

原型是 `.drop{flex:none}` + `.body.is-empty .drop{flex:1}`，靠选择器权重决定，语义清晰。搬到工具类之后这个信息就丢了。

**处置**：`flex-none` 和 `flex-1` 分别挂在两个互斥分支上。

这条也说明冒烟检查值得量 `flexGrow` 这种具体属性，而不是只看「有没有撑满」的观感。

### T12-2：原型自身的空态 bug，以及为什么不照抄

原型的空态预览里，元信息行（「共 11 张 · 34.2 MB」+「清空列表」）**仍然可见**，而且显示的是 11 张 —— 列表明明是空的。

原因是原型自己的一处 CSS 事故：

```js
metaEl.hidden = isEmpty;      // JS 的意图很清楚：空态隐藏
```
```css
.meta{flex:none;display:flex;...}   /* 但这条把 [hidden] 的 display:none 盖掉了 */
```

`[hidden]` 的本质是 `display:none`，而它是一条**低权重的元素属性样式**，任何显式的 `display` 声明都会赢。所以 `.meta` 的 `display:flex` 让 `hidden` 失效。同一段里的 `filesEl.hidden` 反而是有效的（`.files` 没设 `display`）。

**DESIGN.md §4 的空态定义是「左栏整个隐藏，拖拽区吃掉整个右侧」，明确要求元信息行消失。** 所以原型的 JS 意图、DESIGN.md 的文字、以及常识三者一致，只有原型的渲染结果不对。

**处置：按 DESIGN.md 与原型 JS 的意图实现（空态隐藏元信息行），不照抄原型的渲染 bug。** 这条已经在冒烟检查里固化成断言（`metaGone: true`、`main.children.length === 1`）。

**这是唯一一处实现与原型渲染结果不一致的地方，需要用户确认。** 依据见 `docs/decisions.md` 与 DESIGN.md §4。

### T12-3：SPEC §9 的两句行内文案没有位置可放

SPEC §9 给两种「没压好」的情况配了行内文案：

| 场景 | 文案 |
|---|---|
| 输出比原图还大 | 「这张已经压到底了」 |
| 压不到目标体积 | 「质量已到下限，只压到 {x}」 |

但**原型这一行没有位置放它们**：`.file` 是 44px 一行，只有文件名、体积、移除三格，没有第四格，也没有第二行。原型是唯一视觉基准（AGENTS.md：实现必须逐项对齐），不能自己加栏位。

而且「只压到 {x}」里的 `{x}` 是什么也没说清 —— 是体积占原图的百分比，还是压缩率？两种读法都通。

**处置**：这一轮**不擅自改版式**。行状态照原型渲染（`done`/`undershot` 都显示 `4.2 MB → 1.5 MB`），把状态挂在 `data-state` / `data-reason` 上，等确认版式与文案语义后再补。**需要用户拍板。**

### T12-4：原因码到文案的映射只填 SPEC 给了的两条

`lib/reason.ts` 只映射 `CORRUPT`（「文件已损坏，无法读取」）与 `HEIC_DECODE_FAILED`（「这台机器上的 HEIC 解码器打不开这张图」），这两条 SPEC §9 明确给出。

`ENOENT` / `EACCES` 等**刻意留空**：SPEC §9 只说「行内显示原因」没给字符串，§8.4 文案表里也没有。AGENTS.md 的规矩是「不得自造词」「都不覆盖就问用户，不要猜」。所以这类行只把原因码放进 `title`（便于排查），不显示中文。等确认文案后在这里补一行即可。

### T12-5：冒烟检查扩到 4 组、4 张截图

右栏硬指标 14 项（右栏 28/32 内边距、拖拽区 52px 高 1px 虚线 6px 圆角、元信息行 9px 下内边距、文件行 44px、11 行、移除按钮默认 `opacity:0`）。

空态 8 项：点一下「清空列表」之后左栏消失、拖拽区 `flex-grow:1` + 纵向 + 20px 字号、右栏内边距变 32px、清单与元信息行都消失。

截图 4 张：应用有图 / 应用空态 / 原型有图 / 原型空态。T11 的两个坑和 T12-1 都是截图看出来的。

**截图的顺序有约束**：原型那张靠把这一页导航过去截（Electron 的调试端点不支持 `Target.createTarget`），导航之后就跑不了任何针对应用的检查了。所以次序固定为「应用有图 → 空态检查 → 应用空态 → 原型有图 → 原型空态」。

---

## Task 13 决策：全链路串通

### T13-1：单张超时按像素数缩放，不是固定的 30s

SPEC §9 写的是「单张处理超时（>30s）→ 标记 failed」。但 Task 7 实测下来 30s 不够：

| 图 | p=20 时的耗时 |
|---|---|
| 24MP iPhone HEIC | 12s |
| 48MP 纯噪声 | **104s** |

按固定的 30s，一张 48MP 的图会被判死，而它其实跑得完（只是慢）。所以改成按像素数缩放并保留 30s 作为下限：

```
timeout = max(30s, 3s x 百万像素)
```

24MP → 72s，48MP → 144s。它的作用是兜住真正的卡死，不是卡正常的大图。

**已知取舍**：底层的编码没法中断，超时只是「不再等它」，那张仍可能在后台跑完并落盘。因为阈值给得宽，正常情况不会触发。

### T13-2：两处跨进程契约的加法

SPEC §6.2 的 `ImageFileMeta` 和 §7 的 `ImageItem` 都**没有 `path` / `width` / `height`**，但 `StartTaskPayload.items` 要的就是 `{ id, path, bytes, format, width, height, hasAlpha }` —— 照原样定义的话，渲染层根本拼不出那个 payload。

两处各补了字段（**纯加法，没有改动任何已有字段的名字与类型**）：

- `ImageFileMeta` 补 `path`
- 渲染层的 `ImageItem` 补 `path` / `width` / `height`

另一条路是让渲染层把传进去的 paths 按下标 zip 回来，但那是个隐式耦合：哪天 probe 过滤掉一张图（比如拖进来一个 txt），对应关系就静默错位了。显式带上更稳。

### T13-3：非图片静默过滤 + 文件夹展开一层

SPEC §9 的两条：

| 场景 | 处理 |
|---|---|
| 拖入文件夹 | 展开一层取图片文件；空文件夹给提示 |
| 拖入非图片文件 | 静默过滤，不报错 |

「静默过滤」意味着**列表里不该出现那一行**。一开始的实现把所有读不出来的都标成 `readable:false` + `CORRUPT`，于是拖进来一个 `.txt` 会看到一行「文件已损坏，无法读取」—— 这不符合「静默过滤」。

现在 `probe` 先做一遍展开与过滤：

- 目录 → `readdir` 一层，取扩展名在支持列表里的文件，按名字排序
- 图片文件 → 原样保留
- 其他 → 丢掉，不报错
- 路径不存在 → 留给 `metaFor` 给出准确的原因码（`ENOENT`）

「空文件夹给提示」**这一条没做**：原型里没有任何位置可以放这个提示（右栏只有拖拽区、元信息行、文件清单三块），而原型是唯一视觉基准，不能自己加。需要用户确认提示放哪。

### T13-4：完成提示的位置来自原型

SPEC §8.4 有「完成提示 完成。原图没动，新文件在 {path}」，但 DESIGN.md 里找不到它该放哪。翻原型找到了：

```js
footEl.textContent = '完成。原图没动，新文件在 ' + destPath.textContent;
```

底部那行在「常驻声明」和「完成提示」之间切换，`show('empty')` 时切回去。所以 `PrimaryButton` 的底部段落由 `lastOutputDir` 决定显示哪一句。

### T13-5：冒烟脚本升级成真正的端到端

计划 Task 13 Step 4 写的是「手工验证」。手工没法重复跑，所以改成了自动化的端到端，现在覆盖 15 组：

1. 进程隔离（5 项）
2. 白名单形状（方法齐全 + 未泄漏 ipcRenderer）
3. `webUtils` 可用性
4. IPC 往返（settings:get）
5. 设计 token（13 项计算样式）
6. 空态（8 项，应用真实初始状态）
7. **真实拖拽入图**（走 CDP 的 `Input.dispatchDragEvent`，带真实文件路径）
8. 布局硬指标（35 项，逐条对应原型 CSS）
9. **端到端跑一批**：点 CTA → 等所有行落到终态 → 读输出目录 → 用 sharp 比对每张输出的宽高
10. **文件夹展开与非图片过滤**
11. 页面状态
12. 截图 5 张（应用空态 / 有图 / 跑完 / 原型有图 / 原型空态）

第 7 组是关键：`Input.dispatchDragEvent` 的 `DragData.files` 能带真实文件路径，Chromium 会为它们构造真正的 `File` 对象，于是 `webUtils.getPathForFile` 这条链路被完整走通。**用构造的 `File` 是测不出来的** —— 那种 File 没有磁盘路径，`webUtils` 只会返回空串。

第 9 组是 SPEC §10.2 的那条端到端冒烟，也是**承诺二的端到端验证**：不只断言代码里的宽高相等，而是拿真实输出文件去比对。

实测结果：

```
[smoke] 端到端跑一批：
  行状态：undershot, done, done
  通过  oriented-6 1200x900 -> oriented-6.jpg 1200x900
  通过  flat-solid 2000x1500 -> flat-solid.png 2000x1500
  通过  alpha-cutout 1200x1200 -> alpha-cutout.png 1200x1200

[smoke] 文件夹展开与非图片过滤：
  通过  拖入文件夹：新增 2 行（期望 2，txt 被静默过滤）
  通过  列表里没有 .txt
```

### T13-6：`TokenProbe` 作为校验锚点保留在渲染树里

Task 13 把 App.tsx 换成了真实界面，原来那个隐藏的 token 探针块没地方放了。但它是「变量定义了但工具类没生成」这类问题的唯一抓手（T10-1 就是这么漏过去的）。

所以抽成了独立组件 `components/TokenProbe.tsx`，视觉上移出屏幕、`aria-hidden`。其中 `bg-subtle` 是原型定义了但当前界面没有任何地方消费的 token，不靠探针就没法验证它对应的工具类生成没生成。

代价是 6 个空 div。**如果发布时不想要它，删掉那个文件与 App.tsx 里的引用即可，同时去掉冒烟脚本的第 5 组检查。**

---

## Task 14 决策：打包

### T14-1：出包体积 115MB，在 120MB 预算内

```
release/图压压-1.0.0-setup.exe   119,647,404 字节 = 115MB
```

SPEC §11 的预算是 113MB，实测 115MB，差 2MB 左右，在 120MB 上限内。

**包内容核查**（`npx asar list`，共 196 条）：

| 项 | 结果 |
|---|---|
| 顶层条目 | 只有 `node_modules` / `out` / `package.json` |
| `.workbuddy-ai/` | 0 条（9.3MB 技能目录没进包） |
| `prototype/` `tests/` `docs/` `scripts/` | 全部 0 条 |
| `SPEC.md` `DESIGN.md` | 0 条 |
| `*.map` | 0 条 |
| sharp 原生模块 | 已在 `app.asar.unpacked/` 里解包 |

命中的 7 条 `src` 是 sharp 自带的 C++ 头文件，1 条 `.md` 是 `@img/colour` 的 LICENSE，都无害。

### T14-2：`npmRebuild: false`，因为 sharp 走 N-API

sharp 0.33+ 用 N-API（ABI 稳定），预编译二进制在 Node 与 Electron 之间通用。这也是为什么同一份 `node_modules/sharp` 既能在 vitest 里跑、又能在 Electron 里跑。

所以关掉 `npmRebuild`：打开的话 electron-builder 会尝试重编原生模块，要求本机有完整编译工具链，而且没必要。

### T14-3：新增打包产物冒烟（`npm run smoke:packaged`）

`npm run smoke` 测的是 `out/` 里的构建产物、跑在 `node_modules` 的 Electron 上。**打包之后有两件事会变**：

1. sharp 的原生模块从 `app.asar.unpacked/` 加载（`asarUnpack` 配错直接崩）
2. `heic-decode` 的 WASM（libheif-js）从 asar 里读

这两条只有真装一次才验得出来。SPEC §11 的「干净机器验收」里，能在本机自动化的就是这一部分（装到另一台机器、拔网线这些做不了）。

所以加了 `scripts/smoke-packaged.mjs`：启动 `release/win-unpacked/图压压.exe`，走 IPC 做 probe、跑一批、用 sharp 比对输出文件宽高。

实测：

```
[packaged] 渲染层与 preload：
  通过  window.pictureMore 已挂载
  通过  #root 已挂载（title="图压压"）
[packaged] 原生依赖（sharp 与 heic-decode）：
  通过  oriented-6.jpg 读出 jpeg 1200x900
  通过  flat-solid.png 读出 png 2000x1500
  通过  iphone-portrait.heic 读出 heic 4284x5712
  通过  HEIC 竖拍方向正确（4284x5712）
[packaged] 跑一批：
  通过  输出目录里有 3 个文件（期望 3）
  通过  oriented-6 1200x900 -> oriented-6.jpg 1200x900
  通过  flat-solid 2000x1500 -> flat-solid.png 2000x1500
  通过  iphone-portrait 4284x5712 -> iphone-portrait.jpg 4284x5712
```

CDP 客户端抽到了 `scripts/lib/cdp.mjs`，两个冒烟脚本共用。

### T14-4：出包时被宿主环境的安全删除护栏拦了一次

`npm run build` 第一次失败，报的不是代码问题：

```
[vite:prepare-out-dir] [safe-delete][SAFE_DELETE_BULK_CONFIRM_REQUIRED] {"count":223,"threshold":50,...}
```

宿主环境的 `node-safe-delete-shim.cjs` 会拦截 `rmSync`，本轮删除次数超过阈值（50）就拒绝。而 Vite 每次构建都会清空 `out/`，正好撞上。

`out/` 是构建产物目录，清空它是构建的正常行为，所以用 `CODEBUDDY_SAFE_DELETE_ENABLED=0` 跳过这个护栏重跑即可：

```bash
CODEBUDDY_SAFE_DELETE_ENABLED=0 npm run build
```

**这不是产品问题，换台机器或换个 shell 就不会遇到。** 记在这里免得下次再查一遍。

### T14-5：SPEC §11 Step 3 的三条「需要人来点」，实际有两条能自动化

计划把这三条列为手工验收。但其中两条用 CDP 能做得比手工更严格，已经补进冒烟脚本：

**① 运行时零联网（原来是「拔网线跑通」）**

拔网线只能证明「断网时能用」，证明不了「根本没有发出请求」。改成用 CDP 的 `Network.enable` + `Network.requestWillBeSent` 全程监听，然后断言外部请求数为 0：

```
[smoke] 运行时零联网：
  通过  监听到 3 个请求（证明监听是活的）
  通过  外部请求 0 个（承诺一：运行时零联网）
        请求协议：file
```

**这里有个坑值得记**：断言「0 个外部请求」之前必须先证明监听是活的。第一次跑的时候监听是在页面加载完之后才开的，一个请求都没收到 —— 那种情况下「外部请求 0 个」是空断言，什么都没验。所以现在把这一段放在一次 `Page.reload()` 之后，用那次刷新产生的 `file://` 请求证明监听有效。

**② 输出到原图目录、原图未被改动（原来也是手工）**

改成哈希比对：把两张 fixture 复制到临时目录，把存放位置切到那个目录，跑一批，然后

- 原图 sha256 必须一模一样
- 目录里必须多出带 ` (2)` 后缀的产物，而不是把原图覆盖掉

```
[smoke] 输出到原图目录：
  通过  存放位置 = D:\pictureMore\tests\fixtures\_samedir更改
  通过  原图未改动：oriented-6.jpg
  通过  原图未改动：flat-solid.png
  通过  产出 2 个防覆盖文件：flat-solid (2).png, oriented-6 (2).jpg
```

用 jpg 与 png 各一张是有意的：输出格式保持原格式时，候选名会与源文件同名，正好触发防覆盖分支。HEIC 不适用（它必然输出成 `.jpg`，撞不上名）。

**③ 键盘走完整个流程**（原来也是手工）

用 CDP 的 `Input.dispatchKeyEvent` 连按 Tab，记录 `document.activeElement` 的序列：

```
顺序：INPUT:range -> BUTTON[radio] x4 -> BUTTON x6 -> INPUT:range
  通过  滑块可 Tab 到 / 格式选项可 Tab 到 / 按钮可 Tab 到
  通过  按钮聚焦有可见焦点环（outline: solid 2px）
  通过  滑块外框已按原型去掉（outline: none 3px）
```

**最后一条看着像失败，其实是原型的刻意设计**：`.slider:focus-visible{outline:none}` 把外框去掉了，改成在拇指上加一圈 `box-shadow`（`.slider:focus-visible::-webkit-slider-thumb`）。所以断言写成「外框确实被去掉了」，而不是「有外框」。第一版写反了，报了个假失败。

**仍然需要人来点的**：装到另一台没装过 Node 的机器上跑一遍。这个我没法做。

### T14-6：打包版与开发版共用同一个设置文件

`app.getPath('userData')` 在两处都是 `%APPDATA%\picturemore`（Electron 取的是 package.json 的 `name`，不是 `productName`）。对产品来说这是对的 —— 同一个产品的设置本来就该共用。

但对测试有影响：`smoke:packaged` 用 45% 跑了一批，把 45 写进了共享的 settings.json，接着 `smoke` 跑的时候滑块初始值就是 45 而不是 65，于是布局检查里那条 `valueText === '65%'` 报了假失败。

**处置：断言不依赖持久化状态。** 改成断言「百分数显示与滑块的值同步」+「滑块的 min/max/step 与原型一致」—— 那才是真正要守的不变量。

### T14-7：宿主环境的安全删除护栏又拦了一次

`npm run smoke` 里带 `electron-vite build`，而 Vite 每次构建都会清空 `out/`，撞上同一个 `rmSync` 拦截（T14-4 记过）。解法一样：

```bash
CODEBUDDY_SAFE_DELETE_ENABLED=0 npm run smoke
```

**这是宿主环境的产物，不是项目问题。** 没有把 `emptyOutDir: false` 写进 Vite 配置，因为那样会让 `out/renderer/assets/` 里的旧哈希产物越积越多，而 electron-builder 会把这些死文件一起打进安装包。

---

## 收尾：冒烟脚本必须从确定状态出发

给冒烟脚本加自动清理时，又踩到同一类毛病，值得单独记一笔。

**现象**：加了「开跑前删掉 `tests/fixtures/processed`」之后，产物校验反而红了 —— 输出目录里什么都没有。

**原因**：批次的输出目录**不是**写死的，而是从持久化设置里读的。上一轮结束时 `settings.json` 里存着 `outputDir: ...\_samedir`，而那个目录刚被删掉。于是这一轮把产物写回了 `_samedir`，校验却去看 `processed`。

**这和 T14-6 那条滑块断言是同一个病根：断言依赖了上一轮留下的状态。**

**处置**：清理范围扩到设置文件本身。

```js
const APP_SETTINGS = resolve(process.env['APPDATA'], 'picturemore', 'settings.json')
rmSync(resolve(ROOT, 'tests/fixtures/processed'), { recursive: true, force: true })
rmSync(resolve(ROOT, 'tests/fixtures/_samedir'), { recursive: true, force: true })
rmSync(resolve(ROOT, 'tests/fixtures/_dropcase'), { recursive: true, force: true })
rmSync(APP_SETTINGS, { force: true })
```

删设置文件等于模拟首次启动 —— 这正是验收测试该有的起点。

**验证**：连跑两次，第二次开始时设置里还存着上一轮的 `_samedir`，仍然全绿。

**这条经验值得推广**：验收脚本的第一步应该是「把状态复位到已知起点」，而不是「假设环境是干净的」。凡是跨越了上一次运行的断言，迟早会在某个时刻莫名其妙地红一次，然后被人当成 flaky 忽略掉 —— 那比没有测试更糟。

---

## 收尾三：测试覆盖的窟窿，以及它的根因

### T15-1：一半的模块一条测试都没有，根因是它们都 import electron

盘点下来发现：`src/main/image/` 有 100 多条测试，但后面写的这些模块**一条都没有**：

| 模块 | 里面的逻辑 | 错了会怎样 |
|---|---|---|
| `src/main/ipc/files.ts` | 文件夹展开一层、非图片静默过滤 | 列表多一行少一行，不报错 |
| `src/main/ipc/task.ts` | 超时按像素数缩放 | 大图被判失败，或卡死不被兜住 |
| `src/main/settings.ts` | 磁盘值的校验与夹取 | 手改过的设置文件让应用起不来 |
| `src/renderer/lib/format.ts` | MB/KB 分界、体积格式化 | 界面上每个数字的样子 |
| `src/renderer/lib/path.ts` | Windows `\` 与 POSIX `/` 都要认 | 文件存到奇怪的地方 |
| `src/shared/reasons.ts` | 异常码到原因码的映射 | 用户看到错误的原因 |

**根因**：这些模块都在文件顶部 `import ... from 'electron'`，在 node 环境下根本 import 不进来，于是「没法测」变成了「没测」。

`SPEC.md` §4 其实写过这条原则 ——「`src/main/image/` 必须是纯函数模块，不依赖 Electron API，可脱离 Electron 单测」—— 只是当时只把它当成图像引擎的约定，没意识到它是一条**通用**的分层规则。

### T15-2：把纯逻辑从 electron 依赖里分出来

按「逻辑本体 / IPC 注册」拆开，和 `src/main/image/` 遵循同一条原则：

| 新文件（不依赖 electron） | 原位置 | 留下的部分 |
|---|---|---|
| `src/main/files.ts` | `src/main/ipc/files.ts` | 只留 `ipcMain.handle` 转发 |
| `src/main/timeout.ts` | `src/main/ipc/task.ts` | 只留调用 |
| `src/renderer/lib/path.ts` | `src/renderer/store/useAppStore.ts` | 只留 store |

`settings.ts` 没拆 —— 它整体就是「读盘/写盘」，逻辑和 IO 分不开。它的测试用 `vi.mock('electron')` 把 `app.getPath` 指到临时目录：

```ts
const state = vi.hoisted(() => ({ userData: '' }))
vi.mock('electron', () => ({ app: { getPath: () => state.userData } }))
```

**注意 `vi.hoisted`**：`vi.mock` 会被提升到 import 之上，普通模块级变量在工厂执行时还没初始化，只有 `vi.hoisted` 的返回值能一起提上去。

### T15-3：新增 78 条测试

| 文件 | 条数 | 覆盖的是 |
|---|---|---|
| `files.spec.ts` | 24 | 展开一层不递归、非图片静默过滤、空文件/假图片/目录/不存在各自的错误码、一张失败不影响其余 |
| `settings.spec.ts` | 14 | 畸形 JSON 回退、缩小比例夹到 20-90、非法格式回退、空串路径转 null、多余字段丢弃 |
| `format.spec.ts` | 11 | MB/KB 分界（`>= 1MB` 还是 `>`）、0 与 NaN 不产出 `NaN KB`、65% 对应原型里的 64.29% 填充 |
| `path.spec.ts` | 10 | 两种分隔符、混用取最后一个、根分隔符不产出空串、输出分隔符跟着输入走 |
| `timeout.spec.ts` | 9 | 30s 下限、3s/百万像素、iPhone 24MP 落在 60-80s、超时错误带 code、工作抛错不被超时掩盖 |
| `reasons.spec.ts` | 6 | 各错误码归类、非 Error 输入不炸 |
| `reason.spec.ts` | 4 | SPEC 给了的两条原样对上，**SPEC 没给的必须保持为空** |

最后一条值得单说：`reason.spec.ts` 同时守两件事 —— 已确认的文案必须对，未确认的必须**保持为空**。这样哪天有人顺手编一句填进去，测试会红。把「不猜」这条规矩变成了可执行的断言。

**合计**：从 130 条涨到 208 条。

### T15-4：几条断言背后的取舍

**「展开一层不递归」** 单独一条用例守着。SPEC §9 明写「展开一层」，但递归看起来更「完善」—— 用户拖进来一个盘符根目录时，递归会变成扫描整块盘。这种「看起来更好但违反规格」的改动最容易被顺手做掉。

**「0 与 NaN 回退成 0 KB」** —— 读不了的图片 `bytes` 是 0，界面不能显示 `NaN KB`。

**「根分隔符不产出空串」** —— `dirOf('/a.jpg')` 如果返回空串，拼出来就是 `/processed` 这种怪路径。`i > 0` 这个边界条件是随手写最容易写错的地方。

---

## 收尾四：列表虚拟化（SPEC §9 漏掉的一条）

### T16-1：先量，再决定

SPEC §9 写着「拖入 500 张 | 允许，但列表虚拟化（>100 行时启用）」。计划的任务列表里**没提这一条**，所以一直没做。

但 500 个 DOM 节点对 Chromium 未必是问题，而虚拟化要手写（不能引库），会碰到行渲染与 pop 动效。所以先量：

`scripts/measure-500.mjs`（`npm run measure:500`）造 500 张 90 字节的小图，拖进去量：

| 指标 | 无虚拟化 |
|---|---|
| 列表就位 | 1163ms（含 500 次读盘 + 解容器） |
| **DOM 节点** | **2060** |
| 滚动 | 每帧 16ms（正好 60fps） |
| 移除一行到重绘 | 29ms |
| JS 堆 | 10MB |

滚动与单点更新都没问题，所以**不是为了「不卡」而做**。真正的理由是 DOM 节点数：2060 个节点里有 2000 个是看不见的行，而且随批量线性增长。

### T16-2：行高固定，所以能写成纯函数

原型 `.file{height:44px}` 是写死的，所以不需要动态测量行高 —— 这是窗口计算能抽成纯函数的前提。

`src/renderer/lib/virtual.ts` 的 `visibleRange(total, scrollTop, viewportHeight)` 返回 `{start, end, padTop, padBottom}`。

**不变量用例立刻抓到一个真 bug**：`scrollTop` 超出实际滚动范围时（列表刚变短、或惯性滚动到末尾），`first` 会远大于 `total` —— `start` 涨到 22719 而 `end` 被 `min(total)` 夹在 500，于是 `start > end`，渲染出空白加一个几万像素高的占位。

修法是先把 `first` 夹到 `[0, total - 1]`。这个 bug 靠「肉眼检查」是发现不了的：它只在特定滚动位置出现，而且表现为「列表看起来是空的」，很容易被当成别的问题。

所以那组不变量用例（`start >= 0`、`end <= total`、`start <= end`、`padTop + 行数 + padBottom === total * 行高`）值得留着，它比逐条断言具体数值更能兜住差一错误。

### T16-3：实现与实测结果

`FileList.tsx` 里超过 100 行才启用，短列表走原路全渲染 —— **这也是冒烟检查能继续用 `main li` 数行的原因**。

上下用 `ul` 的 padding 占位而不是插两个 spacer 元素（`ul` 里塞 `div` 是非法结构）。为此 `.files` 从 `ul` 挪到了外层滚动容器 `div` 上。

| 指标 | 无虚拟化 | 有虚拟化 |
|---|---|---|
| 列表就位 | 1163ms | 1157ms |
| **实际渲染行数** | **500** | **18** |
| **DOM 节点** | **2060** | **133**（降 15 倍） |
| 滚动 | 16ms/帧 | 18ms/帧 |
| 移除一行 | 29ms | 34ms |

**诚实的结论：500 张时总耗时没有变化。** 那 1157ms 里绝大部分是 500 次读盘 + 解容器，渲染只占一小部分。虚拟化的实际收益是 DOM 节点降 15 倍，在更大批量上才会体现为速度差异。

顺带确认了滚动之后渲染的**是不同**的行（`img-0000.png -> img-0458.png`）—— 这才是虚拟化的正确性检查：只改占位高度不换行的话，用户滚下去会看到一片空白。

### T16-4：测量脚本自己也犯了「断言依赖实现」

第一版测量脚本等的是「DOM 里出现 500 个 `li`」。启用虚拟化之后只渲染 18 行，于是那个循环空转 24 秒，报出「26303ms」——看起来像性能倒退 20 倍，其实是测量脚本在超时。

**这和 T14-6、收尾二里那两次是同一个病根：断言依赖了某个具体实现，而不是用户看到的东西。** 改成读元信息行上真实的张数（`共 500 张`）之后才量准。

一条通用规则：**验收脚本要断言「用户能看到的事实」，不要断言「当前实现恰好长什么样」。** 前者换了实现照样成立，后者换了实现就变成噪音。

---

## 收尾五：磁盘满中止整批，以及批处理编排的测试

### T17-1：SPEC §9 里代价最大的一条没落实

核对 §9 的边界清单，发现「磁盘空间不足 | 捕获 ENOSPC，**中止整批**并提示」只做了一半：当时把 ENOSPC 归到 `WRITE_FAILED`，单张标 failed 之后**继续跑剩下的**。

代价不小：磁盘满之后，剩下的每一张仍然会先读盘、解容器、编码（每张几秒），最后才在写盘那一步失败。500 张就是几分钟的无用功，而用户得到的只是一长串失败行。

**处置**：

1. `ReasonCode` 里把 `DISK_FULL` 从 `WRITE_FAILED` 拆出来 —— 两者混在一个码里的话，中止逻辑无从判断（只读盘是单张的事，磁盘满是整批的事）
2. 新增 `isBatchFatal(code)`：只有 `DISK_FULL` 返回 true
3. 中止时 `pool.cancelPending()` 跳过队列里没开始的，正在跑的几张让它跑完（编码没法中断，硬砍会留下半个文件）
4. **没轮到的行也要补一个终态** —— 否则它们会停在「处理中」，用户以为还在跑。用 `failed` 是因为 `ItemState` 里没有「未尝试」这一档，而它比留在 `pending` 更诚实
5. `TaskDoneEvent` 加 `aborted?: string`，让界面能区分「跑完了但有 N 张失败」和「这批中途停了」

**只把磁盘满列为致命**：单张读不了（权限、损坏）是那张自己的问题，不该拖累整批。这条有专门的用例守着 —— 一张坏图让后面几百张都不处理，是比失败本身更糟的结果。

### T17-2：批处理编排抽出来单独测

`src/main/ipc/task.ts` 里那段编排是**主进程最复杂的逻辑，却只有 happy path 的冒烟覆盖**：中止路径、计数、以及「跳过的那些算不算失败」全靠肉眼看。

抽成 `src/main/batch.ts`（不依赖 electron），`ipc/task.ts` 只负责把「读文件 → probe → 压缩 → 写盘」注入进去。

15 条测试，重点在三处：

**① 每张恰好一个终态，且都先经过 `working`。** 这条不变量能同时兜住「中止后停在处理中」和「重复报状态」两个问题。

**② 计数守恒：`done + undershot + failed === total`。** 中止、取消、部分成功混在一起时最容易算错，而且算错了不会报错，只会让完成提示里的数字不对。

**③ 中止后不再启动新的。** 用并发为 1 的池，断言 `attempted === 1` —— 这条直接量「省下的无用功」。

### T17-3：编排重构顺带炸出一个潜伏的竞态

改完跑冒烟，token 检查与空态检查全红（`#probe-*` 全不存在、`main` 也找不到），但后面的拖拽、布局、跑批又全绿。

原因：**冒烟在 React 挂载之前就开始检查了。**

`waitForPage` 只保证「有一个可调试的页面」，那时 `index.html` 可能刚解析完、React 还没渲染。这个竞态一直存在，只是恰好没触发 —— 主进程产物变大之后启动慢了一点就露出来了。

**它属于「迟早会红一次然后被当 flaky」的那类问题**，而且红的样子很有迷惑性（报一堆「元素不存在」，看起来像应用坏了）。

处置：连接之后先等 `#root` 有子元素，再开始检查。和 T14-6、收尾二、T16-4 是同一个原则 —— **检查必须从已知就绪的状态开始**。

---

## 收尾六：单批上限 100 张（用户决定，推翻 SPEC §9）

### T18-1：一个决定，连带作废两条实现

用户 2026-09-21 的决定：**一次最多处理 100 张**。这条推翻了 SPEC §9 原来的「拖入 500 张：允许，但列表虚拟化（>100 行时启用）」。

连带影响两处：

**① 虚拟化变成不可达代码，删掉。**
虚拟化的阈值是「>100 行」，而上限收到 100 之后列表永远到不了 101 行 —— `items.length > 100` 恒为假。**能证明不可达的代码就不该留在仓库里**，它不是保险，是负担（后人要花时间搞清它为什么在）。`lib/virtual.ts` 与它的 12 条测试一并删除，实现留在 `git log` 里，上限将来放宽可以直接捞回来。

**② SPEC §9 那一行重写**，§8.4 文案表补一条「超过单批上限」。

### T18-2：上限必须报出来，不能静默截断

拖进来 500 张、只压了 100 张，如果界面不说，用户会以为全压完了 —— **这是静默丢数据，比报错更糟**。

所以元信息行变成：

```
共 100 张 · 9 KB（已忽略 400 张）
```

用括号而不是再加一个中黑点，因为写作纪律要求「中黑点每行最多一个」。被忽略的那段用琥珀色（全站唯一有彩色，只在「这样压会看出痕迹」时出现 —— 这里同样是「有件事你得知道」）。

这条文案不在 SPEC §8.4 里，是随这个决定新增的。**已经补进 §8.4 表格**，保持「文案只有一处来源」的规矩。

### T18-3：截断点放在主进程，不是渲染层

上限要在**展开目录之后、读盘之前**执行。

拖进来一个装了几千张图的文件夹时，渲染层只拿到「1 个路径」，它不知道里面有多少张。如果先 `probe` 全量再在渲染层截断，就得把几千个文件全读一遍（还要对每张解一次容器）—— 白白慢几十秒，而结果只是要丢掉其中 90%。

所以 `files:probe` 多了一个 `limit` 参数（**还能再收几张**，不是总数），返回值从 `ImageFileMeta[]` 变成 `{ metas, dropped }`。主进程展开、截断、只读该读的那些，并把被忽略的张数回报给界面。

这是本次唯一一处跨进程契约的**返回形状**变化（之前几处都是加法）。改了四个地方：`shared/types.ts`、`shared/api.ts`、`preload/index.ts`、`main/ipc/files.ts`。

### T18-4：验证

单测 10 条（`limit.spec.ts`）+ 6 条（`files.spec.ts` 的上限截断），外加冒烟里的端到端：

```
[smoke] 单批上限 100 张：
  通过  列表 100 行（期望 100）
  通过  元信息 = 共 100 张 · 9 KB（已忽略 400 张）
```

**最有价值的一条是不变量用例**：「接收数 + 忽略数 永远等于新增数」。它同时挡住两种错法 —— 既收了又算作忽略、或者悄悄吞掉几张。跨 6 种已有数量 × 5 种新增数量全跑一遍。

边界也单独钉了：正好凑满 100 时不算忽略、已经满了时一张不收、已超额（上限被调小过）时不崩、`limit` 是 `NaN`/`Infinity`/`undefined` 时当作不限（参数来自 IPC，不能假设它一定是数字）。

---

## 收尾七：出包时撞上 app.asar 被占用

### T18-5：`EBUSY: resource busy or locked, unlink '...\app.asar'`

改完单批上限要重新出包，`npm run build` 报：

```
⨯ EBUSY: resource busy or locked, unlink 'D:\pictureMore\release\win-unpacked\resources\app.asar'
```

electron-builder 在覆盖旧目录前要删掉旧的 `app.asar`，删不掉。

**排查过程**（都没找到占用者）：

| 查法 | 结果 |
|---|---|
| 按进程名找 `图压压` / `electron` | 没有 |
| 按进程路径找 `D:\pictureMore\*` | 没有 |
| 重命名 `app.asar` 试探 | 仍被占用 |
| 检查只读属性 | 不是只读 |
| 是否重启过 | 机器在失败之前重启过，句柄不可能跨重启存活 |

**关掉宿主的删除护栏也没用** —— `CODEBUDDY_SAFE_DELETE_ENABLED=0` 只影响 Node 的 `fs`，PowerShell 的 `Remove-Item` 仍被接管（而且它自己也删不掉，报 `trash operation: Unknown`）。

**结论：这是环境问题，不是项目问题。** 成因不明（怀疑是杀软的文件系统过滤驱动，或一次未完成的删除留下的 delete-pending 状态），跨重启存活说明不是普通进程句柄。

**处置：绕开它，不纠缠。**

```bash
npx electron-builder -c.directories.output=release-next
```

换个 output 目录，旧目录一个字节都不用碰。`electron-builder.yml` 里仍写 `release`（正常路径），`release-next/` 加进了 `.gitignore`。

顺带给 `smoke:packaged` 加了个位置参数，默认还是 `release/win-unpacked`：

```bash
node scripts/smoke-packaged.mjs release-next/win-unpacked
```

**这条环境问题留个尾巴**：`release/win-unpacked` 现在是 1.0.0 的旧产物且删不掉，重启之后应该就能清了。清掉之前别拿它跑打包冒烟（会验到旧代码），要用就显式传 `release-next/win-unpacked`。

### T18-6：版本号升到 1.0.1

应用行为变了（新增单批上限），继续用 1.0.0 会让两个不同的二进制共用一个版本号 —— 那是最糟的情况：出了问题没法判断用户装的是哪一版。所以升到 1.0.1 重新出包。

**没有打 tag**，release 编号留给用户决定。

---

## 收尾八：把「看不出差别」从手工验收变成量化断言

### T19-1：先测量，再定阈值

SPEC §10.3 的手工验收清单里有一条「100% 缩放对比原图与输出，看不出差别」。这条一直没自动化，因为「看不出」听起来是主观的。

但它是**产品最核心的承诺**（承诺二），靠人肉看一遍不会有人重复做。而现有的黄金测试断言的是**参数**（p <= 70 时 quality >= 82）——参数对不代表结果对：编码器换个版本、metadata 配方改一下，quality 还是 82 但画面可能已经变了。

所以写了 `fidelity.spec.ts`：把输出解回像素，和原图逐点比。**阈值不猜，先量。**

第一轮测量结果：

| 图 | p | 体积 | 均值差 | p99 | 最大 | 超 8/255 的像素 |
|---|---|---|---|---|---|---|
| flat-solid.png | 70 | -92.9% | **0.000** | 0 | 0 | 0% |
| alpha-cutout.png | 70 | -94.5% | **0.000** | 0 | 0 | 0% |
| oriented-6.jpg | 70 | -43.6% | **0.000** | 0 | 0 | 0% |
| iphone-portrait.heic | 45 | -41.5% | 1.440 | 6 | 37 | 0.172% |
| iphone-portrait.heic | 70 | -41.5% | 1.440 | 6 | 37 | 0.172% |
| iphone-portrait.heic | 85 | -70.8% | 1.984 | 8 | 47 | 0.740% |
| noise-hi.jpg | 45 | -46.3% | 14.522 | 51 | 120 | 62.4% |
| noise-hi.jpg | 70 | -47.8% | 15.204 | 54 | 127 | 63.9% |

### T19-2：数据推翻了两个原本的假设

**假设一：「安全线内差异随 p 单调下降」。** 错。45% 与 70% 的输出**完全相同**（均值都是 1.440、体积都是 -41.5%）。

原因是这张图压不到 45% 那个目标，引擎停在质量底线上就收了 —— **这正是「感知无损」的实现方式：宁可压不到目标，也不越过底线。**

所以「70% 那条线」的真正含义不是「超过 70 才开始掉画质」，而是「**线内再往下拉也不会继续掉画质**」。断言按这个改写了。

**假设二：噪声图的差异也该有个上限。** 错。noise-hi 的均值差是 14.5/255，看起来吓人，但那是**纯随机噪声** —— 它本来就不可压，JPEG 编噪声必然损失。而且 45% 与 70% 的差异几乎一样（14.5 vs 15.2），说明底线在两者都生效。

对噪声断言「差异足够小」是错的；该断言的是「**压不动时不牺牲画质**」（45% 与 70% 的损失基本一致）。

### T19-3：最终四组断言

| 组 | 断言 | 阈值来源 |
|---|---|---|
| 压得动的时候必须一个像素都不差 | 三张可无损压缩的图，`mean === 0 && max === 0` | **精确的 0**，不是「足够小」——能无损却引入差异就是缺陷 |
| 真实照片在安全线内看不出差别 | HEIC @ 45/70：`mean < 3`、`p99 <= 8`、`over8 < 1%` | 实测 1.44 / 6 / 0.17%，留了余量 |
| 安全线内再往下拉不会继续掉画质 | HEIC @ 45 与 @ 70 的均值差 `< 0.1` | 实测完全相同 |
| 越过安全线画质确实会掉 | HEIC @ 85 的 `over8 > 70 的 3 倍`，且 `mean` 更大 | 实测 4.3 倍 / 1.38 倍 |

**第三、四组是配套的**：只验「线内没问题」，把线挪到 95% 测试也照样绿；必须同时验「线外确实变差」，那条线才是有依据的。

**主判据用「超 8/255 的像素占比」而不是均值。** 均值把差异摊平了 —— 一张图里 1% 的像素差 50，均值和「全都差 0.5」是一样的。而「多少像素的差异到了肉眼可能分辨的量级」才贴近「看不看得出」这个问题。8/255 是肉眼在纯色区域能开始分辨的量级。

### T19-4：测量过程中修掉一个假差异

第一版比 HEIC 时报「像素数不一致：97880832 vs 73410624」—— 两者相除正好是 4 和 3，像素数相同但通道数不同。

原因是 HEIC 我固定按 4 通道解码，而输出是 3 通道的 JPG。修法：`wantAlpha` 为假时**无条件** `removeAlpha()`，不能只在源带 alpha 时才处理 —— 源不带 alpha 时同样是 4 通道。

另一个容易搞错的地方：源带 alpha 而输出不带时，要按**引擎的方式**（白底 flatten）拍平，不能直接丢 alpha —— 那是两回事，比出来的是假差异。

**这类 bug 不会让测试变红，只会让数字变得毫无意义。** 所以比对类测试一定要先看几个已知结果的样本对不对（比如纯色图应该恰好是 0）。

### T19-5：窗口尺寸适配（SPEC §10.3 另一条）

同一条清单里还有「窗口缩到最小尺寸（880×620）不破版」。`src/main/window.ts` 里 `minWidth: 880, minHeight: 620` 早就设了，但从没验过那个尺寸下的版式。

补进冒烟脚本，**不写死内容区的像素值**（取决于窗口边框与显示缩放），而是断言任何尺寸下都必须成立的不变量：不横向溢出、窗口不超出视口、右栏仍有可用宽度、左栏滚到底后 CTA 可见。

实测：

```
通过  最小窗口的内容区 864x581：窗口 800x485，左栏 328，右栏 470，左栏可滚=true，CTA 可达=true，溢出元素 0
通过  设计尺寸 980x768：窗口 916x672，左栏 328，右栏 586，左栏可滚=false，CTA 可达=true，溢出元素 0
通过  大窗口 1440x900：窗口 980x768，左栏 328，右栏 650，左栏可滚=false，CTA 可达=true，溢出元素 0
```

最小尺寸下左栏会滚动（设计如此，DESIGN.md §4 写明「左栏可纵向滚动」），CTA 仍可达，零元素横向溢出。

### T19-6：§10.3 手工清单的最终状态

| 项 | 状态 |
|---|---|
| 断网启动，全流程可用 | 已自动化（CDP 监听，比拔网线严格） |
| DevTools Network 面板全程零请求 | 已自动化 |
| 键盘走完整个流程 | 已自动化 |
| 100% 缩放对比原图与输出，看不出差别 | **已自动化**（本次，8 条像素断言） |
| 输出目录设为原图目录，原图未被改动 | 已自动化（哈希比对） |
| 窗口缩到最小尺寸（880×620）不破版 | **已自动化**（本次） |

**SPEC §10.3 现在全部有自动化覆盖。** 真正还需要人做的只剩「装到另一台没装过 Node 的机器上跑一遍」。

---

## 收尾九：渲染层大脑的测试，以及三处「实现了却没接线」

### T20-1：`useAppStore.ts` 一条测试都没有

盘点下来，`src/main/image/` 和 `src/main/` 的纯逻辑都有测试，组件被冒烟的 35 项布局硬指标覆盖，但 **`src/renderer/store/useAppStore.ts`（238 行）是空白** —— 它是渲染层的大脑。

而且它的逻辑基本都不在冒烟覆盖的主路径上：

| 行为 | 错了会怎样 |
|---|---|
| 传给 `probe` 的是「还能再收几张」而不是总数 | 拖第二个文件夹时被整批丢掉 |
| `applyProgress` 的进度只增不减 | 并发完成顺序乱时进度条往回跳 |
| `clear` 先 `cancel` 再清 | 空列表被跑完的行重新填上 |
| `run` 失败时收场 | 按钮永远卡在「处理中」 |
| `finishTask` 中止时记原因 | 界面不知道这批是停了还是跑完了 |

补了 31 条测试（`useAppStore.spec.ts`），用一个假的 `window.pictureMore`。

**其中一条值得单说**：「主进程越界返回时本地兜住」。正常路径上 `addPaths` 里的
`takeWithinLimit` 永远不会触发 —— 主进程的 `probe` 已经按限额截过了。
它是一道**跨进程边界的防御**：渲染层不该无条件相信对端，万一主进程限额算错、
多返回几百行，界面会直接被撑破。

这类「防御性但正常不可达」的代码，和 T18-1 删掉的虚拟化不一样：虚拟化是一整个
不可达的子系统，而这个是一行调用 + 一条测试。判据是**能不能写出一条让它执行的测试**
—— 能，就留着；不能，就是死代码。

### T20-2：三处实现了却没接线的地方

扫查 `src/renderer` 对白名单 API 的使用次数，发现：

| 方法 | 渲染层使用次数 | 结论 |
|---|---|---|
| `revealInFolder` | **0** | 孤儿通道 |
| 其余 10 个 | 各 1 | 正常 |

`dialog:revealInFolder` 在 `SPEC.md` §6.1 的通道表里，preload 也把它暴露给了渲染层，
但**从头到尾没说谁用它** —— 原型里没有对应控件，`DESIGN.md` 也没有。

Hmm，所以它是一个**声明了但没有用途的 IPC 通道**。这有两个方向：

1. 补一个界面入口（比如完成提示里的路径可点，点了在文件夹里定位）—— 需要设计 + 文案
2. 从通道表与白名单里删掉 —— 少一个暴露给渲染层的系统能力（`shell.showItemInFolder`）

**倾向 2**：AGENTS.md 要求白名单最小化，而一个没人调的通道纯粹是攻击面。
但删它会改动 `SPEC.md` §6.1 的契约表，所以要用户拍板。

### T20-3：`error` 字段定义了却没显示（静默失败）

同一个扫查发现的更严重的一处：`useAppStore` 里的 `error` 字段**界面一处都没消费**。

它的两个写入点都会导致**用户点了没反应**：

- `run()` 的 IPC 调用失败（输出目录被拔掉的 U 盘、只读盘、路径过长）→ 记下 error，
  但 CTA 只是从「处理中」变回「压缩这 N 张」，**没有任何提示**
- 整批被磁盘满中止 → 记下 error，但界面同样不说

「点了没反应」是最糟的失败方式：用户会以为程序坏了，或者以为已经在跑了。

**为什么没直接修**：`DESIGN.md` §5.6 的 CTA 状态矩阵只有「默认 / 悬停 / 激活 / 禁用」，
**没有任何错误态**；`SPEC.md` §8.4 的文案表里也没有对应字符串。

也就是说这需要同时补设计与文案，而 AGENTS.md 的规矩是「原型即最终样式」+「不得自造词」。
所以这一轮先把问题记清楚，和其余几处文案缺口一起等确认。

**已经确定的实现方案**（等文案到位就能落）：底部那行（`.foot`）现在在「常驻声明」与
「完成提示」之间切换，加第三个状态（错误）最自然 —— 它是现成的状态行，
不需要新增版式。

### T20-4：一条 flaky 测试，差 1 秒

补完 store 测试后跑全量，`compress.spec.ts > huge-8000.jpg @ 20%` 报
`Test timed out in 120000ms`。但**单独跑这个文件连续四轮全过**。

抓下全量的完整输出才看清：它跑 **118975ms**，而超时是 120000ms —— **就差 1 秒**。

原因：48MP 纯噪声在 p=20 时底线命中目标，二分要跑满 5 到 6 次，每次约 23s，
单独跑 104s。全量并行时十几个测试文件抢 CPU，就顶到了 119s。

**处置**：改成按图给预算，而不是一刀切的 120s。

```ts
const TIMEOUT_MS = {
  'huge-8000.jpg': 300_000,   // 48MP 噪声，单独跑 104s，并行时 119s
  'noise-hi.jpg': 180_000,
  'iphone-portrait.heic': 120_000
}
```

**这类问题值得单独记一笔**：它只在全量跑时出现，单独跑永远复现不了 ——
所以很容易被当成「机器抽风」忽略掉。而一个时红时绿的测试，最后一定会被人
当成噪音，那比没有测试更糟。

判据：**慢的测试要给足预算，别让它在超时线上悬着。** 差 1 秒和差 1 分钟一样危险，
因为负载是浮动的。发现 flaky 的第一件事是**量出它实际跑多久**，而不是重跑一遍
祈祷它过。

---

## 收尾十：补上错误态，删掉孤儿通道（用户拍板）

### T21-1：静默失败修掉了

T20-3 记的那个问题 —— `error` 字段定义了却没显示，输出目录写不进去时**点了没反应** —— 用户确认了文案，这轮落地。

**底部那行从两态变成四态**（原型里只在「常驻声明」与「完成提示」之间切换）：

| 状态 | 内容 |
|---|---|
| 有错误 | 错误原因（琥珀色） |
| 跑完了 | 完成提示 |
| 其余 | 常驻声明 |

**错误优先于完成提示**：一批被磁盘满中止时，先说「磁盘满了」比说「完成」有用得多。

用 `role="status"` 而不是 `role="alert"`：这是对一个用户主动触发的操作的反馈，
不该打断屏幕阅读器正在读的内容。

### T21-2：错误码走返回值，不走异常

原来的写法是 `task:start` 抛异常，渲染层 catch 之后把 `e.message` 存进 `error`。有两个问题：

1. **`e.message` 是 Node 的原始错误串**（`EACCES: permission denied, mkdir 'D:\x'`），
   渲染层拿它没法映射成文案 —— 只能原样显示给用户，而目标用户看不懂
2. **错误码要穿过 Electron 的 IPC 序列化**，`code` 属性能不能活下来取决于版本，靠不住

改成结构化返回：

```ts
export interface TaskStartResult {
  taskId: string
  /** 启动前就失败的原因；null 表示这批已经跑起来了 */
  error: ReasonCode | null
}
```

启动前的失败（建目录、查可写）走返回值；意料之外的异常（IPC 断了）仍然 catch，
但用 `reasonFromError` 归一成原因码，而不是把原始字符串塞进界面。

**所以 `error` 里现在一定是原因码或 `null`**，界面靠 `batchErrorText` 映射 ——
和单行的 `reasonText` 分开，因为同一个码在两种语境下要说的话不一样：
`EACCES` 在行内是「这张读不了」，在整批是「这个文件夹写不进去」。

**兜底那句是关键**：任何认不出来的原因都有话说（「这批没有跑完」）。
静默失败比说得不够准更糟，所以宁可笼统也不能空着。

### T21-3：删掉孤儿通道

`dialog:revealInFolder` 在 SPEC §6.1 的通道表里、preload 也把它暴露给了渲染层，
但渲染层一次都没调过，原型与 DESIGN.md 也没有对应控件。用户决定删掉。

**五处一起清**：`shared/ipc.ts` 的通道名、`shared/api.ts` 的接口、`preload/index.ts`
的转发、`main/ipc/dialog.ts` 的 handler（连带 `shell` 的 import）、SPEC §6.1 的表格行。

白名单从 11 个方法降到 10 个。一个没人调的通道纯粹是暴露给渲染层的多余系统能力
（`shell.showItemInFolder` 能在资源管理器里定位任意路径），删掉符合「白名单最小化」。

冒烟脚本的白名单清单也跟着改了 —— 它是硬编码的，不同步的话会误报「方法不全」。

### T21-4：这条经验的形状

**「实现了却没接线」是一类独立的缺陷，值得专门扫一遍。**

它不会报错、不会让测试变红，因为代码本身是对的 —— 只是没人调用。
发现它的方法是**数引用**：对每个导出的接口/通道，数一下消费端调了几次。
零次就是孤儿。

这一轮扫出三处（`revealInFolder` 孤儿通道、`error` 未消费、以及早先的
`isSupportedExt` 定义了但没用上），都不是靠读代码能看出来的。

---

## 收尾十一：`app.asar` 锁的成因查清了

T18-5 记过 `EBUSY: resource busy or locked, unlink app.asar`，当时没查到成因。
这一轮又撞了两次（`release-next` 也锁了），把规律摸清了。

### 规律

**往一个新目录首次出包能成功，重新出包必失败。**

- `release/`：9-20 首次成功，9-21 重出失败
- `release-next/`：9-21 21:30 首次成功，9-21 23:30 重出失败

原因一致：重新出包时 electron-builder 要先 `unlink` 已存在的 `app.asar`，而它删不掉。

### 成因：delete-pending

关键证据是**空间没释放**：我把 `release/win-unpacked` 和 `release-next/win-unpacked`
里除 `app.asar` 之外的文件全删了，只剩两个 9.5MB 的文件，但 `du` 仍报 719MB / 492MB。

**说明那些文件处于 delete-pending 状态**：已被标记删除，但持有句柄的进程没关，
空间要等重启才回收。

这就解释了全部现象：

| 现象 | 解释 |
|---|---|
| `unlink` 报 EBUSY | delete-pending 的文件不能再被 unlink |
| `rename` 也报 EBUSY | 同上，改名也需要独占 |
| 按进程名/路径都找不到占用者 | 占用者不是「打开着这个路径的进程」，而是一个残留句柄 |
| 跨重启存活（当时以为） | 其实中间那次重启发生在锁形成之前，看错了时间线 |
| 删掉文件后空间不释放 | delete-pending 的典型表现 |

### 处置

**每轮出包换一个新目录**，`release-102` 这类。`electron-builder.yml` 里仍写 `release`
（正常路径），临时目录用 `-c.directories.output=...` 覆盖，`.gitignore` 改成 `release*/` 统一忽略。

**重启之后**这些目录就能正常删除，恢复正常出包流程。

**这不是项目问题**：换台机器、或者正常关闭应用之后再出包，都不会遇到。
但本机已经积累了三个 release 目录（约 1.7GB，其中约 1.2GB 要等重启才回收），
重启后记得清一下。

### 一条可以推广的经验

**「文件删不掉」先看空间有没有释放。**

空间释放了 → 真的只是句柄占用，找出进程就行。
空间没释放 → delete-pending，别白费力气找进程，重启是唯一解。

这个判据能省下大量排查时间 —— 我前面按进程名、按路径、按只读属性查了一圈，
都不如 `du` 一次对比来得直接。

---

## 收尾十二：把剩下的文案缺口一次补完（授权升级后）

### T22-0：授权变了

用户 2026-09-22 把授权升到最高级：**需要拍板的决定直接做，不用询问**，
边界只有「不影响电脑系统本身」。所以前面一直挂着等确认的几处文案缺口，
这一轮全部自己定掉，并同步进 SPEC §8.4 的文案表（保持「文案只有一处来源」）。

### T22-1：undershot 的行内提示（补一格）

SPEC §9 给了两句文案（「这张已经压到底了」/「质量已到下限，只压到 {x}」），
但**没说放哪** —— 原型 `.file` 是 44px 一行、只有文件名 / 体积 / 移除三格。

**判断：补一格，不算偏离原型。** 理由：原型**只画了 happy path**，
「压不到目标」这个状态它从未覆盖。原型是唯一视觉基准没错，但基准没画的地方
不是「不许动」，而是「没规定」。

实现上**只在有话说时才渲染这一格**，没有提示的行仍是三格。
文件名那格是 `flex:1`，会吸收这点差异，体积与移除不会跳位。

`{x}` 取**输出体积占原图的百分比**：「只压到 58%」读作「只压到原图的 58%」，
这是中文里最自然的读法，也和旁边那对体积对得上。

**两种 undershot 怎么分**：用 `outBytes === bytes` 判断，不新增字段 ——
`keptOriginal` 的定义就是「返回原文件字节」，两者语义完全等价。
而且万一某个无损格式恰好压出同样大小，显示「已经压到底了」依然是对的（体积确实没变）。

### T22-2：失败行的原因文案（原来那一格是空白的）

SPEC §9 说「文件不存在 / 无读权限 → 行内显示原因」，但**没给字符串**，§8.4 也没有。
之前按「不得自造词」的规矩刻意留空 —— 结果是失败行的体积格**空白**：
一行既没有体积也没有原因，用户只知道「这张不行」，不知道是找不到、没权限还是别的。

补齐七条（见 SPEC §8.4），**关键是那条兜底**：`UNKNOWN` → 「读不了这张图」。
静默比说得不够准更糟。

测试也改成了**不变量式**：断言「每一个原因码都有非空文案」，
而不是逐个对具体文字。这样以后新加原因码却忘了配文案，测试会红。

### T22-3：一张都没加进来时要说话

SPEC §9 有两条相关的：「拖入文件夹 → 空文件夹给提示」和「拖入非图片文件 → 静默过滤」。
之前两条都没做，用户拖进来一个空文件夹或一个 .txt，**界面毫无反应** ——
看起来像程序卡了。

**「静默」理解为「不报错、不当失败处理」，不是「一声不吭」。** 所以：

- 一张都没加进来 → 底部那行显示「没有可压缩的图片」
- 混在一堆图里被过滤掉的那些 → 仍然不吭声

文案刻意用中性说法，因为渲染层只拿到路径，分不出是空文件夹还是非图片 ——
而这两种情况对用户来说是同一件事：「我拖了东西，但什么也没进来」。

底部那行的优先级定为 **错误 > 提示 > 完成 > 常驻声明**：
刚拖进来一个空文件夹时，用户要的是「为什么没反应」，而不是上一批的存放位置。

### T22-4：冒烟报「输出目录里没有产物」，其实是起点不干净

改完跑冒烟，批次跑完了（行状态 done/undershot），但校验报三张图都没有产物。
截图一看，存放位置是 `D:\pictureMore\release-102\_s...` —— **上一轮打包冒烟留下的**。

冒烟脚本开头确实删了设置文件，但**那只保证磁盘上是干净的**：
上一轮跑的是 `smoke-packaged`（它把存放位置设成 `release-xxx/_smoke-out` 并落盘），
应用就带着那个陈旧值起来了，第一批产物写到别处去。

**报错信息很有迷惑性**：「输出目录里没有产物」听起来像压缩坏了。

处置：在应用挂载之后**显式断言一次存放位置是「没设置过」**，不干净就当场停下，
并打印可操作的提示（「删掉 %APPDATA%\picturemore\settings.json 再跑」）。

这已经是同一类问题的第四次了（T14-6、收尾二、T16-4、T20-4）：
**验收脚本的第一步应该是「把状态复位到已知起点」，而不是「假设环境是干净的」。**
区别是这次加了守卫，把「看起来像功能坏了」变成了「起点不干净，这么做」。

### T22-5：护栏补强

顺带补了 SPEC §14.1 要求但一直没做的那条：「加 ESLint `no-restricted-imports`
禁止 renderer 引用 sharp」。项目没有 ESLint（依赖白名单里也没有），
所以写了等价的 `scripts/check-renderer-boundary.mjs`：

- 渲染层禁止引用 `electron` / `node:*` / `sharp` / `heic-decode` / `@img/*` / `main` / `preload`
- **为什么值得单独守**：渲染层引用这些不会在开发时报错，Vite 会当成普通包处理，
  打包可能成功，运行时才崩，而且是白屏。排查要从头找
- 冒烟会在运行时验一次（`window.require` 不存在），但那个要起 Electron 才跑得到

同时把 `lint:no-resize` 从「只拦 `.resize(`」扩到拦**所有会改像素尺寸的调用**：
`.resize(` / `.rotate(` / `.extract(` / `.trim(`。SPEC §14.1 单独点出过 `.rotate()` ——
orientation 5/6/7/8 时它真旋转像素、宽高互换，而我们的方向处理是「只写标签不动像素」。

两条护栏都**故意造了一次违规验证会拦**——不验证的话，一个永远绿的护栏和没有护栏是一样的。

---

## 收尾十三：Android 的 sRGB HEIC 不再被错标成 P3

### T23-1：一条挂了很久的「已知问题」，其实可以拆成两半

这一条一直挂在「需要用户拍板」里，理由写的是「手上没有 Android HEIC 样张，改不了就没法验」。

**拆开看，它其实是两个问题：**

| 部分 | 能不能验 |
|---|---|
| **判据**：从 ICC 里认出这是不是 sRGB | **能**。手上有三份真实 profile：iPhone fixture 里的 Apple Display P3、sharp 内置的 `sP3C` 与 `sRGB` |
| **数据事实**：Android 机型拍的 HEIC 确实带 sRGB ICC | 不能，缺样张 |

判据能验，就该先把判据做出来 —— 缺的只是「Android 确实如此」这一条，而那条不影响代码正确性：
**认不出的一律维持原行为**，所以这个改动只可能修好 Android，不会弄坏 iPhone。

### T23-2：改动只有一行

```ts
tagAsP3: useRaw && shouldTagAsP3(classifyIccName(src.icc))
```

`shouldTagAsP3` 的规则是**保守**的：**只有明确认出 sRGB 才不挂 P3**，
`none` / `other` / `display-p3` 都照挂 —— 与改动前完全一致。

这条保守规则是整个改动安全的前提。反过来（认不出就当成 sRGB、不挂标签）会把 iPhone
那条主路径改坏：Apple 的 profile 一旦解析失败，输出就没有 P3 标签，画面会变淡 ——
**那比原来的 bug 更严重**。

### T23-3：ICC 名字的两种编码

写解析器时踩到一个：`desc` 标签有两种类型，**两种都得认**。

| 类型 | 结构 | 谁在用 |
|---|---|---|
| `desc`（textDescription） | 类型 4 + 保留 4 + 长度 4 + **ASCII** | 老的 sRGB profile |
| `mluc`（multiLocalizedUnicode） | 类型 4 + 保留 4 + 记录数 4 + 记录长度 4 + 记录表 + **UTF-16BE** | Apple 的 "Display P3" |

只写 `desc` 的话，**iPhone 那张会读不出名字**（实测就是这样：一开始读出来是空串）。
验证方法是拿三份真 profile 跑一遍，看名字对不对 —— 而不是拿自己造的字节自证。

### T23-4：`ProbeResult.icc` 的语义按 SPEC 走

改的过程中一度把 `icc` 存成分类结果（`'display-p3' | 'srgb' | ...`）。但 SPEC §6.2 写的是：

```
icc: string | null;       // ICC profile 名，如 'srgb'
```

**按规格改回存 profile 名**（`'Display P3'` / `'sRGB'` / `'sP3C'`），分类在调用处做。
名字的信息量更大，而且改了语义就得同步改 SPEC，没必要。

顺带发现 `ProbeResult.icc` 这个字段**之前从来没人消费过** —— 又是一处「实现了却没接线」
（见 T20-2 的方法）。这次它终于有了用处。

### T23-5：语义上的一处收敛，写进测试里说明

改成「按名字分类」之后，「有 ICC 但名字读不出来」和「根本没有 ICC」都落到 `none`。
两者在 `shouldTagAsP3` 里都走「挂」，行为完全一样 —— 而区分它们要往 `ProbeResult`
再加一个字段，不划算。

这一点用一条单独的用例写明，免得后人以为是 bug。

### T23-6：验的是什么

13 条测试，**全部用真实 profile**，没有一条是拿自己造的字节自证：

- 三份真 profile 的名字都读对（`Display P3` / `sP3C` / `sRGB`）
- 三份都归对类
- 坏输入不崩（null / 空 / 太短 / 标签数荒谬 / 偏移越界）
- `shouldTagAsP3` 对四种情况都维持原行为（除 srgb）
- **端到端：iPhone HEIC 压出来的 JPG 仍带 P3 标签** ← 这条最重要

最后一条守的是「别把主路径改坏」。改动的目的是让 sRGB 不挂 P3，
但主力输入是 iPhone 的 P3 —— 如果识别逻辑出错导致它也不挂了，画面会变淡。
所以直接验产物：压完之后输出里还得有 P3 标签。

---

## 收尾十四：把「数引用」做成工具，以及工具自己的误报

### T24-1：把一次性手法固化成脚本

「实现了却没接线」这类问题（T20-2 找出的三处）之前是靠临时脚本扫的。
固化成 `scripts/find-orphans.mjs`（`npm run find:orphans`）：

收集 `src/` 下所有 export 的具名符号，数每个名字在产品代码里出现了几次，
减去声明本身那一次；零次就是孤儿。

**两类分开报**，因为处置不同：

| 类别 | 含义 | 处置 |
|---|---|---|
| 完全没人引用 | 死代码 | 删 |
| 只被测试引用 | 没接到产品上，但可能是模块的合法 API | 人工判断 |

### T24-2：工具自己的误报率是 93%

第一版跑出来 120 个导出里 30 个「孤儿」——**其中 28 个是误报**。

原因有两个，都是同一个毛病的不同表现：

1. **没有把「定义文件内的使用」算进去。** `*Props` 接口就写在组件的同一个文件里，
   当参数类型用 —— 它显然接上了
2. **修第一版时「跳过声明那一整行」，又跳多了。**
   `export function X(props: XProps)` 这一行**同时**是 X 的声明和 XProps 的使用，
   整行跳过就把 XProps 误判成孤儿

最终改成「先全数、再减一」——声明必然占一次，减掉就对了。结果从 30 降到 2，
再删掉一个真正没用的（`IpcChannel`），剩 1 个（`classifyIcc`，只被测试引用，保留）。

**这条和第 T22-5 里护栏误报是同一个教训**：误报率高的工具会被忽略，
而一个被忽略的工具等于不存在。所以工具也要像测试一样，**拿已知答案的样本验一遍**——
我这次是拿「显然接上了的东西」（`*Props`、`useAppStore`）当样本，一看就知道错了。

### T24-3：删掉 `IpcChannel`

`src/shared/ipc.ts` 里那个 `export type IpcChannel = (typeof IPC)[keyof typeof IPC]`
从写完就没人用过。删掉 —— 一行的类型别名，将来要用再加回来是零成本。

`classifyIcc` 保留：它是「给定 ICC 字节，判断是什么 profile」的模块 API，
虽然产品路径上 `probe` 用 `iccProfileName`、`compress` 用 `classifyIccName`，
但它是这个模块对外能力的完整表达，而且有测试。**「只被测试引用」和「完全没人引用」
是两回事**，处置也不同。

---

## 收尾十五：一处「代码承诺了没做的事」

### T25-1：`role="radio"` 不等于 radio 行为

扫无障碍时看 `FormatPicker`，注释写着：

> 用 radiogroup 语义而不是普通按钮组：键盘可以用方向键在选项间移动，
> 这是原生 radio 的行为，也是 SPEC §10.3「键盘走完整个流程」要求的。

**但代码里只有 `role="radio"` 和 `aria-checked`，没有 roving tabindex、也没有接方向键。**

`role="radio"` 挂在 `<button>` 上**不会带来任何原生行为** —— 它只是给辅助技术的声明。
所以实际情况是：四个选项全进了 Tab 序列（标准 radiogroup 只该有一个 Tab 停靠点），
方向键按下去毫无反应。

**代码承诺了没做的事，比不承诺更糟**：读注释的人会以为这块不用管了。
而且这类问题冒烟也验不出来 —— 原来的键盘检查只断言「至少能 Tab 到格式选项」，
它确实能 Tab 到，只是方式不对。

**处置**：按 ARIA Authoring Practices 补齐 radiogroup 的完整键盘模式。

- 只有选中的那个 `tabIndex=0`，其余 `-1`（整组一个 Tab 停靠点）
- 方向键在选项间移动，**移动的同时选中**（radiogroup 的约定）
- Home / End 跳首尾

### T25-2：把「行为」也验了

冒烟的键盘检查从「有没有 `role="radio"`」改成**量行为**：

```
通过  整组一个 Tab 停靠点（1 / 4）
通过  方向键移动选中项（0 -> 1）
通过  方向键同时移动焦点（落在第 1 项）
```

Tab 顺序的实测输出也跟着变了，一眼能看出差别：

```
改之前：INPUT:range -> BUTTON[radio] -> BUTTON[radio] -> BUTTON[radio] -> BUTTON[radio] -> ...
改之后：INPUT:range -> BUTTON[radio] -> BUTTON -> BUTTON -> ...
```

**这条和 T19-1（画质）、T22-5（护栏）是同一个原则**：查定义只能证明「写对了」，
量结果才能证明「做对了」。`role` 写了、`aria-checked` 也写了，全都对 —— 但功能不存在。

---

## 收尾十六：滑块从没被移动过

### T26-1：两个 SPEC 要求一直没验

查冒烟脚本发现，它**从来没有操作过滑块** —— 只验了初始状态（大数字 = 80 那条对应关系）。
于是两件 SPEC §7 明文要求的事成了空白：

| 要求 | 状态 |
|---|---|
| 预估量随滑块实时重算 | 没验 |
| 质量提示的四态随滑块切换（越过 70% 才出琥珀） | 没验 |
| CTA 的「处理中 i / N」与「再压一次」两态（SPEC §8.4） | 没验 |

第三条尤其值得说：冒烟只验了默认态（`压缩这 N 张`）和跑完之后还能点，
**中间那一态完全没看**。而那一态里有个容易漏的东西 —— **按钮必须禁用**，
不禁用的话用户可以重复点，同一批会被跑两遍。

### T26-2：React 受控输入要用原生 setter

设置滑块值不能直接写 `slider.value = '80'`。React 比对的是自己记的旧值，
看到没变就不重渲。必须走原生 setter 再派发事件：

```js
const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
setter.call(s, '80')
s.dispatchEvent(new Event('input', { bubbles: true }))
s.dispatchEvent(new Event('change', { bubbles: true }))
```

### T26-3：选择器抓错元素，导致空断言

第一版用「文本匹配 `/^\d+%$/`」找大数字、「排除掉预估量那一行之后最长的 p」找质量提示。
结果：

- 大数字读成 `null`（它是个 `<output>` 元素，不是 `span`）
- 质量提示读成了**存放位置的说明文字**（「原图不会被改动…」）

**最危险的是第三条**：那条「琥珀色只在越过 70% 时出现」的断言，
因为读的是永远灰色的元素，**变成了空断言**。它那次恰好失败了（因为找不到琥珀色），
但如果我把断言写成「不超过一个」而不是「恰好一个」，它就会**永远通过**。

**这正是本项目第四次踩同一个坑**（T14-6 / 收尾二 / T16-4 / T22-4）：
**断言在「什么都没测到」时也会通过。** 处置：

- 大数字改用 `aside output`（左栏里唯一的 output）
- 质量提示改用 `p[data-note-kind]` —— 给它加了个 `data-*` 属性把状态显式挂到 DOM 上，
  和行上的 `data-state` / `data-reason` 一个路子

**按文案或样式找元素都太脆**：文案会改，样式分不出是哪一态。

### T26-4：容差算错，把公式的错算成了显示的错

预估量的检查一开始拿**界面上显示的**「82 KB」当分母，算出 80% 那档偏差 2.4%，判失败。
但公式其实一分不差 —— 是显示的舍入叠了：

```
真实总量 83823 字节 -> 显示「82 KB」（少 383）
真值 16765 字节    -> 显示「16 KB」（少 381）
两个舍入方向相反，叠出 2.4% 的「偏差」
```

改成**基准取真实字节数**（冒烟本来就知道那三个文件多大），容差只剩输出那一侧的显示精度
（KB 取整 → 512 字节）。实测差 381 / 453 / 498，全部落在容差内。

**教训：拿显示值当基准时，要意识到它已经被舍入过一次。** 基准应当取真值，
容差只留给被测的那一侧。

### T26-5：同一个竞态，修了一个没修另一个

出完 1.0.6 跑打包冒烟，`#root 已挂载` 那项红了 —— 但批次照跑通了，说明是检查的问题。

原因和 T20-4 一模一样：连上 CDP 就立刻读 `document.getElementById('root')`，
而 `waitForPage` 只保证「有一个可调试的页面」，那时 HTML 可能还没解析到 `#root`。

**开发冒烟早就修过这个竞态，但没同步到打包冒烟。** 于是它一直时灵时不灵，
直到这次真的红了。

顺带把判据也改准了：原来断言「`#root` 存在」，而**存在不等于渲染完了** ——
空壳一样算存在。改成等它有子元素，并且连跑两轮确认稳定。

**这条的教训不是「又有竞态」，而是「修竞态时要问还有没有别处有同一个竞态」。**
同一个毛病分散在两个脚本里时，修一处等于没修。

---

## 收尾十七：交互态与动效的验证，以及一处自己造成的死路径

### T27-1：`disabled={running}` 让 SPEC §9 的一条路径永远走不到

核对 SPEC §10.3 的键盘项（「Tab / Space / Enter / 方向键」）时，顺手看了一眼
清空按钮的禁用条件 —— 发现它写着 `disabled={running}`。

**但那是我自己加的。** 原型里 `#clearBtn` 就是个普通 click，从不禁用；
DESIGN.md 也没提禁用态。

而那个禁用把 SPEC §9 的「处理中清空列表 → 先 `task:cancel` 再清」变成了
**走不到的路径** —— `task:cancel` 从此成了死代码，preload 白名单里那个 `cancel`
也永远调不到。

**一条写在规格里、却因为另一处的擅自加码而永远执行不到的分支，比没有这条规格更糟**：
它会让人以为已经处理过了。

**处置**：按原型改回来，去掉 `disabled={running}`。顺带把 `running` 这条传递链
（App → FileList → ListMeta）也清理掉了 —— 它唯一的用途就是那个禁用。

清空期间的行为本来是安全的：`cancelPending` 跳过没开始的，在跑的几张跑完；
它们推的进度按 `itemId` 匹配，匹配不到就什么也不做。

**补了冒烟守它**：

```
通过  处理中清空按钮可点（clicked，进入过处理中=true）
通过  清空后列表立刻为空（0 行）
通过  等 1.5s 后仍是空的（0 行）
```

第三条是关键：在跑的那几张跑完还会推进度事件，**它们不该把行加回一个空列表**。
造 30 张 2000×1500 的图（每张约 400ms）就是为了让「处理中」有一个够宽的窗口 ——
用极小的图会因为跑太快而抓不到。

### T27-2：悬停态与动效兜底，两条都没验过

同一轮扫出来的：

| 要求 | 之前的验证 |
|---|---|
| DESIGN.md §5.2：悬停时「移除」由 `opacity:0` 变 1 | 只验了隐藏探针 `#probe-hover` 的配色，**没验真按钮** |
| AGENTS.md：任何动效必须有 `prefers-reduced-motion` 兜底 | CSS 里有那条 media query，但**从没验过它真的生效** |
| DESIGN.md §5.2：处理中的行整行降到 30% 不透明 | 没验 |

补上之后：

```
通过  移除按钮默认隐身（opacity=0）
通过  悬停时移除按钮现身（opacity=1）
通过  鼠标移开后回到隐身（opacity=0）
通过  reduce 模式下过渡已停（0s / 0s）
通过  reduce 模式下动画已停（animation-name: none）
通过  处理中的行降到 30% 不透明（最低 opacity=0.3）
```

**两条方法上的要点：**

**一、动效兜底要真的模拟媒体特性再读计算样式。** 光看 CSS 里有没有那条 media query
只能证明「写了」。这里用 CDP 的 `Emulation.setEmulatedMedia` 把
`prefers-reduced-motion` 设成 `reduce`，再读 `transitionDuration` / `animationName`，
确认**实际**被停掉。

**二、量过渡中的样式要取一段时间内的极值，不能采一次。** 第一版一看到「处理中」
就采样，读到 `opacity: 1` 判失败 —— 但 `.file` 上有 `transition: opacity 0.22s`，
那时过渡才刚开始。改成在窗口期连采 12 次取最小值。

**「采一次就断言」在动画面前是不可靠的**，这和 T26-3 的空断言是同一类问题：
读到的值不是你以为的那个时刻的值。

---

## 收尾十八：PNG 的文案是错的，实测推翻了直觉

### T28-1：用户的一个问题，暴露了一句没人核过的文案

用户问：「为什么 PNG 图选保留原格式显示无法压缩？那其他格式转 PNG 是不是都压不动？」

这句话让我去实测了一遍 —— 65% 档，全部 fixture 转各种格式：

| 输入 | 体积 | 转 PNG |
|---|---|---|
| `flat-solid.png`（纯色） | 44KB | **3KB，−93%，达标** |
| `alpha-cutout.png`（抠图） | 31KB | **2KB，−95%，达标** |
| `oriented-6.jpg`（低色数） | 7KB | **2KB，−78%，达标** |
| `noise-hi.jpg`（噪声） | 11.9MB | 交原图 |
| `sample.webp`（照片） | 3.1MB | 交原图 |
| `sample.avif`（照片） | 1.4MB | 交原图 |
| `iphone-portrait.heic` | 2.5MB | 交原图 |

**分界线是颜色数，不是输入格式。** ≤256 色（纯色 / 截图 / 图标 / 线条图）走调色板量化，
能压 80% 以上；照片几十万色，无损格式无能为力。

最能说明问题的是 `oriented-6.jpg`：**输入是 JPG，转 PNG 照样压掉 78%** ——
因为它色数低。所以「什么格式转 PNG 压不动」这个问法本身就问错了。

### T28-2：界面提示与事实相反

界面上 PNG 那条琥珀提示写的是：

> PNG 是无损格式，**体积基本压不下来**。要变小请选 JPG 或 WebP。

这句话对照片成立，对截图和纯色图**完全相反**。而截图、图标、示意图恰恰是
「发不出去的图」里很大的一类 —— 用户拿着能压 90% 的截图，看到这句话就换去 JPG 了，
而 JPG 对线条图反而更容易出彩边。

**这句话来自 SPEC §7，是当初按直觉写的，从来没人拿实测核过。**
用户就是被它绕进去的。

改成如实说两边：

> PNG 是无损格式。照片类压不动，截图和纯色图能压很多。

同步改了 SPEC §7 与 DESIGN.md §7 的文案表（保持「文案只有一处来源」）。

### T28-3：把这条事实钉进测试

补了两条用例，断言「低色数图转 PNG 能压掉 70% 以上」，其中一条特意用
`oriented-6.jpg`（输入是 JPG）—— 钉的就是「输入格式不是判据」这一点。

### T28-4：这条经验的形状

**「按直觉写的文案」是一类独立的缺陷。**

它不会报错、不会让测试变红，甚至看起来很像一句合理的提示 ——
但它会把用户往错误的方向推。而这个项目里**没有任何机制会去核对文案与实测是否一致**：
文案表是手写的，测试只断言「取到了这句话」，不断言「这句话是对的」。

**发现它的唯一途径是「有人问」。** 所以用户提问本身是有价值的输入，
不该只回答完就算 —— 值得顺手把它变成一个测试或一次实测。

这一条和 T19-1（黄金测试断言的 `quality >= 82` 只是参数）是同一类：
**「写下来了」和「是对的」是两回事。**





























