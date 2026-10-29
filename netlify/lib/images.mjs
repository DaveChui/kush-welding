// Validates and re-encodes uploaded photos. Re-encoding strips metadata and any hidden payload.
import { randomBytes } from 'node:crypto';
import { HttpError } from './util.mjs';

let sharpMod; // undefined = not tried yet, null = unavailable
async function getSharp() {
  if (sharpMod !== undefined) return sharpMod;
  try { sharpMod = (await import('sharp')).default; } catch { sharpMod = null; }
  return sharpMod;
}
export async function sharpAvailable() { return !!(await getSharp()); }

const MAX_PIXELS = 60_000_000;

/** Reads type and size straight from the file header (used only if resizing is unavailable). */
export function sniff(buf) {
  const b = Buffer.from(buf);
  if (b.length > 24 && b[0] === 0x89 && b.toString('ascii', 1, 4) === 'PNG') {
    return { type: 'png', w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { type: 'jpg', h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
      i += 2 + b.readUInt16BE(i + 2);
    }
    return { type: 'jpg', w: 0, h: 0 };
  }
  if (b.length > 30 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const k = b.toString('ascii', 12, 16);
    if (k === 'VP8X') return { type: 'webp', w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
    if (k === 'VP8 ') return { type: 'webp', w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
    if (k === 'VP8L') { const v = b.readUInt32LE(21); return { type: 'webp', w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1 }; }
    return { type: 'webp', w: 0, h: 0 };
  }
  return null;
}

const stamp = () => {
  const d = new Date(Date.now() + 3 * 3600000); // Nairobi date in the file name
  return d.toISOString().slice(2, 10).replace(/-/g, '');
};

/**
 * Returns { file, w, h, thumb, outputs:[{ key, bytes, contentType }] }.
 * file / thumb are site paths such as "uploads/photos/261028-ab12cd34ef.webp".
 */
export async function processImage(input, folder, max, thumbMax = 0) {
  const buf = Buffer.from(input);
  const base = `${stamp()}-${randomBytes(5).toString('hex')}`;
  const sharp = await getSharp();

  if (!sharp) { // no resizing available: keep the file as is, after checking it really is a photo
    const info = sniff(buf);
    if (!info) throw new HttpError('That file is not a JPG, PNG or WebP photo.');
    if (info.w && (info.w < 40 || info.h < 40)) throw new HttpError('That photo is too small.');
    if (info.w * info.h > MAX_PIXELS) throw new HttpError('That photo is too large (over 60 megapixels). Please use a smaller one.');
    const ct = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[info.type];
    return { file: `uploads/${folder}/${base}.${info.type}`, w: info.w, h: info.h, thumb: '', outputs: [{ key: `${folder}/${base}.${info.type}`, bytes: buf, contentType: ct }] };
  }

  let meta;
  try {
    meta = await sharp(buf, { limitInputPixels: MAX_PIXELS, failOn: 'error' }).metadata();
  } catch (e) {
    if (/pixel limit/i.test(String(e.message))) throw new HttpError('That photo is too large (over 60 megapixels). Please use a smaller one.');
    throw new HttpError('That file is not a JPG, PNG or WebP photo.');
  }
  if (!['jpeg', 'png', 'webp'].includes(meta.format)) throw new HttpError('That file is not a JPG, PNG or WebP photo.');
  if ((meta.width || 0) < 40 || (meta.height || 0) < 40) throw new HttpError('That photo is too small.');

  const render = async (limit) => {
    const { data, info } = await sharp(buf, { limitInputPixels: MAX_PIXELS, failOn: 'error' })
      .rotate() // keep phone photos upright, then metadata is dropped on output
      .resize({ width: limit, height: limit, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
    return { data, w: info.width, h: info.height };
  };
  let main;
  try { main = await render(max); } catch { throw new HttpError('That photo could not be read. Try saving it as a JPG first.'); }
  const outputs = [{ key: `${folder}/${base}.webp`, bytes: main.data, contentType: 'image/webp' }];
  let thumb = '';
  if (thumbMax > 0 && Math.max(main.w, main.h) > thumbMax) {
    const t = await render(thumbMax);
    outputs.push({ key: `${folder}/${base}_t.webp`, bytes: t.data, contentType: 'image/webp' });
    thumb = `uploads/${folder}/${base}_t.webp`;
  }
  return { file: `uploads/${folder}/${base}.webp`, w: main.w, h: main.h, thumb, outputs };
}
