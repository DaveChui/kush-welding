// End-to-end tests: runs the real functions against a local stand-in for Netlify Blobs.
//   node test/run.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { startDevServer } from './dev-server.mjs';

const store = fs.mkdtempSync(path.join(os.tmpdir(), 'kush-test-'));
const srv = await startDevServer({ storeDir: store });
const B = `http://127.0.0.1:${srv.port}`;
const INITIAL = process.env.INITIAL_PASSWORD;
if (!INITIAL) { console.error('Set INITIAL_PASSWORD to the starting owner password, e.g.  INITIAL_PASSWORD=... npm test'); process.exit(2); }
let passed = 0;
const ok = (name) => { passed++; console.log('  ok  ' + name); };

class Client {
  constructor(ip = '10.0.0.1') { this.cookie = ''; this.csrf = ''; this.ip = ip; }
  async call(action, { body, form, method, csrf = true } = {}) {
    const headers = { 'x-test-ip': this.ip };
    if (this.cookie) headers.cookie = this.cookie;
    if (csrf && this.csrf) headers['x-csrf'] = this.csrf;
    let payload;
    if (form) payload = form;
    else if (body !== undefined) { payload = JSON.stringify(body); headers['content-type'] = 'application/json'; }
    const r = await fetch(`${B}/api/admin?action=${action}`, { method: method || (payload ? 'POST' : 'GET'), headers, body: payload });
    for (const c of r.headers.getSetCookie()) {
      const kv = c.split(';')[0];
      this.cookie = /Max-Age=0/i.test(c) ? '' : kv;
    }
    const j = await r.json();
    if (j.csrf) this.csrf = j.csrf;
    return { status: r.status, j };
  }
  async login(pw) { return this.call('login', { body: { password: pw }, csrf: false }); }
}
const jpeg = async (w, h, extra = {}) => {
  const sharp = (await import('sharp')).default;
  return sharp({ create: { width: w, height: h, channels: 3, background: { r: 150, g: 90, b: 40 } } }).jpeg(extra).toBuffer();
};
const photoForm = (buf, name, fields = {}, type = 'image/jpeg') => {
  const f = new FormData();
  f.append('file', new Blob([buf], { type }), name);
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  return f;
};
const publicContent = async () => (await fetch(`${B}/content/content.json`)).json();

try {
  console.log('Login and sessions');
  const a = new Client();
  let r = await a.call('state');
  assert.equal(r.status, 401); ok('state needs login');
  r = await a.login('wrong');
  assert.equal(r.status, 401); assert.match(r.j.error, /not correct\. 4 attempt/); ok('wrong password rejected with attempts left');
  r = await a.login(INITIAL);
  assert.equal(r.status, 200); assert.ok(a.cookie.startsWith('kush_admin=')); ok('starting password logs in');
  r = await a.call('state');
  assert.equal(r.status, 200); assert.equal(r.j.mustChange, true); assert.ok(r.j.csrf);
  assert.equal(r.j.builtin.length, 14);
  assert.ok(r.j.system.find((c) => c.label.startsWith('Storage')).ok, 'storage check');
  assert.ok(r.j.system.find((c) => c.label.startsWith('Photo resizing')).ok, 'sharp check');
  ok('state: must change password, storage + resizing checks pass');
  r = await a.call('ad_save', { body: { ad: { title: 'x', enabled: true } } });
  assert.equal(r.status, 403); assert.match(r.j.error, /own password first/); ok('everything locked until password is changed');

  console.log('Password change');
  r = await a.call('password_change', { body: { current: 'nope', new: 'Brand-new-pass-1' } });
  assert.equal(r.status, 403); ok('wrong current password rejected');
  r = await a.call('password_change', { body: { current: INITIAL, new: 'short' } });
  assert.equal(r.status, 400); ok('short password rejected');
  r = await a.call('password_change', { body: { current: INITIAL, new: INITIAL } });
  assert.equal(r.status, 400); ok('same password rejected');
  const oldCookie = a.cookie;
  r = await a.call('password_change', { body: { current: INITIAL, new: 'Brand-new-pass-1' } });
  assert.equal(r.status, 200); assert.equal(r.j.mustChange, false); ok('password changed, admin unlocked');
  const other = new Client(); other.cookie = oldCookie;
  r = await other.call('state'); assert.equal(r.status, 401); ok('older sessions end after a password change');
  const c0 = new Client('10.0.0.9'); r = await c0.login(INITIAL); assert.equal(r.status, 401); ok('starting password no longer works');
  const c1 = new Client('10.0.0.9'); r = await c1.login('Brand-new-pass-1'); assert.equal(r.status, 200); ok('new password works');

  console.log('Security');
  const sec = new Client('10.0.0.2'); await sec.login('Brand-new-pass-1'); await sec.call('state');
  r = await sec.call('ad_toggle', { body: { id: 'x', enabled: true }, csrf: false });
  assert.equal(r.status, 403); assert.match(r.j.error, /Security check/); ok('writes without CSRF token are refused');
  const forged = new Client('10.0.0.2'); forged.cookie = sec.cookie.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'));
  r = await forged.call('state'); assert.equal(r.status, 401); ok('tampered session cookie refused');
  const lock = new Client('10.0.0.77');
  for (let i = 0; i < 5; i++) await lock.login('bad' + i);
  r = await lock.login('Brand-new-pass-1'); assert.equal(r.status, 429); ok('5 wrong passwords lock that visitor out for 15 minutes');
  const fresh = new Client('10.0.0.78'); r = await fresh.login('Brand-new-pass-1'); assert.equal(r.status, 200); ok('lockout does not affect other visitors');

  console.log('Photos');
  const o = new Client('10.0.0.3'); await o.login('Brand-new-pass-1'); await o.call('state');
  const big = await jpeg(3600, 2400, { quality: 90 });
  r = await o.call('photo_upload', { form: photoForm(big, 'IMG_2031.jpg', { title: '', type: 'railings', commercial: '1' }) });
  assert.equal(r.status, 200, JSON.stringify(r.j));
  const p = r.j.photo;
  assert.equal(p.title, 'Railing / Balcony'); assert.deepEqual(p.cats, ['railings', 'commercial']);
  assert.ok(Math.max(p.w, p.h) <= 1600 && p.w === 1600); assert.ok(p.thumb); ok('big photo resized to 1600px, thumbnail made, generic filename gets a sensible title');
  const img = await fetch(`${B}/${p.file}`);
  assert.equal(img.status, 200); assert.equal(img.headers.get('content-type'), 'image/webp'); assert.match(img.headers.get('cache-control'), /max-age/);
  const th = await fetch(`${B}/${p.thumb}`); assert.equal(th.status, 200); ok('uploaded photo and thumbnail are served publicly as WebP');
  let pc = await publicContent(); assert.equal(pc.photos.length, 1); assert.equal(pc.photos[0].id, p.id); ok('photo appears in the public content.json');

  r = await o.call('photo_upload', { form: photoForm(Buffer.from('<?php echo 1; ?>'), 'shell.php.jpg', { type: 'gates' }) });
  assert.equal(r.status, 400); assert.match(r.j.error, /not a JPG, PNG or WebP/); ok('non-image disguised as a photo is rejected');
  r = await o.call('photo_upload', { form: photoForm(Buffer.alloc(6 * 1024 * 1024, 1), 'huge.jpg') });
  assert.equal(r.status, 413); ok('oversized upload gets a friendly error');
  r = await o.call('photo_upload', { form: photoForm(await jpeg(20, 20), 'tiny.jpg') });
  assert.equal(r.status, 400); assert.match(r.j.error, /too small/); ok('tiny image rejected');
  const named = await o.call('photo_upload', { form: photoForm(await jpeg(700, 500), 'curved-stair-railing.jpg', { type: 'railings' }) });
  assert.equal(named.j.photo.title, 'Curved Stair Railing'); assert.equal(named.j.photo.thumb, ''); ok('descriptive filename becomes the title; small photo needs no thumbnail');
  r = await o.call('photo_update', { body: { id: p.id, title: '<b>Spiral</b> staircase', type: 'structures', commercial: false, visible: false } });
  const u = r.j.content.photos.find((x) => x.id === p.id);
  assert.equal(u.title, 'Spiral staircase'); assert.equal(u.tag, 'Steel Structure'); assert.deepEqual(u.cats, ['structures']); assert.equal(u.visible, false); ok('photo edit: title cleaned, type, hide');
  r = await o.call('photo_move', { body: { id: named.j.photo.id, dir: 'down' } });
  assert.equal(r.j.content.photos[1].id, named.j.photo.id); ok('photo reorder');
  r = await o.call('builtin_set', { body: { id: 'gate-grey-panels', hidden: true } });
  assert.deepEqual(r.j.content.hidden, ['gate-grey-panels']);
  r = await o.call('builtin_set', { body: { id: 'nope', hidden: true } }); assert.equal(r.status, 404);
  r = await o.call('builtin_set', { body: { id: 'gate-grey-panels', hidden: false } }); assert.deepEqual(r.j.content.hidden, []); ok('hide / show built-in photos');
  r = await o.call('photo_delete', { body: { id: p.id } });
  assert.equal(r.j.content.photos.length, 1);
  assert.equal((await fetch(`${B}/${p.file}`)).status, 404); assert.equal((await fetch(`${B}/${p.thumb}`)).status, 404); ok('deleting a photo also deletes its files');

  console.log('Photo drafts and scheduling');
  const eat = (ms) => new Date(ms + 3 * 3600000).toISOString().slice(0, 16);   // Nairobi wall-clock "YYYY-MM-DDTHH:mm"
  r = await o.call('photo_upload', { form: photoForm(await jpeg(900, 600), 'draft-gate.jpg', { type: 'gates', mode: 'draft' }) });
  assert.equal(r.status, 200, JSON.stringify(r.j)); const dr = r.j.photo;
  assert.equal(dr.state, 'draft'); assert.equal(dr.visible, false); assert.equal((await fetch(`${B}/${dr.file}`)).status, 200);
  pc = await publicContent(); assert.ok(!pc.photos.some((x) => x.id === dr.id)); ok('upload with "save, publish later": stored on the server but not on the public site');
  r = await o.call('photo_upload', { form: photoForm(await jpeg(900, 600), 'late.jpg', { type: 'gates', mode: 'schedule', at: eat(Date.now() - 3600000) }) });
  assert.equal(r.status, 400); assert.match(r.j.error, /already passed/);
  r = await o.call('photo_upload', { form: photoForm(await jpeg(900, 600), 'nodate.jpg', { type: 'gates', mode: 'schedule' }) });
  assert.equal(r.status, 400); assert.match(r.j.error, /date and time/); ok('scheduling needs a valid future time');
  r = await o.call('photo_upload', { form: photoForm(await jpeg(900, 600), 'soon-gate.jpg', { type: 'gates', mode: 'schedule', at: eat(Date.now() + 2 * 86400000) }) });
  assert.equal(r.status, 200, JSON.stringify(r.j)); const sc = r.j.photo;
  assert.equal(sc.state, 'scheduled'); assert.ok(Math.abs(sc.publishAt - Math.floor((Date.now() + 2 * 86400000) / 1000)) < 120);
  pc = await publicContent(); assert.ok(!pc.photos.some((x) => x.id === sc.id)); ok('scheduled photo waits: not on the public site before its time');
  r = await o.call('state'); assert.equal(r.j.content.photos.find((x) => x.id === sc.id).state, 'scheduled'); assert.equal(r.j.content.photos.find((x) => x.id === dr.id).state, 'draft'); ok('admin sees draft and scheduled states');
  r = await o.call('photo_status', { body: { ids: [dr.id], mode: 'now' } });
  assert.equal(r.j.content.photos.find((x) => x.id === dr.id).state, 'live');
  pc = await publicContent(); const pubd = pc.photos.find((x) => x.id === dr.id); assert.ok(pubd && pubd.visible === true && !('status' in pubd) && !('publishAt' in pubd)); ok('publish a draft: goes live, schedule fields not leaked');
  r = await o.call('photo_status', { body: { ids: [dr.id], mode: 'draft' } });
  pc = await publicContent(); assert.ok(!pc.photos.some((x) => x.id === dr.id)); ok('take a live photo back to draft');
  r = await o.call('photo_status', { body: { ids: [dr.id], mode: 'schedule', at: eat(Date.now() - 60000) } }); assert.equal(r.status, 400);
  r = await o.call('photo_status', { body: { ids: ['nope'], mode: 'now' } }); assert.equal(r.status, 404); ok('status change validates time and id');
  // a scheduled photo whose time has arrived becomes visible by itself (simulated by moving its time into the past)
  { const fsx = await import('node:fs'); const dir = `${store}/kush-content`; const f = `${dir}/content.json`;
    const c = JSON.parse(fsx.readFileSync(f, 'utf8')); c.photos.find((x) => x.id === sc.id).publishAt = Math.floor(Date.now() / 1000) - 5; fsx.writeFileSync(f, JSON.stringify(c)); }
  pc = await publicContent(); const due = pc.photos.find((x) => x.id === sc.id);
  assert.ok(due && due.visible === true); ok('scheduled photo goes live by itself once its time arrives');
  r = await o.call('photo_update', { body: { id: sc.id, visible: false } });
  assert.equal(r.j.content.photos.find((x) => x.id === sc.id).state, 'draft'); ok('old hide/show control still maps to draft/live');
  for (const x of [dr, sc]) await o.call('photo_delete', { body: { id: x.id } });

  console.log('Advertisements');
  const banner = await jpeg(1800, 560);
  r = await o.call('ad_image', { form: photoForm(banner, 'banner.jpg', { kind: 'banner' }) });
  assert.equal(r.status, 200); const adImg = r.j.path; assert.match(adImg, /^uploads\/ads\/[a-z0-9_-]+\.webp$/); ok('ad banner uploaded');
  r = await o.call('ad_save', { body: { ad: { enabled: true, title: 'Festive <script>alert(1)</script>offer', text: 'Book before December.', button: '', link: 'whatsapp', image: adImg, imageOnly: false } } });
  assert.equal(r.status, 200, JSON.stringify(r.j));
  let ad = r.j.content.ads[0];
  assert.equal(ad.title, 'Festive alert(1)offer'); assert.equal(ad.button, 'Chat on WhatsApp'); assert.equal(ad.imageW, 1800); assert.equal(ad.imageH, 560); ok('ad saved: markup stripped, default button, image size recorded');
  pc = await publicContent(); assert.equal(pc.ads.length, 1); assert.equal((await fetch(`${B}/${adImg}`)).status, 200); ok('ad is live in public content.json');
  r = await o.call('ad_save', { body: { ad: { id: ad.id, enabled: true, title: 'Edited', link: 'whatsapp', image: '../../etc/passwd' } } });
  assert.equal(r.j.content.ads[0].image, ''); assert.equal((await fetch(`${B}/${adImg}`)).status, 404); ok('path-injection in ad image ignored; replaced image is removed');
  r = await o.call('ad_save', { body: { ad: { enabled: true, title: 'Bad link', link: 'url', url: 'javascript:alert(1)' } } });
  assert.equal(r.status, 400); ok('javascript: links refused');
  r = await o.call('ad_save', { body: { ad: { enabled: true, title: 'Dates', link: 'contact', start: '2026-12-31', end: '2026-12-01' } } });
  assert.equal(r.status, 400); assert.match(r.j.error, /end date/); ok('end date before start date refused');
  r = await o.call('ad_save', { body: { ad: { enabled: true, title: 'Second ad', link: 'url', url: 'example.com/offer', start: '2026-11-01', end: '2026-11-30' } } });
  assert.equal(r.status, 200); assert.equal(r.j.content.ads[0].url, 'https://example.com/offer'); assert.equal(r.j.content.ads.length, 2); ok('second ad with dates; bare domain gets https://');
  r = await o.call('ad_move', { body: { id: r.j.content.ads[1].id, dir: 'up' } });
  assert.equal(r.j.content.ads[0].title, 'Edited'); ok('ad reorder');
  const aid = r.j.content.ads[0].id;
  r = await o.call('ad_toggle', { body: { id: aid, enabled: false } }); assert.equal(r.j.content.ads[0].enabled, false);
  r = await o.call('settings_save', { body: { empty: 'hide', seconds: 10 } }); assert.deepEqual(r.j.content.adSettings, { empty: 'hide', seconds: 10 });
  r = await o.call('settings_save', { body: { empty: 'x', seconds: 99 } }); assert.deepEqual(r.j.content.adSettings, { empty: 'default', seconds: 7 }); ok('pause an ad; ad-area settings validated');
  r = await o.call('ad_delete', { body: { id: aid } }); assert.equal(r.j.content.ads.length, 1); ok('ad deleted');
  r = await o.call('ad_delete', { body: { id: r.j.content.ads[0].id } }); assert.equal(r.j.content.ads.length, 0); assert.equal((await publicContent()).ads.length, 0); ok('last ad deleted: gone from the public site too');
  const rev = (await publicContent()).rev; assert.ok(rev > 10); ok('content revision counter increments (' + rev + ')');

  console.log('Logout and password reset');
  const lo = new Client('10.0.0.4'); await lo.login('Brand-new-pass-1'); await lo.call('state');
  const stolen = lo.cookie; r = await lo.call('logout', { body: {} }); assert.equal(r.status, 200);
  const thief = new Client('10.0.0.4'); thief.cookie = stolen; r = await thief.call('state');
  assert.equal(r.status, 401); ok('logging out ends the session on the server');

  process.env.ADMIN_PASSWORD = 'temp-reset-pass-9';
  const rs = new Client('10.0.0.5');
  assert.equal((await rs.login('Brand-new-pass-1')).status, 401); ok('while a reset password is set, the old password is not accepted');
  r = await rs.login('temp-reset-pass-9'); assert.equal(r.status, 200);
  r = await rs.call('state'); assert.equal(r.j.mustChange, true); ok('ADMIN_PASSWORD reset: logs in and forces a new password');
  r = await rs.call('password_change', { body: { current: 'temp-reset-pass-9', new: 'My-chosen-pass-22' } }); assert.equal(r.status, 200);
  const rs2 = new Client('10.0.0.6');
  assert.equal((await rs2.login('temp-reset-pass-9')).status, 401);
  assert.equal((await rs2.login('My-chosen-pass-22')).status, 200); ok('after choosing a password the reset value is spent (safe to leave in Netlify)');
  delete process.env.ADMIN_PASSWORD;

  console.log('Image header reader (used only if resizing is unavailable)');
  const { sniff } = await import('../netlify/lib/images.mjs');
  const sharp = (await import('sharp')).default;
  const base = sharp({ create: { width: 321, height: 123, channels: 3, background: '#888' } });
  for (const [fmt, buf] of [['jpg', await base.clone().jpeg().toBuffer()], ['png', await base.clone().png().toBuffer()], ['webp', await base.clone().webp().toBuffer()]]) {
    const i = sniff(buf); assert.deepEqual([i.type, i.w, i.h], [fmt, 321, 123], fmt);
  }
  assert.equal(sniff(Buffer.from('GIF89a......')), null); ok('jpg / png / webp sizes read correctly; other files refused');

  console.log(`\nAll ${passed} checks passed.`);
} catch (e) {
  console.error('\nFAILED:', e.message);
  console.error(e.stack?.split('\n').slice(1, 4).join('\n'));
  process.exitCode = 1;
} finally {
  await srv.close();
  fs.rmSync(store, { recursive: true, force: true });
}
