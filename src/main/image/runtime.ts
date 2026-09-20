import sharp from 'sharp'

let configured = false

/**
 * 图像引擎的运行时配置，进程启动时调用一次。
 *
 * SPEC §14 的 OOM 条目：「8000x6000 的图同时跑 8 张会吃满内存」，
 * 给出的处置是关掉 sharp 内部缓存。
 *
 * sharp 默认会缓存最近解码/编码过的图（libvips 的 operation cache 与 memory cache）。
 * 对"一张一张来"的场景这份缓存是好事，但批量压缩时它只会挤占本就紧张的内存：
 * 一张 48MP 的图光裸 RGBA 就是 192MB，缓存几份就上 GB 了。
 *
 * 这里刻意不去动 `sharp.concurrency()`。并发池（`src/main/queue.ts`）负责并行度，
 * libvips 自己的线程数怎么配需要实测再定，不凭感觉设。
 */
export function configureImageRuntime(): void {
  if (configured) return
  configured = true
  sharp.cache(false)
}
