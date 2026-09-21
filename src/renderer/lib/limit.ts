/**
 * 单批数量上限。
 *
 * 用户 2026-09-21 的决定：一次最多处理 100 张。原来的规格是「拖入 500 张允许」
 * （SPEC §9），改成上限 100 之后，原来那套「长列表虚拟化」就永远不会触发了
 * （阈值是 >100 行），所以一并删掉了 —— 见 docs/decisions.md 的 T18-1。
 *
 * 上限在**主进程展开目录之后**执行（`probe` 的 `limit` 参数），
 * 这样拖进来一个几千张的文件夹时不会先把它们全读一遍。
 */
export const MAX_BATCH = 100

/**
 * 按剩余名额截断新加入的项。
 *
 * 抽成纯函数是因为它的错法都是差一：正好 100 张时该不该再收、超出的算不算 dropped。
 * 这些不会报错，只会让界面上的数字对不上。
 */
export function takeWithinLimit<T>(
  existingCount: number,
  incoming: T[],
  max: number = MAX_BATCH
): { accepted: T[]; dropped: number } {
  const room = Math.max(0, max - existingCount)
  const accepted = incoming.slice(0, room)
  return { accepted, dropped: incoming.length - accepted.length }
}
