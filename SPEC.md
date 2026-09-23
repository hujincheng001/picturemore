# 图压压 pictureMore · 开发文档

> **这份文档的用法**：按 §12 里程碑顺序开发。§4 图像引擎是全部价值的所在，先写它、先测它，界面最后接。
> 视觉基准是 `prototype/index.html`（浏览器直接打开即可），文字规范是 `DESIGN.md`。两份都不是参考意见，是规格。
> 本文档中标注 **⚠️ 风险** 或 **⚠️ 陷阱** 的条目必须在动手前先验证，不要假定它能跑通。

---

## 0. 冷启动指南

如果你是一个**没有任何上文的新会话**，从这里开始。

### 0.1 先读这四份，按这个顺序

| 顺序 | 文件 | 读它是为了 |
|---|---|---|
| 1 | `docs/DEVELOPMENT.md` | 技术栈决策依据、目录结构、开发环境 |
| 2 | `PRODUCT.md` | 产品定位、目标用户、两条承诺、能力边界 |
| 3 | `SPEC.md`（本文） | 开发依据。架构、算法、IPC 契约、里程碑 |
| 4 | `DESIGN.md` + `prototype/index.html` | 视觉规格与唯一视觉基准 |

`docs/superpowers/plans/2026-09-19-picturemore-v1.md` 是任务级实施计划（14 个 Task，每个 Task 都是 TDD 小步 + 可验证交付物），逐条勾选执行。

### 0.2 第一件事

**不要先搭项目，先做 §5.3 和 §4.5 的两个验证脚本。** 它们各自可能推翻一个已经写进文档的假设：

- §5.3 验证 sharp 能不能读 HEIC（结论很可能是不能，需要 `heic-decode` 兜底）
- §4.5 验证 `withMetadata` 的 ICC / orientation / EXIF 行为，定下编码写法

跑完把结论写进 `docs/decisions.md`，再开始 M1。

### 0.3 三条绝对不能破的线

违反任何一条，代码即使跑通也是错的：

1. **绝不调用 `.resize()`。** 本产品承诺尺寸不变。加 CI grep 拦截。
2. **每次输出后断言宽高与输入一致。** 不一致就抛错、不写文件。
3. **渲染进程不碰文件系统。** `contextIsolation: true` + `nodeIntegration: false` 永远不动，所有文件操作走 IPC。

### 0.4 遇到不确定时

- 视觉上的任何问题 → 以 `prototype/index.html` 为准，并排打开比对
- 文案上的任何问题 → 查 §8.4 文案表，不要自己造词
- 技术选型上的任何问题 → 先查 §14 已知陷阱，再查 `docs/DEVELOPMENT.md`，最后才问
- **不要引入新依赖。** 除 `heic-decode` 外，本文档指定的依赖就是全部

---

## 1. 产品定义

### 1.1 一句话

一个完全本地运行的图片压缩工具，把"发不出去的图"变成"能发出去的图"，并且**只改文件体积，不改图片本身**。

### 1.2 用户与场景

普通个人用户，非技术背景。使用发生在"图发不出去"的那一刻：微信 / 邮件 / 云盘提示体积超限，或办事系统要求"照片必须 ≤200KB"。

- 使用频次低，单次数量从 1 张到几十张都有
- 不会阅读文档，不会调参数，界面必须自解释
- 对"图片被上传到服务器"有真实顾虑（证件照、合同、私密照片）

### 1.3 v1 范围

**做**：

| 能力 | 深度 |
|---|---|
| 压缩 | 做深。一条"体积缩小百分比"滑块驱动，实时预估，逐张迭代逼近 |
| 格式转换 | 做深。作为压缩的**输出选项**存在（保持原格式 / JPG / PNG / WebP），不是独立工具 |

**不做**：去 EXIF、改尺寸 / 裁剪、水印、拼接、批量重命名、调色 / 滤镜 / 锐化、AI 抠图、文件夹监控、macOS / Linux 版本。

### 1.4 两条不可违反的承诺

> **承诺一：图片内容永不离开用户机器。**
> 压缩与格式转换全部在本机完成。运行时零网络请求，无遥测，无广告，断网完全可用。
>
> **承诺二：只改变文件体积，不允许影响图片的正常展示。**
> 绝不降分辨率、绝不裁剪、绝不重绘像素。只允许在编码参数上做感知无损的优化。
> 任何为了凑压缩率而牺牲观感或尺寸的做法一律视为 bug，不是取舍。

承诺二在代码层的落点是三条硬断言，见 §4.4 与 §4.8。

---

## 2. 技术栈（已锁定）

| 层 | 选型 |
|---|---|
| 桌面壳 | Electron 44 |
| 渲染层 | React 19 + TypeScript 5.9 |
| 构建 | Vite 8 + electron-vite |
| 样式 | Tailwind CSS 4（`@theme` 承载 token） |
| 图像 | sharp 0.35 |
| 状态 | zustand 5 |
| 打包 | electron-builder 26（NSIS） |
| 测试 | Vitest（单元）+ Playwright（Electron 冒烟） |

**新增依赖只允许一个**：`heic-decode`（含 `libheif-js` WASM，约 2MB），理由见 §5。

不引入：Python sidecar、onnxruntime、任何需要联网的运行时依赖、任何 CDN 资源、任何图标库（v1 全站零图标）。

---

## 3. 架构

### 3.1 进程模型

```
┌─ 主进程 (main) ────────────────────────────────┐
│  窗口生命周期 · 文件系统 · sharp · 任务队列      │
│  src/main/image/*  ← 纯函数，零 Electron 依赖    │
└───────────────┬────────────────────────────────┘
                │ IPC（invoke/handle + 事件推送）
┌───────────────┴────────────────────────────────┐
│  preload（contextBridge 白名单，无 fs 能力）     │
└───────────────┬────────────────────────────────┘
                │ window.pictureMore.*
┌───────────────┴────────────────────────────────┐
│  渲染层 (renderer)  React 19 + zustand          │
│  只拿到元信息与进度，永远不碰文件系统             │
└────────────────────────────────────────────────┘
```

### 3.2 目录结构

```
pictureMore/
├─ package.json
├─ electron.vite.config.ts
├─ electron-builder.yml
├─ tsconfig.json  tsconfig.node.json  tsconfig.web.json
├─ vitest.config.ts
├─ README.md               # 面向使用者：这是什么、怎么下载、怎么用
├─ PRODUCT.md              # 产品定义（本文件的来源）
├─ DESIGN.md               # 视觉规范
├─ SPEC.md                 # 本文件
├─ AGENTS.md               # AI 开发会话入口页
├─ prototype/
│  └─ index.html           # 视觉基准，只读
├─ docs/
│  ├─ decisions.md         # 决策记录（每个"为什么"写这里）
│  ├─ DEVELOPMENT.md       # 面向开发者：技术栈依据、目录结构、环境
│  └─ images/              # 文档配图（README 截图）
├─ tests/
│  ├─ fixtures/            # 测试用图片
│  └─ e2e/
└─ src/
   ├─ shared/
   │  ├─ ipc.ts            # 通道名常量（main 与 preload 共用）
   │  └─ types.ts          # 跨进程共享类型
   ├─ main/
   │  ├─ index.ts          # app 生命周期
   │  ├─ window.ts         # BrowserWindow 配置
   │  ├─ security.ts       # CSP + 网络拦截
   │  ├─ settings.ts       # 用户偏好持久化
   │  ├─ queue.ts          # 并发池
   │  ├─ ipc/
   │  │  ├─ index.ts       # registerIpc()
   │  │  ├─ files.ts       # 选图 / 探测
   │  │  ├─ process.ts     # 压缩任务编排
   │  │  └─ dialog.ts      # 选文件夹
   │  └─ image/            # ★ 纯函数，零 Electron 依赖
   │     ├─ index.ts
   │     ├─ types.ts
   │     ├─ probe.ts
   │     ├─ plan.ts
   │     ├─ encode.ts
   │     ├─ compress.ts
   │     ├─ convert.ts
   │     ├─ verify.ts
   │     ├─ naming.ts
   │     └─ heic.ts        # HEIC 兜底解码器
   ├─ preload/
   │  └─ index.ts
   └─ renderer/
      ├─ index.html
      ├─ main.tsx
      ├─ App.tsx
      ├─ styles/
      │  ├─ tokens.css     # 三层 token（DESIGN.md §1）
      │  └─ index.css
      ├─ components/
      │  ├─ AppHeader.tsx
      │  ├─ ControlPane.tsx
      │  ├─ ShrinkSlider.tsx
      │  ├─ FormatPicker.tsx
      │  ├─ DestinationPicker.tsx
      │  ├─ QualityNote.tsx
      │  ├─ EstimateLine.tsx
      │  ├─ PrimaryButton.tsx
      │  ├─ DropZone.tsx
      │  ├─ ListMeta.tsx
      │  ├─ FileRow.tsx
      │  └─ FileList.tsx
      ├─ store/
      │  └─ useAppStore.ts
      └─ lib/
         └─ format.ts      # fmtSize 等纯函数
```

### 3.3 数据流

```
用户拖入 / 选择
   → IPC files:probe(paths)
   → 主进程 sharp.metadata() 逐张探测
   → 返回 ImageFileMeta[]（尺寸、格式、字节数、是否有透明、是否可读）
   → 渲染层入 store，列表渲染

用户拖滑块
   → 纯前端计算预估（不请求主进程），实时更新

用户按 CTA
   → IPC task:start({ items, shrinkPercent, outputFormat, outputDir })
   → 主进程队列并发 4-8 逐张处理
   → 每张完成 webContents.send('task:progress', ...)
   → 渲染层逐行落位
   → 全部完成 webContents.send('task:done', ...)
```

---

## 4. 图像引擎 `src/main/image/`

### 4.1 为什么必须是纯函数

`src/main/image/` 下**不允许出现任何 `import ... from 'electron'`**。所有文件系统访问通过参数注入（例如传入 `readFile`、`exists` 函数）。

理由有三：可以脱离 Electron 用 Vitest 直接单测；可以脱离 GUI 跑批量回归；未来要抽成 CLI 或换壳时零成本。

### 4.2 模块清单

```ts
// types.ts
export type ImageFormat = 'heic' | 'jpeg' | 'png' | 'webp' | 'avif' | 'gif' | 'tiff' | 'unknown';
export type OutputFormat = 'keep' | 'jpeg' | 'png' | 'webp';

export interface ProbeResult {
  format: ImageFormat;
  width: number;
  height: number;
  bytes: number;
  hasAlpha: boolean;
  orientation: number;      // 1-8，来自 EXIF
  icc: string | null;       // ICC profile 名，如 'srgb'
}

export interface EncodePlan {
  format: Exclude<OutputFormat, 'keep'>;
  quality: number | null;   // null 表示该格式无质量档（PNG）
  palette: boolean;         // PNG 专用
  attempt: number;
}

export interface CompressResult {
  bytes: number;
  width: number;
  height: number;
  format: string;
  quality: number | null;
  /** 质量底线挡住了目标体积，实际没压到。界面需要如实告知 */
  undershot: boolean;
  /** 透明通道被拍平到白底（仅 JPG） */
  flattened: boolean;
}
```

```ts
// probe.ts
export function probe(buf: Buffer, bytes: number): Promise<ProbeResult>
```

```ts
// plan.ts：纯计算，不碰 sharp，最容易测
export function qualityFloor(shrinkPercent: number): number
export function targetBytes(originalBytes: number, shrinkPercent: number): number
export function nextQuality(
  shrinkPercent: number,
  history: Array<{ quality: number; bytes: number }>
): number | null            // null = 已收敛，取 history 中最优解
```

```ts
// encode.ts：唯一的 sharp 编码出口
export function encode(
  input: Buffer | { data: Buffer; width: number; height: number },
  plan: EncodePlan,
  opts: { orientation: number; keepIcc: boolean; flatten: boolean }
): Promise<{ data: Buffer; info: { width: number; height: number; format: string } }>
```

```ts
// compress.ts：单张图的完整流程
export function compressOne(input: {
  buf: Buffer;
  originalBytes: number;
  shrinkPercent: number;
  outputFormat: OutputFormat;
  probe: ProbeResult;
}): Promise<{ data: Buffer; result: CompressResult }>
```

```ts
// verify.ts
export function assertSameDimensions(before: { width: number; height: number },
                                     after:  { width: number; height: number }): void
```

```ts
// naming.ts：纯函数，exists 注入以便测试
export function resolveOutputPath(input: {
  sourcePath: string;
  outputDir: string;
  targetExt: string;
  exists: (p: string) => boolean;
}): string
```

```ts
// heic.ts
export function canSharpDecodeHeic(): Promise<boolean>
export function decodeHeic(buf: Buffer): Promise<{ data: Buffer; width: number; height: number }>
```

### 4.3 压缩算法（核心）

**输入**：`shrinkPercent` p ∈ [20, 90]。
**目标**：输出字节数 ≈ `originalBytes × (1 - p/100)`。

```
TARGET = originalBytes * (1 - p/100)
FLOOR  = qualityFloor(p)          // 见下

若输出格式支持有损（jpeg / webp）：
  1. 在 [FLOOR, 95] 区间二分搜索质量档
  2. 每轮用当前 q 编码一次，比较字节数
  3. 字节数 <= TARGET → 记录为候选，抬高下界
     字节数 >  TARGET → 压低上界
  4. 最多 6 次编码，收敛即提前结束
  5. 取所有候选中最小的 q（满足体积前提下质量最优）

  若 6 次后没有任何候选命中：
    输出 q = FLOOR 的结果，标记 undershot = true
    质量底线优先于体积目标。这是承诺二的要求。

若输出格式是 png：
  无法有损压缩。尝试两件事：
    a) 颜色数 <= 256 → 量化到调色板（palette: true）
    b) compressionLevel: 9
  若结果反而变大 → 返回原文件字节，标记 undershot = true
```

**质量底线 `qualityFloor(p)`**：

| p | FLOOR | 含义 |
|---|---|---|
| p ≤ 70 | **82** | 感知无损区。这是"正常观看看不出差别"的工程落点 |
| p > 70 | **62** | 用户主动越过安全线，接受放大可见的压缩痕迹 |

**性能预算**：单张 4MB 照片，6 次编码约 1.5-2.5s。这是可接受的，因为界面逐行落位、有进度反馈。
**可选优化**（v1.1）：把上一张的最优质量作为下一张的二分初值，通常能把 6 次压到 3 次。

### 4.4 承诺二的落点（三条硬断言）

1. **绝不调用 `.resize()`。** 代码审查时搜索 `.resize(` 应当零命中。加一条 ESLint 自定义规则或 CI grep 拦截。
2. **每次输出后断言宽高一致。** `assertSameDimensions` 不通过就抛 `DIMENSION_CHANGED`，该张标记为 `failed`，**不写入文件**。
3. **不达标就如实说。** `undershot === true` 时，界面把该行标为"未达标"并给出原因，绝不静默交付。

### 4.5 元数据、方向、色彩配置

这一节是观感不变的关键，也是最容易做错的地方。

| 项 | 处理 | 为什么 |
|---|---|---|
| EXIF 方向 | **保留**（写回 orientation 标签） | 手机竖拍照片的像素是横的，靠 EXIF orientation 旋转显示。丢掉它，照片会躺倒 |
| ICC 色彩配置 | **保留** | 丢掉会让 sRGB 之外的图（如 Display P3）明显偏色 |
| 其余 EXIF / GPS / 缩略图 | **丢弃** | 压缩的必要条件（内嵌缩略图常有 30KB+），顺带减少隐私泄露 |

```ts
// encode.ts 的目标写法（具体 API 组合见下方 M0 验证项）
sharp(input)
  // 绝不调用 .resize()、绝不调用 .rotate()
  // 目标：保留 ICC profile + 写入 orientation 标签，丢弃其余 EXIF
```

**⚠️ M0 必须验证的 API 细节**：sharp 0.33+ 的 `withMetadata()` 语义有变化，下面这几种写法效果不同，**不要凭记忆写**，跑一遍再定：

```js
const sharp = require('sharp');
const fs = require('fs');

const src = fs.readFileSync('./tests/fixtures/iphone-portrait.heic');
(async () => {
  const before = await sharp(src).metadata();
  console.log('输入 orientation:', before.orientation, 'icc:', before.icc);

  const cases = {
    'A 不写任何 metadata':        sharp(src),
    'B withMetadata()':           sharp(src).withMetadata(),
    'C withMetadata({orientation})': sharp(src).withMetadata({ orientation: before.orientation }),
    'D keepIcc + orientation':    sharp(src).keepIccProfile().withMetadata({ orientation: before.orientation }),
  };

  for (const [name, p] of Object.entries(cases)) {
    const buf = await p.jpeg({ quality: 85 }).toBuffer();
    const meta = await sharp(buf).metadata();
    console.log(name.padEnd(30),
      'orientation =', meta.orientation,
      '| icc =', !!meta.icc,
      '| exif =', !!meta.exif,
      '| 字节 =', buf.length);
  }
})();
```

**判定标准**：选那个 `orientation` 正确、`icc` 保留、`exif` 最小、字节数最小的组合。
若没有任何组合能同时满足「保留 ICC + 写入 orientation + 不夹带完整 EXIF」，优先保 orientation 与 ICC，接受 EXIF 被部分保留，并在 `docs/decisions.md` 记录取舍。

**为什么不用 `.rotate()`**：`rotate()` 在 orientation 为 5/6/7/8 时会真正旋转像素，导致宽高互换，违反断言 2。保留标签是唯一同时满足"尺寸不变"和"显示正确"的做法。

**已知副作用（需产品确认，见 §13）**：EXIF 会被清掉。这不是"去 EXIF"功能，是压缩的副产品。界面上不宣传，也不隐藏。

### 4.6 格式转换规则

| 输出格式 | 编码参数 | 透明通道 |
|---|---|---|
| 保持原格式 | 按源格式走对应编码器 | 按源格式能力 |
| JPG | `jpeg({ mozjpeg: true, quality })` | **拍平到白底**（JPG 无 alpha） |
| PNG | `png({ compressionLevel: 9, palette })` | 保留 |
| WebP | `webp({ quality, effort: 4 })` | 保留 |

**输入侧**：
- HEIC → 见 §5，先解码成 RGBA raw 再进 sharp
- AVIF → sharp 原生支持
- GIF → 只取第一帧（多帧动图不在 v1 范围），并给出提示

### 4.7 输出命名与防覆盖

`resolveOutputPath` 规则：

1. `base = basename(source, extname(source))`
2. `candidate = join(outputDir, base + '.' + targetExt)`
3. 若 `exists(candidate)` **或** `candidate === sourcePath`：追加 ` (2)`、` (3)`… 直到不冲突

第 3 条的第二个条件是必须的：当用户把输出目录设成原图目录、且格式保持原格式时，输出名会和原文件同名，不加保护就会原地覆盖。

**默认输出目录**：`<第一张图所在目录>/processed`。首次启动时写入 settings，之后沿用用户的选择。

### 4.8 并发

`queue.ts` 是一个 Promise 池，并发数 `clamp(os.cpus().length - 1, 4, 8)`。

- 支持 `cancel(taskId)`：已开始的当前张跑完，队列里未开始的直接跳过
- 每张完成立即 `webContents.send`，不等整批
- 单张失败不中断整批，标记该张 `failed` 后继续

---

## 5. ⚠️ 风险点：sharp 无法解码 HEIC

### 5.1 事实

**sharp 的预编译二进制不含 HEVC 解码器，因此无法读取 .HEIC 文件。**

官方 issue #4132 中维护者 lovell 的原话是「HEIF is the container, HEVC is the codec, HEIC is the combination of these」，并为此专门修改了 `sharp.format.heif` 的输出来反映预编译二进制的真实能力。实际报错是：

```
heif: Unsupported feature: Unsupported codec (4.3000)
```

预编译版能处理的是 **AVIF**（AV1 编码），不是 **HEIC**（HEVC 编码）。二者容器相同、编码器不同。

**这对本产品是致命问题**：目标用户的主力输入就是 iPhone 拍的 HEIC 照片，原型里 11 张示例图有 4 张是 HEIC。

### 5.2 方案

引入 `heic-decode`（基于 `libheif-js` 的 WASM 实现，纯 JS，无需本地编译，完全离线，约 2MB）。

```
读文件 Buffer
  → 尝试 sharp.metadata() 探测
  → 失败且扩展名/文件头是 HEIC
      → heic-decode(buf) 得到 { width, height, data: RGBA }
      → sharp(data, { raw: { width, height, channels: 4 } })
      → 后续流程完全一致
```

选 `heic-decode` 而不是 `heic-convert` 的理由：前者返回 raw 像素，不经过一次有损 JPEG 中间编码，保住"观感不变"。

### 5.3 第一天就要跑的验证脚本

**在写任何界面代码之前**，先跑通这个：

```bash
npm i sharp heic-decode
node -e "
const sharp = require('sharp');
const heic = require('heic-decode');
const fs = require('fs');
const buf = fs.readFileSync('./tests/fixtures/iphone.heic');
console.log('sharp 能否读:', sharp.format.heif);
heic({ buffer: buf }).then(r => {
  console.log('heic-decode 尺寸:', r.width, r.height, '通道:', r.data.length / (r.width*r.height));
  return sharp(Buffer.from(r.data), { raw: { width: r.width, height: r.height, channels: 4 } })
    .jpeg({ quality: 85 }).toBuffer();
}).then(b => console.log('编码成功，字节:', b.length))
  .catch(e => console.error('失败:', e.message));
"
```

必须准备三张 fixture：iPhone 竖拍 HEIC、iPhone 横拍 HEIC、Android HEIC。

**同时要验证的两个坑**：
1. `heic-decode` 返回的 raw 是否已应用了 EXIF orientation（若已应用，则后续不能再写 orientation 标签，否则会二次旋转）
2. 10-bit HEIC（部分新机型）能否正常解码

若 `heic-decode` 也不可用，退路是让用户先用系统"导出为 JPG"。**不要**为了让 HEIC 跑通去编译自定义 libvips，那会把打包复杂度推到一个个人项目无法维护的程度。

---

## 6. IPC 契约

### 6.1 通道表

全部使用 `invoke/handle`（请求-响应），只有进度是单向推送。

| 通道 | 方向 | 入参 | 返回 |
|---|---|---|---|
| `files:probe` | R→M | `{ paths: string[] }` | `ImageFileMeta[]` |
| `dialog:pickImages` | R→M | 无 | `{ paths: string[] } \| null` |
| `dialog:pickOutputDir` | R→M | 无 | `{ dir: string } \| null` |
| `task:start` | R→M | `StartTaskPayload` | `{ taskId: string }` |
| `task:cancel` | R→M | `{ taskId: string }` | `void` |
| `settings:get` | R→M | 无 | `Settings` |
| `settings:set` | R→M | `Partial<Settings>` | `Settings` |
| `task:progress` | M→R | `TaskProgressEvent` | 无 |
| `task:done` | M→R | `TaskDoneEvent` | 无 |

拖拽入图的路径获取：Electron 32 起 `File.path` 已被移除，替代方案是 `webUtils.getPathForFile(file)`。preload 暴露 `getDroppedPaths(files: File[]): string[]`。

**⚠️ M1 验证项**：`webUtils` 的官方标注是 renderer 进程模块，在 `sandbox: true`（Electron 默认）的 preload 里能否 `require('electron').webUtils` 需要实测。若不可用，把 `webPreferences.sandbox` 显式设为 `false`。这**不影响**两条红线（`contextIsolation: true` + `nodeIntegration: false` 保持不动），只是让 preload 能拿到完整 electron 模块。两条红线永远不动。

### 6.2 类型定义 `src/shared/types.ts`

```ts
export type ImageFormat = 'heic' | 'jpeg' | 'png' | 'webp' | 'avif' | 'gif' | 'tiff' | 'unknown';
export type OutputFormat = 'keep' | 'jpeg' | 'png' | 'webp';
export type ItemState = 'pending' | 'working' | 'done' | 'undershot' | 'failed';

export interface ImageFileMeta {
  id: string;              // nanoid，渲染层主键
  name: string;            // 仅文件名，用于展示
  ext: string;
  bytes: number;
  format: ImageFormat;
  width: number;
  height: number;
  hasAlpha: boolean;
  readable: boolean;
  reason?: string;         // readable=false 时的原因
}

export interface StartTaskPayload {
  taskId: string;
  items: Array<{ id: string; path: string; bytes: number; format: ImageFormat; width: number; height: number; hasAlpha: boolean }>;
  shrinkPercent: number;   // 20-90
  outputFormat: OutputFormat;
  outputDir: string;
}

export interface TaskProgressEvent {
  taskId: string;
  itemId: string;
  index: number;
  total: number;
  state: ItemState;
  outBytes?: number;
  outName?: string;
  width?: number;
  height?: number;
  quality?: number | null;
  reason?: string;
}

export interface TaskDoneEvent {
  taskId: string;
  done: number;
  undershot: number;
  failed: number;
  outputDir: string;
}

export interface Settings {
  outputDir: string | null;
  shrinkPercent: number;
  outputFormat: OutputFormat;
  lastDir: string | null;
}
```

### 6.3 安全约束

```ts
// window.ts
new BrowserWindow({
  width: 980, height: 768, minWidth: 880, minHeight: 620,
  backgroundColor: '#EFEDE8',
  show: false,
  webPreferences: {
    preload: join(__dirname, '../preload/index.js'),
    contextIsolation: true,      // 红线，不可关闭
    nodeIntegration: false,      // 红线，不可关闭
    // sandbox 保持默认 true
  }
})
```

```ts
// security.ts：运行时强制零联网
session.defaultSession.webRequest.onBeforeRequest((details, cb) => {
  const ok = details.url.startsWith('file://') || details.url.startsWith('devtools://');
  cb({ cancel: !ok });
});
```

生产环境 CSP（通过 `onHeadersReceived` 注入）：

```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:;
connect-src 'none';
font-src 'self';
```

`img-src` 里的 `blob:` 是给未来可能的缩略图预览留的；v1 列表不显示缩略图，可以先不加。

---

## 7. 状态管理 `useAppStore`

```ts
interface AppState {
  // 数据
  items: ImageItem[];
  taskId: string | null;
  running: boolean;

  // 设置（与主进程 settings 双向同步）
  shrinkPercent: number;    // 默认 65
  outputFormat: OutputFormat; // 默认 'keep'
  outputDir: string;

  // 派生（用 selector 算，不存）
  // totalBytes / estimateBytes / counts
}

interface ImageItem {
  id: string;
  name: string;
  bytes: number;
  format: ImageFormat;
  hasAlpha: boolean;
  readable: boolean;
  reason?: string;
  state: ItemState;
  outBytes?: number;
}
```

规则：
- **滑块拖动不触发 IPC。** 预估量在前端算（`totalBytes × (1 - p/100)`），实时更新。
- `task:progress` 事件按 `itemId` 定点更新单行，不整表重渲。
- 空列表时左栏整体隐藏（见 DESIGN.md §4 空态）。

---

## 8. 界面实现规范

### 8.1 视觉基准

`prototype/index.html` 是唯一基准。开发时并排打开它比对，任何像素级差异都要有理由。
组件状态、动效时长、文案规则全部在 `DESIGN.md`，不在本文档重复。

### 8.2 Token → Tailwind v4 `@theme`

```css
/* src/renderer/styles/tokens.css */
@import "tailwindcss";

@theme {
  /* primitive */
  --color-bone-050: #FBFAF8;
  --color-bone-200: #EFEDE8;
  --color-stone-100: #F4F2EE;
  --color-stone-200: #E9E6E0;
  --color-line-100: #E8E5DF;
  --color-line-200: #D8D4CC;
  --color-ink-900: #141414;
  --color-ink-700: #3A3835;
  --color-ink-500: #6B6963;
  --color-amber-700: #8A5B00;

  /* semantic */
  --color-bg-app: var(--color-bone-200);
  --color-bg-surface: #FFFFFF;
  --color-border: var(--color-line-100);
  --color-border-strong: var(--color-line-200);
  --color-fg: var(--color-ink-900);
  --color-fg-2: var(--color-ink-700);
  --color-fg-3: var(--color-ink-500);
  --color-accent: var(--color-ink-900);
  --color-caution: var(--color-amber-700);

  /* type */
  --font-sans: "Segoe UI Variable Text","Segoe UI","PingFang SC","Microsoft YaHei UI",system-ui,sans-serif;
  --font-mono: "Cascadia Mono",Consolas,"SF Mono",ui-monospace,monospace;
  --text-1: 12px;  --text-2: 15px;  --text-3: 20px;  --text-4: 36px;

  /* radius：全站唯一规则，不得出现第四个值 */
  --radius-window: 12px;
  --radius-control: 6px;
  --radius-inline: 4px;
}
```

### 8.3 组件与原型元素的对应

| 组件 | 对应原型选择器 |
|---|---|
| `AppHeader` | `.top` |
| `ControlPane` | `.pane` |
| `ShrinkSlider` | `.field`（第一个）+ `.slider-wrap` + `.scale` |
| `FormatPicker` | `.fmts` |
| `DestinationPicker` | `.picker` + `.hint` |
| `QualityNote` | `.note` |
| `EstimateLine` | `.estimate` |
| `PrimaryButton` | `.cta` + `.foot` |
| `DropZone` | `.drop` |
| `ListMeta` | `.meta` |
| `FileRow` | `.file` |
| `FileList` | `.files` |

### 8.4 文案表（集中管理，禁止散落在组件里）

```
拖拽区（有图）   拖入更多图片，或 [选择文件]
拖拽区（空）     把图片拖到这里 [选择文件] / HEIC、JPG、PNG、WebP。一张也行，几十张也行
体积缩小         体积缩小
刻度             几乎看不出 / 能看出差别
输出格式         输出格式
格式选项         保持原格式 / JPG / PNG / WebP
存放位置         存放位置 [更改]
存放位置说明     原图不会被改动，压缩后的新文件单独放在这里
承诺句           不改尺寸，不裁剪，不重绘。只重新编码，正常观看看不出差别。
越线警告         超过 70% 后，放大到 100% 能看出压缩痕迹。图片尺寸仍然不变。
PNG 劝阻         PNG 是无损格式。照片类压不动，截图和纯色图能压很多。
CTA 默认         压缩这 {n} 张
CTA 处理中       处理中 {i} / {n}
CTA 完成         再压一次
底部声明         图片只在这台电脑上处理，不会上传
完成提示         完成。原图没动，新文件在 {path}
列表元信息       共 {n} 张 · {size}
超过单批上限      （已忽略 {n} 张）      # 跟在元信息后面，2026-09-21 用户决定加单批 100 张上限时新增
压到底了          这张已经压到底了            # 行内第四格，2026-09-22 定。只在 undershot 行出现
压到下限          质量已到下限，只压到 {x}%     # 同上。{x} = 输出体积占原图的百分比
行内-找不到        找不到这个文件            # 失败行的体积格，2026-09-22 补
行内-没权限        没有读取权限              # 同上
行内-不是文件       这不是文件               # 同上
行内-超时          处理超时了               # 同上
行内-写不进去       写不进去                # 同上
行内-磁盘满        磁盘满了                # 同上
行内-兜底          读不了这张图              # 同上。保证每个原因码都有话说，不留空白格
空拖入            没有可压缩的图片            # 一张都没加进来时，底部那行显示，2026-09-22 补
批次错误-写不进去   这个文件夹写不进去，换一个试试   # 2026-09-21 用户确认。底部那行显示
批次错误-磁盘满    磁盘满了，后面的图没有处理      # 同上
批次错误-兜底      这批没有跑完                # 同上，保证任何原因都有话说
清空             清空列表
移除             移除
```

**写作纪律**：零 em-dash（`—` 和 `–` 都不行，中文里也不用"——"）。零 emoji。中黑点 `·` 每行最多一个。禁用"赋能 / 一站式 / 极致 / 轻松搞定 / 无缝 / 释放"。

---

## 9. 错误处理与边界情况

| 场景 | 处理 |
|---|---|
| 文件不存在 / 无读权限 | `readable: false`，行内显示原因，不参与处理 |
| 文件头损坏 | 同上，文案「文件已损坏，无法读取」 |
| HEIC 解码失败 | 该张 `failed`，文案「这台机器上的 HEIC 解码器打不开这张图」 |
| 输出目录不存在 | 自动 `mkdir -p`；创建失败则弹错并中止整批 |
| 输出目录无写权限 | 处理前预检，不可写则 CTA 前置报错，不让用户白等 |
| 磁盘空间不足 | 捕获 `ENOSPC`，中止整批并提示 |
| 输出比原图还大 | 返回原文件字节，标 `undershot`，行内第四格显示「这张已经压到底了」 |
| 压不到目标体积 | 标 `undershot`，行内第四格显示「质量已到下限，只压到 {x}%」，{x} = 输出体积占原图的百分比。绝不为了达标牺牲观感 |
| 单张处理超时（>30s） | 标记 `failed`，继续下一张 |
| 用户在处理中改滑块 | 滑块只影响下一次运行，不打断当前批次 |
| 处理中清空列表 | 先 `task:cancel` 再清 |
| 用户选了原图所在目录 + 保持原格式 | `resolveOutputPath` 追加 ` (2)`，绝不覆盖 |
| 同名文件已存在 | 同上 |
| 拖入文件夹 | 展开一层取图片文件；一张都没加进来时底部那行显示「没有可压缩的图片」 |
| 拖入非图片文件 | 静默过滤，不报错。但若**一张都没加进来**（只拖了非图片 / 空文件夹），底部那行要说一声，否则界面毫无反应 |
| 拖入超过 100 张 | 只收前 100 张，其余忽略；元信息行报出「（已忽略 {n} 张）」。上限在主进程展开目录之后执行，不先读全量 |

---

## 10. 测试计划

### 10.0 测试图片从哪来（**开工前必须先解决**）

测试需要 10 张 fixture，但它们不能凭空产生，也不能从网上拉。分两类处理：

**A 类：能合成的（8 张）**：用 sharp 现场生成，写成脚本提交进仓库。

```js
// scripts/make-fixtures.mjs
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';

mkdirSync('tests/fixtures', { recursive: true });

const noise = (w, h, ch) => {
  const buf = Buffer.alloc(w * h * ch);
  for (let i = 0; i < buf.length; i++) buf[i] = (Math.random() * 256) | 0;
  return sharp(buf, { raw: { width: w, height: h, channels: ch } });
};

// 1. 高噪点 JPG（最难压，用来验证 undershot）
await noise(4000, 3000, 3).jpeg({ quality: 95 }).toFile('tests/fixtures/noise-hi.jpg');

// 2. 纯色 PNG（最容易压，用来验证 palette 路径）
await sharp({ create: { width: 2000, height: 1500, channels: 3, background: '#3A7BD5' } })
  .png().toFile('tests/fixtures/flat-solid.png');

// 3. 带 alpha 的 PNG（用来验证 flatten）
await sharp({ create: { width: 1200, height: 1200, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0.5 } } })
  .png().toFile('tests/fixtures/alpha-cutout.png');

// 4. 1×1 像素图（最小边界）
await sharp({ create: { width: 1, height: 1, channels: 3, background: '#000' } })
  .png().toFile('tests/fixtures/tiny-1x1.png');

// 5. 超大图 8000×6000（验证并发与内存）
await noise(8000, 6000, 3).jpeg({ quality: 90 }).toFile('tests/fixtures/huge-8000.jpg');

// 6. WebP 输入
await noise(2400, 1600, 3).webp({ quality: 90 }).toFile('tests/fixtures/sample.webp');

// 7. AVIF 输入（sharp 原生支持，验证输入侧）
await noise(1600, 1200, 3).avif({ quality: 60 }).toFile('tests/fixtures/sample.avif');

// 8. 带 orientation 标签的 JPG（验证方向保留）
await sharp({ create: { width: 1200, height: 900, channels: 3, background: '#888' } })
  .withMetadata({ orientation: 6 }).jpeg({ quality: 90 })
  .toFile('tests/fixtures/oriented-6.jpg');

console.log('合成 fixture 完成');
```

**B 类：必须人工提供（2 张 HEIC）**：sharp 编不出 HEIC，也无法从网络获取。

在 `tests/fixtures/` 手动放入两张真实 iPhone 拍的 `.heic`：

- `iphone-portrait.heic`：竖拍（orientation 通常为 6）
- `iphone-landscape.heic`：横拍

**做法**：从 iPhone 通过 AirDrop / 数据线导出原始 HEIC（不要用微信转发，会被转成 JPG）。若手边没有 iPhone，去 Apple Store 样机拍两张也行。

**测试要优雅降级**：`heic.spec.ts` 与黄金测试中的 HEIC 用例，在 fixture 不存在时 `test.skip`，并打印一行提示。这样没有 HEIC 的人也能跑通其余测试，CI 上不会红。

### 10.1 单元测试（Vitest，覆盖 `src/main/image/`，不需要 Electron）

| 文件 | 必测 |
|---|---|
| `plan.spec.ts` | `qualityFloor` 边界（20 / 70 / 71 / 90）；二分收敛；收敛不了时返回 null |
| `naming.spec.ts` | 冲突追加序号；**输出路径等于源路径时必须改名**；多扩展名（`.tar.gz` 类） |
| `verify.spec.ts` | 尺寸不一致时抛 `DIMENSION_CHANGED` |
| `probe.spec.ts` | 各格式的宽高、alpha 判定、orientation 读取 |
| `compress.spec.ts` | **黄金测试**：见下 |

**`compress.spec.ts` 的黄金断言（每次改动都必须全绿）**：

```
对 tests/fixtures/ 下每一张图，在 p ∈ {20, 45, 70, 85} 各跑一次：
  1. 输出宽高 === 输入宽高            ← 承诺二
  2. 输出字节 <= 输入字节              ← 压不动就返回原图
  3. p <= 70 时 quality >= 82          ← 感知无损底线
  4. 输出格式 === 请求的格式
  5. 有 alpha 的图转 JPG 后 flattened === true
```

fixture 清单：见 §10.0。A 类 8 张脚本合成，B 类 2 张 HEIC 人工提供。

### 10.2 端到端（Playwright + Electron）

v1 只做一条冒烟：启动 → 拖入 3 张 fixture → 拖滑块到 60% → 点 CTA → 等完成 → 断言输出目录里有 3 个文件且宽高与原图一致。

### 10.3 手工验收清单

- [ ] 断网启动，全流程可用
- [ ] DevTools Network 面板全程零请求
- [ ] 键盘走完整个流程（Tab / Space / Enter / 方向键调滑块）
- [ ] 100% 缩放对比原图与输出，看不出差别
- [ ] 输出目录设为原图目录，原图未被改动
- [ ] 窗口缩到最小尺寸（880×620）不破版

---

## 11. 打包与发布

```yaml
# electron-builder.yml 要点
appId: com.picturemore.app
productName: 图压压
directories: { output: release }
files:
  - "out/**"
  - "package.json"
  - "!**/*.map"
  - "!**/.workbuddy-ai/**"      # 9.3MB 技能目录，绝不打进包
  - "!**/prototype/**"
asarUnpack:
  - "**/node_modules/sharp/**"   # 原生模块必须解包
  - "**/node_modules/@img/**"
win:
  target: [nsis]
  artifactName: "${productName}-${version}-setup.${ext}"
nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
  createDesktopShortcut: always
```

**体积预算**：Electron 运行时约 80MB + sharp 约 30MB + libheif-js WASM 约 2MB + 前端产物约 1MB ≈ **113MB**。
比不加 HEIC 支持多 2MB，值得。

**签名**：v1 不买代码签名证书。用户会看到 SmartScreen 警告，在安装说明里写明"点更多信息 → 仍要运行"。

---

## 12. 开发里程碑

每个里程碑结束都应当是可运行、可验收的状态。

### M0 · 技术验证（半天）

- [ ] 跑通 §5.3 的 HEIC 验证脚本
- [ ] 跑通 §4.5 的 metadata API 验证脚本，定下 ICC / orientation / EXIF 的写法
- [ ] 确认 `heic-decode` 返回的 raw 是否已应用 EXIF orientation（若已应用，后续不能再写 orientation 标签，否则二次旋转）
- [ ] 确认 10-bit HEIC 的处理结果
- [ ] 记录全部结论到 `docs/decisions.md`

**验收**：iPhone HEIC 能被读成 raw 并编码成 JPEG，宽高正确、方向正确、色彩正确。

**这个里程碑不过，后面全部重做。先做它。**

### M1 · 骨架（半天）

- [ ] electron-vite 起项目，主进程 / preload / 渲染层三份能通
- [ ] `security.ts` 网络拦截生效
- [ ] 一个空的 BrowserWindow 能起来，`contextIsolation` 生效

**验收**：`npm run dev` 出窗口，DevTools 里 `window.require` 是 undefined。

### M2 · 图像引擎（2 天，**最重要**）

- [ ] `src/main/image/` 全部模块 + 单元测试
- [ ] 黄金断言全绿
- [ ] 加 CI grep 拦截 `.resize(`

**验收**：`npm test` 全绿，fixture 覆盖 10 张图 × 4 个压缩档。

### M3 · 界面（2 天）

- [ ] Token 落到 Tailwind `@theme`
- [ ] 12 个组件按原型实现，逐项对照 `DESIGN.md` §5 的状态矩阵
- [ ] store 接通，拖拽 / 选择 / 滑块 / 格式 / 存放位置全部可用
- [ ] 空态、处理中、未达标、失败四态齐备

**验收**：与 `prototype/index.html` 并排比对，肉眼无差异。

### M4 · 串通与打磨（1 天）

- [ ] IPC 全链路，进度逐行落位
- [ ] §9 的边界情况逐条走一遍
- [ ] 键盘可操作性验收
- [ ] 文案表逐条比对

### M5 · 打包（半天）

- [ ] electron-builder 出 NSIS 安装包
- [ ] 干净机器上安装、启动、断网跑通
- [ ] 确认包体在 120MB 以内

---

## 13. 已定的三个决定

这三条原本是待确认项，现已按最优解定稿。**开发时直接照此执行，不要再停下来问。**
如果用户后续要改，改这里和对应的实现点即可。

**① 压缩时清掉 EXIF，保留 ICC 与方向（§4.5）**：**已定清掉。**

- 保留：ICC 色彩配置（不保留会偏色）、EXIF orientation 标签（不保留照片会躺倒）
- 丢弃：拍摄时间、设备型号、GPS、内嵌缩略图等全部其余元数据
- 理由：内嵌缩略图常有 30KB+，不清掉压不动；顺带减少隐私泄露
- 已知副作用：用户可能发现拍摄时间没了。界面上**不宣传也不隐藏**，不做任何提示
- 实现点：`src/main/image/encode.ts`

**② JPG + 透明图要有提示态（§4.6）**：**已定加。**

- 触发条件：输出格式 = JPG，且列表中至少一张 `hasAlpha === true`
- 文案：`选中的图里有 {n} 张带透明区域，转成 JPG 后透明部分会变成白色。`
- 颜色：琥珀 `--caution`
- 优先级：排在 PNG 劝阻之后、越线警告之前（完整四态表见 `DESIGN.md` §7）
- **原型已实现**，见 `prototype/index.html` 的 `sync()` 函数
- 实现点：`src/renderer/components/QualityNote.tsx`

**③ 引入 heic-decode，包体增加约 2MB（§5）**：**已定引入。**

- 不加的后果是 iPhone 用户的主力格式打不开，产品基本不可用，没有选择余地
- 体积预算从 113MB 调整为 **115MB**

---

## 14. 已知陷阱

这些坑都会真实地卡住你，且大多不会给出有用的报错。逐条看完再动手。

### 14.1 图像相关

| 陷阱 | 后果 | 规避 |
|---|---|---|
| sharp 预编译版不解 HEIC | 直接报 `Unsupported codec (4.3000)` | 见 §5，用 `heic-decode` 兜底 |
| `.rotate()` 会改宽高 | orientation 为 5/6/7/8 时像素真旋转，宽高互换 | 永不调用，只写 orientation 标签 |
| `withMetadata()` 语义与直觉不符 | ICC 可能丢、EXIF 可能全保留 | 先跑 §4.5 的验证脚本，不要凭记忆写 |
| sharp 是原生模块 | Vite 打包时会被当成普通包处理，运行时报找不到 `.node` | `build.rollupOptions.external` 里加 `sharp`；electron-builder 里 `asarUnpack` |
| 渲染层误 import sharp | 打包直接失败，或运行时崩 | 加 ESLint `no-restricted-imports` 禁止 renderer 引用 sharp |
| 大图 OOM | 8000×6000 的图同时跑 8 张会吃满内存 | 并发上限 8，且用 `sharp.cache(false)` 关闭 sharp 内部缓存 |

### 14.2 Electron / 构建相关

| 陷阱 | 后果 | 规避 |
|---|---|---|
| Electron 32 起 `File.path` 已移除 | 拖拽拿到的是空字符串 | 用 `webUtils.getPathForFile(file)`，见 §6.1 |
| `webUtils` 在 sandbox preload 里可能不可用 | `require('electron').webUtils` 为 undefined | 实测；不行就把 `sandbox` 显式设 false（两条红线不动） |
| `.workbuddy-ai/` 有 9.3MB | 被打进安装包 | electron-builder `files` 里排除，见 §11 |
| Tailwind v4 用错 PostCSS 插件 | 样式全不生效，无报错 | 用 `@tailwindcss/vite`，不要写 `tailwindcss` 到 `postcss.config.js` |
| dev 模式下 React 严格模式双执行 | IPC 事件监听器注册两次，进度回调跑两遍 | 监听写在 `useEffect` 的 cleanup 里，或改用 `ipcRenderer.on` 只注册一次的模块级单例 |
| 打包后 `__dirname` 指向 asar 内 | preload 路径拼错，白屏 | 用 `join(__dirname, '../preload/index.js')`，并确保 preload 在 `files` 白名单里 |
| Windows 路径反斜杠 | 字符串里 `\p` `\2` 被当转义 | 一律用 `path.join()`，字面量路径写双反斜杠或用正斜杠 |

### 14.3 依赖相关

| 陷阱 | 后果 | 规避 |
|---|---|---|
| `nanoid` v5 是 ESM-only | 在 CJS 主进程里 `require` 直接抛错 | **不用 nanoid**，用 Node 内置的 `crypto.randomUUID()` |
| `electron-store` 需要 ESM 配置 | 主进程启动失败 | **不用它**，自己写 20 行的 JSON 读写（`app.getPath('userData')`） |
| 装了一堆图标库 | 违反「全站零图标」，且增加包体 | v1 一个图标库都不装 |

### 14.4 最省事的做法

**v1 的依赖只有这五个**，多一个都不要加：

```
dependencies:    sharp, heic-decode, zustand
devDependencies: electron, electron-vite, electron-builder, react, react-dom,
                 typescript, tailwindcss, @tailwindcss/vite, vitest
```

`react-router-dom` 也不需要：本产品只有一个界面，没有路由。

---

## 15. package.json 骨架

```jsonc
{
  "name": "picturemore",
  "version": "1.0.0",
  "description": "本地图片压缩工具，图片内容永不离开你的电脑",
  "main": "out/main/index.js",
  "type": "module",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "npm run typecheck && electron-vite build && electron-builder",
    "build:dir": "electron-vite build && electron-builder --dir",
    "preview": "electron-vite preview",
    "typecheck": "tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json",
    "test": "vitest run",
    "test:watch": "vitest",
    "fixtures": "node scripts/make-fixtures.mjs",
    "lint:no-resize": "! grep -rn '\\.resize(' src/main/image/ --include='*.ts'",
    "check": "npm run lint:no-resize && npm run typecheck && npm run test"
  },
  "dependencies": {
    "sharp": "^0.35.0",
    "heic-decode": "^2.0.0",
    "zustand": "^5.0.0"
  },
  "devDependencies": {
    "electron": "^44.0.0",
    "electron-vite": "^4.0.0",
    "electron-builder": "^26.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@tailwindcss/vite": "^4.0.0",
    "tailwindcss": "^4.0.0",
    "typescript": "^5.9.0",
    "vitest": "^3.0.0"
  }
}
```

`lint:no-resize` 是承诺二的自动化护栏。`npm run check` 应当在每次提交前跑。

---

## 16. 开工前检查清单

```bash
# 1. 确认 Node 版本（electron-vite 4 需要 Node >= 20.19）
node -v

# 2. 生成项目骨架
npm create @quick-start/electron@latest . -- --template react-ts

# 3. 按 §15 调整 package.json 的 dependencies 与 scripts
#    删掉模板里多余的依赖（electron-updater、@electron-toolkit/* 之类按需保留）

# 4. 装依赖
npm install

# 5. 合成测试图
npm run fixtures
#    然后把两张真实 iPhone HEIC 放进 tests/fixtures/，命名为
#    iphone-portrait.heic 与 iphone-landscape.heic

# 6. 立刻做 M0 的两个验证脚本，不要往下走
node scripts/verify-heic.mjs       # 见 §5.3
node scripts/verify-metadata.mjs   # 见 §4.5

# 7. 把结论写进 docs/decisions.md，然后才开始 M1
```

**第 6 步不做完，后面全部可能重做。**
