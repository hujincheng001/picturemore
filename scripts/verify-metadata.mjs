/**
 * M0 验证脚本 B：定下 encode.ts 里 metadata 的确切写法
 *
 * 目标（SPEC.md §4.5）：保留 ICC + 写入 orientation 标签 + 丢弃其余 EXIF。
 * sharp 0.33+ 的 withMetadata / keepIccProfile / withExif 语义与直觉不符，必须实测。
 *
 * 三组输入：
 *   α 普通 sRGB JPG，带大 EXIF + orientation 6           —— 主路径
 *   β 真正的 Display P3 输入（由 HEIC 解出的 raw 挂 p3 得到）—— 验证 ICC 是否原样保留
 *   γ HEIC 解出的 raw RGBA（P3 数值、无 ICC、方向已应用）   —— HEIC 路径
 *
 * 用法：node scripts/verify-metadata.mjs
 */
import sharp from 'sharp';
import heicDecode from 'heic-decode';
import { readFileSync, existsSync } from 'node:fs';

const HEIC = 'tests/fixtures/iphone-portrait.heic';

const line = (s = '') => console.log(s);
const rule = (t) => line(`\n${'='.repeat(4)} ${t} ${'='.repeat(Math.max(0, 60 - t.length))}`);
const pad = (s, n) => String(s).padEnd(n);

/** 逐字节比较两段像素的平均绝对差，用来判断"动了像素"还是"只改了标签" */
async function pixelDelta(a, b) {
  const [ra, rb] = await Promise.all([sharp(a).raw().toBuffer(), sharp(b).raw().toBuffer()]);
  if (ra.length !== rb.length) return Number.NaN;
  let sum = 0;
  let max = 0;
  for (let i = 0; i < ra.length; i++) {
    const d = Math.abs(ra[i] - rb[i]);
    sum += d;
    if (d > max) max = d;
  }
  return { mean: sum / ra.length, max };
}

/* ================================================================
 * α：普通 sRGB JPG，带大 EXIF 与 orientation 6
 * ================================================================ */
const srcJpeg = await sharp({ create: { width: 900, height: 600, channels: 3, background: '#3A7BD5' } })
  .withExif({ IFD0: { Make: 'M0-TestCamera', Software: 'pictureMore-M0', ImageDescription: 'X'.repeat(3000) } })
  .withMetadata({ orientation: 6 })
  .jpeg({ quality: 90 })
  .toBuffer();
const mJpeg = await sharp(srcJpeg).metadata();

rule('输入 α：普通 sRGB JPG');
line(`宽高 ${mJpeg.width}x${mJpeg.height}  orientation=${mJpeg.orientation}  exif=${mJpeg.exif?.length} 字节  icc=${mJpeg.icc ? '有' : '无'}`);

const ALPHA_CASES = {
  'A 不写任何 metadata': (p) => p,
  'B withMetadata()': (p) => p.withMetadata(),
  'C keepIccProfile + withMetadata({orientation})': (p) =>
    p.keepIccProfile().withMetadata({ orientation: 6 }),
  'D keepExif()': (p) => p.keepExif(),
  'E withExif({})': (p) => p.withExif({}),
  'F keepIccProfile + withExif({})': (p) => p.keepIccProfile().withExif({}),
  'G withExif({}) + withMetadata({orientation})': (p) =>
    p.withExif({}).withMetadata({ orientation: 6 }),
  'H keepIccProfile + withExif({}) + withMetadata({orientation})': (p) =>
    p.keepIccProfile().withExif({}).withMetadata({ orientation: 6 }),
};

rule('用例矩阵 · α 普通 sRGB JPG 输入');
line(pad('用例', 56) + pad('orientation', 13) + pad('exif', 10) + pad('icc', 7) + '字节');
line('-'.repeat(92));

const rowsAlpha = [];
for (const [name, apply] of Object.entries(ALPHA_CASES)) {
  const buf = await apply(sharp(srcJpeg)).jpeg({ quality: 85, mozjpeg: true }).toBuffer();
  const m = await sharp(buf).metadata();
  const row = {
    name,
    orientation: m.orientation ?? null,
    exif: m.exif?.length ?? 0,
    icc: m.icc?.length ?? 0,
    bytes: buf.length,
    dimsOk: m.width === mJpeg.width && m.height === mJpeg.height,
  };
  rowsAlpha.push(row);
  line(
    pad(name, 56) +
      pad(row.orientation ?? '无', 13) +
      pad(row.exif ? `${row.exif}B` : '无', 10) +
      pad(row.icc ? `${row.icc}B` : '无', 7) +
      row.bytes
  );
}

rule('α 组判定：orientation 写对 + EXIF 最小 + ICC 保留 + 尺寸不变');
const passes = (r) => r.orientation === 6 && r.exif <= 200 && r.icc > 0 && r.dimsOk;
for (const r of rowsAlpha) {
  line(
    `${pad(r.name, 56)} orientation:${r.orientation === 6 ? 'ok' : 'no'} exif:${r.exif <= 200 ? 'ok' : 'no'} icc:${r.icc > 0 ? 'ok' : 'no'} => ${passes(r) ? '通过' : '不通过'}`
  );
}
const winners = rowsAlpha.filter(passes).sort((a, b) => a.bytes - b.bytes);
line('');
line(winners.length ? `>>> α 组通过: ${winners.map((r) => r.name).join(' / ')}` : '>>> α 组没有满足条件的写法');
line('>>> 关键：withMetadata() 会把输出 ICC 强制设成 sRGB，且不转换像素，对 P3 输入等于改坏颜色。不要用它。');

/* ================================================================
 * 跨格式验证：keepIccProfile().withExif({}) 是否保住方向与 ICC
 * ================================================================ */
rule('跨格式矩阵：keepIccProfile().withExif({})');
line(pad('格式', 8) + pad('输入 orient', 13) + pad('输出 orient', 13) + pad('输入 exif', 11) + pad('输出 exif', 11) + 'ICC 原样');
line('-'.repeat(78));

const iccEq = (a, b) => Boolean(a && b && a.length === b.length && Buffer.compare(a, b) === 0);
let matrixOk = true;
for (const fmt of ['jpeg', 'png', 'webp']) {
  for (const orient of [1, 3, 6, 8]) {
    const src = await sharp({ create: { width: 200, height: 120, channels: 3, background: '#C81E1E' } })
      .withIccProfile('p3')
      .withExif({ IFD0: { Make: 'M0' } })
      .withMetadata({ orientation: orient })
      [fmt]()
      .toBuffer();
    const sm = await sharp(src).metadata();
    const out = await sharp(src).keepIccProfile().withExif({})[fmt]().toBuffer();
    const om = await sharp(out).metadata();
    const same = iccEq(sm.icc, om.icc);
    const ok = om.orientation === sm.orientation && om.exif.length < sm.exif.length && same;
    if (!ok) matrixOk = false;
    line(
      pad(fmt, 8) +
        pad(sm.orientation ?? '无', 13) +
        pad(om.orientation ?? '无', 13) +
        pad(sm.exif?.length ?? 0, 11) +
        pad(om.exif?.length ?? 0, 11) +
        (same ? '是' : '否')
    );
  }
}
line('');
line(matrixOk ? '>>> 全格式全方向通过：方向保留、EXIF 缩小、ICC 字节原样' : '>>> 有组合未通过，需要重新取舍');

/* ================================================================
 * β / γ：HEIC 相关
 * ================================================================ */
if (!existsSync(HEIC)) {
  rule('HEIC fixture 不存在，β / γ 跳过');
} else {
  const raw = await heicDecode({ buffer: readFileSync(HEIC) });
  const rawOpts = { raw: { width: raw.width, height: raw.height, channels: 4 } };
  // 缩到 400px 宽做验证，避免每次全尺寸编码太慢
  const small = () => sharp(Buffer.from(raw.data), rawOpts).resize(400, null, { fit: 'inside' });

  rule('输入 γ：HEIC 解出的 raw RGBA');
  line(`宽高 ${raw.width}x${raw.height}  通道 ${raw.data.length / (raw.width * raw.height)}`);
  line('ICC 无（libheif-js 不暴露 ICC，见 docs/decisions.md）');
  line('EXIF 无，方向已在解码阶段应用');

  const baseline = await small().png().toBuffer();

  const GAMMA_CASES = {
    'A 什么都不写': (p) => p,
    'B withMetadata()': (p) => p.withMetadata(),
    'C withExif({})': (p) => p.withExif({}),
    'D withExif({}) + withIccProfile("p3")': (p) => p.withExif({}).withIccProfile('p3'),
    'E withMetadata({orientation:1}) + withIccProfile("p3")': (p) =>
      p.withMetadata({ orientation: 1 }).withIccProfile('p3'),
  };

  rule('用例矩阵 · γ HEIC raw 输入（PNG 无损输出，便于逐像素比对）');
  line(pad('用例', 56) + pad('icc', 8) + pad('orientation', 13) + '像素平均改动');
  line('-'.repeat(92));
  for (const [name, apply] of Object.entries(GAMMA_CASES)) {
    const out = await apply(small()).png().toBuffer();
    const m = await sharp(out).metadata();
    const d = await pixelDelta(baseline, out);
    line(
      pad(name, 56) +
        pad(m.icc ? `${m.icc.length}B` : '无', 8) +
        pad(m.orientation ?? '无', 13) +
        `${d.mean.toFixed(3)}（最大 ${d.max}）`
    );
  }

  /* β：把 raw 挂上 p3 标签，得到一张真正的 Display P3 输入 */
  const p3Input = await small().withIccProfile('p3').png().toBuffer();
  const mP3 = await sharp(p3Input).metadata();

  rule('输入 β：真正的 Display P3 输入（HEIC raw 挂 p3 标签得到）');
  line(`icc=${mP3.icc?.length} 字节`);

  rule('用例矩阵 · β 真 P3 输入，看 ICC 是否原样保留');
  for (const [name, apply] of Object.entries({
    'A 什么都不写': (p) => p,
    'B keepIccProfile()': (p) => p.keepIccProfile(),
    'H keepIccProfile + withExif({}) + withMetadata({orientation})': (p) =>
      p.keepIccProfile().withExif({}).withMetadata({ orientation: 6 }),
  })) {
    const out = await apply(sharp(p3Input)).png().toBuffer();
    const m = await sharp(out).metadata();
    const same = m.icc && mP3.icc && m.icc.length === mP3.icc.length && Buffer.compare(m.icc, mP3.icc) === 0;
    const d = await pixelDelta(p3Input, out);
    line(
      pad(name, 56) +
        pad(m.icc ? `${m.icc.length}B${same ? ' 同输入' : ' 已变'}` : '无', 18) +
        pad(`orientation=${m.orientation ?? '无'}`, 20) +
        `像素平均改动 ${d.mean.toFixed(3)}`
    );
  }
}

rule('结论');
line('完整结论与取舍见 docs/decisions.md');
