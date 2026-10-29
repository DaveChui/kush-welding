/* Kush Welding Services: owner admin (no dependencies) */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const app = $('#app');
  function store0(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  let csrf = '';
  let S = null;                 // server state: content, builtin, types, system, mustChange
  let tab = 'ads';
  let draft = null;             // ad being edited (null = show the list)
  let staged = [];              // photos picked but not yet saved to the server
  let stageMode = ['now', 'draft', 'schedule'].includes(store0('kush_mode')) ? store0('kush_mode') : 'now';   // what to do with picked photos
  let stageAt = '';             // schedule time (Nairobi) for picked photos
  let phFilter = 'all';         // photo library filter: all | live | draft | scheduled
  let busy = false;

  const store = {
    get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} },
  };

  /* ---------------- icons ---------------- */
  const I = {
    up: '<path d="m6 15 6-6 6 6"/>', down: '<path d="m6 9 6 6 6-6"/>',
    edit: '<path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 10v6M14 10v6"/>',
    eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    eyeoff: '<path d="M3 3l18 18M10.6 6.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.5 6.6A17 17 0 0 0 2 12s3.6 7 10 7a9.7 9.7 0 0 0 4.4-1"/>',
  };
  const ic = n => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[n]}</svg>`;

  /* ---------------- helpers ---------------- */
  function toast(msg, type = 'ok', ms = 4200) {
    const el = document.createElement('div');
    el.className = 'toast ' + type; el.textContent = msg;
    const box = $('#toasts');
    while (box.children.length >= 2) box.firstElementChild.remove();
    box.appendChild(el);
    setTimeout(() => el.remove(), ms);
  }
  async function api(action, body) {
    const opt = { credentials: 'same-origin', headers: { 'X-CSRF': csrf } };
    if (body !== undefined) { opt.method = 'POST'; opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
    let r, j;
    try { r = await fetch('/api/admin?action=' + action, opt); } catch (e) { throw new Error('No connection. Check your internet and try again.'); }
    try { j = await r.json(); } catch (e) { throw new Error('The server sent an unexpected reply. Please try again.'); }
    if (r.status === 401) { showLogin(); throw new Error(j.error || 'Please log in again.'); }
    if (!j.ok) throw new Error(j.error || 'Something went wrong.');
    return j;
  }
  function upload(action, fd, onp) {
    return new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open('POST', '/api/admin?action=' + action);
      x.setRequestHeader('X-CSRF', csrf);
      x.upload.onprogress = e => { if (e.lengthComputable && onp) onp(e.loaded / e.total); };
      x.onload = () => {
        if (x.status === 401) { showLogin(); return reject(new Error('Please log in again.')); }
        let j; try { j = JSON.parse(x.responseText); } catch (e) { return reject(new Error(x.status === 413 ? 'That photo is too big for the server.' : 'The server sent an unexpected reply.')); }
        j.ok ? resolve(j) : reject(new Error(j.error || 'Upload failed.'));
      };
      x.onerror = () => reject(new Error('Network problem. Check your connection and try again.'));
      x.send(fd);
    });
  }
  // Shrinks big phone photos in the browser first: faster upload on mobile data and stays under server limits.
  async function shrink(file, max) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
      if (s === 1 && file.size < 1.5e6) return file;
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(bmp.width * s)); c.height = Math.max(1, Math.round(bmp.height * s));
      const g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
      g.drawImage(bmp, 0, 0, c.width, c.height);
      const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.88));
      return blob && blob.size < file.size ? new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file;
    } catch (e) { return file; }
  }
  const parseAt = v => Date.parse(v + ':00+03:00') / 1000;
  const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' });
  const fmt = d => { if (!d) return ''; const [y, m, dd] = d.split('-').map(Number); return `${dd} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]} ${y}`; };
  const nowLocal = () => new Date().toLocaleString('sv-SE', { timeZone: 'Africa/Nairobi' }).replace(' ', 'T').slice(0, 16);   // "2026-11-05T08:00" in Nairobi time
  const tomorrow8 = () => new Date(Date.now() + 864e5).toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' }) + 'T08:00';
  const fmtWhen = ts => new Date(ts * 1000).toLocaleString('en-GB', { timeZone: 'Africa/Nairobi', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  // A scheduled photo whose time has passed is live, even if this screen was opened before that moment.
  const phState = p => (p.state === 'scheduled' && p.publishAt <= Date.now() / 1000 ? 'live' : p.state || (p.visible === false ? 'draft' : 'live'));
  function adStatus(a) {
    if (!a.enabled) return ['off', 'Paused'];
    const t = today();
    if (a.start && t < a.start) return ['soon', 'Starts ' + fmt(a.start)];
    if (a.end && t > a.end) return ['ended', 'Ended'];
    return ['live', 'Live'];
  }
  const defBtn = l => l === 'call' ? 'Call us now' : l === 'contact' ? 'Get a free quote' : l === 'url' ? 'Learn more' : 'Chat on WhatsApp';

  function dlg(html) {
    const d = document.createElement('dialog');
    d.innerHTML = html;
    document.body.appendChild(d);
    d.addEventListener('close', () => d.remove());
    d.showModal();
    return d;
  }
  const ask = (title, msg, ok = 'Delete', danger = true) => new Promise(res => {
    const d = dlg(`<h3>${esc(title)}</h3><p class="muted">${esc(msg)}</p><div class="btns"><button class="btn ghost" value="no">Cancel</button><button class="btn ${danger ? 'danger' : 'gold'}" value="yes">${esc(ok)}</button></div>`);
    d.addEventListener('click', e => { const b = e.target.closest('button'); if (b) { res(b.value === 'yes'); d.close(); } });
    d.addEventListener('close', () => res(false));
  });
  async function run(fn, okMsg) {
    if (busy) return;
    busy = true;
    try { const r = await fn(); if (okMsg) toast(okMsg); return r; }
    catch (e) { toast(e.message, 'bad', 6500); }
    finally { busy = false; }
  }
  function take(j) { if (j.csrf) csrf = j.csrf; S = Object.assign(S || {}, j); }

  /* ---------------- ADS ---------------- */
  function pv(d) {
    const only = d.imageOnly && d.image;
    return `<div class="pv${only ? ' only' : ''}" id="pv"><span class="tag">Advertisement</span>${d.image ? `<img src="../${esc(d.image)}" alt="">` : ''}<div class="shade"></div>
<div class="body"><h4>${esc(d.title || 'Your headline here')}</h4>${d.text ? `<p>${esc(d.text)}</p>` : ''}<span class="b">${esc(d.button || defBtn(d.link))}</span></div></div>`;
  }
  function adRow(a, i, n) {
    const [st, label] = adStatus(a);
    const when = a.start || a.end ? `${a.start ? 'From ' + fmt(a.start) : 'Runs now'}${a.end ? ' until ' + fmt(a.end) : ', no end date'}` : 'Runs until you pause it';
    const thumb = a.image ? `<img src="../${esc(a.image)}" alt="" loading="lazy">` : '';
    const over = a.image && a.imageOnly ? '' : `<div class="t"><b>${esc(a.title)}</b><span>${esc(a.text)}</span></div>`;
    return `<article class="ad-row" data-id="${a.id}"><div class="ad-thumb">${thumb}${over}</div>
<div class="ad-meta"><div><span class="pill ${st}">${esc(label)}</span></div><h3>${esc(a.title || '(Image-only ad)')}</h3><p class="when">${esc(when)}</p>
<div class="ad-act"><label class="switch"><input type="checkbox" data-chg="ad-toggle" data-id="${a.id}" ${a.enabled ? 'checked' : ''}><span class="tr"></span><span>Active</span></label>
<button class="btn ghost sm" data-act="ad-edit" data-id="${a.id}">${ic('edit')} Edit</button>
<span class="grow"><button class="icon-btn" data-act="ad-up" data-id="${a.id}" aria-label="Move earlier" ${i === 0 ? 'disabled' : ''}>${ic('up')}</button><button class="icon-btn" data-act="ad-down" data-id="${a.id}" aria-label="Move later" ${i === n - 1 ? 'disabled' : ''}>${ic('down')}</button>
</span><button class="btn danger sm" data-act="ad-del" data-id="${a.id}">${ic('trash')} Delete</button></div></div></article>`;
  }
  function viewAds() {
    if (draft) return viewEditor();
    const c = S.content, ads = c.ads;
    const live = ads.filter(a => adStatus(a)[0] === 'live').length;
    return `<div class="page-head"><div><h2>Advertisement</h2><p>The ad appears in a banner near the top of your homepage, right below the gold ticker. Add as many as you like: all the live ones rotate.</p></div>
<button class="btn gold" data-act="ad-new">+ New ad</button></div>
<div class="notice ok" role="note">${live ? `<b>${live} ad${live > 1 ? 's' : ''} live</b> on your website right now.` : `<b>No ad is live.</b> ${c.adSettings.empty === 'hide' ? 'The ad area is hidden.' : 'Visitors see the default "Free site visit" message.'}`} <a href="../#ads" target="_blank" rel="noopener" style="text-decoration:underline">See it on the website &#8599;</a></div>
${ads.length ? `<div class="ad-list">${ads.map((a, i) => adRow(a, i, ads.length)).join('')}</div>` : `<div class="empty"><b>No ads yet</b>Tap "New ad" to create your first one. You only need a headline, or just a banner image.</div>`}
<section class="card" style="margin-top:20px"><h3>Ad area settings</h3><p class="sm-note" style="margin-bottom:14px">Changes save automatically.</p>
<div class="row2"><div class="fld"><label for="s-empty">When no ad is live</label><select id="s-empty" data-chg="settings"><option value="default"${c.adSettings.empty !== 'hide' ? ' selected' : ''}>Show the default "Free site visit" message</option><option value="hide"${c.adSettings.empty === 'hide' ? ' selected' : ''}>Hide the ad area completely</option></select></div>
<div class="fld"><label for="s-sec">Change ads every</label><select id="s-sec" data-chg="settings">${[4, 5, 7, 10, 15].map(s => `<option value="${s}"${+c.adSettings.seconds === s ? ' selected' : ''}>${s} seconds</option>`).join('')}</select></div></div></section>`;
  }
  function viewEditor() {
    const d = draft;
    const imgBox = (src, cls) => `<div class="upl-prev ${cls}">${src ? `<img src="../${esc(src)}" alt="">` : 'No image'}</div>`;
    return `<div class="page-head"><div><h2>${d.id ? 'Edit ad' : 'New ad'}</h2><p>Fill in what you want visitors to see. The preview updates as you type.</p></div><button class="btn ghost" data-act="ad-cancel">&larr; Back to ads</button></div>
<div class="editor"><form class="card editor-form" id="adForm" novalidate>
<div class="fld"><label for="a-title">Headline</label><input id="a-title" name="title" type="text" maxlength="80" value="${esc(d.title)}" placeholder="e.g. 10% off new gates this month"><span class="hint">Short and clear works best.</span></div>
<div class="fld"><label for="a-text">Message (optional)</label><textarea id="a-text" name="text" maxlength="220" placeholder="One or two short sentences.">${esc(d.text)}</textarea></div>
<div class="row2"><div class="fld"><label for="a-link">Button goes to</label><select id="a-link" name="link">
<option value="whatsapp"${d.link === 'whatsapp' ? ' selected' : ''}>Your WhatsApp chat (recommended)</option><option value="call"${d.link === 'call' ? ' selected' : ''}>Call your phone</option><option value="contact"${d.link === 'contact' ? ' selected' : ''}>The quote form on the page</option><option value="url"${d.link === 'url' ? ' selected' : ''}>A website link</option></select></div>
<div class="fld"><label for="a-button">Button text</label><input id="a-button" name="button" type="text" maxlength="26" value="${esc(d.button)}" placeholder="${esc(defBtn(d.link))}"></div></div>
<div class="fld" id="urlFld"${d.link === 'url' ? '' : ' hidden'}><label for="a-url">Website link</label><input id="a-url" name="url" type="url" inputmode="url" value="${esc(d.url)}" placeholder="https://"></div>
<div class="fld"><span class="lbl">Banner image (optional)</span><div class="upl"><div id="bannerBox">${imgBox(d.image, '')}</div><div style="display:grid;gap:8px"><label class="btn ghost sm" for="a-img">Choose image</label><input id="a-img" type="file" accept="image/*" hidden><button type="button" class="btn danger sm" data-act="ad-img-clear" ${d.image ? '' : 'hidden'}>Remove</button></div></div>
<span class="hint">Best size: wide, about 1600 &times; 500 pixels. Keep important words in the middle.</span></div>
<label class="check"><input type="checkbox" name="imageOnly" ${d.imageOnly ? 'checked' : ''}><span><b>My image already has the words on it</b><br><span class="sm-note">Show only the picture, no text on top. The whole banner becomes the button.</span></span></label>
<div class="fld"><span class="lbl">Phone version of the image (optional)</span><div class="upl"><div id="mobileBox">${imgBox(d.mobile, 'm')}</div><div style="display:grid;gap:8px"><label class="btn ghost sm" for="a-mob">Choose image</label><input id="a-mob" type="file" accept="image/*" hidden><button type="button" class="btn danger sm" data-act="ad-mob-clear" ${d.mobile ? '' : 'hidden'}>Remove</button></div></div>
<span class="hint">A taller picture (about 1000 &times; 750) shown to people on phones, so nothing is cropped.</span></div>
<div class="row2"><div class="fld"><label for="a-start">Start date (optional)</label><input id="a-start" name="start" type="date" value="${esc(d.start)}"></div><div class="fld"><label for="a-end">End date (optional)</label><input id="a-end" name="end" type="date" value="${esc(d.end)}"></div></div>
<span class="hint" style="margin-top:-8px">Leave the dates empty to run until you pause or delete the ad. An ended ad disappears by itself. To keep an ad ready without showing it, switch Active off and save.</span>
<label class="switch"><input type="checkbox" name="enabled" ${d.enabled ? 'checked' : ''}><span class="tr"></span><span>Active (visible on the website)</span></label>
<div class="editor-actions">${d.id ? `<button type="button" class="btn danger" data-act="ad-del-edit" style="margin-right:auto">${ic('trash')} Delete ad</button>` : ''}<button type="button" class="btn ghost" data-act="ad-cancel">Cancel</button><button type="submit" class="btn gold" id="adSave">Save ad</button></div></form>
<aside class="card preview" aria-label="Preview"><span class="lbl">Preview</span><div style="margin-top:10px" id="pvWrap">${pv(d)}</div><p class="sm-note" style="margin-top:10px">Roughly how it looks on a computer. On phones the banner is taller.</p></aside></div>`;
  }
  function bindEditor() {
    const f = $('#adForm'); if (!f) return;
    const upd = () => {
      $('#pvWrap').innerHTML = pv(draft);
      $('#urlFld').hidden = draft.link !== 'url';
      $('#a-button').placeholder = defBtn(draft.link);
    };
    f.addEventListener('input', e => {
      const t = e.target; if (!t.name) return;
      draft[t.name] = t.type === 'checkbox' ? t.checked : t.value;
      upd();
    });
    f.addEventListener('change', e => { const t = e.target; if (t.name === 'link') { draft.link = t.value; upd(); } });
    f.addEventListener('submit', e => { e.preventDefault(); saveAd(); });
    const pick = (inputId, kind, key, boxId, cls, max) => $(inputId).addEventListener('change', async e => {
      const file = e.target.files[0]; e.target.value = ''; if (!file) return;
      const box = $(boxId); box.firstElementChild.textContent = 'Uploading…';
      try {
        const small = await shrink(file, max);
        const fd = new FormData(); fd.append('file', small); fd.append('kind', kind);
        const r = await upload('ad_image', fd);
        draft[key] = r.path;
        box.innerHTML = `<div class="upl-prev ${cls}"><img src="../${esc(r.path)}" alt=""></div>`;
        $(`[data-act="${kind === 'mobile' ? 'ad-mob-clear' : 'ad-img-clear'}"]`).hidden = false;
        upd();
      } catch (err) {
        box.innerHTML = `<div class="upl-prev ${cls}">${draft[key] ? `<img src="../${esc(draft[key])}" alt="">` : 'No image'}</div>`;
        toast(err.message, 'bad', 6500);
      }
    });
    pick('#a-img', 'banner', 'image', '#bannerBox', '', 1800);
    pick('#a-mob', 'mobile', 'mobile', '#mobileBox', 'm', 1100);
  }
  function saveAd() {
    if (!draft.title.trim() && !draft.image) return toast('Add a headline or a banner image first.', 'bad');
    run(async () => {
      $('#adSave').disabled = true;
      try { take(await api('ad_save', { ad: draft })); } finally { const b = $('#adSave'); if (b) b.disabled = false; }
      draft = null; render(); scrollTo(0, 0);
    }, 'Ad saved. It is on your website now.');
  }

  /* ---------------- PHOTOS ---------------- */
  const typeOpts = (sel) => Object.entries(S.types).map(([k, v]) => `<option value="${k}"${k === sel ? ' selected' : ''}>${esc(v)}</option>`).join('');
  const lastType = () => (S.types[store.get('kush_type')] ? store.get('kush_type') : 'gates');
  function stageHTML() {
    if (!staged.length) return '';
    const opt = (v, t, d) => `<label class="mode${stageMode === v ? ' on' : ''}"><input type="radio" name="stage-mode" value="${v}"${stageMode === v ? ' checked' : ''}><span><b>${t}</b><small>${d}</small></span></label>`;
    if (stageMode === 'schedule' && !stageAt) stageAt = tomorrow8();
    const n = staged.length, s = n > 1 ? 's' : '';
    const btn = stageMode === 'draft' ? `Save ${n} photo${s} (not published)` : stageMode === 'schedule' ? `Schedule ${n} photo${s}` : `Publish ${n} photo${s}`;
    return `<div class="fld" style="margin-top:18px;max-width:340px"><label for="all-type">Same type for all photos</label><select id="all-type">${typeOpts(lastType())}</select></div>
<fieldset class="modes"><legend>What should happen to these photos?</legend>
${opt('now', 'Publish now', 'Shown on the website straight away.')}${opt('draft', 'Save, publish later', 'Kept safely here. Visitors cannot see them yet.')}${opt('schedule', 'Schedule', 'Goes live by itself at the time you choose.')}
${stageMode === 'schedule' ? `<div class="fld" style="margin-top:4px;max-width:300px"><label for="sch-at">Publish on (Nairobi time)</label><input type="datetime-local" id="sch-at" value="${esc(stageAt)}" min="${nowLocal()}"></div>` : ''}</fieldset><div class="stage">${staged.map((s, i) => `
<div class="stage-row${s.err ? ' err' : ''}" data-i="${i}"><img src="${s.url}" alt=""><div class="f"><div class="row2"><input type="text" data-k="title" value="${esc(s.title)}" maxlength="80" aria-label="Photo title" placeholder="Title"><select data-k="type" aria-label="Photo type">${typeOpts(s.type)}</select></div>
<label class="check" style="font-size:.86rem"><input type="checkbox" data-k="commercial" ${s.commercial ? 'checked' : ''}><span>Also show under "Commercial"</span></label>
<div class="bar"><i id="bar${i}"></i></div><div class="st" id="st${i}">${s.status || 'Ready'}</div>
${s.done ? '' : `<div><button class="btn danger sm" data-act="stage-del" data-i="${i}">Remove</button></div>`}</div></div>`).join('')}</div>
<div class="editor-actions" style="margin-top:16px"><button class="btn ghost" data-act="stage-clear">Clear</button><button class="btn gold" data-act="publish" id="pubBtn">${btn}</button></div>`;
  }
  function photoCard(p, i, n) {
    const st = phState(p), live = st === 'live';
    const isNew = Date.now() / 1000 - p.added < 14 * 86400;
    const pill = st === 'draft' ? '<span class="pill off">Draft</span>' : st === 'scheduled' ? '<span class="pill soon">Scheduled</span>' : isNew ? '<span class="pill new">New</span>' : '';
    const sub = st === 'scheduled' ? `<small class="when">Goes live ${esc(fmtWhen(p.publishAt))}</small>` : st === 'draft' ? '<small class="when">Not on the website</small>' : '';
    const pub = st === 'live' ? '' : `<div class="pub"><button class="btn gold sm" data-act="ph-now" data-id="${p.id}">Publish now</button><button class="btn ghost sm" data-act="ph-sched" data-id="${p.id}">${st === 'scheduled' ? 'Change time' : 'Schedule'}</button>${st === 'scheduled' ? `<button class="btn ghost sm" data-act="ph-draft" data-id="${p.id}">Unschedule</button>` : ''}</div>`;
    return `<article class="ph${live ? '' : ' hidden-ph'}"><div class="im"><img src="../${esc(p.thumb || p.file)}" alt="" loading="lazy">${pill}</div>
<div class="info"><b>${esc(p.title)}</b><small>${esc(p.tag)}${p.commercial && p.type !== 'commercial' ? ' · Commercial' : ''}</small>${sub}</div>${pub}
<div class="act"><button class="icon-btn" data-act="ph-up" data-id="${p.id}" aria-label="Move earlier" ${i === 0 ? 'disabled' : ''}>${ic('up')}</button><button class="icon-btn" data-act="ph-down" data-id="${p.id}" aria-label="Move later" ${i === n - 1 ? 'disabled' : ''}>${ic('down')}</button>
${live ? `<button class="icon-btn" data-act="ph-draft" data-id="${p.id}" aria-label="Take off the website (keep as draft)" title="Take off the website (keep as draft)">${ic('eye')}</button>` : ''}
<button class="icon-btn" data-act="ph-edit" data-id="${p.id}" aria-label="Edit">${ic('edit')}</button><button class="icon-btn push" data-act="ph-del" data-id="${p.id}" aria-label="Delete">${ic('trash')}</button></div></article>`;
  }
  function builtinCard(b) {
    const off = S.content.hidden.includes(b.id);
    return `<article class="ph builtin${off ? ' hidden-ph' : ''}"><div class="im"><img src="../${esc(b.img)}" alt="" loading="lazy"></div><div class="info"><b>${esc(b.title)}</b><small>${esc(b.tag)}</small></div>
<div class="act"><label class="switch"><input type="checkbox" data-chg="builtin" data-id="${b.id}" ${off ? '' : 'checked'}><span class="tr"></span><span>Shown</span></label></div></article>`;
  }
  function libHTML() {
    const ps = S.content.photos, cnt = { live: 0, draft: 0, scheduled: 0 };
    ps.forEach(p => { cnt[phState(p)]++; });
    const shown = ps.map((p, i) => [p, i]).filter(([p]) => phFilter === 'all' || phState(p) === phFilter);
    const f = (v, t, n) => `<button type="button" class="chip${phFilter === v ? ' on' : ''}" data-act="ph-filter" data-v="${v}" aria-pressed="${phFilter === v}">${t} (${n})</button>`;
    return `<div class="lib-head"><h3>Your uploaded photos (${ps.length})</h3>${cnt.draft ? `<button class="btn gold sm" data-act="ph-all-now">Publish all ${cnt.draft} draft${cnt.draft > 1 ? 's' : ''}</button>` : ''}</div>
${ps.length ? `<div class="chips-row">${f('all', 'All', ps.length)}${f('live', 'Live', cnt.live)}${f('draft', 'Drafts', cnt.draft)}${f('scheduled', 'Scheduled', cnt.scheduled)}</div>` : ''}
${shown.length ? `<div class="grid">${shown.map(([p, i]) => photoCard(p, i, ps.length)).join('')}</div>` : ps.length ? `<div class="empty"><b>Nothing here</b>No photos in this view.</div>` : `<div class="empty"><b>No uploaded photos yet</b>Photos you add appear here. Live ones are on your website; drafts and scheduled ones wait here until their time.</div>`}`;
  }
  function viewPhotos() {
    const ps = S.content.photos;
    return `<div class="page-head"><div><h2>Project photos</h2><p>Add new photos of your work. Publish them straight away, save them here to publish later, or schedule them to go live by themselves. Live photos appear in the "Featured Projects" gallery, newest first.</p></div></div>
<section class="card"><div class="drop" id="drop" tabindex="0" role="button" aria-label="Choose photos to upload"><b>Add new photos</b><span class="muted">Tap to choose from your phone or computer, or drop photos here. You can pick many at once.</span><br><span class="btn gold">Choose photos</span></div>
<input type="file" id="files" accept="image/*" multiple hidden>${`<div id="stageWrap">${stageHTML()}</div>`}</section>
${libHTML()}
<details class="card" style="margin-top:24px"><summary>Original photos on the site (${S.builtin.length})</summary><p class="sm-note" style="margin-bottom:14px">These came with the website. Switch off any you do not want visitors to see.</p><div class="grid">${S.builtin.map(builtinCard).join('')}</div></details>`;
  }
  function bindPhotos() {
    const drop = $('#drop'), files = $('#files'); if (!drop) return;
    drop.addEventListener('click', () => files.click());
    drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); files.click(); } });
    ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', e => addFiles(e.dataTransfer.files));
    files.addEventListener('change', () => { addFiles(files.files); files.value = ''; });
    bindStage();
  }
  function bindStage() {
    const w = $('#stageWrap'); if (!w) return;
    w.addEventListener('input', e => {
      const row = e.target.closest('.stage-row'); if (!row) return;
      const s = staged[+row.dataset.i], k = e.target.dataset.k; if (!s || !k) return;
      s[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    });
    w.addEventListener('input', e => { if (e.target.id === 'sch-at') stageAt = e.target.value; });
    w.addEventListener('change', e => {
      if (e.target.name === 'stage-mode') { stageMode = e.target.value; store.set('kush_mode', stageMode); w.innerHTML = stageHTML(); return; }
      if (e.target.id === 'all-type') { staged.forEach(s => { s.type = e.target.value; }); store.set('kush_type', e.target.value); w.innerHTML = stageHTML(); }
    });
  }
  function addFiles(list) {
    const ok = Array.from(list).filter(f => /^image\//.test(f.type) || /\.(jpe?g|png|webp|heic)$/i.test(f.name));
    if (ok.length < list.length) toast('Some files were skipped: only photos can be added.', 'bad');
    ok.forEach(f => staged.push({
      file: f, url: URL.createObjectURL(f), type: lastType(), commercial: false,
      title: f.name.replace(/\.\w+$/, '').replace(/[^A-Za-z0-9]+/g, ' ').trim().replace(/\b\w/g, c => c.toUpperCase()).replace(/^(Img|Dsc|Image|Photo|Whatsapp)\b.*$/i, '').replace(/^\d+$/, ''),
    }));
    if (staged.length > 40) { staged.length = 40; toast('Up to 40 photos at a time.', 'bad'); }
    $('#stageWrap').innerHTML = stageHTML();
    if (ok.length) toast('Check the titles and types, choose what should happen to them, then tap the gold button.', 'ok', 4200);
  }
  async function publish() {
    if (busy || !staged.length) return;
    if (stageMode === 'schedule') {
      const at = ($('#sch-at') || {}).value || stageAt;
      if (!at) return toast('Choose the date and time to publish.', 'bad');
      if (at <= nowLocal()) return toast('That time has already passed. Choose a time in the future.', 'bad');
      stageAt = at;
    }
    const mode = stageMode, at = stageAt;
    busy = true;
    const btn = $('#pubBtn'); btn.disabled = true;
    $$('[data-act="stage-del"],[data-act="stage-clear"]').forEach(b => { b.disabled = true; });
    let okN = 0, fail = 0;
    for (let i = 0; i < staged.length; i++) {
      const s = staged[i]; if (s.done) { okN++; continue; }
      const st = $('#st' + i), bar = $('#bar' + i), row = st.closest('.stage-row');
      row.classList.remove('err'); st.textContent = 'Preparing…';
      try {
        const small = await shrink(s.file, 2000);
        const fd = new FormData();
        fd.append('file', small); fd.append('title', s.title.trim()); fd.append('type', s.type); fd.append('commercial', s.commercial ? '1' : '0'); fd.append('mode', mode); fd.append('at', at);
        st.textContent = 'Uploading…';
        await upload('photo_upload', fd, p => { bar.style.width = Math.round(p * 100) + '%'; });
        bar.style.width = '100%'; st.textContent = mode === 'draft' ? 'Saved (not published)' : mode === 'schedule' ? 'Scheduled' : 'Published'; row.classList.add('done'); s.done = true; okN++;
      } catch (e) { fail++; s.err = true; s.status = e.message; row.classList.add('err'); st.textContent = e.message; bar.style.width = '0'; }
    }
    busy = false;
    try { take(await api('state')); } catch (e) { /* ignore */ }
    if (!fail) {
      staged.forEach(s => URL.revokeObjectURL(s.url)); staged = [];
      const pl = okN > 1;
      toast(mode === 'draft' ? `${okN} photo${pl ? 's' : ''} saved. Not on the website yet: publish ${pl ? 'them' : 'it'} from the list below when ready.`
        : mode === 'schedule' ? `${okN} photo${pl ? 's' : ''} scheduled for ${fmtWhen(parseAt(at))}.`
        : `${okN} photo${pl ? 's are' : ' is'} live on your website now.`, 'ok', mode === 'now' ? 4200 : 6500);
      render();
    } else {
      toast(`${okN} done, ${fail} failed. Remove or fix the red ones and try again.`, 'bad', 7000);
      staged = staged.filter(s => !s.done);
      render();
    }
  }
  function schedulePhotos(ids, title) {
    const d = dlg(`<h3>${esc(title)}</h3><form id="scForm" style="display:grid;gap:14px"><div class="fld"><label for="sc-at">Publish on (Nairobi time)</label><input id="sc-at" type="datetime-local" required value="${esc(tomorrow8())}" min="${nowLocal()}"><span class="hint">It goes live by itself at this time. Nothing else to do.</span></div>
<div class="btns" style="margin-top:6px"><button type="button" class="btn ghost" value="no">Cancel</button><button type="submit" class="btn gold">Schedule</button></div></form>`);
    d.addEventListener('click', e => { if (e.target.closest('button[value=no]')) d.close(); });
    $('#scForm', d).addEventListener('submit', e => {
      e.preventDefault();
      const at = $('#sc-at', d).value;
      if (!at || at <= nowLocal()) return toast('Choose a time in the future.', 'bad');
      d.close();
      run(async () => { take(await api('photo_status', { ids, mode: 'schedule', at })); render(); }, `Scheduled for ${fmtWhen(parseAt(at))}.`);
    });
  }
  function editPhoto(p) {
    const d = dlg(`<h3>Edit photo</h3><form id="phForm" style="display:grid;gap:14px"><div class="fld"><label for="e-title">Title</label><input id="e-title" type="text" maxlength="80" value="${esc(p.title)}"></div>
<div class="fld"><label for="e-type">Type</label><select id="e-type">${typeOpts(p.type)}</select></div>
<label class="check"><input type="checkbox" id="e-com" ${p.commercial ? 'checked' : ''}><span>Also show under "Commercial"</span></label>
<div class="btns" style="margin-top:6px"><button type="button" class="btn ghost" value="no">Cancel</button><button type="submit" class="btn gold">Save</button></div></form>`);
    d.addEventListener('click', e => { if (e.target.closest('button[value=no]')) d.close(); });
    $('#phForm', d).addEventListener('submit', e => {
      e.preventDefault();
      const body = { id: p.id, title: $('#e-title', d).value, type: $('#e-type', d).value, commercial: $('#e-com', d).checked };
      d.close();
      run(async () => { take(await api('photo_update', body)); render(); }, 'Photo updated.');
    });
  }

  /* ---------------- ACCOUNT ---------------- */
  function viewAccount() {
    const checks = S.system.map(c => `<li class="${c.ok ? '' : c.soft ? 'soft' : 'bad'}"><span class="dot">${c.ok ? '&#10003;' : c.soft ? '!' : '&times;'}</span><span>${esc(c.label)}${c.ok ? '' : `<span class="fix">${esc(c.fix)}</span>`}</span></li>`).join('');
    return `<div class="page-head"><div><h2>Account</h2><p>Your password and a quick health check of your website's storage.</p></div></div>
${S.mustChange ? '<div class="notice" role="alert"><b>Choose your own password to continue.</b> You are using the starting password. Set a new one below, then the Advertisement and Photos tabs unlock.</div>' : ''}
<section class="card"><h3>Change password</h3><form class="pw-form" id="pwForm" style="margin-top:14px" autocomplete="off"><div class="fld"><label for="p-cur">Current password</label><input id="p-cur" type="password" autocomplete="current-password" required></div>
<div class="fld"><label for="p-new">New password</label><input id="p-new" type="password" autocomplete="new-password" minlength="8" required><span class="hint">At least 8 characters. A short sentence is easy to remember and hard to guess.</span></div>
<div class="fld"><label for="p-new2">Repeat new password</label><input id="p-new2" type="password" autocomplete="new-password" required></div>
<div><button class="btn gold" type="submit">Save password</button></div></form></section>
<section class="card"><h3>System check</h3><ul class="checks">${checks}</ul></section>
<section class="card"><h3>Forgot your password?</h3><p class="muted" style="margin-top:6px">Sign in to Netlify, open your site, then <b>Site configuration &rarr; Environment variables</b>. Add (or change) a variable named <b>ADMIN_PASSWORD</b> to any new temporary password, then press <b>Deploys &rarr; Trigger deploy</b>. Log in here with that temporary password and you will be asked to choose a new one. Nothing else is lost.</p></section>`;
  }
  function bindAccount() {
    const f = $('#pwForm'); if (!f) return;
    f.addEventListener('submit', e => {
      e.preventDefault();
      const cur = $('#p-cur').value, n = $('#p-new').value, n2 = $('#p-new2').value;
      if (n.length < 8) return toast('Use at least 8 characters.', 'bad');
      if (n !== n2) return toast('The two new passwords do not match.', 'bad');
      run(async () => { take(await api('password_change', { current: cur, new: n })); f.reset(); render(); }, 'Password changed.');
    });
  }

  /* ---------------- shell ---------------- */
  function render() {
    if (S.mustChange) tab = 'account';
    $$('#tabs button').forEach(b => { b.setAttribute('aria-selected', String(b.dataset.tab === tab)); b.disabled = S.mustChange && b.dataset.tab !== 'account'; b.style.opacity = b.disabled ? '.4' : ''; });
    app.innerHTML = tab === 'photos' ? viewPhotos() : tab === 'account' ? viewAccount() : viewAds();
    if (tab === 'ads') bindEditor(); else if (tab === 'photos') bindPhotos(); else bindAccount();
  }
  function go(t) { if (S.mustChange && t !== 'account') return; tab = t; draft = null; history.replaceState(null, '', '#' + t); render(); scrollTo(0, 0); }
  $('#tabs').addEventListener('click', e => { const b = e.target.closest('button[data-tab]'); if (b) go(b.dataset.tab); });
  $('#logout').addEventListener('click', async () => { try { await api('logout', {}); } catch (e) {} showLogin(); });

  const newAd = () => ({ id: '', enabled: true, title: '', text: '', button: '', link: 'whatsapp', url: '', image: '', mobile: '', imageOnly: false, start: '', end: '' });
  const findAd = id => S.content.ads.find(a => a.id === id);
  const findPh = id => S.content.photos.find(p => p.id === id);

  app.addEventListener('click', async e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const act = b.dataset.act, id = b.dataset.id;
    const call = (action, body, msg) => run(async () => { take(await api(action, body)); render(); }, msg);
    switch (act) {
      case 'ad-new': draft = newAd(); render(); scrollTo(0, 0); break;
      case 'ad-edit': draft = Object.assign(newAd(), JSON.parse(JSON.stringify(findAd(id)))); render(); scrollTo(0, 0); break;
      case 'ad-cancel': draft = null; render(); break;
      case 'ad-img-clear': draft.image = ''; draft.imageOnly = false; render(); break;
      case 'ad-mob-clear': draft.mobile = ''; render(); break;
      case 'ad-up': call('ad_move', { id, dir: 'up' }); break;
      case 'ad-down': call('ad_move', { id, dir: 'down' }); break;
      case 'ad-del-edit': if (await ask('Delete this ad?', 'It disappears from your website straight away. This cannot be undone.')) run(async () => { take(await api('ad_delete', { id: draft.id })); draft = null; render(); scrollTo(0, 0); }, 'Ad deleted.'); break;
      case 'ad-del': if (await ask('Delete this ad?', 'It disappears from your website straight away. This cannot be undone.')) call('ad_delete', { id }, 'Ad deleted.'); break;
      case 'ph-up': call('photo_move', { id, dir: 'up' }); break;
      case 'ph-down': call('photo_move', { id, dir: 'down' }); break;
      case 'ph-now': call('photo_status', { ids: [id], mode: 'now' }, 'Photo is live on your website now.'); break;
      case 'ph-draft': call('photo_status', { ids: [id], mode: 'draft' }, 'Photo taken off the website. It is saved here as a draft.'); break;
      case 'ph-sched': schedulePhotos([id], 'Schedule this photo'); break;
      case 'ph-all-now': { const ids = S.content.photos.filter(p => phState(p) === 'draft').map(p => p.id); if (ids.length && await ask('Publish all drafts?', `${ids.length} photo${ids.length > 1 ? 's go' : ' goes'} live on your website straight away.`, 'Publish', false)) call('photo_status', { ids, mode: 'now' }, `${ids.length} photo${ids.length > 1 ? 's are' : ' is'} live now.`); break; }
      case 'ph-filter': phFilter = b.dataset.v; render(); break;
      case 'ph-edit': editPhoto(findPh(id)); break;
      case 'ph-del': if (await ask('Delete this photo?', 'It is removed from your website and the server. This cannot be undone. (To keep it but not show it, use the eye button instead.)')) call('photo_delete', { id }, 'Photo deleted.'); break;
      case 'stage-del': staged.splice(+b.dataset.i, 1); $('#stageWrap').innerHTML = stageHTML(); break;
      case 'stage-clear': staged = []; $('#stageWrap').innerHTML = ''; break;
      case 'publish': publish(); break;
    }
  });
  app.addEventListener('change', e => {
    const t = e.target, k = t.dataset.chg; if (!k) return;
    if (k === 'ad-toggle') run(async () => { take(await api('ad_toggle', { id: t.dataset.id, enabled: t.checked })); render(); }, t.checked ? 'Ad is active.' : 'Ad paused.');
    if (k === 'builtin') run(async () => { take(await api('builtin_set', { id: t.dataset.id, hidden: !t.checked })); render(); }, t.checked ? 'Photo is shown.' : 'Photo hidden from the website.');
    if (k === 'settings') run(async () => { take(await api('settings_save', { empty: $('#s-empty').value, seconds: +$('#s-sec').value })); render(); }, 'Saved.');
  });

  addEventListener('hashchange', () => { const h = location.hash.slice(1); if (S && h !== tab && ['ads', 'photos', 'account'].includes(h)) go(h); });

  /* ---------------- login + start ---------------- */
  const loginBox = $('#login'), topBar = $('#topbar'), loginErr = $('#loginErr');
  function showLogin(msg) {
    S = null; draft = null; staged = []; csrf = '';
    document.body.className = 'login-page';
    topBar.hidden = true; app.hidden = true; loginBox.hidden = false;
    loginErr.hidden = !msg; loginErr.textContent = msg || '';
    setTimeout(() => $('#pw').focus(), 50);
  }
  function showApp() {
    document.body.className = 'app';
    loginBox.hidden = true; topBar.hidden = false; app.hidden = false;
  }
  $('#pwShow').addEventListener('click', function () {
    const i = $('#pw'), s = i.type === 'password';
    i.type = s ? 'text' : 'password'; this.textContent = s ? 'Hide' : 'Show'; this.setAttribute('aria-pressed', String(s));
  });
  $('#loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = $('#loginBtn'), pw = $('#pw').value;
    if (!pw) { loginErr.hidden = false; loginErr.textContent = 'Enter your password.'; return; }
    btn.disabled = true; btn.textContent = 'Checking…'; loginErr.hidden = true;
    try {
      const r = await fetch('/api/admin?action=login', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) });
      let j = {}; try { j = await r.json(); } catch (x) { /* not json */ }
      if (r.ok && j.ok) { $('#pw').value = ''; await boot(); }
      else { loginErr.hidden = false; loginErr.textContent = j.error || 'Could not log in. Please try again.'; }
    } catch (x) { loginErr.hidden = false; loginErr.textContent = 'No connection. Check your internet and try again.'; }
    btn.disabled = false; btn.textContent = 'Log in';
  });
  async function boot() {
    try {
      take(await api('state'));
      showApp();
      const h = location.hash.slice(1);
      tab = ['ads', 'photos', 'account'].includes(h) ? h : 'ads';
      render();
    } catch (e) {
      if (!loginBox.hidden) return;   // not logged in: the login form is already showing
      showApp();
      app.innerHTML = `<div class="notice" role="alert"><b>Could not load.</b> ${esc(e.message)}</div>`;
    }
  }
  boot();
  addEventListener('beforeunload', e => { if (busy) { e.preventDefault(); e.returnValue = ''; } });
})();
