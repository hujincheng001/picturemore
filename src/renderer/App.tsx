import type { JSX } from 'react'

/**
 * Task 10 的占位界面。
 *
 * 里面那个 `token-probe` 块是**有意的**：Tailwind v4 按源码里出现过的类名生成工具类，
 * 如果这些类只写在冒烟脚本的字符串里，CSS 里根本不会有它们，验证就成了空转。
 * 所以这里用真实类名渲染一遍，冒烟脚本再读计算样式确认 token 真的生效。
 *
 * Task 11 / 12 会把这页换成真实组件，那时探针的使命结束，冒烟脚本改成量真实元素。
 */
export default function App(): JSX.Element {
  return (
    <div>
      <p>图压压</p>
      <p>骨架已通。按 F12 在 Console 里执行 typeof window.require</p>

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
      </div>
    </div>
  )
}
