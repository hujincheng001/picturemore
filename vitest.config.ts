import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // 图像引擎是纯函数，脱离 Electron 直接跑在 Node 里（SPEC.md §4.1）
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    testTimeout: 30_000
  }
})
