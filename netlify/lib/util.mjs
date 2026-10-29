// Small helpers shared by the admin functions.
import { randomBytes } from 'node:crypto';

export const TYPES = {
  'gates': 'Steel Gate',
  'doors-windows': 'Door / Window',
  'railings': 'Railing / Balcony',
  'structures': 'Steel Structure',
  'fabrication': 'Workshop / Fabrication',
  'commercial': 'Commercial',
};
export const LINKS = ['whatsapp', 'call', 'url', 'contact'];
export const MAX_UPLOAD = 5 * 1024 * 1024; // Netlify functions accept ~6 MB requests; the browser shrinks photos first.

export class HttpError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

const SECURITY = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'X-Robots-Tag': 'noindex, nofollow',
};
export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store, max-age=0', ...SECURITY, ...headers },
  });
}
export const fail = (message, status = 400) => { throw new HttpError(message, status); };

export const newId = () => randomBytes(5).toString('hex');

/** Plain text only: strips control characters and HTML tags, trims, limits length. */
export function text(v, max) {
  let s = typeof v === 'string' ? v : '';
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  s = s.replace(/<[^>]*>?/g, '').trim();
  return Array.from(s).slice(0, max).join('');
}
export function cleanUrl(v) {
  let s = typeof v === 'string' ? v.trim() : '';
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s.replace(/^\/+/, '');
  try {
    const u = new URL(s);
    if (!/^https?:$/.test(u.protocol) || !u.hostname.includes('.')) return '';
    return s.slice(0, 500);
  } catch { return ''; }
}
export function cleanDate(v) {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
  const d = new Date(s + 'T00:00:00Z');
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? '' : s;
}
/** Accepts only our own upload paths such as "uploads/ads/261028-ab12cd34ef.webp". */
export function uploadPath(p, folder) {
  const s = typeof p === 'string' ? p : '';
  return new RegExp('^uploads/' + folder + '/[a-z0-9_-]+\\.(webp|jpg|png)$').test(s) ? s : '';
}
export const isUploadPath = (p) => /^uploads\/(photos|ads)\/[a-z0-9_-]+\.(webp|jpg|png)$/.test(p || '');
export const blobKey = (rel) => rel.replace(/^uploads\//, '');

export function defaultContent() {
  return { rev: 0, updated: '', adSettings: { empty: 'default', seconds: 7 }, ads: [], photos: [], hidden: [] };
}
export function normalizeContent(d) {
  const base = defaultContent();
  const c = d && typeof d === 'object' ? d : {};
  const out = { ...base, ...c, adSettings: { ...base.adSettings, ...(c.adSettings || {}) } };
  for (const k of ['ads', 'photos', 'hidden']) out[k] = Array.isArray(out[k]) ? [...out[k]] : [];
  return out;
}

/* ---------- photo publishing: live / draft / scheduled ---------- */
export const PHOTO_MODES = ['now', 'draft', 'schedule'];
/** "2026-11-05T08:00" typed in Nairobi time (EAT, UTC+3, no daylight saving) -> unix seconds, or 0 if invalid. */
export function parseWhen(v) {
  const m = typeof v === 'string' ? v.trim().match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})$/) : null;
  if (!m) return 0;
  const t = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00+03:00`);
  return Number.isNaN(t) ? 0 : Math.floor(t / 1000);
}
/** What a photo is right now: 'live' (on the website), 'draft' (saved, not shown) or 'scheduled' (waiting for its time). */
export function photoState(p, now = Date.now() / 1000) {
  const st = p && p.status;
  if (st === 'draft') return 'draft';
  if (st === 'scheduled') return Number(p.publishAt) <= now ? 'live' : 'scheduled';
  if (st === 'live') return 'live';
  return p && p.visible === false ? 'draft' : 'live'; // photos saved before drafts existed
}
/** Visitors only ever get live photos; drafts and not-yet-due photos never leave the server. */
export function publicContent(c, now = Date.now() / 1000) {
  const photos = [];
  for (const p of c.photos) {
    if (photoState(p, now) !== 'live') continue;
    const { status, publishAt, ...rest } = p;
    photos.push({ ...rest, visible: true, added: status === 'scheduled' ? Number(publishAt) : p.added });
  }
  return { ...c, photos };
}
