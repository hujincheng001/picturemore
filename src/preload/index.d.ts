import type { PictureMoreApi } from '../shared/api'

/**
 * 渲染层看到的 `window.pictureMore`。
 *
 * 只声明类型，不引入 preload 的实现 —— 渲染进程拿不到 electron，
 * 类型图里也不该出现它。
 */
declare global {
  interface Window {
    pictureMore: PictureMoreApi
  }
}

export {}
