import { basename, extname, join, resolve } from 'node:path'

/**
 * 算出输出文件的绝对路径，并保证绝不覆盖任何已有文件、绝不覆盖原图。
 *
 * 第二条判断是必须的：用户把输出目录设成原图目录、且输出格式和原格式相同时，
 * 拼出来的路径正好等于原图路径。少了它就会原地覆盖原图（SPEC.md §4.7）。
 */
export function resolveOutputPath(input: {
  sourcePath: string
  outputDir: string
  targetExt: string
  exists: (p: string) => boolean
}): string {
  const { sourcePath, outputDir, targetExt, exists } = input
  const sourceAbs = resolve(sourcePath)
  const stem = basename(sourcePath, extname(sourcePath))

  const candidate = join(outputDir, `${stem}.${targetExt}`)
  if (resolve(candidate) !== sourceAbs && !exists(candidate)) return candidate

  for (let n = 2; n < 10_000; n++) {
    const next = join(outputDir, `${stem} (${n}).${targetExt}`)
    if (resolve(next) !== sourceAbs && !exists(next)) return next
  }
  throw new Error('OUTPUT_NAME_EXHAUSTED')
}
