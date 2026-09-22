/**
 * ICC profile 的识别。
 *
 * **为什么需要它**：HEIC 的像素走 `heic-decode`（libheif-js），而它不做色彩管理 ——
 * 解出来的原始数值没有任何标签。我们的做法是补挂一个 P3 标签（M0-3）。
 *
 * 但那个做法对 **iPhone 之外**的 HEIC 是错的：Android 拍的 HEIC 通常是 sRGB，
 * 给它挂 P3 会让画面**偏艳**（把 sRGB 数值当成 P3 显示）。
 *
 * 所以先认出源文件自带的是哪种 profile，只在**不是 sRGB** 时才补挂 P3。
 * 判据保守：只有明确认出 sRGB 才不挂，认不出的一律维持原行为 ——
 * iPhone 是主力输入，宁可对未知情况保持现状，也不能把主路径改坏。
 *
 * 见 docs/decisions.md 的 M0-3 与 T23-1。
 */

export type IccKind = 'display-p3' | 'srgb' | 'other' | 'none'

/**
 * 从 ICC 里读出 profile 的可读名字。
 *
 * ICC 结构：128 字节头 → 4 字节标签数 → 每 12 字节一个标签表项
 * （签名 4 + 偏移 4 + 长度 4）。名字在 `desc` 标签里，有两种类型：
 *
 * - `desc`（textDescription）：4 字节类型 + 4 保留 + 4 长度 + ASCII 串
 * - `mluc`（multiLocalizedUnicode）：4 + 4 + 记录数 4 + 记录长度 4 + 记录表 + UTF-16BE 串
 *
 * **两种都要认**：Apple 的 "Display P3" 用的是 `mluc`，而老的 sRGB profile
 * 常用 `desc`。只处理一种会漏掉一半。
 *
 * 返回 null 表示读不出来（不是合法 ICC、标签缺失、偏移越界等）。
 */
export function iccProfileName(icc: Buffer | null): string | null {
  if (icc === null || icc.length < 132) return null

  const tagCount = icc.readUInt32BE(128)
  // 标签数明显超出文件大小时说明这不是 ICC，别继续读
  if (tagCount > 1024) return null

  for (let i = 0; i < tagCount; i++) {
    const entry = 132 + i * 12
    if (entry + 12 > icc.length) return null
    if (icc.toString('latin1', entry, entry + 4) !== 'desc') continue

    const offset = icc.readUInt32BE(entry + 4)
    const size = icc.readUInt32BE(entry + 8)
    if (size < 12 || offset + size > icc.length) return null

    const type = icc.toString('latin1', offset, offset + 4)

    if (type === 'desc') {
      const count = icc.readUInt32BE(offset + 8)
      const end = Math.min(offset + 12 + count, icc.length)
      return icc
        .toString('latin1', offset + 12, end)
        .replace(/\0+$/, '')
        .trim()
    }

    if (type === 'mluc') {
      const records = icc.readUInt32BE(offset + 8)
      if (records < 1) return null
      // 取第一条记录：语言 2 + 国家 2 + 长度 4 + 偏移 4
      const length = icc.readUInt32BE(offset + 20)
      const stringOffset = icc.readUInt32BE(offset + 24)
      const start = offset + stringOffset
      if (length < 2 || start + length > icc.length) return null

      let out = ''
      for (let k = 0; k + 1 < length; k += 2) {
        out += String.fromCharCode(icc.readUInt16BE(start + k))
      }
      return out.replace(/\0+$/, '').trim()
    }

    // desc 标签存在但类型不认识
    return null
  }

  return null
}

/**
 * 把 ICC 归类。认不出来的一律是 `other` —— 调用方对 `other` 应当**维持原行为**，
 * 不要因为认不出就当成 sRGB。
 */
export function classifyIcc(icc: Buffer | null): IccKind {
  if (icc === null || icc.length === 0) return 'none'
  return classifyIccName(iccProfileName(icc))
}

/**
 * 按 profile **名字**归类。`probe` 存的是名字（SPEC §6.2：`icc: string | null`，
 * 「ICC profile 名，如 'srgb'」），所以压缩路径用的是这个。
 *
 * 认不出来的一律 `other` —— 调用方对 `other` 应当**维持原行为**，
 * 不要因为认不出就当成 sRGB。
 *
 * 名字为 null（没有 ICC，或名字读不出来）时是 `none`。两者在 `shouldTagAsP3`
 * 里都走「挂」，所以不必区分。
 */
export function classifyIccName(name: string | null): IccKind {
  if (name === null) return 'none'
  const lower = name.toLowerCase()
  if (lower.length === 0) return 'other'

  // "Display P3" 与 sharp 内置的 "sP3C" 都含 p3
  if (lower.includes('p3')) return 'display-p3'
  if (lower.includes('srgb')) return 'srgb'
  return 'other'
}

/**
 * 该不该给这份像素补挂 P3 标签。
 *
 * 只有明确是 sRGB 时才不挂；`none` / `other` / `display-p3` 都挂 ——
 * 和改动之前的行为一致，所以这条改动**只可能修好 Android，不会弄坏 iPhone**。
 */
export function shouldTagAsP3(kind: IccKind): boolean {
  return kind !== 'srgb'
}
