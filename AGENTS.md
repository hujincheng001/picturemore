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
| 1 | `README.md` | 技术栈决策依据、Electron 红线、常用命令 |
| 2 | `PRODUCT.md` | 产品定位、目标用户、能力边界、产品原则 |
| 3 | `SPEC.md` | **开发依据**。架构、压缩算法、IPC 契约、陷阱、里程碑 |
| 4 | `docs/superpowers/plans/2026-09-19-picturemore-v1.md` | **任务级实施计划**，14 个 Task，逐条勾选执行 |
| 5 | `DESIGN.md` | 视觉规格：token、组件状态矩阵、动效、文案规则 |
| 6 | `prototype/index.html` | **唯一视觉基准**，浏览器直接打开，与实现并排比对 |

---

## 现在该做什么

### 第一步：M0 技术验证（**不要跳，不要先搭项目**）

计划里的 Task 0。跑两个脚本：

```
scripts/verify-heic.mjs        # 验证 sharp 能不能读 HEIC
scripts/verify-metadata.mjs    # 验证 withMetadata 的 ICC / orientation / EXIF 行为
```

它们各自可能推翻 `SPEC.md` 里已写好的假设。结论写进 `docs/decisions.md`，再往下走。

### 第二步：按计划执行

用 `executing-plans` 技能，从 Task 1 开始，一个 Task 一个 Task 做。每个 Task 结束都要跑 `npm run check`。

---

## 三条绝对不能破的线

违反任何一条，代码即使跑通也是错的：

1. **绝不调用 `.resize()`。** 本产品承诺尺寸不变。`npm run lint:no-resize` 会拦截。
2. **每次输出后断言宽高与输入一致。** 不一致就抛 `DIMENSION_CHANGED`，不写文件。
3. **渲染进程不碰文件系统。** `contextIsolation: true` + `nodeIntegration: false` 永远不动，所有文件操作走 IPC。

---

## 硬性约束速查

| 项 | 规则 |
|---|---|
| 依赖 | 只有 `sharp`、`heic-decode`、`zustand` 三个运行时依赖。**不要加新的**。特别地：不用 `nanoid`（用 `crypto.randomUUID()`）、不用 `electron-store`、不用 `react-router-dom`、不装图标库 |
| 图标 | 全站零图标、零 emoji。交互靠文字 |
| 文案 | 只能取自 `SPEC.md` §8.4 文案表，不得自造词 |
| 标点 | 零 em-dash（`—` 和 `–` 都不行，中文里也不用"——"）。中黑点 `·` 每行最多一个 |
| 圆角 | 只用 12 / 6 / 4 三个值 |
| 字号 | 只用 12 / 15 / 20 / 36 四个值 |
| 颜色 | 暖灰一族，不混冷灰。唯一有彩色是琥珀 `#8A5B00`，只在警示时出现 |
| 动效 | 只动 `transform` / `opacity` / 颜色。必须有 `prefers-reduced-motion` 兜底 |
| 网络 | 任何需要联网的依赖、CDN、云 API 一律不加。`src/main/security.ts` 在运行时也会拦 |

---

## 视觉上的任何问题

**以 `prototype/index.html` 为准。** 把它在浏览器打开，和你的实现并排放在一起比对。字号、间距、圆角、颜色、悬停态、聚焦环，逐项对齐。肉眼能看出差异就是没做完。

`DESIGN.md` 是它的文字化规格。两者冲突时以原型为准。

---

## 遇到不确定时

1. 先查 `SPEC.md` §14 已知陷阱
2. 再查 `README.md` 的红线清单
3. 都不覆盖，就问用户，**不要猜**

---

## 已完成的部分

- 产品定义、范围收敛（v1 只做压缩，格式转换是输出选项）
- 界面设计已定稿并经用户审核通过，视觉基准已冻结在 `prototype/index.html`
- 技术风险已识别（HEIC 解码、metadata 行为），验证脚本已备好
- 代码：**一行都没写**
