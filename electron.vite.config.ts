import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  // sharp 是原生模块，绝不能被 Vite 打进 bundle（见 SPEC.md §14.1）。
  // externalizeDepsPlugin 把 package.json 的 dependencies 全部标成 external。
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        external: ['sharp', 'heic-decode']
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer')
      }
    },
    // Tailwind v4 必须走 @tailwindcss/vite，不要写 postcss.config.js（见 SPEC.md §14.2）
    plugins: [react(), tailwindcss()]
  }
})
