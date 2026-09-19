# 图压压 pictureMore v1 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> 每个 Task 结束都必须是可验证的状态。不要跨 Task 提前实现。

**Goal:** 交付一个 Windows 桌面应用，把"发不出去的图"压到能发出去，且只改文件体积、不改图片本身。

**Architecture:** Electron 主进程持有全部文件系统与 sharp 能力，`src/main/image/` 是零 Electron 依赖的纯函数图像引擎（可脱离 Electron 单测）；preload 通过 `contextBridge` 暴露白名单 API；渲染层是 React 19 + zustand，永远不碰文件系统，只拿元信息与进度事件。

**Tech Stack:** Electron 44 · React 19 · TypeScript 5.9 · Vite 8 (electron-vite) · Tailwind CSS 4 · sharp 0.35 · heic-decode · zustand 5 · Vitest · electron-builder 26

## Global Constraints

以下约束适用于**每一个 Task**，不再重复：

- 绝不调用 `.resize()`。任何 Task 结束时 `npm run lint:no-resize` 必须通过
- 每次输出后断言宽高与输入一致，不一致抛 `DIMENSION_CHANGED` 且不写文件
- `contextIsolation: true` + `nodeIntegration: false` 永远不动
- 渲染层不 import `sharp`、不 import `node:fs`、不 import `electron`
- 不引入 `SPEC.md` §15 之外的任何依赖。特别地：不用 `nanoid`（用 `crypto.randomUUID()`）、不用 `electron-store`、不用 `react-router-dom`、不装图标库
- 界面零图标、零 emoji、零 em-dash（`—` 与 `–` 都不行）
- 文案只能取自 `SPEC.md` §8.4 文案表，不得自造
- 视觉以 `prototype/index.html` 为唯一基准
- 圆角只用 12 / 6 / 4 三个值；字号只用 12 / 15 / 20 / 36 四个值
- 每个 Task 结束跑一次 `npm run check`（= lint:no-resize + typecheck + test）

---

## Task 0：M0 技术验证（**先做这个，不要跳**）

**Files:**
- Create: `scripts/verify-heic.mjs`
- Create: `scripts/verify-metadata.mjs`
- Create: `docs/decisions.md`

**为什么先做**：这两个脚本各自可能推翻 `SPEC.md` 里已经写好的假设。跑完之前不要写任何 `src/` 下的代码。

- [ ] **Step 1: 装最小依赖并准备一张 HEIC**

```bash
npm init -y
npm i sharp heic-decode
# 从 iPhone 导出一张原始 HEIC（不要经微信转发），放到 tests/fixtures/iphone-portrait.heic
```

- [ ] **Step 2: 写 `scripts/verify-heic.mjs`**

```js
import sharp from 'sharp';
import heicDecode from 'heic-decode';
import { readFileSync } from 'node:fs';

const PATH = 'tests/fixtures/iphone-portrait.heic';
const buf = readFileSync(PATH);

console.log('sharp.format.heif =', JSON.stringify(sharp.format.heif));

// 路径 A：sharp 直接读
try {
  const m = await sharp(buf).metadata();
  console.log('[A] sharp 直读成功:', m.width, m.height, m.format);
} catch (e) {
  console.log('[A] sharp 直读失败:', e.message);
}

// 路径 B：heic-decode 兜底
const r = await heicDecode({ buffer: buf });
console.log('[B] heic-decode:', r.width, r.height, '通道 =', r.data.length / (r.width * r.height));

const out = await sharp(Buffer.from(r.data), {
  raw: { width: r.width, height: r.height, channels: 4 }
}).jpeg({ quality: 85 }).toBuffer();

const om = await sharp(out).metadata();
console.log('[B] 编码后:', om.width, om.height, 'orientation =', om.orientation, '字节 =', out.length);
console.log('[B] 宽高是否一致:', om.width === r.width && om.height === r.height);
```

- [ ] **Step 3: 跑它，记录结论**

Run: `node scripts/verify-heic.mjs`

必须回答三个问题，答案写进 `docs/decisions.md`：
1. sharp 直读是否失败？（预期：失败，报 `Unsupported codec`）
2. `heic-decode` 返回的 raw 是否已经应用了 EXIF orientation？（判断方法：把输出的 jpg 用系统看图工具打开，看方向对不对）
3. 若已应用，则后续 `encode.ts` 里**不能再写 orientation 标签**，否则二次旋转

- [ ] **Step 4: 写 `scripts/verify-metadata.mjs`**

```js
import sharp from 'sharp';
import { readFileSync } from 'node:fs';

const src = readFileSync('tests/fixtures/iphone-portrait.heic');
const { data, width, height } = await (await import('heic-decode')).default({ buffer: src });
const raw = { raw: { width, height, channels: 4 } };
const input = Buffer.from(data);

const cases = {
  'A 不写 metadata':            sharp(input, raw),
  'B withMetadata()':           sharp(input, raw).withMetadata(),
  'C withMetadata({orient:1})': sharp(input, raw).withMetadata({ orientation: 1 }),
  'D keepIcc + orient':         sharp(input, raw).keepIccProfile().withMetadata({ orientation: 1 }),
};

for (const [name, p] of Object.entries(cases)) {
  const buf = await p.jpeg({ quality: 85 }).toBuffer();
  const m = await sharp(buf).metadata();
  console.log(name.padEnd(28),
    '| orientation =', m.orientation,
    '| icc =', !!m.icc,
    '| exif =', !!m.exif,
    '| 字节 =', buf.length);
}
```

- [ ] **Step 5: 跑它，定下 `encode.ts` 的 metadata 写法**

Run: `node scripts/verify-metadata.mjs`

判定标准：选 `icc` 保留、`exif` 最小、字节最小的组合。把选中的写法原样抄进 Task 5 的 `encode.ts`。

- [ ] **Step 6: 写 `docs/decisions.md` 并提交**

```bash
git add scripts/ docs/decisions.md
git commit -m "chore: M0 spike - verify HEIC decode and metadata behavior"
```

---

## Task 1：项目骨架与安全配置

**Files:**
- Create: 项目根（electron-vite 脚手架）
- Create: `src/main/window.ts`
- Create: `src/main/security.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `createMainWindow(): BrowserWindow`；`applySecurityPolicies(session: Session): void`

- [ ] **Step 1: 生成骨架**

```bash
npm create @quick-start/electron@latest . -- --template react-ts
```

- [ ] **Step 2: 按 `SPEC.md` §15 调整 `package.json`**

删掉模板里多余的依赖，加上 `sharp`、`heic-decode`、`zustand`。scripts 照抄 §15。

- [ ] **Step 3: 装依赖并确认原生模块可用**

```bash
npm install
node -e "const s=require('sharp'); console.log('sharp ok', s.versions.vips)"
```

Expected: 打印 libvips 版本号。若报找不到 `.node`，检查 `electron-vite` 配置里的 `external`。

- [ ] **Step 4: 写 `src/main/security.ts`**

```ts
import { session } from 'electron';

export function applySecurityPolicies(): void {
  // 承诺一：运行时零联网。除本地资源外全部拦截。
  session.defaultSession.webRequest.onBeforeRequest((details, cb) => {
    const url = details.url;
    const ok =
      url.startsWith('file://') ||
      url.startsWith('devtools://') ||
      url.startsWith('blob:') ||
      url.startsWith('data:');
    if (!ok) console.warn('[blocked]', url);
    cb({ cancel: !ok });
  });
}
```

- [ ] **Step 5: 写 `src/main/window.ts`**

```ts
import { BrowserWindow, shell } from 'electron';
import { join } from 'node:path';

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 980, height: 768, minWidth: 880, minHeight: 620,
    backgroundColor: '#EFEDE8',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,   // 红线
      nodeIntegration: false,   // 红线
    },
  });

  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  return win;
}
```

- [ ] **Step 6: 验证红线生效**

Run: `npm run dev`，在 DevTools Console 里执行：

```js
console.log(typeof window.require, typeof window.process, typeof window.pictureMore)
```

Expected: `undefined undefined undefined`（第三个此时还没实现，为 undefined 正确）

- [ ] **Step 7: 验证零联网**

在 DevTools Network 面板留空，随便点几下界面。
Expected: 全程零请求。

- [ ] **Step 8: 提交**

```bash
git add -A && git commit -m "feat: project skeleton with electron security policies"
```

---

## Task 2：`plan.ts` 压缩参数推导（TDD）

**Files:**
- Create: `src/main/image/types.ts`
- Create: `src/main/image/plan.ts`
- Test: `src/main/image/plan.spec.ts`

**Interfaces:**
- Produces: `qualityFloor(p: number): number`；`targetBytes(original: number, p: number): number`；`nextQuality(p: number, history: Attempt[]): number | null`
- Produces: `type Attempt = { quality: number; bytes: number }`

- [ ] **Step 1: 写类型定义**

```ts
// src/main/image/types.ts
export type ImageFormat = 'heic' | 'jpeg' | 'png' | 'webp' | 'avif' | 'gif' | 'tiff' | 'unknown';
export type OutputFormat = 'keep' | 'jpeg' | 'png' | 'webp';

export interface ProbeResult {
  format: ImageFormat;
  width: number;
  height: number;
  bytes: number;
  hasAlpha: boolean;
  orientation: number;
  icc: string | null;
}

export interface Attempt { quality: number; bytes: number; }

export interface CompressResult {
  bytes: number;
  width: number;
  height: number;
  format: string;
  quality: number | null;
  undershot: boolean;
  flattened: boolean;
}
```

- [ ] **Step 2: 写失败的测试**

```ts
// src/main/image/plan.spec.ts
import { describe, it, expect } from 'vitest';
import { qualityFloor, targetBytes, nextQuality } from './plan';

const ORIGINAL = 4_000_000;   // 4MB 原图

describe('qualityFloor', () => {
  it('感知无损区（p <= 70）底线是 82', () => {
    expect(qualityFloor(20)).toBe(82);
    expect(qualityFloor(45)).toBe(82);
    expect(qualityFloor(70)).toBe(82);
  });
  it('越过安全线后底线降到 62', () => {
    expect(qualityFloor(71)).toBe(62);
    expect(qualityFloor(90)).toBe(62);
  });
});

describe('targetBytes', () => {
  it('p=45 时目标为原体积的 55%', () => {
    expect(targetBytes(ORIGINAL, 45)).toBe(2_200_000);
  });
});

describe('nextQuality', () => {
  it('第一次尝试返回二分中点', () => {
    expect(nextQuality(ORIGINAL, 45, [])).toBe(Math.round((82 + 95) / 2));
  });
  it('上一轮偏大则压低上界', () => {
    const q = nextQuality(ORIGINAL, 45, [{ quality: 88, bytes: 9_000_000 }]);
    expect(q).toBeLessThan(88);
    expect(q).toBeGreaterThanOrEqual(82);
  });
  it('上一轮已达标则抬高下界', () => {
    const q = nextQuality(ORIGINAL, 45, [{ quality: 88, bytes: 1_000_000 }]);
    expect(q).toBeGreaterThan(88);
  });
  it('上下界交错时收敛，返回 null', () => {
    const history = [
      { quality: 88, bytes: 9_000_000 },
      { quality: 84, bytes: 1_000_000 },
    ];
    expect(nextQuality(ORIGINAL, 45, history)).toBeNull();
  });
  it('达到 6 次尝试上限时返回 null', () => {
    const history = Array.from({ length: 6 }, (_, i) => ({ quality: 82 + i, bytes: 9_000_000 }));
    expect(nextQuality(ORIGINAL, 45, history)).toBeNull();
  });
  it('已试过的质量档不再重复返回', () => {
    const history = [{ quality: 88, bytes: 1_000_000 }, { quality: 89, bytes: 900_000 }];
    const q = nextQuality(ORIGINAL, 45, history);
    expect(history.map((h) => h.quality)).not.toContain(q);
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `npx vitest run src/main/image/plan.spec.ts`
Expected: FAIL，`Failed to resolve import "./plan"`

- [ ] **Step 4: 写实现**

```ts
// src/main/image/plan.ts
import type { Attempt } from './types';

const SAFE_MAX = 70;
const FLOOR_PERCEPTUAL = 82;   // 感知无损区
const FLOOR_VISIBLE = 62;      // 用户主动越线后
const CEIL = 95;
const MAX_ATTEMPTS = 6;

export function qualityFloor(shrinkPercent: number): number {
  return shrinkPercent > SAFE_MAX ? FLOOR_VISIBLE : FLOOR_PERCEPTUAL;
}

export function targetBytes(originalBytes: number, shrinkPercent: number): number {
  return Math.round(originalBytes * (1 - shrinkPercent / 100));
}

/**
 * 二分搜索下一个要试的质量档。
 * 返回 null 表示已收敛或已达尝试上限，调用方应从 history 里挑最优解。
 */
export function nextQuality(
  originalBytes: number,
  shrinkPercent: number,
  history: Attempt[]
): number | null {
  if (history.length >= MAX_ATTEMPTS) return null;

  const target = targetBytes(originalBytes, shrinkPercent);
  const floor = qualityFloor(shrinkPercent);
  let lo = floor;
  let hi = CEIL;

  for (const a of history) {
    if (a.bytes <= target) lo = Math.max(lo, a.quality + 1);
    else hi = Math.min(hi, a.quality - 1);
  }

  if (lo > hi) return null;

  const mid = Math.floor((lo + hi) / 2);
  return history.some((a) => a.quality === mid) ? null : mid;
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run src/main/image/plan.spec.ts`
Expected: PASS，全部 8 条

- [ ] **Step 6: 提交**

```bash
git add src/main/image/ && git commit -m "feat(image): add quality plan with perceptual floor"
```

---

## Task 3：`naming.ts` 输出路径与防覆盖（TDD）

**Files:**
- Create: `src/main/image/naming.ts`
- Test: `src/main/image/naming.spec.ts`

**Interfaces:**
- Produces: `resolveOutputPath(input: { sourcePath: string; outputDir: string; targetExt: string; exists: (p: string) => boolean }): string`

- [ ] **Step 1: 写失败的测试**

```ts
// src/main/image/naming.spec.ts
import { describe, it, expect } from 'vitest';
import { resolveOutputPath } from './naming';

const none = () => false;
const base = { outputDir: 'D:\\out', targetExt: 'jpg', exists: none };

describe('resolveOutputPath', () => {
  it('普通情况直接用原名换扩展名', () => {
    const r = resolveOutputPath({ ...base, sourcePath: 'D:\\in\\a.heic' });
    expect(r).toBe('D:\\out\\a.jpg');
  });

  it('目标已存在时追加 (2)', () => {
    const exists = (p: string) => p === 'D:\\out\\a.jpg';
    const r = resolveOutputPath({ ...base, sourcePath: 'D:\\in\\a.heic', exists });
    expect(r).toBe('D:\\out\\a (2).jpg');
  });

  it('连续冲突时序号递增', () => {
    const exists = (p: string) => ['D:\\out\\a.jpg', 'D:\\out\\a (2).jpg'].includes(p);
    const r = resolveOutputPath({ ...base, sourcePath: 'D:\\in\\a.heic', exists });
    expect(r).toBe('D:\\out\\a (3).jpg');
  });

  it('输出路径等于源路径时必须改名，绝不原地覆盖', () => {
    const r = resolveOutputPath({
      sourcePath: 'D:\\in\\a.jpg',
      outputDir: 'D:\\in',
      targetExt: 'jpg',
      exists: none,
    });
    expect(r).not.toBe('D:\\in\\a.jpg');
    expect(r).toBe('D:\\in\\a (2).jpg');
  });

  it('多个点的文件名只替换最后一个扩展名', () => {
    const r = resolveOutputPath({ ...base, sourcePath: 'D:\\in\\my.photo.v2.heic' });
    expect(r).toBe('D:\\out\\my.photo.v2.jpg');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/main/image/naming.spec.ts`
Expected: FAIL，无法解析 `./naming`

- [ ] **Step 3: 写实现**

```ts
// src/main/image/naming.ts
import { basename, dirname, extname, join, resolve } from 'node:path';

export function resolveOutputPath(input: {
  sourcePath: string;
  outputDir: string;
  targetExt: string;
  exists: (p: string) => boolean;
}): string {
  const { sourcePath, outputDir, targetExt, exists } = input;
  const sourceAbs = resolve(sourcePath);
  const stem = basename(sourcePath, extname(sourcePath));

  let candidate = join(outputDir, `${stem}.${targetExt}`);
  if (resolve(candidate) !== sourceAbs && !exists(candidate)) return candidate;

  for (let n = 2; n < 10_000; n++) {
    candidate = join(outputDir, `${stem} (${n}).${targetExt}`);
    if (resolve(candidate) !== sourceAbs && !exists(candidate)) return candidate;
  }
  throw new Error('OUTPUT_NAME_EXHAUSTED');
}

export { dirname };
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/main/image/naming.spec.ts`
Expected: PASS，5 条

- [ ] **Step 5: 提交**

```bash
git add src/main/image/ && git commit -m "feat(image): output naming never overwrites the original"
```

---

## Task 4：`verify.ts` 尺寸断言 + `probe.ts` 元信息探测

**Files:**
- Create: `src/main/image/verify.ts`
- Create: `src/main/image/probe.ts`
- Test: `src/main/image/verify.spec.ts`
- Test: `src/main/image/probe.spec.ts`

**Interfaces:**
- Produces: `assertSameDimensions(before, after): void`，抛 `ImageEngineError` 且 `code === 'DIMENSION_CHANGED'`
- Produces: `probe(buf: Buffer): Promise<ProbeResult>`
- Produces: `class ImageEngineError extends Error { code: string }`

- [ ] **Step 1: 写 `verify.ts` 的失败测试**

```ts
// src/main/image/verify.spec.ts
import { describe, it, expect } from 'vitest';
import { assertSameDimensions, ImageEngineError } from './verify';

describe('assertSameDimensions', () => {
  it('尺寸一致时通过', () => {
    expect(() => assertSameDimensions({ width: 100, height: 200 }, { width: 100, height: 200 })).not.toThrow();
  });
  it('宽度变化时抛 DIMENSION_CHANGED', () => {
    try {
      assertSameDimensions({ width: 100, height: 200 }, { width: 101, height: 200 });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ImageEngineError);
      expect((e as ImageEngineError).code).toBe('DIMENSION_CHANGED');
    }
  });
  it('宽高互换时也抛错', () => {
    expect(() => assertSameDimensions({ width: 100, height: 200 }, { width: 200, height: 100 }))
      .toThrow(ImageEngineError);
  });
});
```

- [ ] **Step 2: 跑测试确认失败，然后写实现**

```ts
// src/main/image/verify.ts
export class ImageEngineError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'ImageEngineError';
  }
}

export function assertSameDimensions(
  before: { width: number; height: number },
  after: { width: number; height: number }
): void {
  if (before.width !== after.width || before.height !== after.height) {
    throw new ImageEngineError(
      'DIMENSION_CHANGED',
      `尺寸被改动了：${before.width}x${before.height} -> ${after.width}x${after.height}`
    );
  }
}
```

Run: `npx vitest run src/main/image/verify.spec.ts` → PASS

- [ ] **Step 3: 写 `probe.ts` 的测试（依赖 fixture）**

先跑 `npm run fixtures` 生成合成图，再写：

```ts
// src/main/image/probe.spec.ts
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { probe } from './probe';

const F = 'tests/fixtures';

describe('probe', () => {
  it('读出 PNG 的尺寸与透明通道', async () => {
    const r = await probe(readFileSync(`${F}/alpha-cutout.png`));
    expect(r.format).toBe('png');
    expect(r.width).toBe(1200);
    expect(r.hasAlpha).toBe(true);
  });

  it('纯色 PNG 无透明通道', async () => {
    const r = await probe(readFileSync(`${F}/flat-solid.png`));
    expect(r.hasAlpha).toBe(false);
  });

  it('读出 JPG 的 orientation 标签', async () => {
    const r = await probe(readFileSync(`${F}/oriented-6.jpg`));
    expect(r.orientation).toBe(6);
  });

  it('1x1 边界图不崩', async () => {
    const r = await probe(readFileSync(`${F}/tiny-1x1.png`));
    expect(r.width).toBe(1);
    expect(r.height).toBe(1);
  });

  it.skipIf(!existsSync(`${F}/iphone-portrait.heic`))('读出 HEIC 尺寸', async () => {
    const r = await probe(readFileSync(`${F}/iphone-portrait.heic`));
    expect(r.width).toBeGreaterThan(1000);
    expect(r.format).toBe('heic');
  });
});
```

- [ ] **Step 4: 写 `probe.ts` 实现**

```ts
// src/main/image/probe.ts
import sharp from 'sharp';
import { canSharpDecodeHeic, decodeHeic } from './heic';
import type { ImageFormat, ProbeResult } from './types';

const MAP: Record<string, ImageFormat> = {
  jpeg: 'jpeg', jpg: 'jpeg', png: 'png', webp: 'webp',
  heif: 'heic', avif: 'avif', gif: 'gif', tiff: 'tiff',
};

export async function probe(buf: Buffer): Promise<ProbeResult> {
  try {
    const m = await sharp(buf).metadata();
    return {
      format: MAP[m.format ?? ''] ?? 'unknown',
      width: m.width ?? 0,
      height: m.height ?? 0,
      bytes: buf.length,
      hasAlpha: m.hasAlpha ?? false,
      orientation: m.orientation ?? 1,
      icc: m.icc ? 'present' : null,
    };
  } catch (e) {
    // 兜底：sharp 读不了，可能是 HEIC
    if (!(await canSharpDecodeHeic())) {
      const r = await decodeHeic(buf);
      const m2 = await sharp(Buffer.from(r.data), {
        raw: { width: r.width, height: r.height, channels: 4 },
      }).metadata();
      return {
        format: 'heic',
        width: r.width,
        height: r.height,
        bytes: buf.length,
        hasAlpha: m2.hasAlpha ?? false,
        orientation: m2.orientation ?? 1,
        icc: null,
      };
    }
    throw e;
  }
}
```

- [ ] **Step 5: 跑测试**

Run: `npm run fixtures && npx vitest run src/main/image/probe.spec.ts`
Expected: PASS（HEIC 那条若没有 fixture 会 skip）

- [ ] **Step 6: 提交**

```bash
git add -A && git commit -m "feat(image): dimension assertion and metadata probe"
```

---

## Task 5：`heic.ts` HEIC 兜底解码

**Files:**
- Create: `src/main/image/heic.ts`
- Test: `src/main/image/heic.spec.ts`

**Interfaces:**
- Produces: `canSharpDecodeHeic(): Promise<boolean>`（带缓存，只探测一次）
- Produces: `decodeHeic(buf: Buffer): Promise<{ data: Uint8ClampedArray; width: number; height: number }>`
- Consumes: Task 0 的结论

- [ ] **Step 1: 写实现**

```ts
// src/main/image/heic.ts
import sharp from 'sharp';
import heicDecode from 'heic-decode';
import { ImageEngineError } from './verify';

let cached: boolean | null = null;

/**
 * sharp 的预编译二进制不含 HEVC 解码器，读不了 HEIC。
 * 这里探测一次并缓存，避免每张图都试错。
 */
export async function canSharpDecodeHeic(): Promise<boolean> {
  if (cached !== null) return cached;
  try {
    // 造一个最小 HEIC 文件头去探；探不到就认为不支持
    await sharp(Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]))
      .metadata();
    cached = true;
  } catch {
    cached = false;
  }
  return cached;
}

export async function decodeHeic(buf: Buffer): Promise<{
  data: Uint8ClampedArray;
  width: number;
  height: number;
}> {
  try {
    const r = await heicDecode({ buffer: buf });
    return { data: r.data, width: r.width, height: r.height };
  } catch (e) {
    throw new ImageEngineError(
      'HEIC_DECODE_FAILED',
      `HEIC 解码失败：${(e as Error).message}`
    );
  }
}
```

- [ ] **Step 2: 写测试（HEIC fixture 缺失时 skip）**

```ts
// src/main/image/heic.spec.ts
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { canSharpDecodeHeic, decodeHeic } from './heic';

const P = 'tests/fixtures/iphone-portrait.heic';
const has = existsSync(P);

describe('heic', () => {
  it.skipIf(!has)('sharp 预编译版读不了 HEIC（预期为 false）', async () => {
    expect(await canSharpDecodeHeic()).toBe(false);
  });

  it.skipIf(!has)('heic-decode 能解出正确尺寸的 RGBA', async () => {
    const r = await decodeHeic(readFileSync(P));
    expect(r.width).toBeGreaterThan(1000);
    expect(r.data.length).toBe(r.width * r.height * 4);
  });
});
```

- [ ] **Step 3: 跑测试并提交**

Run: `npx vitest run src/main/image/heic.spec.ts`

```bash
git add src/main/image/ && git commit -m "feat(image): HEIC fallback decoder"
```

---

## Task 6：`encode.ts` 唯一编码出口

**Files:**
- Create: `src/main/image/encode.ts`
- Test: `src/main/image/encode.spec.ts`

**Interfaces:**
- Consumes: Task 0 定下的 metadata 写法
- Produces: `encode(input, plan, opts): Promise<{ data: Buffer; width: number; height: number; format: string }>`
- Produces: `type EncodeInput = { kind: 'buffer'; buf: Buffer } | { kind: 'raw'; buf: Buffer; width: number; height: number }`

- [ ] **Step 1: 写实现**

```ts
// src/main/image/encode.ts
import sharp from 'sharp';
import type { OutputFormat } from './types';

export type EncodeInput =
  | { kind: 'buffer'; buf: Buffer }
  | { kind: 'raw'; buf: Buffer; width: number; height: number };

export interface EncodePlan {
  format: Exclude<OutputFormat, 'keep'>;
  quality: number | null;
  palette: boolean;
}

export interface EncodeOptions {
  /** Task 0 验证后填这里的写法；若 heic-decode 已应用方向，则传 null */
  orientation: number | null;
  keepIcc: boolean;
  /** JPG 输出且源有 alpha 时，把透明拍平到这个底色 */
  flattenTo: string | null;
}

export async function encode(input: EncodeInput, plan: EncodePlan, opts: EncodeOptions) {
  let p =
    input.kind === 'raw'
      ? sharp(input.buf, { raw: { width: input.width, height: input.height, channels: 4 } })
      : sharp(input.buf, { failOn: 'error' });

  // 承诺二：绝不 resize、绝不 rotate
  if (opts.flattenTo) p = p.flatten({ background: opts.flattenTo });

  // ↓↓↓ 下面这几行以 Task 0 的验证结论为准，不要凭记忆写 ↓↓↓
  if (opts.keepIcc) p = p.keepIccProfile();
  if (opts.orientation && opts.orientation !== 1) p = p.withMetadata({ orientation: opts.orientation });
  // ↑↑↑

  switch (plan.format) {
    case 'jpeg': p = p.jpeg({ quality: plan.quality ?? 85, mozjpeg: true }); break;
    case 'webp': p = p.webp({ quality: plan.quality ?? 85, effort: 4 }); break;
    case 'png':  p = p.png({ compressionLevel: 9, palette: plan.palette }); break;
  }

  const { data, info } = await p.toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, format: info.format };
}
```

- [ ] **Step 2: 写测试**

```ts
// src/main/image/encode.spec.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { encode } from './encode';

const F = 'tests/fixtures';

describe('encode', () => {
  it('JPG 输出宽高与输入一致', async () => {
    const r = await encode(
      { kind: 'buffer', buf: readFileSync(`${F}/noise-hi.jpg`) },
      { format: 'jpeg', quality: 85, palette: false },
      { orientation: null, keepIcc: true, flattenTo: null }
    );
    expect(r.width).toBe(4000);
    expect(r.height).toBe(3000);
    expect(r.format).toBe('jpeg');
  });

  it('透明 PNG 转 JPG 时被拍平（输出无 alpha）', async () => {
    const r = await encode(
      { kind: 'buffer', buf: readFileSync(`${F}/alpha-cutout.png`) },
      { format: 'jpeg', quality: 85, palette: false },
      { orientation: null, keepIcc: true, flattenTo: '#FFFFFF' }
    );
    expect(r.format).toBe('jpeg');
  });

  it('PNG 调色板路径可用', async () => {
    const r = await encode(
      { kind: 'buffer', buf: readFileSync(`${F}/flat-solid.png`) },
      { format: 'png', quality: null, palette: true },
      { orientation: null, keepIcc: true, flattenTo: null }
    );
    expect(r.format).toBe('png');
  });
});
```

- [ ] **Step 3: 跑测试并提交**

Run: `npx vitest run src/main/image/encode.spec.ts`

```bash
git add src/main/image/ && git commit -m "feat(image): single encode entry point"
```

---

## Task 7：`compress.ts` 单张主流程（黄金测试）

**Files:**
- Create: `src/main/image/compress.ts`
- Create: `src/main/image/index.ts`
- Test: `src/main/image/compress.spec.ts`

**Interfaces:**
- Produces: `compressOne(input: CompressInput): Promise<{ data: Buffer; result: CompressResult }>`
- Produces: `type CompressInput = { buf: Buffer; shrinkPercent: number; outputFormat: OutputFormat; probe: ProbeResult }`

- [ ] **Step 1: 写实现**

```ts
// src/main/image/compress.ts
import { probe } from './probe';
import { encode } from './encode';
import { nextQuality, qualityFloor, targetBytes } from './plan';
import { assertSameDimensions, ImageEngineError } from './verify';
import { decodeHeic, canSharpDecodeHeic } from './heic';
import type { Attempt, CompressResult, OutputFormat, ProbeResult } from './types';

export interface CompressInput {
  buf: Buffer;
  shrinkPercent: number;
  outputFormat: OutputFormat;
  probe: ProbeResult;
}

const EXT: Record<Exclude<OutputFormat, 'keep'>, string> = {
  jpeg: 'jpg', png: 'png', webp: 'webp',
};

export function targetFormat(src: ProbeResult, want: OutputFormat): Exclude<OutputFormat, 'keep'> {
  if (want !== 'keep') return want;
  if (src.format === 'heic' || src.format === 'avif') return 'jpeg';
  if (src.format === 'jpeg') return 'jpeg';
  if (src.format === 'png') return 'png';
  if (src.format === 'webp') return 'webp';
  return 'jpeg';
}

export { EXT };

export async function compressOne(input: CompressInput) {
  const { buf, shrinkPercent, outputFormat, probe: src } = input;
  const format = targetFormat(src, outputFormat);
  const needsDecode = !(await canSharpDecodeHeic()) && src.format === 'heic';

  const base = needsDecode
    ? { kind: 'raw' as const, ...(await decodeHeic(buf)) }
    : { kind: 'buffer' as const, buf };

  const flattenTo = format === 'jpeg' && src.hasAlpha ? '#FFFFFF' : null;
  const orientation = needsDecode ? null : src.orientation; // Task 0 结论决定

  const opts = { orientation, keepIcc: true, flattenTo };
  const target = targetBytes(buf.length, shrinkPercent);

  let best: { data: Buffer; quality: number | null } | null = null;

  if (format === 'png') {
    const r = await encode(base, { format, quality: null, palette: src.hasAlpha === false }, opts);
    best = { data: r.data, quality: null };
  } else {
    const history: Attempt[] = [];
    for (let i = 0; i < 8; i++) {
      const q = nextQuality(buf.length, shrinkPercent, history);
      if (q === null) break;
      const r = await encode(base, { format, quality: q, palette: false }, opts);
      history.push({ quality: q, bytes: r.data.length });
      if (r.data.length <= target) {
        if (!best || (best.quality ?? 0) < q) best = { data: r.data, quality: q };
      }
    }
    if (!best) {
      const q = qualityFloor(shrinkPercent);
      const r = await encode(base, { format, quality: q, palette: false }, opts);
      best = { data: r.data, quality: q };
    }
  }

  // 压不动就返回原图，不交出更差的结果
  let out = best.data;
  let quality = best.quality;
  if (out.length >= buf.length && outputFormat === 'keep') {
    out = buf;
    quality = null;
  }

  const after = await probe(out);
  assertSameDimensions(src, after);   // 承诺二，失败即抛

  const result: CompressResult = {
    bytes: out.length,
    width: after.width,
    height: after.height,
    format: after.format,
    quality,
    undershot: quality !== null && out.length > target,
    flattened: flattenTo !== null,
  };
  return { data: out, result };
}
```

- [ ] **Step 2: 写黄金测试**

```ts
// src/main/image/compress.spec.ts
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { compressOne } from './compress';
import { probe } from './probe';

const F = 'tests/fixtures';
const FILES = [
  'noise-hi.jpg', 'flat-solid.png', 'alpha-cutout.png',
  'tiny-1x1.png', 'huge-8000.jpg', 'sample.webp', 'oriented-6.jpg',
  'iphone-portrait.heic',
].filter((f) => existsSync(`${F}/${f}`));

const PERCENTS = [20, 45, 70, 85];

describe('compressOne 黄金断言', () => {
  for (const file of FILES) {
    for (const p of PERCENTS) {
      it(`${file} @ ${p}%`, async () => {
        const buf = readFileSync(`${F}/${file}`);
        const src = await probe(buf);
        const { data, result } = await compressOne({
          buf, shrinkPercent: p, outputFormat: 'keep', probe: src,
        });

        // 1. 尺寸绝不变（承诺二）
        expect(result.width).toBe(src.width);
        expect(result.height).toBe(src.height);

        // 2. 不产出比原图更大的文件
        expect(data.length).toBeLessThanOrEqual(buf.length);

        // 3. 感知无损区质量底线
        if (p <= 70 && result.quality !== null) expect(result.quality).toBeGreaterThanOrEqual(82);
        if (p > 70 && result.quality !== null) expect(result.quality).toBeGreaterThanOrEqual(62);
      }, 60_000);
    }
  }

  it('透明 PNG 转 JPG 时标记 flattened', async () => {
    const buf = readFileSync(`${F}/alpha-cutout.png`);
    const src = await probe(buf);
    const { result } = await compressOne({
      buf, shrinkPercent: 45, outputFormat: 'jpeg', probe: src,
    });
    expect(result.flattened).toBe(true);
    expect(result.format).toBe('jpeg');
  });
});
```

- [ ] **Step 3: 跑黄金测试**

Run: `npx vitest run src/main/image/compress.spec.ts`
Expected: 全部 PASS。若某条尺寸断言失败，**不要改断言**，去查为什么尺寸被改了。

- [ ] **Step 4: 写 `index.ts` 出口并提交**

```ts
// src/main/image/index.ts
export * from './types';
export { probe } from './probe';
export { compressOne, targetFormat, EXT } from './compress';
export { resolveOutputPath } from './naming';
export { ImageEngineError } from './verify';
```

```bash
git add src/main/image/ && npm run check && git commit -m "feat(image): golden-tested compression pipeline"
```

---

## Task 8：`queue.ts` 并发池

**Files:**
- Create: `src/main/queue.ts`
- Test: `src/main/queue.spec.ts`

**Interfaces:**
- Produces: `class Pool { constructor(limit: number); run<T>(task: () => Promise<T>): Promise<T>; cancelPending(): void }`

- [ ] **Step 1: 写测试**

```ts
// src/main/queue.spec.ts
import { describe, it, expect } from 'vitest';
import { Pool } from './queue';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('Pool', () => {
  it('并发不超过上限', async () => {
    const pool = new Pool(3);
    let live = 0, peak = 0;
    await Promise.all(Array.from({ length: 12 }, () =>
      pool.run(async () => {
        live++; peak = Math.max(peak, live);
        await sleep(20);
        live--;
      })
    ));
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
  });

  it('cancelPending 后未开始的任务直接抛出', async () => {
    const pool = new Pool(1);
    const running = pool.run(() => sleep(50));
    const queued = pool.run(() => sleep(10));
    pool.cancelPending();
    await running;
    await expect(queued).rejects.toThrow('CANCELLED');
  });
});
```

- [ ] **Step 2: 写实现**

```ts
// src/main/queue.ts
export class Pool {
  private active = 0;
  private waiting: Array<() => void> = [];
  private cancelled = false;

  constructor(private limit: number) {}

  cancelPending(): void {
    this.cancelled = true;
    const w = this.waiting;
    this.waiting = [];
    w.forEach((resolve) => resolve());
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      if (this.cancelled) throw new Error('CANCELLED');
      return await task();
    } finally {
      this.active--;
      const next = this.waiting.shift();
      if (next) next();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.limit) { this.active++; return Promise.resolve(); }
    return new Promise<void>((resolve) => {
      this.waiting.push(() => { this.active++; resolve(); });
    });
  }
}
```

- [ ] **Step 3: 跑测试并提交**

```bash
npx vitest run src/main/queue.spec.ts
git add src/main/ && git commit -m "feat: bounded concurrency pool with cancel"
```

---

## Task 9：IPC 契约与 preload

**Files:**
- Create: `src/shared/types.ts`
- Create: `src/shared/ipc.ts`
- Create: `src/preload/index.ts`
- Create: `src/main/ipc/*.ts`
- Modify: `src/main/index.ts`

**Interfaces:**
- Produces: `window.pictureMore`，形状照抄 `SPEC.md` §6

- [ ] **Step 1: 抄 `SPEC.md` §6.2 的类型到 `src/shared/types.ts`**

一字不改。这是跨进程契约，任何改动都会同时影响三个进程。

- [ ] **Step 2: 写通道常量**

```ts
// src/shared/ipc.ts
export const IPC = {
  probe: 'files:probe',
  pickImages: 'dialog:pickImages',
  pickOutputDir: 'dialog:pickOutputDir',
  revealInFolder: 'dialog:revealInFolder',
  taskStart: 'task:start',
  taskCancel: 'task:cancel',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  taskProgress: 'task:progress',
  taskDone: 'task:done',
} as const;
```

- [ ] **Step 3: 写 preload**

```ts
// src/preload/index.ts
import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { IPC } from '../shared/ipc';

const api = {
  probe: (paths: string[]) => ipcRenderer.invoke(IPC.probe, { paths }),
  pickImages: () => ipcRenderer.invoke(IPC.pickImages),
  pickOutputDir: () => ipcRenderer.invoke(IPC.pickOutputDir),
  revealInFolder: (path: string) => ipcRenderer.invoke(IPC.revealInFolder, { path }),
  start: (payload: unknown) => ipcRenderer.invoke(IPC.taskStart, payload),
  cancel: (taskId: string) => ipcRenderer.invoke(IPC.taskCancel, { taskId }),
  getSettings: () => ipcRenderer.invoke(IPC.settingsGet),
  setSettings: (patch: unknown) => ipcRenderer.invoke(IPC.settingsSet, patch),
  getDroppedPaths: (files: File[]) => files.map((f) => webUtils.getPathForFile(f)),
  onProgress: (cb: (e: unknown) => void) => {
    const h = (_: unknown, e: unknown) => cb(e);
    ipcRenderer.on(IPC.taskProgress, h);
    return () => ipcRenderer.off(IPC.taskProgress, h);
  },
  onDone: (cb: (e: unknown) => void) => {
    const h = (_: unknown, e: unknown) => cb(e);
    ipcRenderer.on(IPC.taskDone, h);
    return () => ipcRenderer.off(IPC.taskDone, h);
  },
};

contextBridge.exposeInMainWorld('pictureMore', api);
export type PictureMoreApi = typeof api;
```

- [ ] **Step 4: 验证拖拽路径可用（⚠️ 陷阱 14.2）**

在渲染层拖入一个文件，Console 里打印 `window.pictureMore.getDroppedPaths(files)`。
Expected: 返回真实绝对路径。若返回空串或抛错，把 `webPreferences.sandbox` 显式设为 `false` 后重试（两条红线不动）。

- [ ] **Step 5: 提交**

```bash
git add src/ && git commit -m "feat: IPC contract and preload bridge"
```

---

## Task 10：设计 Token 落地

**Files:**
- Create: `src/renderer/styles/tokens.css`
- Create: `src/renderer/styles/index.css`
- Modify: `electron.vite.config.ts`

**Interfaces:**
- Produces: Tailwind 可用的 `bg-surface` / `text-fg-3` / `border-strong` / `rounded-control` 等类名

- [ ] **Step 1: 抄 `SPEC.md` §8.2 的 `@theme` 块到 `tokens.css`**

一字不改。这是视觉规范到代码的唯一映射点。

- [ ] **Step 2: 写 `index.css`**

```css
@import "./tokens.css";

* { box-sizing: border-box; }
html, body, #root { height: 100%; margin: 0; }
body {
  background: var(--color-bg-app);
  color: var(--color-fg);
  font: 400 var(--text-2) / 1.5 var(--font-sans);
  -webkit-font-smoothing: antialiased;
  display: grid; place-items: center; padding: 32px;
}
button { font: inherit; color: inherit; background: none; border: 0; padding: 0; cursor: pointer; }
p, ul { margin: 0; padding: 0; list-style: none; }
:focus-visible { outline: 2px solid var(--color-ink-900); outline-offset: 2px; border-radius: 4px; }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; }
}
```

- [ ] **Step 3: 配置 Vite 用 `@tailwindcss/vite`（⚠️ 陷阱 14.2）**

```ts
// electron.vite.config.ts 的 renderer 段
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({
  renderer: { plugins: [react(), tailwindcss()] },
});
```

不要写 `postcss.config.js`。

- [ ] **Step 4: 验证 token 生效**

在 `App.tsx` 里写一个 `<div className="bg-bone-200 text-fg-3 rounded-control p-4">测试</div>`。
Expected: 底色是暖骨白，文字是三级灰，圆角 6px。

- [ ] **Step 5: 提交**

```bash
git add src/renderer/styles electron.vite.config.ts && git commit -m "feat(ui): design tokens via tailwind v4 theme"
```

---

## Task 11：左栏组件

**Files:**
- Create: `src/renderer/components/AppHeader.tsx`
- Create: `src/renderer/components/ControlPane.tsx`
- Create: `src/renderer/components/ShrinkSlider.tsx`
- Create: `src/renderer/components/FormatPicker.tsx`
- Create: `src/renderer/components/DestinationPicker.tsx`
- Create: `src/renderer/components/QualityNote.tsx`
- Create: `src/renderer/components/EstimateLine.tsx`
- Create: `src/renderer/components/PrimaryButton.tsx`

**Interfaces:**
- Consumes: `SPEC.md` §8.3 的组件对应表
- Produces: `<ControlPane />`

- [ ] **Step 1: 逐组件搬运原型**

打开 `prototype/index.html` 并排对照。每个组件的 HTML 结构与 CSS 直接从原型的对应选择器搬过来（`SPEC.md` §8.3 有完整对应表）。

**注意**：原型的 CSS 是原生 CSS，搬到 React 时优先用 Tailwind 的 `@theme` 生成类；确实无法用工具类表达的（滑块 `::-webkit-slider-thumb` 伪元素、`linear-gradient` 轨道）保留为 CSS Module。

- [ ] **Step 2: 实现滑块的两条关键逻辑**

```tsx
// ShrinkSlider.tsx 关键片段
const ratio = ((value - 20) / (90 - 20)) * 100;
const fill = value > 70 ? 'var(--color-caution)' : 'var(--color-ink-900)';

<input
  type="range" min={20} max={90} step={5} value={value}
  aria-label="体积缩小百分比"
  aria-valuetext={`体积缩小 ${value}%`}
  onChange={(e) => onChange(Number(e.target.value))}
  style={{
    background: `linear-gradient(to right, ${fill} 0 ${ratio}%, var(--color-line-100) ${ratio}% 100%)`,
  }}
/>
```

- [ ] **Step 3: 实现四态文案（`DESIGN.md` §7）**

```tsx
// QualityNote.tsx
export function QualityNote({ format, alphaCount, shrinkPercent }: Props) {
  let text = '不改尺寸，不裁剪，不重绘。只重新编码，正常观看看不出差别。';
  let caution = false;

  if (format === 'png') {
    text = 'PNG 是无损格式，体积基本压不下来。要变小请选 JPG 或 WebP。';
    caution = true;
  } else if (format === 'jpeg' && alphaCount > 0) {
    text = `选中的图里有 ${alphaCount} 张带透明区域，转成 JPG 后透明部分会变成白色。`;
    caution = true;
  } else if (shrinkPercent > 70) {
    text = '超过 70% 后，放大到 100% 能看出压缩痕迹。图片尺寸仍然不变。';
    caution = true;
  }

  return <p className={caution ? 'text-caution' : 'text-fg-3'}>{text}</p>;
}
```

- [ ] **Step 4: 实现存放位置选择器**

```tsx
// DestinationPicker.tsx
const pick = async () => {
  const r = await window.pictureMore.pickOutputDir();
  if (r?.dir) onChange(r.dir);
};

<button onClick={pick} className="..." aria-label="更改图片存放位置">
  <span className="font-mono text-1 text-fg-2 truncate">{dir}</span>
  <span className="text-1 text-fg-3 underline underline-offset-2">更改</span>
</button>
```

- [ ] **Step 5: 并排比对原型**

把 `prototype/index.html` 在浏览器打开，Electron 应用在旁边，逐项对齐：字号、间距、圆角、颜色、悬停态、聚焦环。
Expected: 肉眼无差异。

- [ ] **Step 6: 提交**

```bash
git add src/renderer/components && git commit -m "feat(ui): control pane components"
```

---

## Task 12：右栏组件

**Files:**
- Create: `src/renderer/components/DropZone.tsx`
- Create: `src/renderer/components/ListMeta.tsx`
- Create: `src/renderer/components/FileRow.tsx`
- Create: `src/renderer/components/FileList.tsx`
- Create: `src/renderer/lib/format.ts`

**Interfaces:**
- Produces: `fmtSize(mb: number): string`

- [ ] **Step 1: 写 `fmtSize`**

```ts
// src/renderer/lib/format.ts
export function fmtSize(mb: number): string {
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(mb * 1024)} KB`;
}
export function fmtBytes(bytes: number): string {
  return fmtSize(bytes / 1024 / 1024);
}
```

- [ ] **Step 2: 实现拖拽（⚠️ 陷阱 14.2）**

```tsx
// FileList.tsx 关键片段
const [over, setOver] = useState(false);

const onDrop = async (e: React.DragEvent) => {
  e.preventDefault();
  setOver(false);
  const paths = window.pictureMore.getDroppedPaths([...e.dataTransfer.files]);
  if (paths.length) onPaths(paths);
};

<div
  onDragOver={(e) => { e.preventDefault(); setOver(true); }}
  onDragLeave={() => setOver(false)}
  onDrop={onDrop}
>
```

拖拽目标挂在**整个右栏**，高亮反馈落在 `DropZone` 上。

- [ ] **Step 3: 实现文件行**

```tsx
<li className={`flex items-center gap-3 h-11 border-b border-line-100 ${busy ? 'opacity-30' : ''}`}>
  <span className="flex-1 truncate text-fg-2">{name}</span>
  <span className="font-mono text-1 tabular-nums text-fg-3">
    {fmtBytes(bytes)}
    {outBytes != null && (
      <>
        <span className="px-1.5">→</span>
        <span className="text-fg">{fmtBytes(outBytes)}</span>
      </>
    )}
  </span>
  <button className="text-1 text-fg-3 opacity-0 group-hover:opacity-100" onClick={onRemove}>
    移除
  </button>
</li>
```

移除按钮是**文字**，不是图标。

- [ ] **Step 4: 并排比对原型，然后提交**

```bash
git add src/renderer && git commit -m "feat(ui): file list and drop zone"
```

---

## Task 13：store 与全链路接线

**Files:**
- Create: `src/renderer/store/useAppStore.ts`
- Modify: `src/renderer/App.tsx`
- Modify: `src/main/ipc/*.ts`

**Interfaces:**
- Consumes: 全部前置 Task

- [ ] **Step 1: 写 store，照抄 `SPEC.md` §7**

关键规则：滑块拖动**不发 IPC**，预估量在前端算。

- [ ] **Step 2: 实现主进程的 task 编排**

```ts
// src/main/ipc/process.ts 关键片段
const pool = new Pool(Math.min(8, Math.max(4, os.cpus().length - 1)));

ipcMain.handle(IPC.taskStart, async (evt, p: StartTaskPayload) => {
  const { taskId, items, shrinkPercent, outputFormat, outputDir } = p;
  await fs.mkdir(outputDir, { recursive: true });

  const results = await Promise.allSettled(
    items.map((it, index) =>
      pool.run(async () => {
        const buf = await fs.readFile(it.path);
        const pr = await probe(buf);
        const { data, result } = await compressOne({ buf, shrinkPercent, outputFormat, probe: pr });
        const outPath = resolveOutputPath({
          sourcePath: it.path, outputDir, targetExt: EXT[targetFormat(pr, outputFormat)],
          exists: existsSync,
        });
        await fs.writeFile(outPath, data);
        evt.sender.send(IPC.taskProgress, {
          taskId, itemId: it.id, index, total: items.length,
          state: result.undershot ? 'undershot' : 'done',
          outBytes: result.bytes, outName: basename(outPath),
          width: result.width, height: result.height, quality: result.quality,
        });
      })
    )
  );

  evt.sender.send(IPC.taskDone, { taskId, outputDir, /* 汇总 */ });
  return { taskId };
});
```

- [ ] **Step 3: 渲染层订阅进度**

```tsx
useEffect(() => {
  const offP = window.pictureMore.onProgress((e) => {
    useAppStore.getState().applyProgress(e as TaskProgressEvent);
  });
  const offD = window.pictureMore.onDone(() => useAppStore.getState().finishTask());
  return () => { offP(); offD(); };   // ⚠️ 陷阱 14.2：必须清理，否则严格模式注册两次
}, []);
```

- [ ] **Step 4: 端到端手工验证**

拖入 3 张图 → 滑块拖到 60% → 点 CTA → 观察逐行落位 → 打开输出目录。
Expected: 3 个文件，宽高与原图一致，肉眼无差异。

- [ ] **Step 5: 走一遍 `SPEC.md` §9 的 17 条边界情况**

逐条手工触发，记录任何不符合预期的行为。

- [ ] **Step 6: 提交**

```bash
git add -A && npm run check && git commit -m "feat: wire up end-to-end compression flow"
```

---

## Task 14：打包

**Files:**
- Create: `electron-builder.yml`
- Modify: `package.json`

- [ ] **Step 1: 写 `electron-builder.yml`，照抄 `SPEC.md` §11**

**最容易漏的两条**：`asarUnpack` 里必须有 sharp 与 `@img/*`；`files` 里必须排除 `.workbuddy-ai/**`。

- [ ] **Step 2: 出包**

```bash
npm run build
```

Expected: `release/图压压-1.0.0-setup.exe`，体积在 120MB 以内。

- [ ] **Step 3: 干净机器验收**

在一台没装过 Node 的机器（或新建的 Windows 用户）上：
- [ ] 安装、启动
- [ ] **拔网线**，跑通完整压缩流程
- [ ] 输出目录选到原图所在目录，确认原图未被改动
- [ ] 键盘走完整个流程

- [ ] **Step 4: 提交并打 tag**

```bash
git add -A && git commit -m "chore: packaging config" && git tag v1.0.0
```

---

## 自检清单

**规格覆盖**：`SPEC.md` §1-§9 的每一条要求都能对应到上面某个 Task。§13 的三个决定已在 Task 6 / Task 11 落地。§14 的陷阱已在 Task 1 / 5 / 9 / 10 / 12 / 13 里作为具体步骤处理。

**无占位符**：全部步骤都给了可直接运行的命令或代码。唯一保留的空白是 Task 0 的结论（这是刻意的，因为它必须靠实测确定）。

**类型一致性**：`ProbeResult`、`CompressResult`、`TaskProgressEvent` 在三处出现（`src/main/image/types.ts`、`src/shared/types.ts`、`SPEC.md` §6.2）。Task 9 Step 1 要求以 `SPEC.md` §6.2 为准，`src/main/image/types.ts` 里的同名类型应当在 Task 9 时收敛为 re-export，避免两套定义漂移。

**已知的执行顺序依赖**：Task 0 → 1 → 2 → 3 → 4（依赖 5）→ 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13 → 14。Task 4 的 `probe.ts` 依赖 Task 5 的 `heic.ts`，若严格按序执行，先写 Task 5 再回头补 Task 4 的 HEIC 分支。
