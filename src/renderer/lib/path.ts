/**
 * 路径处理。
 *
 * 渲染进程拿不到 `node:path`（红线三：渲染层不碰文件系统），所以这里用字符串处理。
 * 抽成独立模块是为了能单测 —— 这两种分隔符都要认的逻辑很容易写漏。
 */

/**
 * 取父目录。
 *
 * Windows 的 `\` 与 POSIX 的 `/` 都要认：用户可能从任何地方拿到路径，
 * 而拖动/粘贴来的路径不保证是同一种分隔符。
 */
export function dirOf(p: string): string {
  const i = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'))
  // i <= 0 时说明没有分隔符（纯文件名）或只有根分隔符（如 `/foo`），原样返回
  return i > 0 ? p.slice(0, i) : p
}

/**
 * `<第一张图所在目录>/processed`（SPEC §4.6 的默认输出目录）。
 *
 * 分隔符跟着输入走：输入是 Windows 路径就产出 Windows 路径，
 * 不要混着来 —— 混着的路径显示给用户会很怪，而且复制到别处可能不认。
 */
export function defaultOutputDir(firstPath: string): string {
  const dir = dirOf(firstPath)
  const sep = dir.includes('\\') ? '\\' : '/'
  return dir.endsWith(sep) ? `${dir}processed` : `${dir}${sep}processed`
}
