/**
 * M0 验证脚本 A：sharp 能不能读 HEIC，heic-decode 兜底能不能用
 *
 * 必须回答三个问题（结论见 docs/decisions.md）：
 *   1. sharp 直读是否失败？
 *   2. heic-decode 返回的 raw 是否已经应用了方向（HEIF irot / EXIF orientation）？
 *   3. 若已应用，encode.ts 里就不能再写 orientation 标签，否则二次旋转
 *
 * 第 2 问不靠肉眼，靠解容器：主图的 ispe（存储尺寸）与 irot（旋转）直接从字节里读出来，
 * 再和 heic-decode 的返回值比。
 *
 * 用法：node scripts/verify-heic.mjs
 */
import sharp from 'sharp';
import heicDecode from 'heic-decode';
import { readFileSync, existsSync } from 'node:fs';
import { basename } from 'node:path';
import { inspectHeif, describeIcc } from './lib/heif.mjs';

const FIXTURES = ['tests/fixtures/iphone-portrait.heic', 'tests/fixtures/iphone-landscape.heic'];

const line = (s = '') => console.log(s);
const rule = (t) => line(`\n${'='.repeat(4)} ${t} ${'='.repeat(Math.max(0, 60 - t.length))}`);

rule('sharp 的 HEIF 能力声明');
line(JSON.stringify(sharp.format.heif, null, 2));
line('');
line('注意 input.fileSuffix 只有 .avif：预编译版能解 AVIF（AV1），解不了 HEIC（HEVC）。');

let sharpDecodeFailed = 0;

for (const path of FIXTURES) {
  rule(basename(path));

  if (!existsSync(path)) {
    line('fixture 不存在，跳过。');
    continue;
  }

  const buf = readFileSync(path);
  line(`文件字节: ${buf.length}`);

  /* ---------- 容器里的事实 ---------- */
  const info = inspectHeif(buf);
  const primary = info.items.find((i) => i.id === info.primaryItemId);
  const prop = (t) => primary?.decoded.find((d) => d.type === t) ?? null;
  const ispe = prop('ispe');
  const irot = prop('irot');
  const imir = prop('imir');
  const pixi = prop('pixi');
  const colr = prop('colr');

  line(`容器 brand          : ${info.majorBrand}  主图 item #${info.primaryItemId}（${primary?.type}）`);
  line(`主图 ispe（存储尺寸）: ${ispe ? `${ispe.width}x${ispe.height}` : '无'}`);
  line(`主图 irot（旋转）    : ${irot ? `${irot.angle} 度` : '无'}`);
  line(`主图 imir（镜像）    : ${imir ? imir.axis : '无'}`);
  line(`主图 pixi（位深）    : ${pixi ? `${pixi.bitsPerChannel.join('/')} bit` : '无'}`);
  if (colr?.kind === 'icc') {
    const d = describeIcc(colr.bytes);
    line(`主图 colr（色彩配置）: ICC ${colr.bytes.length} 字节，${d.primaries}`);
  } else if (colr?.kind === 'nclx') {
    line(`主图 colr（色彩配置）: nclx primaries=${colr.colourPrimaries}`);
  } else {
    line('主图 colr（色彩配置）: 无');
  }

  /* ---------- 路径 A：sharp 直读 ---------- */
  let sharpMetadataOk = false;
  try {
    const m = await sharp(buf).metadata();
    sharpMetadataOk = true;
    line(`[A] sharp.metadata() 成功: ${m.width}x${m.height} format=${m.format} orientation=${m.orientation}`);
  } catch (e) {
    line(`[A] sharp.metadata() 失败: ${e.message}`);
  }

  let sharpEncodeOk = false;
  try {
    const b = await sharp(buf).jpeg({ quality: 85 }).toBuffer();
    sharpEncodeOk = true;
    line(`[A] sharp 解码并编码成功，字节 = ${b.length}`);
  } catch (e) {
    sharpDecodeFailed++;
    line(`[A] sharp 解码失败: ${e.message.split('\n').filter(Boolean).pop()}`);
  }

  /* ---------- 路径 B：heic-decode 兜底 ---------- */
  const r = await heicDecode({ buffer: buf });
  const channels = r.data.length / (r.width * r.height);
  line(`[B] heic-decode: ${r.width}x${r.height} 通道 = ${channels}`);

  const out = await sharp(Buffer.from(r.data), {
    raw: { width: r.width, height: r.height, channels: 4 },
  })
    .jpeg({ quality: 85 })
    .toBuffer();

  const om = await sharp(out).metadata();
  line(
    `[B] 编码后: ${om.width}x${om.height} orientation=${om.orientation} icc=${!!om.icc} 字节=${out.length}`
  );
  line(`[B] 宽高是否一致: ${om.width === r.width && om.height === r.height}`);

  /* ---------- 方向判定 ---------- */
  let verdict;
  if (!ispe) {
    verdict = '无法判定：容器里没读到主图 ispe';
  } else if (r.width === ispe.width && r.height === ispe.height) {
    const needsRotation = (irot && irot.angle !== 0) || (imir && imir.axis);
    verdict = needsRotation
      ? 'heic-decode 返回的是「存储尺寸」，未应用方向。方向标签需要我们自己写回。'
      : 'heic-decode 返回的是「存储尺寸」，且本图本身无方向变换，无需写回。';
  } else if (r.width === ispe.height && r.height === ispe.width) {
    verdict =
      'heic-decode 返回的是「显示尺寸」，宽高已被交换，方向已经应用过了。' +
      'encode.ts 对 HEIC 输入不得再写 orientation 标签，否则二次旋转。';
  } else {
    verdict = `尺寸既非存储也非其转置（存储 ${ispe.width}x${ispe.height}，解出 ${r.width}x${r.height}），需人工确认。`;
  }
  line(`>>> 判定: ${verdict}`);
  void sharpMetadataOk;
  void sharpEncodeOk;
}

rule('汇总');
line(`sharp 能读 metadata 但解不了像素的 fixture 数: ${sharpDecodeFailed} / ${FIXTURES.length}`);
line('结论与取舍见 docs/decisions.md');
