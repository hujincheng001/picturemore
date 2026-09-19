/**
 * 最小 HEIF/ISOBMFF 内省工具（仅用于 M0 验证脚本，不进产品代码）
 *
 * 为什么需要它：heic-decode 只给出像素与尺寸，不暴露容器里的
 * ispe（存储尺寸）、irot（旋转）、colr（色彩配置）。而这三样正是
 * 判断「方向是否已应用」「HEIC 到底该带哪个 ICC」的唯一依据。
 */

/** 遍历一个区间内的所有 box */
function* boxes(buf, start, end) {
  let p = start;
  while (p + 8 <= end) {
    let size = buf.readUInt32BE(p);
    const type = buf.subarray(p + 4, p + 8).toString('latin1');
    let header = 8;
    if (size === 1) {
      if (p + 16 > end) break;
      size = Number(buf.readBigUInt64BE(p + 8));
      header = 16;
    } else if (size === 0) {
      size = end - p;
    }
    if (size < header || p + size > end) break;
    yield { type, start: p, dataStart: p + header, end: p + size, size };
    p += size;
  }
}

const children = (buf, box, extraSkip = 0) => boxes(buf, box.dataStart + extraSkip, box.end);
const child = (buf, box, type, extraSkip = 0) => {
  for (const b of children(buf, box, extraSkip)) if (b.type === type) return b;
  return null;
};

function parseColr(buf, box) {
  const colourType = buf.subarray(box.dataStart, box.dataStart + 4).toString('latin1');
  if (colourType === 'prof' || colourType === 'rICC') {
    return { kind: 'icc', bytes: buf.subarray(box.dataStart + 4, box.end) };
  }
  if (colourType === 'nclx') {
    return {
      kind: 'nclx',
      colourPrimaries: buf.readUInt16BE(box.dataStart + 4),
      transferCharacteristics: buf.readUInt16BE(box.dataStart + 6),
      matrixCoefficients: buf.readUInt16BE(box.dataStart + 8),
      fullRange: buf[box.dataStart + 10] >> 7,
    };
  }
  return { kind: colourType };
}

function parseIspe(buf, box) {
  return { width: buf.readUInt32BE(box.dataStart + 4), height: buf.readUInt32BE(box.dataStart + 8) };
}

function parseIrot(buf, box) {
  return { angle: buf[box.dataStart] * 90 };
}

function parseImir(buf, box) {
  return { axis: buf[box.dataStart] === 0 ? 'vertical' : 'horizontal' };
}

function parsePixi(buf, box) {
  const n = buf[box.dataStart + 4];
  return { bitsPerChannel: Array.from(buf.subarray(box.dataStart + 5, box.dataStart + 5 + n)) };
}

/** 从 ICC 的 tag table 读 desc 描述与色域原色，用来判 sRGB / Display P3 */
export function describeIcc(icc) {
  if (!icc || icc.length < 132) return { desc: '(过短)', primaries: null };
  const nTags = icc.readUInt32BE(128);
  const tags = {};
  for (let t = 0; t < nTags && 132 + t * 12 + 12 <= icc.length; t++) {
    const e = 132 + t * 12;
    tags[icc.subarray(e, e + 4).toString('latin1')] = {
      off: icc.readUInt32BE(e + 4),
      size: icc.readUInt32BE(e + 8),
    };
  }
  let desc = '';
  if (tags.desc) {
    const d = icc.subarray(tags.desc.off, tags.desc.off + tags.desc.size);
    const sig = d.subarray(0, 4).toString('latin1');
    try {
      if (sig === 'desc') desc = d.subarray(12, 12 + d.readUInt32BE(8)).toString('latin1').replace(/\0+$/, '');
      else if (sig === 'mluc') {
        const n = d.readUInt32BE(8);
        desc = d.subarray(28, 28 + n).toString('utf16le').replace(/\0+$/, '');
      }
    } catch {
      desc = '(解析失败)';
    }
  }
  const xyz = (sig) => {
    const t = tags[sig];
    if (!t) return null;
    return [0, 4, 8].map((o) => icc.readInt32BE(t.off + 8 + o) / 65536);
  };
  const r = xyz('rXYZ');
  let primaries = null;
  if (r) {
    // 用红原色 x 坐标区分：sRGB 约 0.436，Display P3 约 0.515
    primaries = r[0] > 0.47 ? 'Display P3' : r[0] > 0.4 ? 'sRGB / BT.709' : '其它';
  }
  return { desc, primaries, rXYZ: r, tagCount: nTags, bytes: icc.length };
}

/**
 * 解析 HEIF 文件，返回主图的 ispe / irot / imir / colr，以及全部 item 概览。
 */
export function inspectHeif(buf) {
  const root = { dataStart: 0, end: buf.length };
  let meta = null;
  for (const b of children(buf, root)) if (b.type === 'meta') meta = b;
  if (!meta) return { error: 'no meta box' };

  const metaVerFlags = buf.readUInt32BE(meta.dataStart);
  const metaFlags = metaVerFlags & 0xffffff;

  /* pitm：主图 item id */
  let primaryItemId = null;
  const pitm = child(buf, meta, 'pitm', 4);
  if (pitm) {
    const version = buf[pitm.dataStart];
    primaryItemId = version === 0 ? buf.readUInt16BE(pitm.dataStart + 4) : buf.readUInt32BE(pitm.dataStart + 4);
  }

  /* iinf：item 清单 */
  const items = new Map();
  const iinf = child(buf, meta, 'iinf', 4);
  if (iinf) {
    const version = buf[iinf.dataStart];
    let p = iinf.dataStart + 4;
    const count = version === 0 ? buf.readUInt16BE(p) : buf.readUInt32BE(p);
    p += version === 0 ? 2 : 4;
    for (const b of boxes(buf, p, iinf.end)) {
      if (b.type !== 'infe') continue;
      const v = buf[b.dataStart];
      const id = buf.readUInt16BE(b.dataStart + 4);
      const type = buf.subarray(b.dataStart + 8, b.dataStart + 12).toString('latin1');
      let name = '';
      if (v >= 2) {
        const s = b.dataStart + 12;
        const e = buf.indexOf(0, s);
        name = buf.subarray(s, e === -1 ? b.end : e).toString('utf8');
      }
      items.set(id, { id, type, name, props: [] });
    }
    void count;
  }

  /* iprp → ipco（属性容器）+ ipma（关联表） */
  const iprp = child(buf, meta, 'iprp', 4);
  if (iprp) {
    const ipco = child(buf, iprp, 'ipco', 0);
    const ipma = child(buf, iprp, 'ipma', 0);
    const properties = [];
    if (ipco) for (const b of children(buf, ipco, 0)) properties.push(b);

    if (ipma) {
      const flags = buf.readUInt32BE(ipma.dataStart) & 0xffffff;
      const wide = (flags & 1) === 1;
      let p = ipma.dataStart + 4;
      const entryCount = buf.readUInt32BE(p);
      p += 4;
      for (let i = 0; i < entryCount; i++) {
        const itemId = wide ? buf.readUInt32BE(p) : buf.readUInt16BE(p);
        p += wide ? 4 : 2;
        const assocCount = buf[p++];
        const list = [];
        for (let a = 0; a < assocCount; a++) {
          if (wide) {
            const v = buf.readUInt16BE(p);
            p += 2;
            list.push({ essential: (v >> 15) === 1, index: v & 0x7fff });
          } else {
            const v = buf[p++];
            list.push({ essential: (v >> 7) === 1, index: v & 0x7f });
          }
        }
        const item = items.get(itemId);
        if (item) {
          item.props = list
            .filter((x) => x.index > 0 && x.index <= properties.length)
            .map((x) => ({ essential: x.essential, box: properties[x.index - 1] }));
        }
      }
    }
    for (const item of items.values()) {
      item.decoded = item.props.map(({ box, essential }) => {
        switch (box.type) {
          case 'ispe': return { type: 'ispe', essential, ...parseIspe(buf, box) };
          case 'irot': return { type: 'irot', essential, ...parseIrot(buf, box) };
          case 'imir': return { type: 'imir', essential, ...parseImir(buf, box) };
          case 'pixi': return { type: 'pixi', essential, ...parsePixi(buf, box) };
          case 'colr': return { type: 'colr', essential, ...parseColr(buf, box) };
          case 'hvc1': case 'hev1': case 'av01': return { type: box.type, essential };
          default: return { type: box.type, essential };
        }
      });
    }
  }

  const primary = items.get(primaryItemId) ?? null;
  const pick = (t) => primary?.decoded.find((d) => d.type === t) ?? null;

  return {
    majorBrand: buf.subarray(8, 12).toString('latin1'),
    metaFlags,
    primaryItemId,
    itemCount: items.size,
    items: [...items.values()],
    primary: {
      type: primary?.type ?? null,
      ispe: pick('ispe'),
      irot: pick('irot'),
      imir: pick('imir'),
      pixi: pick('pixi'),
      colr: pick('colr'),
    },
  };
}
