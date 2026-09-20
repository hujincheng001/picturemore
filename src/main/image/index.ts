/**
 * 图像引擎的唯一对外出口。
 *
 * 上层（IPC 层、队列）只从这里拿能力，不直接 import 内部模块，
 * 这样内部换实现时不用动调用方。
 */

export * from './types'
export { probe } from './probe'
export { compressOne, targetFormat, EXT } from './compress'
export type { CompressInput, CompressOutput } from './compress'
export { resolveOutputPath } from './naming'
export { ImageEngineError } from './verify'
export { qualityFloor, targetBytes, SAFE_MAX, FLOOR_PERCEPTUAL, FLOOR_VISIBLE, CEIL } from './plan'
