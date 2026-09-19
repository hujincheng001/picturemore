import type { JSX } from 'react'

// Task 1 的占位界面：只用来验证窗口能起来、红线生效。
// Task 10 接 token，Task 11/12 换成真正的组件。
export default function App(): JSX.Element {
  return (
    <div>
      <p>图压压</p>
      <p>骨架已通。按 F12 在 Console 里执行 typeof window.require</p>
    </div>
  )
}
