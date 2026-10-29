// content.json lives in Netlify Blobs; the public website reads it through /content/content.json.
import { openStore } from './store.mjs';
import { defaultContent, normalizeContent, blobKey, isUploadPath } from './util.mjs';

const KEY = 'content.json';
const db = () => openStore('kush-content');
const media = () => openStore('kush-uploads');

export async function readContent() {
  return normalizeContent(await (await db()).getJSON(KEY));
}

let chain = Promise.resolve();
/**
 * Read-modify-write, one at a time. fn(content, helpers) mutates the content; return false to skip saving.
 * helpers.drop(path) schedules an uploaded file for deletion once the new content is saved.
 */
export function updateContent(fn) {
  const run = chain.then(async () => {
    const c = await readContent();
    const drops = [];
    const r = await fn(c, { drop: (p) => { if (isUploadPath(p)) drops.push(p); } });
    if (r === false) return false;
    c.rev = (c.rev | 0) + 1;
    c.updated = new Date().toISOString();
    await (await db()).setJSON(KEY, c);
    const m = await media();
    for (const p of drops) { try { await m.del(blobKey(p)); } catch { /* already gone */ } }
    return true;
  });
  chain = run.catch(() => {});
  return run;
}

export async function ensureContent() {
  const s = await db();
  if (!(await s.getJSON(KEY))) await s.setJSON(KEY, defaultContent());
}

/** Deletes ad pictures nobody uses any more (only ones older than a day, so fresh uploads are safe). */
export async function gcAds(c) {
  const used = new Set();
  for (const a of c.ads) { used.add(a.image); used.add(a.mobile); }
  const m = await media();
  for (const key of await m.list('ads/')) {
    if (used.has('uploads/' + key)) continue;
    const meta = await m.meta(key);
    if (meta && Number(meta.added) < Date.now() - 86400000) await m.del(key);
  }
}

export const mediaStore = media;
