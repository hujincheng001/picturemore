# AGENTS.md · 给 AI 开发会话的入口

> **如果你是一个刚打开这个项目的 AI 会话，读这一页就够了。**
> 它告诉你去哪读、先做什么、以及哪些事绝对不能做。

---

## 这是什么项目

**图压压 pictureMore**：一个 Windows 桌面图片压缩工具。把"发不出去的图"压到能发出去。

两条不可违反的产品承诺：

1. **图片内容永不离开用户机器。** 运行时零网络请求，无遥测，断网完全可用。
2. **只改变文件体积，不允许影响图片的正常展示。** 绝不降分辨率、绝不裁剪、绝不重绘像素。

---

## 读文档的顺序

| 顺序 | 文件 | 读它是为了 |
|---|---|---|
| 1 | `docs/decisions.md` | **先读这个**。每条实测结论 + 为什么不能按直觉写 |
| 2 | `README.md` | 技术栈决策依据、Electron 红线、常用命令 |
| 3 | `PRODUCT.md` | 产品定位、目标用户、能力边界、产品原则 |
| 4 | `SPEC.md` | **开发依据**。架构、压缩算法、IPC 契约、陷阱、里程碑 |
| 5 | `docs/superpowers/plans/2026-09-19-picturemore-v1.md` | **任务级实施计划**，14 个 Task（已完成，当执行记录看） |
| 6 | `DESIGN.md` | 视觉规格：token、组件状态矩阵、动效、文案规则 |
| 7 | `prototype/index.html` | **唯一视觉基准**，浏览器直接打开，与实现并排比对 |

---

## 当前状态

**v1.0.0 已交付。** 14 个 Task 全部完成，`git tag v1.0.0`，安装包在 `release/图压压-1.0.0-setup.exe`（115MB）。

所以下面这些不是「接下来要做的」，是**动手前必须知道的**。

### 动手前先看决策记录

`docs/decisions.md` 是这份代码的地基。里面记着每一条「实测推翻了文档假设」的结论，
每一条都写着「为什么不能按直觉写」：

| 条目 | 一句话 |
|---|---|
| M0-1 | sharp 预编译版能读 HEIC 容器头，但解不了像素 |
| M0-2 | `heic-decode` 返回的 raw **已经应用过方向**，再写 orientation 标签会二次旋转 |
| M0-3 | libheif-js 不带色彩管理，需要补挂 P3 标签 |
| M0-4 | metadata 的正确写法是 `keepIccProfile().withExif({})`，**绝不能用 `withMetadata()`** |
| T6-1 | 验证「有没有动像素」必须用无损格式，有损编码的噪声会淹掉信号 |
| T10-1 | Tailwind v4 的工具类在 `@layer utilities`，**无层级的 CSS 永远压过它** |
| T11-2 | `#root{display:contents}` —— 否则 `place-items:center` 会把窗口挤窄一半 |

### 本机环境的三个坑

这三条每次开发都会撞，别再重新查：

1. **启动 Electron 前剥掉 `NODE_OPTIONS` 与 `ELECTRON_RUN_AS_NODE`。**
   后者置 1 时 `electron.exe` 退化成普通 Node，主进程 `require('electron')` 会命中项目自己的
   `node_modules/electron`（导出的是路径字符串），报 `electron.app is undefined`。
   症状是「同一个 exe，脚本放项目外能跑、放项目内就挂」。
2. **构建/冒烟命令前加 `CODEBUDDY_SAFE_DELETE_ENABLED=0`。**
   宿主会拦 `rmSync`（每轮超 50 次就拒），而 Vite 每次构建都清空 `out/`，必然撞上。
   不要为此改 `emptyOutDir: false`——旧哈希产物会积在 `out/renderer/assets/` 里被打进安装包。
3. **Git Bash 的 `/d/xxx` 不能传给 `node.exe` / `electron.exe`**，会被解析成 `D:\d\xxx`。用 `D:/xxx`。

---

## 三条绝对不能破的线

违反任何一条，代码即使跑通也是错的：

1. **绝不调用 `.resize()`。** 本产品承诺尺寸不变。`npm run lint:no-resize` 会拦截。
2. **每次输出后断言宽高与输入一致。** 不一致就抛 `DIMENSION_CHANGED`，不写文件。
3. **渲染进程不碰文件系统。** `contextIsolation: true` + `nodeIntegration: false` 永远不动，所有文件操作走 IPC。

---

## 怎么验证

```bash
npm run check            # 主护栏：lint:no-resize + typecheck + 249 条测试（约 7 分钟）
npm test                 # 只跑测试
npm run test:watch       # 测试 watch 模式
npm run smoke            # 端到端：构建 + 启动 + 21 组检查 + 5 张截图（需加上面的环境变量）
npm run smoke:packaged   # 打包产物冒烟（先 npm run build）
npm run measure:500      # 量 500 行列表的性能（上限 100 张之后主要留作参考）
npm run fixtures         # 重新生成合成测试图
npm run verify:icc       # 单独验证 withIccProfile 会不会改像素
```

**验证的标准是「量结果」，不是「查定义」。** 这一条是被坑出来的：

- 界面：量计算样式（尺寸/间距/字号/圆角/颜色）。只肉眼看，`T10-1` 和 `T11-2` 那两个坑都会漏过去。
- **画质**：`fidelity.spec.ts` 把输出解回像素和原图逐点比。「看不出差别」不是主观判断，是 `均值 < 3/255、p99 <= 8` 这样的数（见 `docs/decisions.md` 的 T19-1）。黄金测试断言的 `quality >= 82` 只是**参数**，参数对不代表结果对。
- 截图并排比对：硬指标覆盖不到对齐与配色。`npm run smoke` 会自动截 5 张到 `tests/fixtures/_shot-*.png`。
- 零联网：用 CDP 监听请求，比「拔网线」严格。
- 打包产物：真启动一次，验证原生模块从 `app.asar.unpacked` 加载。

三个反复踩到的测试设计问题：

- **断言「0 个」之前先证明监听是活的**，否则是空断言，什么都没验。
- **断言不要依赖持久化状态**（设置文件、缓存、上轮产物）。要断言不变量，不是具体数值。
- **比对类测试先看已知样本对不对**（比如纯色图应该恰好是 0）。通道数对不上之类的 bug 不会让测试变红，只会让数字变得毫无意义。

完整套路见用户级技能 `electron-cdp-acceptance`。

---

## 硬性约束速查

| 项 | 规则 |
|---|---|
| 依赖 | 只有 `sharp`、`heic-decode`、`zustand` 三个运行时依赖。**不要加新的**。特别地：不用 `nanoid`（用 `crypto.randomUUID()`）、不用 `electron-store`、不用 `react-router-dom`、不装图标库 |
| 图标 | 全站零图标、零 emoji。交互靠文字 |
| 文案 | 只能取自 `SPEC.md` §8.4 文案表，不得自造词。**`docs/decisions.md` 里记着三处 SPEC 没给文案的缺口**，不要自己编 |
| 标点 | 零 em-dash（`—` 和 `–` 都不行，中文里也不用"——"）。中黑点 `·` 每行最多一个 |
| 圆角 | 只用 12 / 6 / 4 三个值 |
| 字号 | 只用 12 / 15 / 20 / 36 四个值 |
| 颜色 | 暖灰一族，不混冷灰。唯一有彩色是琥珀 `#8A5B00`，只在警示时出现 |
| 动效 | 只动 `transform` / `opacity` / 颜色。必须有 `prefers-reduced-motion` 兜底 |
| 网络 | 任何需要联网的依赖、CDN、云 API 一律不加。`src/main/security.ts` 在运行时也会拦 |
| 尺寸 | 改界面先跑 `npm run smoke`。它会量 35 项布局硬指标，对不上就是和原型不一致 |
| 单批上限 | **一次最多 100 张**（用户 2026-09-21 决定）。上限在 `src/renderer/lib/limit.ts`，实际截断在主进程展开目录之后执行。改这个数要同步改 SPEC §9 |

---

## 视觉上的任何问题

**以 `prototype/index.html` 为准。** 把它在浏览器打开，和你的实现并排放在一起比对。字号、间距、圆角、颜色、悬停态、聚焦环，逐项对齐。肉眼能看出差异就是没做完。

`DESIGN.md` 是它的文字化规格。两者冲突时以原型为准。

**已知例外（唯一一处）**：原型的空态有个 CSS 事故——`.meta{display:flex}` 盖掉了 `[hidden]` 的 `display:none`，导致空列表时元信息行还显示「共 11 张」。原型 JS 的意图与 `DESIGN.md` §4 都要求它消失，所以实现按意图走，没照抄渲染结果。见 `docs/decisions.md` 的 T12-2。

---

## 遇到不确定时

1. 先查 `docs/decisions.md`（那里有全部实测结论）
2. 再查 `SPEC.md` §14 已知陷阱
3. 再查 `README.md` 的红线清单
4. 都不覆盖，就问用户，**不要猜**

---

## 已完成的部分

- 产品定义、范围收敛（v1 只做压缩，格式转换是输出选项）
- 界面设计已定稿并经用户审核通过，视觉基准已冻结在 `prototype/index.html`
- M0 技术验证（HEIC 解码、metadata 行为），结论在 `docs/decisions.md`
- 图像引擎：`src/main/image/` 全部模块 + 黄金测试（9 张 fixture × 4 个压缩档）
- 界面：12 个组件，与原型逐项对齐，冒烟脚本 35 项布局硬指标 + 5 张截图
- 全链路：拖拽 → probe → 压缩 → 写盘 → 逐行进度，端到端跑通
- 单批上限 100 张，超出的如实报出「（已忽略 N 张）」
- 打包：NSIS 安装包 115MB，包内容核查干净
- 测试 241 条（含批处理编排、设置容错、路径分隔符、上限截断）

### 还挂着的（需要用户拍板，不要自己决定）

- **Android 的 sRGB HEIC 会被错标成 P3**（画面偏艳）。修法已明确，但**手上没有 Android HEIC 样张，改不了就没法验**，所以没动
- **三处 SPEC 没给文案**：「文件不存在 / 无读权限」、SPEC §9 的两句行内文案（「这张已经压到底了」/「质量已到下限，只压到 {x}」）、「空文件夹给提示」
- **`TokenProbe` 要不要留在渲染树里**（6 个隐藏 div，是「变量定义了但工具类没生成」这类问题的唯一抓手）

