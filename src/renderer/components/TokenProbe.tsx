import type { JSX } from 'react'

/**
 * 设计 token 的校验锚点。
 *
 * 为什么需要它：Tailwind v4 按源码里出现过的类名生成工具类，而冒烟脚本是拿
 * **计算样式**判断 token 有没有生效的。如果某个 token 当前界面没用到
 * （`bg-subtle` 就是这样，原型定义了但没有任何规则消费它），就没法验证它对应的
 * 工具类到底生成没生成 —— 而「变量定义了但工具类没生成」正是 Task 10 那个坑
 * （见 docs/decisions.md 的 T10-1）。
 *
 * 所以这里用真实类名渲染一份，视觉上移出屏幕、对辅助技术隐藏。
 * 它不参与任何交互，代价是 6 个空 div。如果最终发布不想要它，删掉这个文件
 * 和 App.tsx 里的引用即可，同时把冒烟脚本的 token 检查一并去掉。
 */
export function TokenProbe(): JSX.Element {
  return (
    <div
      id="token-probe"
      aria-hidden="true"
      style={{ position: 'absolute', left: '-9999px', top: 0 }}
    >
      {/* primitive → semantic 映射：骨白底 + 三级灰字 + 控件圆角 */}
      <div id="probe-bone" className="bg-bone-200 text-fg-3 rounded-control" />
      {/* 语义层：白底 + 主字色 + 窗口圆角 */}
      <div id="probe-surface" className="bg-surface text-fg rounded-window" />
      {/* 全站唯一有彩色，只在警示时出现 */}
      <div id="probe-caution" className="text-caution rounded-inline" />
      {/* 字号四档的最大档 + 等宽字族 */}
      <div id="probe-type" className="text-4 font-mono" />
      {/* 发丝线 */}
      <div id="probe-strong" className="border border-strong" />
      {/* 悬停底色与次强调字色 */}
      <div id="probe-hover" className="bg-hover text-fg-2" />
      {/* 次级底色（原型定义了但当前界面还没消费） */}
      <div id="probe-subtle" className="bg-subtle" />
    </div>
  )
}
