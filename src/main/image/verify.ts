export class ImageEngineError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message)
    this.name = 'ImageEngineError'
  }
}

/**
 * 承诺二的落点：输出宽高必须和输入逐字节相等。
 * 不一致就抛错，调用方不得写文件（SPEC.md §4.4）。
 */
export function assertSameDimensions(
  before: { width: number; height: number },
  after: { width: number; height: number }
): void {
  if (before.width !== after.width || before.height !== after.height) {
    throw new ImageEngineError(
      'DIMENSION_CHANGED',
      `尺寸被改动了：${before.width}x${before.height} -> ${after.width}x${after.height}`
    )
  }
}
