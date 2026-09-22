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

  /**
   * 拖进来的东西里一张可压缩的图都没有。
   *
   * 覆盖两种情况：空文件夹、只拖了非图片文件（.txt 之类）。
   * 文案刻意用中性说法，因为渲染层只拿到路径，分不出是哪一种 ——
   * 而这两种情况对用户来说是同一件事：「我拖了东西，但什么也没进来」。
   *
   * SPEC §9 只说「拖入非图片文件 → 静默过滤」和「空文件夹 → 给提示」。
   * **「静默」理解为「不报错、不当失败处理」，不是「一声不吭」**：
   * 一张图都没进来时如果界面完全没反应，用户只会以为程序卡了。
   * 混在一堆图里被过滤掉的那些仍然不吭声。
   *
   * 2026-09-22 定，已同步进 SPEC §8.4。
   */
  emptyDrop: '没有可压缩的图片',

  /**
   * 行内提示：这张没压到目标。
   *
   * SPEC §9 给了这两句，但**没说放哪** —— 原型 `.file` 是 44px 一行、只有
   * 文件名 / 体积 / 移除三格。原型只画了 happy path，这两个状态它从未覆盖，
   * 所以补一格不算偏离原型，是填原型没画的洞。
   *
   * 实现上**只在有话说时才渲染这一格**，没有提示的行仍是三格。
   * 文件名那格是 `flex:1`，会吸收这点差异，其它两格不会跳位。
   *
   * `{x}` 取**输出体积占原图的百分比**：「只压到 58%」读作「只压到原图的 58%」，
   * 这是中文里最自然的读法，也和旁边那对体积对得上。
   */
  undershotKept: '这张已经压到底了',
  undershotFloor: (pct: number): string => `质量已到下限，只压到 ${pct}%`,

  /**
   * 批次级错误。放在底部那行 —— 它本来就在「常驻声明」与「完成提示」之间切换，
   * 加第三个状态不需要新增版式。
   *
   * 用户 2026-09-21 确认。原来 DESIGN.md §5.6 的 CTA 状态矩阵只有
   * 「默认 / 悬停 / 激活 / 禁用」，SPEC §8.4 也没有对应字符串 ——
   * 结果是输出目录写不进去时**点了没反应**。见 docs/decisions.md 的 T20-3。
   */
  errorWriteFailed: '这个文件夹写不进去，换一个试试',
  errorDiskFull: '磁盘满了，后面的图没有处理',
  errorFallback: '这批没有跑完',

  clearList: '清空列表',
  remove: '移除',
  removeAria: (name: string): string => `移除 ${name}`,

  /* ---------- 结果 ---------- */
  doneTip: (path: string): string => `完成。原图没动，新文件在 ${path}`
} as const
