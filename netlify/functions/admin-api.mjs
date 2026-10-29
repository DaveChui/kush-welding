// Owner admin API: login, advertisements, photos, password. Same actions as the original admin.
import {
  HttpError, TYPES, LINKS, MAX_UPLOAD, json, fail, newId, text, cleanUrl, cleanDate,
  uploadPath, blobKey, PHOTO_MODES, parseWhen, photoState,
} from '../lib/util.mjs';
import {
  activeAuth, savePassword, readSession, newSession, makeCookie, clearCookie, isSecure,
  csrfFor, csrfOk, revokeSession, throttleState, throttleFail, throttleClear,
} from '../lib/auth.mjs';
import { readContent, updateContent, ensureContent, gcAds, mediaStore } from '../lib/content-store.mjs';
import { processImage, sharpAvailable } from '../lib/images.mjs';
import { openStore } from '../lib/store.mjs';
import BUILTIN from '../lib/builtin.mjs';

const typeCats = (type, commercial) => (commercial && type !== 'commercial' ? [type, 'commercial'] : [type]);
const findIndex = (list, id) => list.findIndex((x) => x && x.id === id);
function move(list, i, dir) {
  const n = list.length;
  if (i < 0 || i >= n) return;
  const j = dir === 'up' ? i - 1 : dir === 'down' ? i + 1 : dir === 'top' ? 0 : i;
  if (j < 0 || j >= n || j === i) return;
  const [item] = list.splice(i, 1);
  list.splice(j, 0, item);
}

function cleanAd(inp, old) {
  const link = LINKS.includes(inp.link) ? inp.link : 'whatsapp';
  const image = uploadPath(inp.image, 'ads');
  const mobile = uploadPath(inp.mobile, 'ads');
  const ad = {
    id: old?.id || newId(),
    enabled: !!inp.enabled,
    title: text(inp.title, 80),
    text: text(inp.text, 220),
    button: text(inp.button, 26),
    link,
    url: cleanUrl(inp.url),
    image, imageW: 0, imageH: 0,
    mobile,
    imageOnly: !!inp.imageOnly && image !== '',
    start: cleanDate(inp.start), end: cleanDate(inp.end),
    created: old?.created || Math.floor(Date.now() / 1000),
  };
  if (image && old?.image === image) { ad.imageW = old.imageW || 0; ad.imageH = old.imageH || 0; }
  if (ad.title === '' && ad.image === '') fail('Add a headline or a banner image for the ad.');
  if (ad.button === '' && !ad.imageOnly) {
    ad.button = link === 'call' ? 'Call us now' : link === 'contact' ? 'Get a free quote' : link === 'url' ? 'Learn more' : 'Chat on WhatsApp';
  }
  if (link === 'url' && ad.url === '') fail('Enter the website link for the ad button (for example https://example.com).');
  if (ad.start && ad.end && ad.end < ad.start) fail('The end date is before the start date.');
  return ad;
}

/** Adds each photo's current state (live / draft / scheduled) for the admin screens. */
function withPhotoState(c) {
  const now = Date.now() / 1000;
  return { ...c, photos: c.photos.map((p) => ({ ...p, state: photoState(p, now), publishAt: Number(p.publishAt) || 0 })) };
}
/** Reads and checks the "what to do with it" choice. Returns { status, publishAt }. */
function publishChoice(mode, at) {
  const m = PHOTO_MODES.includes(mode) ? mode : 'now';
  if (m === 'draft') return { status: 'draft', publishAt: 0 };
  if (m === 'schedule') {
    const t = parseWhen(at);
    if (!t) fail('Choose the date and time to publish.');
    if (t <= Math.floor(Date.now() / 1000)) fail('That time has already passed. Choose a date and time in the future.');
    return { status: 'scheduled', publishAt: t };
  }
  return { status: 'live', publishAt: 0 };
}

async function systemCheck(req) {
  const checks = [];
  let storageOk = false;
  try {
    const s = await openStore('kush-private');
    await s.setJSON('selftest.json', { t: Date.now() });
    storageOk = !!(await s.getJSON('selftest.json'));
    await s.del('selftest.json');
  } catch { storageOk = false; }
  checks.push({ label: 'Storage for photos and ads is connected', ok: storageOk, fix: 'Netlify storage did not respond. Open your site in the Netlify dashboard, check the latest deploy succeeded, then try again.' });
  checks.push({ label: 'Photo resizing is available', ok: await sharpAvailable(), fix: 'Photos still upload, but they will not be shrunk on the server. Redeploy the site from the Netlify dashboard (Deploys, Trigger deploy).', soft: true });
  checks.push({ label: 'Connection is secure (HTTPS)', ok: isSecure(req), fix: 'Open the admin using the https:// address.', soft: true });
  return checks;
}

async function stateBody(req, session, auth, extra = {}) {
  return {
    ok: true,
    csrf: await csrfFor(session),
    mustChange: auth.mustChange,
    content: withPhotoState(await readContent()),
    builtin: BUILTIN,
    types: TYPES,
    system: await systemCheck(req),
    ...extra,
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function login(req, context, auth) {
  if (req.method !== 'POST') fail('Use the login form.', 405);
  const ip = context.ip || req.headers.get('x-nf-client-connection-ip') || '0';
  const t = await throttleState(ip);
  if (t.locked) fail(`Too many wrong attempts. Try again in ${t.waitMin} minute(s).`, 429);
  let body = {};
  try { body = await req.json(); } catch { fail('Bad request.'); }
  const pw = typeof body.password === 'string' ? body.password : '';
  if (pw !== '' && pw.length <= 200 && (await auth.check(pw))) {
    await throttleClear(ip);
    await ensureContent();
    const cookie = await makeCookie(newSession(auth.v), isSecure(req));
    return json({ ok: true }, 200, { 'Set-Cookie': cookie });
  }
  await throttleFail(ip);
  await sleep(400);
  const t2 = await throttleState(ip);
  fail(t2.locked ? 'Too many wrong attempts. Try again in 15 minutes.' : `That password is not correct. ${t2.left} attempt(s) left.`, t2.locked ? 429 : 401);
}

export default async (req, context) => {
  try {
    const url = new URL(req.url);
    const action = url.searchParams.get('action') || '';
    const secure = isSecure(req);
    const auth = await activeAuth();

    if (action === 'login') return await login(req, context, auth);

    const session = await readSession(req, auth);
    if (!session) return json({ ok: false, error: 'Your session has ended. Please log in again.' }, 401, { 'Set-Cookie': clearCookie(secure) });
    if (req.method !== 'GET' && !(await csrfOk(req, session))) fail('Security check failed. Please refresh the page and try again.', 403);
    if (auth.mustChange && !['state', 'password_change', 'logout'].includes(action)) fail('Please choose your own password first (Account tab).', 403);

    // keep the session alive while the owner is working
    let cookie = await makeCookie({ ...session, t: Date.now() }, secure);
    const reply = async (data, status = 200) => json(data, status, { 'Set-Cookie': cookie });
    const withState = async () => reply(await stateBody(req, session, auth));

    let inp = {};
    if (req.method === 'POST' && !['photo_upload', 'ad_image'].includes(action)) {
      try { inp = await req.json(); } catch { fail('Bad request.'); }
      if (!inp || typeof inp !== 'object') fail('Bad request.');
    }

    switch (action) {
      case 'state':
        return await withState();

      /* ------------- advertisements ------------- */
      case 'ad_image': {
        const { file, form } = await receiveFile(req);
        const kind = form.get('kind') === 'mobile' ? 'mobile' : 'banner';
        const r = await processImage(await file.arrayBuffer(), 'ads', kind === 'mobile' ? 1100 : 1800);
        await storeOutputs(r);
        return await reply({ ok: true, path: r.file, w: r.w, h: r.h });
      }
      case 'ad_save': {
        const ad = inp.ad;
        if (!ad || typeof ad !== 'object') fail('Bad request.');
        await updateContent(async (c, { drop }) => {
          const i = findIndex(c.ads, String(ad.id ?? ''));
          if (i < 0 && c.ads.length >= 12) fail('You can keep up to 12 ads. Delete an old one first.');
          const old = i >= 0 ? c.ads[i] : null;
          const next = cleanAd(ad, old);
          if (next.image && (!old || old.image !== next.image)) await fillSize(next);
          if (old) {
            for (const k of ['image', 'mobile']) if (old[k] && old[k] !== next[k]) drop(old[k]);
            c.ads[i] = next;
          } else c.ads.unshift(next);
          await gcAds(c);
        });
        return await withState();
      }
      case 'ad_toggle':
        await updateContent((c) => {
          const i = findIndex(c.ads, String(inp.id ?? ''));
          if (i < 0) fail('Ad not found.', 404);
          c.ads[i].enabled = !!inp.enabled;
        });
        return await withState();
      case 'ad_delete':
        await updateContent((c, { drop }) => {
          const i = findIndex(c.ads, String(inp.id ?? ''));
          if (i < 0) return false;
          for (const k of ['image', 'mobile']) if (c.ads[i][k]) drop(c.ads[i][k]);
          c.ads.splice(i, 1);
        });
        return await withState();
      case 'ad_move':
        await updateContent((c) => { move(c.ads, findIndex(c.ads, String(inp.id ?? '')), String(inp.dir ?? '')); });
        return await withState();
      case 'settings_save':
        await updateContent((c) => {
          c.adSettings.empty = inp.empty === 'hide' ? 'hide' : 'default';
          const s = parseInt(inp.seconds ?? 7, 10);
          c.adSettings.seconds = [4, 5, 7, 10, 15].includes(s) ? s : 7;
        });
        return await withState();

      /* ------------- photos ------------- */
      case 'photo_upload': {
        const { file, form } = await receiveFile(req);
        const choice = publishChoice(String(form.get('mode') ?? 'now'), String(form.get('at') ?? ''));
        const type = Object.hasOwn(TYPES, String(form.get('type'))) ? String(form.get('type')) : 'gates';
        let title = text(String(form.get('title') ?? ''), 80);
        if (title === '') {
          const stem = String(file.name || '').replace(/\.[^.]*$/, '').replace(/[^A-Za-z0-9]+/g, ' ').trim().replace(/\b[a-z]/g, (m) => m.toUpperCase());
          title = text(stem, 80);
          if (title === '' || /^(img|dsc|image|photo|whatsapp)\b/i.test(title) || /^\d+$/.test(title)) title = TYPES[type];
        }
        const r = await processImage(await file.arrayBuffer(), 'photos', 1600, 800);
        await storeOutputs(r);
        const cv = String(form.get('commercial') ?? '');
        const commercial = cv !== '' && cv !== '0' && cv !== 'false';
        const p = {
          id: 'u' + newId(), file: r.file, thumb: r.thumb, w: r.w, h: r.h,
          title, tag: TYPES[type], type, commercial, cats: typeCats(type, commercial),
          alt: `${title}, custom metalwork by Kush Welding Services`, visible: choice.status === 'live', added: Math.floor(Date.now() / 1000),
          status: choice.status, publishAt: choice.publishAt,
        };
        try {
          await updateContent((c) => {
            if (c.photos.length >= 400) fail('You have reached 400 photos. Delete some old ones first.');
            c.photos.unshift(p);
          });
        } catch (e) { await removeOutputs(r); throw e; }
        return await reply({ ok: true, photo: { ...p, state: photoState(p) } });
      }
      case 'photo_update':
        await updateContent((c) => {
          const i = findIndex(c.photos, String(inp.id ?? ''));
          if (i < 0) fail('Photo not found.', 404);
          const p = c.photos[i];
          if (inp.title !== undefined) {
            const t = text(inp.title, 80);
            if (t !== '') { p.title = t; p.alt = `${t}, custom metalwork by Kush Welding Services`; }
          }
          if (typeof inp.type === 'string' && Object.hasOwn(TYPES, inp.type)) { p.type = inp.type; p.tag = TYPES[inp.type]; }
          if ('commercial' in inp) p.commercial = !!inp.commercial;
          p.cats = typeCats(String(p.type), !!p.commercial);
          if ('visible' in inp) { p.visible = !!inp.visible; p.status = p.visible ? 'live' : 'draft'; p.publishAt = 0; }
        });
        return await withState();
      case 'photo_status': {
        // Publish now, save as a draft (not shown), or schedule: for one photo or several at once.
        const ids = (Array.isArray(inp.ids) ? inp.ids : [inp.id]).map((x) => String(x ?? '')).slice(0, 400);
        const choice = publishChoice(String(inp.mode ?? ''), String(inp.at ?? ''));
        let hit = 0;
        await updateContent((c) => {
          const now = Math.floor(Date.now() / 1000);
          for (const p of c.photos) {
            if (!ids.includes(p.id)) continue;
            hit++;
            p.status = choice.status; p.publishAt = choice.publishAt; p.visible = choice.status === 'live';
            if (choice.status === 'live') p.added = now; // shows the "New" tag from the moment it goes up
          }
          if (!hit) fail('Photo not found.', 404);
        });
        return await withState();
      }
      case 'photo_delete':
        await updateContent((c, { drop }) => {
          const i = findIndex(c.photos, String(inp.id ?? ''));
          if (i < 0) return false;
          for (const k of ['file', 'thumb']) if (c.photos[i][k]) drop(c.photos[i][k]);
          c.photos.splice(i, 1);
        });
        return await withState();
      case 'photo_move':
        await updateContent((c) => { move(c.photos, findIndex(c.photos, String(inp.id ?? '')), String(inp.dir ?? '')); });
        return await withState();
      case 'builtin_set': {
        const id = String(inp.id ?? '');
        if (!BUILTIN.some((b) => b.id === id)) fail('Unknown photo.', 404);
        await updateContent((c) => {
          c.hidden = c.hidden.filter((h) => h !== id);
          if (inp.hidden) c.hidden.push(id);
        });
        return await withState();
      }

      /* ------------- account ------------- */
      case 'password_change': {
        const cur = String(inp.current ?? ''), next = String(inp.new ?? '');
        if (!(await auth.check(cur))) fail('Your current password is not correct.', 403);
        if (next.length < 8) fail('Use at least 8 characters for the new password.');
        if (next.length > 200) fail('That password is too long.');
        if (cur === next) fail('Choose a password different from the current one.');
        const v = await savePassword(next, auth);
        const fresh = newSession(v);
        cookie = await makeCookie(fresh, secure);
        const nowAuth = { ...auth, v, mustChange: false };
        return await reply(await stateBody(req, fresh, nowAuth));
      }
      case 'logout':
        await revokeSession(session.sid);
        return json({ ok: true }, 200, { 'Set-Cookie': clearCookie(secure) });
      default:
        fail('Unknown action.', 404);
    }
  } catch (e) {
    if (e instanceof HttpError) return json({ ok: false, error: e.message }, e.status);
    console.error('admin-api error', e);
    return json({ ok: false, error: 'Something went wrong on the server. Please try again.' }, 500);
  }
};

/* ---------- helpers ---------- */
async function receiveFile(req) {
  const len = Number(req.headers.get('content-length') || 0);
  if (len > MAX_UPLOAD + 200_000) fail('That photo is too big for the server (over 5 MB). Please choose a smaller one.', 413);
  let form;
  try { form = await req.formData(); } catch { fail('No photo was received. Please try again.'); }
  const file = form.get('file');
  if (!file || typeof file === 'string' || typeof file.arrayBuffer !== 'function') fail('No photo was received. Please try again.');
  if (file.size > MAX_UPLOAD) fail('That photo is over 5 MB. Please use a smaller one.', 413);
  return { file, form };
}
async function storeOutputs(r) {
  const m = await mediaStore();
  const added = Date.now();
  for (const o of r.outputs) await m.setBin(o.key, o.bytes, { contentType: o.contentType, added });
}
async function removeOutputs(r) {
  const m = await mediaStore();
  for (const o of r.outputs) { try { await m.del(o.key); } catch { /* ignore */ } }
}
/** Ad pictures: remember the real size so the page can reserve space. */
async function fillSize(ad) {
  if (!ad.image) return;
  const hit = await (await mediaStore()).getBin(blobKey(ad.image));
  if (!hit) return;
  const { sniff } = await import('../lib/images.mjs');
  const info = sniff(hit.data);
  if (info?.w) { ad.imageW = info.w; ad.imageH = info.h; }
}
export const config = { path: '/api/admin' };
