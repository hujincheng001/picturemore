# 开发文档

> **面向改这份代码的人。** 只想了解这个产品是什么，看根目录的 [`README.md`](../README.md)。
>
> 本文记录**技术栈决策依据**与**开发环境配置**，供开发时随时查阅。
> 最近更新：2026-09-23（从 README 拆出来，README 改为面向使用者）

---

## 文档地图

| 文件 | 内容 | 什么时候读 |
|---|---|---|
| [`AGENTS.md`](../AGENTS.md) | **AI 开发会话的入口页**：当前状态、三条不能破的线、怎么验证 | **开工第一份** |
| [`docs/decisions.md`](decisions.md) | **实测结论与取舍记录**。每条都写着「为什么不能按直觉写」 | **动手前先看，能省掉一半返工** |
| [`PRODUCT.md`](../PRODUCT.md) | 产品定位、目标用户、能力边界、产品原则 | 想搞清楚"为什么这么做" |
| [`SPEC.md`](../SPEC.md) | 开发依据：架构、压缩算法、IPC 契约、测试计划、已知陷阱、里程碑 | 写代码时随时查 |
| [`DESIGN.md`](../DESIGN.md) | 视觉规格：三层 token、组件状态矩阵、动效表、文案规则 | 写界面时逐条对照 |
| [`prototype/index.html`](../prototype/index.html) | **唯一视觉基准**，浏览器直接打开 | 写界面时并排比对 |
| [`docs/superpowers/plans/2026-09-19-picturemore-v1.md`](superpowers/plans/2026-09-19-picturemore-v1.md) | 任务级实施计划，14 个 Task | 已完成，当执行记录看 |

**状态**：v1.0.8 已交付，安装包在 `release/`。`AGENTS.md` 的「已完成的部分」列着全部产出，以及还挂着的待定项。

---

## 一、技术栈

### 选定方案

```
桌面壳     Electron 44
前端       React 19 + Vite 7 + TypeScript 5.9
样式       Tailwind CSS 4
图像处理   sharp 0.35（基于 libvips，主力）
状态       zustand 5
打包       electron-builder 26
```

**两处与最初设想不同，都是实测撞出来的：**

| 项 | 原计划 | 实际 | 原因 |
|---|---|---|---|
| Vite | 8 | **7** | `electron-vite@5` 的 peer 是 `vite@^5 \|\| ^6 \|\| ^7`，装 8 会 `ERESOLVE`。`@vitejs/plugin-react` 也跟着从 6 降到 5 |
| 路由 | react-router-dom 7 | **不用** | 单窗口单页面，`AGENTS.md` 也明确禁止引入 |

**没有用 `@electron-toolkit/*`**：脚手架默认会带，但那会多两个依赖，而它提供的东西（preload 的类型辅助、tsconfig 基类）手写一遍只要几十行。

### 决策依据

**本机已有的可复用资产**：

| 项目路径 | 技术栈 | 参考价值 |
|---|---|---|
| `F:\AIGC\解疑助手\imagePro` | Electron 44 + React 19 + Tailwind 4 + **sharp 0.35** + electron-builder | ★ **已做出可打包的图片压缩工具，路径完全验证** |
| `F:\AIGC\新家助手\admin-web` | Vite 8 + React 19 + TS 5.9 + antd 5 + zustand 5 + axios | 工程配置参考 |
| `F:\AIGC\我的冰箱\frontend` | Vite 8 + React 19 + TS + react-router 7 + zustand 5 | 精简配置参考 |
| `F:\AIGC\善解疑\frontend` | Vite 8 + React 19 + TS | 最小配置参考 |

这 4 个项目的 `node_modules` **全部已安装**，搭建新项目时可直接复制 `package.json` 与配置文件再增删，避免重复下载。

**为什么用 sharp 而不是 Python**：

- sharp 基于 libvips，处理速度比 Python PIL 快数倍，且不需要跨语言调用
- 压缩 / 缩放 / 裁剪 / 旋转 / 格式转换 / 合成 / 水印 / 基础调色 / 卷积滤镜 —— 全部覆盖

**⛔ Python sidecar 方案已否决**（早期曾考虑，对可分发桌面应用是错误方向）：

1. **分发体积爆炸**——要随包塞 Python 运行时（~50MB）+ onnxruntime + 模型（u2net 约 176MB），安装包翻倍
2. **打包复杂度高**——跨语言进程管理、路径、权限、杀软误报，在用户机器上全是坑
3. **本机 rembg 实际是空壳**——虽已 pip 安装，但模型从未下载（`~/.u2net` 不存在），本来跑不起来
4. **有更好的替代**——`onnxruntime-node` 是官方 Node 原生模块，同一 ONNX 模型可直接在 Electron 主进程推理

**结论**：v1 只做 sharp 能覆盖的功能；真要做 AI 抠图，用 `onnxruntime-node` + 随包模型。

### 安装包体积预估（要如实写进产品说明）

| 项 | 体积量级 |
|---|---|
| Electron 运行时 | ~80 MB |
| sharp（含 libvips 原生库） | ~30 MB |
| 前端构建产物 | ~2 MB |
| **基础安装包合计** | **约 120 MB** |
| 若将来加 AI 模型（u2net） | +176 MB |

### 环境

```
Node    D:\node\node.exe (v24.14.1)  |  managed v22.22.2
npm     registry=https://registry.npmjs.org/  cache=D:\npm-cache  prefix=D:\npm-global
Python  D:\Python\python.exe (3.11.5)  ← 仅 AI sidecar 用
```

---

## 二、已配置的技能（34 个）

技能放在 `.workbuddy\skills\`，程序会**自动加载**。

### 项目专属（1）

| 技能 | 作用 |
|---|---|
| `picturemore-dev` | **本项目开发规范**——技术栈、sharp 能力边界、参考项目路径、Electron 红线、常用命令 |

### 设计（10）

| 技能 | 作用 |
|---|---|
| `impeccable` | 设计总纲，26 个命令 + 44 篇 reference + 脚本化质检钩子 |
| `ui-ux-pro-max` | 选型知识库：50+ 风格、161 调色板、57 字体配对、99 UX 准则 |
| `taste-skill` | 反「AI 感」前端（`impeccable` 的零依赖备选） |
| `minimalist-skill` | 极简编辑风——工具类界面最合适的默认风格 |
| `design-system` | 三层设计令牌架构（primitive → semantic → component） |
| `ui-styling` | **shadcn/ui + Tailwind 组件模板（97 个附带文件）**——本项目主用 |
| `imagegen-frontend-web` | 生成界面设计稿参考图 |
| `image-to-code-skill` | 设计稿 → 代码闭环 |
| `redesign-skill` | 界面做出来后的品质升级 |
| `output-skill` | 禁止代码截断与占位符 |

### 工程（15）

`using-superpowers`（总入口）· `brainstorming` · `writing-plans` · `executing-plans` ·
`test-driven-development` · `systematic-debugging` · `requesting-code-review` · `receiving-code-review` ·
`verification-before-completion` · `subagent-driven-development` · `dispatching-parallel-agents` ·
`using-git-worktrees` · `finishing-a-development-branch` · `writing-skills` · `karpathy-guidelines`

覆盖「想清楚 → 写计划 → 写测试 → 实现 → 调试 → 评审 → 验证 → 合并」全流程。

### 产品与质量（8）

`prd-development`（写 PRD）· `user-story` / `user-story-mapping`（需求表达）·
`product-strategy-session`（产品战略）· `prioritization-advisor` / `analyze-feature-requests`（排优先级）·
`pre-mortem`（上线前风险排查）· `test-scenarios`（测试场景）

---

## 三、技能如何生效

项目级技能的加载路径是 `<项目目录>\.workbuddy\skills\`。**用 `D:\pictureMore` 作为工作目录打开 WorkBuddy**，这 34 个技能就会自动出现在可用列表中。

已额外创建路径兼容联接：

```
D:\pictureMore\.workbuddy-ai  →  D:\pictureMore\.workbuddy
```

这样两种路径解析方式（硬编码 `.workbuddy` 与产品数据目录名 `.workbuddy-ai`）都能命中同一份技能。

---

## 四、目录结构

```
pictureMore/
├── src/
│   ├── main/                      # Electron 主进程（独占文件系统与 sharp）
│   │   ├── index.ts               # 入口：单实例锁 → 注册 IPC → 安全策略 → 开窗口
│   │   ├── window.ts              # BrowserWindow（两条红线在这里）
│   │   ├── security.ts            # 运行时零联网：onBeforeRequest + 打包后注入 CSP
│   │   ├── queue.ts               # 有界并发池 clamp(cpus-1, 4, 8)
│   │   ├── settings.ts            # 手写 JSON 设置存储（不用 electron-store）
│   │   ├── ipc/                   # IPC handler：files / dialog / settings / task
│   │   └── image/                 # ★ 图像引擎（纯函数，不依赖 Electron API）
│   │       ├── probe.ts           # 读容器，拿格式/宽高/alpha/orientation
│   │       ├── plan.ts            # 质量档推导：targetBytes / qualityFloor / 二分
│   │       ├── encode.ts          # 唯一的 sharp 输出出口（metadata 配方在这）
│   │       ├── compress.ts        # 单张主流程，尺寸断言在这
│   │       ├── heic.ts            # HEIC 兜底解码（sharp 解不了 HEVC）
│   │       ├── naming.ts          # 输出路径与防覆盖
│   │       ├── verify.ts          # assertSameDimensions
│   │       └── runtime.ts         # sharp.cache(false)
│   ├── preload/                   # contextBridge 白名单，只做转发
│   ├── renderer/                  # React 前端
│   │   ├── components/            # 12 个组件，与原型元素一一对应
│   │   ├── lib/                   # copy（文案集中）/ format / note（四态文案）/ reason
│   │   ├── store/                 # zustand
│   │   └── styles/                # tokens.css（三层 token）+ index.css
│   └── shared/                    # 跨进程契约：types / ipc 通道名 / reasons / api
├── scripts/                       # 验证与冒烟（不进包）
├── tests/fixtures/                # 测试图片（合成的不入库，真实 HEIC 入库）
├── prototype/index.html           # 唯一视觉基准
├── build/                         # 打包资源（图标）
└── electron-builder.yml           # 打包配置
```

> 不设 `python/` 目录——AI 能力如要做，走 `onnxruntime-node` 在主进程内推理，不引入跨语言进程。

**核心原则**：`src/main/image/` 必须是纯函数模块，不依赖 Electron API——便于单测，也便于将来替换实现。
它下面有 7 个 `.spec.ts`，共 100 多条测试，`npm test` 就能跑，不需要起 Electron。

---

## 五、常用命令

```bash
npm install              # 装依赖

npm run dev              # 开发（Vite + Electron）
npm run build            # 类型检查 + 构建 + 打 Windows 安装包
npm run build:dir        # 只构建不打安装包

npm run check            # 主护栏：lint:no-resize + typecheck + 全部测试（约 5 分钟）
npm test                 # 只跑测试
npm run test:watch       # 测试 watch 模式
npm run lint:no-resize   # 单独跑「绝不 resize」的拦截

npm run smoke            # 端到端冒烟：构建 + 启动 + 18 组检查 + 5 张截图
npm run smoke:packaged   # 打包产物冒烟（先跑 npm run build）

npm run fixtures         # 重新生成合成测试图（8 张，约 54MB，不入库）
npm run verify:icc       # 单独验证 withIccProfile 会不会改像素
```

### 本机环境的三个坑

这三条每次开发都会撞，`AGENTS.md` 里有详细说明：

```bash
# 1 + 2：构建/冒烟前加上这个，否则 Vite 清空 out/ 会被宿主的安全删除护栏拦住
CODEBUDDY_SAFE_DELETE_ENABLED=0 npm run smoke

# 3：启动 Electron 的脚本必须自己剥掉这两个变量，否则 electron.exe 会退化成 Node
#    （脚本里已经处理了，这里是给手写命令的人看的）
```

---

## 六、开发红线（Electron 特有）

1. **渲染进程不直接访问文件系统**，全部走 IPC → 主进程；`contextIsolation: true` 不能关
2. **大图不发原图给渲染进程**，预览用缩略图（限制 1000px 内），导出时才处理原图
3. **耗时处理异步 + 进度反馈**，走主进程队列 + IPC 推送，不阻塞 UI
4. **绝不原地覆盖原图**，一律输出到用户指定目录，文件名保持原样
5. **限制 sharp 并发**（建议 4~8），libvips 内部已有线程池，放开会吃满内存
6. **打包注意原生模块**：sharp 需要 `asarUnpack` 配置，参考 `imagePro` 的 `build` 字段
7. **不引入任何需要联网的运行时依赖**——看到「云 API」「在线模型」「CDN 资源」一律先停下来确认
8. **文件路径全部走用户选择**——用 `dialog.showOpenDialog` / `showSaveDialog`，不硬编码路径、不擅自扫描用户磁盘
