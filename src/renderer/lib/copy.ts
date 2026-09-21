/**
 * 全站文案的唯一来源。
 *
 * SPEC §8.4 明确要求「集中管理，禁止散落在组件里」，所以组件里不允许出现
 * 中文字符串字面量。要改文案只改这里。
 *
 * 四态文案（承诺句 / PNG 劝阻 / 越线警告 / 透明提示）的优先级见 DESIGN.md §7，
 * 判定逻辑在 QualityNote.tsx，字符串在这里。
 *
 * 写作纪律（DESIGN.md §7）：零 em-dash、零 emoji、中黑点每行最多一个、
 * 禁用「赋能 / 一站式 / 极致 / 轻松搞定 / 无缝 / 释放」。
 */

export const COPY = {
  /** 产品名，左上角 */
  wordmark: '图压压',
  wordmarkSub: 'pictureMore',

  /* ---------- 左栏 ---------- */
  shrinkLabel: '体积缩小',
  shrinkAria: '体积缩小百分比',
  scaleLow: '几乎看不出',
  scaleHigh: '能看出差别',

  formatLabel: '输出格式',
  formatKeep: '保持原格式',
  formatJpeg: 'JPG',
  formatPng: 'PNG',
  formatWebp: 'WebP',

  destLabel: '存放位置',
  destChange: '更改',
  destPickAria: '更改图片存放位置',
  destHint: '原图不会被改动，压缩后的新文件单独放在这里',

  /* ---------- 四态文案（DESIGN.md §7）---------- */
  /** 优先级 4：默认承诺句 */
  promise: '不改尺寸，不裁剪，不重绘。只重新编码，正常观看看不出差别。',
  /** 优先级 3：滑块越线 */
  overLine: '超过 70% 后，放大到 100% 能看出压缩痕迹。图片尺寸仍然不变。',
  /** 优先级 1：输出 PNG 时的劝阻 */
  pngDissuade: 'PNG 是无损格式，体积基本压不下来。要变小请选 JPG 或 WebP。',
  /** 优先级 2：输出 JPG 且列表里有透明图。{n} 是带透明通道的图片数 */
  alphaFlatten: (n: number): string =>
    `选中的图里有 ${n} 张带透明区域，转成 JPG 后透明部分会变成白色。`,

  /** 预估行的近似标记。取自 prototype/index.html 的「约 12.0 MB」 */
  estimateApprox: '约',
  /** 体积变化箭头。原型里就是这一个字符 */
  arrow: '→',

  /* ---------- CTA ---------- */
  ctaDefault: (n: number): string => `压缩这 ${n} 张`,
  ctaRunning: (i: number, n: number): string => `处理中 ${i} / ${n}`,
  ctaDone: '再压一次',
  footer: '图片只在这台电脑上处理，不会上传',

  /* ---------- 右栏 ---------- */
  dropWithFiles: '拖入更多图片，或',
  dropEmpty: '把图片拖到这里',
  dropFormats: 'HEIC、JPG、PNG、WebP。一张也行，几十张也行',
  pickFile: '选择文件',
  listMeta: (n: number, size: string): string => `共 ${n} 张 · ${size}`,
  /**
   * 超过单批上限时，跟在元信息后面。
   *
   * 用括号而不是再加一个中黑点 —— 写作纪律要求「中黑点每行最多一个」。
   * 这条是用户 2026-09-21 决定加单批 100 张上限时新增的文案，已同步进 SPEC §8.4。
   */
  listDropped: (n: number): string => `（已忽略 ${n} 张）`,
  clearList: '清空列表',
  remove: '移除',
  removeAria: (name: string): string => `移除 ${name}`,

  /* ---------- 结果 ---------- */
  doneTip: (path: string): string => `完成。原图没动，新文件在 ${path}`
} as const
