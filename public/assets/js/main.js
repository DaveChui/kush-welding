/* Kush Welding Services: site behaviour (no dependencies) */
(() => {
  'use strict';
  const K = window.KUSH || { phone: '0796 039580', tel: '+254796039580', wa: '254796039580' };
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const html = document.documentElement;
  const icon = n => `<svg class="i" aria-hidden="true"><use href="#i-${n}"/></svg>`;
  const waUrl = msg => `https://wa.me/${K.wa}?text=${encodeURIComponent(msg)}`;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  /* ---------------- toasts ---------------- */
  const box = $('#toasts');
  const canPopover = box && 'showPopover' in box;
  if (canPopover) box.setAttribute('popover', 'manual');   // top layer, so toasts show above open dialogs
  const raise = () => { if (!canPopover) return; try { if (box.matches(':popover-open')) box.hidePopover(); box.showPopover(); } catch (e) {} };
  const lower = () => { if (canPopover && !box.children.length) { try { box.hidePopover(); } catch (e) {} } };

  function dismiss(el) {
    if (!el || el.classList.contains('out')) return;
    el.classList.add('out');
    setTimeout(() => { el.remove(); lower(); }, 260);
  }
  function toast({ type = 'info', title, text = '', ic = 'check', action, duration = 5600 }) {
    if (!box) return;
    $$('.toast', box).forEach(t => { if (t.dataset.key === title) t.remove(); });
    while (box.children.length >= 3) box.firstElementChild.remove();
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.dataset.key = title;
    el.style.setProperty('--d', duration + 'ms');
    el.innerHTML = `<span class="t-ic">${icon(ic)}</span><div class="t-tx"><b></b><span></span></div><button class="t-x" type="button" aria-label="Dismiss notification">${icon('x')}</button>`;
    $('b', el).textContent = title;
    const sp = $('.t-tx > span', el);
    if (text) sp.textContent = text; else sp.remove();
    if (action) {
      const a = document.createElement(action.href ? 'a' : 'button');
      a.className = 't-act';
      if (action.href) { a.href = action.href; a.target = '_blank'; a.rel = 'noopener'; } else a.type = 'button';
      a.innerHTML = `${icon(action.icon || 'arrow')}<span></span>`;
      $('span', a).textContent = action.label;
      if (action.fn) a.addEventListener('click', () => { action.fn(); dismiss(el); });
      $('.t-tx', el).appendChild(a);
    }
    $('.t-x', el).addEventListener('click', () => dismiss(el));
    if (reduce) setTimeout(() => dismiss(el), duration);
    else el.addEventListener('animationend', e => { if (e.pseudoElement === '::after') dismiss(el); });
    box.appendChild(el);
    raise();
  }
  window.kushToast = toast;

  function copyText(text, label) {
    const done = () => toast({ type: 'info', title: 'Number copied', text: `${text} is ready to paste into your phone's dialer.`, ic: 'copy', duration: 3800 });
    const fallback = () => {
      const t = document.createElement('textarea');
      t.value = text; t.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(t); t.select();
      let ok = false; try { ok = document.execCommand('copy'); } catch (e) {}
      t.remove();
      ok ? done() : toast({ type: 'info', title: label || 'Our number', text, ic: 'phone' });
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback); else fallback();
  }

  // Any WhatsApp or call link on the page shows a toast, then follows its link normally.
  document.addEventListener('click', e => {
    const a = e.target.closest('a.js-wa, a.js-call');
    if (!a) return;
    if (a.classList.contains('js-call')) {
      toast({ type: 'call', ic: 'phone', title: `Dialing ${K.phone}`, text: 'Speak to our team. On a computer, or if your phone does not start the call, copy the number.',
        action: { label: 'Copy number', icon: 'copy', fn: () => copyText(K.phone) }, duration: 7000 });
    } else {
      toast({ type: 'wa', ic: 'whatsapp', title: 'Opening WhatsApp…', text: `Chat with Kush Welding Services on ${K.phone}. We usually reply within minutes.`, duration: 5200 });
    }
  });
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-copy]');
    if (b) copyText(b.dataset.copy);
  });

  /* ---------------- header, nav, progress ---------------- */
  const hdr = $('.hdr'), nav = $('#nav'), burger = $('#burger'), prog = $('#progress'), toTop = $('#toTop');
  function setMenu(open) {
    nav.classList.toggle('open', open);
    burger.setAttribute('aria-expanded', String(open));
    burger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    html.classList.toggle('lock', open);
  }
  burger.addEventListener('click', () => setMenu(!nav.classList.contains('open')));
  nav.addEventListener('click', e => { if (e.target.closest('a')) setMenu(false); });
  addEventListener('keydown', e => { if (e.key === 'Escape') setMenu(false); });
  matchMedia('(min-width:981px)').addEventListener('change', () => setMenu(false));

  let ticking = false;
  function onScroll() {
    ticking = false;
    const y = scrollY, max = html.scrollHeight - innerHeight;
    hdr.classList.toggle('stuck', y > 24);
    prog.style.transform = `scaleX(${max > 0 ? clamp(y / max, 0, 1) : 0})`;
    toTop.hidden = y < 900;
  }
  addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });
  addEventListener('resize', onScroll);
  onScroll();
  toTop.addEventListener('click', () => scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' }));

  const links = $$('.nav-a');
  const secs = links.map(a => $(a.getAttribute('href'))).filter(Boolean);
  if ('IntersectionObserver' in window) {
    const so = new IntersectionObserver(es => {
      es.forEach(en => { if (en.isIntersecting) links.forEach(a => a.classList.toggle('on', a.getAttribute('href') === '#' + en.target.id)); });
    }, { rootMargin: '-45% 0px -50% 0px' });
    secs.forEach(s => so.observe(s));
  }

  /* ---------------- reveal + counters ---------------- */
  const rv = $$('.rv');
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(es => es.forEach(en => {
      if (!en.isIntersecting) return;
      const el = en.target; io.unobserve(el);
      el.style.transitionDelay = (Math.min(+el.dataset.d || 0, 6) * 70) + 'ms';
      el.classList.add('in');
      setTimeout(() => { el.classList.remove('rv'); el.style.transitionDelay = ''; }, 1300);
    }), { threshold: 0.1, rootMargin: '0px 0px -5% 0px' });
    // stagger siblings in grids
    $$('.svc-grid,.tcards,.masonry,.area-list').forEach(g => $$(':scope > .rv', g).forEach((c, i) => c.dataset.d = i % 4));
    rv.forEach(el => io.observe(el));
  } else rv.forEach(el => el.classList.add('in'));

  const counters = $$('[data-count]');
  function runCounters() {
    counters.forEach(c => {
      const to = +c.dataset.count;
      if (reduce) return;
      const t0 = performance.now(), dur = 1800;
      const step = now => {
        const p = clamp((now - t0) / dur, 0, 1), e = 1 - Math.pow(1 - p, 3);
        c.textContent = Math.round(to * e);
        if (p < 1) requestAnimationFrame(step);
      };
      c.textContent = '0';
      requestAnimationFrame(step);
    });
  }
  if (counters.length && 'IntersectionObserver' in window) {
    const co = new IntersectionObserver(es => { if (es[0].isIntersecting) { co.disconnect(); runCounters(); } }, { threshold: 0.4 });
    co.observe($('.metrics'));
  }

  /* ---------------- hero slider ---------------- */
  const slides = $$('.slide'), cards = $$('.hc'), bars = $$('.bar'), now = $('#hcNow');
  const DUR = 6500;
  let cur = 0, timer = null;
  function go(n) {
    cur = (n + slides.length) % slides.length;
    slides.forEach((s, i) => s.classList.toggle('on', i === cur));
    cards.forEach((s, i) => s.classList.toggle('on', i === cur));
    bars.forEach((b, i) => { b.classList.remove('on'); b.classList.toggle('done', i < cur); b.style.setProperty('--dur', DUR + 'ms'); });
    void bars[cur].offsetWidth;
    bars[cur].classList.add('on');
    if (now) now.textContent = String(cur + 1).padStart(2, '0');
    clearTimeout(timer);
    if (!reduce) timer = setTimeout(() => go(cur + 1), DUR);
  }
  if (slides.length) {
    $('#sPrev').addEventListener('click', () => go(cur - 1));
    $('#sNext').addEventListener('click', () => go(cur + 1));
    bars.forEach(b => b.addEventListener('click', () => go(+b.dataset.i)));
    document.addEventListener('visibilitychange', () => { if (document.hidden) clearTimeout(timer); else go(cur); });
    go(0);
  }

  /* ---------------- dialogs ---------------- */
  function lockOnOpen(dlg) { dlg.addEventListener('close', () => html.classList.remove('lock')); dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); }); $$('[data-close]', dlg).forEach(b => b.addEventListener('click', () => dlg.close())); }
  function openDlg(dlg) { if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', ''); html.classList.add('lock'); }

  const svc = $('#svcDlg');
  lockOnOpen(svc);
  function openService(card) {
    const d = card.dataset;
    $('#svcTitle').textContent = d.title;
    $('#svcLong').textContent = d.long;
    const im = $('#svcImg'); im.src = `assets/img/${d.img}.webp`; im.alt = `${d.title} by Kush Welding Services`; im.style.objectPosition = d.pos;
    $('#svcFeats').innerHTML = d.feats.split('|').map(f => `<li>${icon('check')}<span></span></li>`).join('');
    $$('#svcFeats span').forEach((s, i) => s.textContent = d.feats.split('|')[i]);
    $('#svcWa').href = waUrl(`Hello Kush Welding Services, I would like a quote for: ${d.title}.`);
    openDlg(svc);
  }
  $$('.svc').forEach(card => {
    $('.more', card).addEventListener('click', () => openService(card));
    $('.svc-img', card).addEventListener('click', () => openService(card));
    $('.svc-img', card).style.cursor = 'pointer';
  });

  /* ---------------- portfolio: filter + lightbox ---------------- */
  // Works on the live DOM, so photos the owner uploads later (see "managed content" below) behave exactly like the built-in ones.
  const grid = $('#masonry');
  const chipsEl = $('.chips[aria-label="Filter projects"]');
  const pjAll = () => $$('.pj', grid);
  let filter = 'all';
  const inCat = (p, f) => p.dataset.off !== '1' && (f === 'all' || p.dataset.cats.split(' ').includes(f));
  function applyFilter(animate) {
    pjAll().forEach(p => {
      const show = inCat(p, filter);
      p.hidden = !show;
      if (show && animate) { p.classList.remove('rv'); p.style.opacity = ''; p.style.transform = ''; p.classList.remove('fade'); void p.offsetWidth; p.classList.add('fade'); }
    });
  }
  function recount() {
    $$('[data-f]', chipsEl).forEach(c => {
      const f = c.dataset.f, n = pjAll().filter(p => inCat(p, f)).length;
      $('small', c).textContent = n;
      c.hidden = f !== 'all' && n === 0;
    });
    const sel = $('[data-f][aria-selected="true"]', chipsEl);
    if (!sel || sel.hidden) { filter = 'all'; $$('[data-f]', chipsEl).forEach(c => c.setAttribute('aria-selected', String(c.dataset.f === 'all'))); }
  }
  chipsEl.addEventListener('click', e => {
    const chip = e.target.closest('[data-f]'); if (!chip) return;
    filter = chip.dataset.f;
    $$('[data-f]', chipsEl).forEach(c => c.setAttribute('aria-selected', String(c === chip)));
    applyFilter(true);
  });

  const lb = $('#lb'), lbImg = $('#lbImg');
  lockOnOpen(lb);
  let list = [], li = 0;
  function showLb(i) {
    li = (i + list.length) % list.length;
    const p = list[li], im = $('img', p);
    lbImg.src = p.dataset.full || im.getAttribute('src'); lbImg.alt = im.alt;
    $('#lbTitle').textContent = p.dataset.title; $('#lbTag').textContent = p.dataset.tag;
    $('#lbWa').href = waUrl(`Hello Kush Welding Services, I like this design: "${p.dataset.title}". Can you make something similar for me?`);
    $('#lbPrev').hidden = $('#lbNext').hidden = list.length < 2;
  }
  grid.addEventListener('click', e => {
    const btn = e.target.closest('.pj-btn'); if (!btn) return;
    const p = btn.closest('.pj');
    list = pjAll().filter(x => !x.hidden); showLb(list.indexOf(p)); openDlg(lb);
  });
  $('#lbPrev').addEventListener('click', () => showLb(li - 1));
  $('#lbNext').addEventListener('click', () => showLb(li + 1));
  lb.addEventListener('keydown', e => { if (e.key === 'ArrowLeft') showLb(li - 1); if (e.key === 'ArrowRight') showLb(li + 1); });
  let sx = 0;
  lb.addEventListener('touchstart', e => { sx = e.touches[0].clientX; }, { passive: true });
  lb.addEventListener('touchend', e => { const dx = e.changedTouches[0].clientX - sx; if (Math.abs(dx) > 50) showLb(li + (dx < 0 ? 1 : -1)); }, { passive: true });

  /* ---------------- before / after stages ---------------- */
  const journeys = $$('.journey');
  let stageTimer = null, userTouched = false;
  const setStage = (j, s) => {
    $$('.sv', j).forEach(x => x.classList.toggle('on', +x.dataset.s === s));
    $$('.stg', j).forEach(x => x.classList.toggle('on', +x.dataset.s === s));
    j.dataset.cur = s;
  };
  journeys.forEach(j => $$('.stg', j).forEach(b => b.addEventListener('click', () => { userTouched = true; setStage(j, +b.dataset.s); })));
  $$('.chips [data-j]').forEach(c => c.addEventListener('click', () => {
    userTouched = true;
    $$('.chips [data-j]').forEach(x => x.setAttribute('aria-selected', String(x === c)));
    journeys.forEach(j => j.classList.toggle('on', j.dataset.j === c.dataset.j));
  }));
  const baBody = $('.ba-body');
  if (baBody && !reduce && 'IntersectionObserver' in window) {
    const bo = new IntersectionObserver(es => {
      clearInterval(stageTimer);
      if (es[0].isIntersecting) stageTimer = setInterval(() => {
        if (userTouched) return clearInterval(stageTimer);
        const j = $('.journey.on'); setStage(j, ((+j.dataset.cur || 0) + 1) % 3);
      }, 3200);
    }, { threshold: 0.4 });
    bo.observe(baBody);
  }

  /* ---------------- testimonials slider ---------------- */
  const track = $('#tmTrack');
  if (track) {
    const tms = $$('.tm', track), dots = $('#tmDots');
    let perView = 3, pages = tms.length, tTimer = null, hover = false;
    const step = () => tms[1].offsetLeft - tms[0].offsetLeft;
    const index = () => clamp(Math.round(track.scrollLeft / step()), 0, pages - 1);
    const goTo = i => track.scrollTo({ left: clamp(i, 0, pages - 1) * step(), behavior: reduce ? 'auto' : 'smooth' });
    function build() {
      perView = Math.max(1, Math.round(track.clientWidth / step()));
      pages = Math.max(1, tms.length - perView + 1);
      dots.innerHTML = '';
      for (let i = 0; i < pages; i++) { const b = document.createElement('button'); b.type = 'button'; b.setAttribute('aria-label', `Go to review ${i + 1}`); b.addEventListener('click', () => goTo(i)); dots.appendChild(b); }
      mark();
    }
    function mark() { const c = index(); $$('button', dots).forEach((b, i) => b.classList.toggle('on', i === c)); }
    track.addEventListener('scroll', () => requestAnimationFrame(mark), { passive: true });
    $('#tmPrev').addEventListener('click', () => goTo(index() - 1));
    $('#tmNext').addEventListener('click', () => goTo(index() + 1 >= pages ? 0 : index() + 1));
    addEventListener('resize', build);
    build();
    const play = () => { clearInterval(tTimer); if (!reduce) tTimer = setInterval(() => { if (!hover) goTo(index() + 1 >= pages ? 0 : index() + 1); }, 6000); };
    track.addEventListener('mouseenter', () => hover = true); track.addEventListener('mouseleave', () => hover = false);
    track.addEventListener('focusin', () => hover = true); track.addEventListener('focusout', () => hover = false);
    track.addEventListener('touchstart', () => hover = true, { passive: true }); track.addEventListener('touchend', () => setTimeout(() => hover = false, 4000), { passive: true });
    play();
  }

  /* ---------------- quote form ---------------- */
  const form = $('#quoteForm');
  if (form) {
    const rules = {
      name: v => v.trim().length >= 2 || 'Please enter your full name.',
      phone: v => /^(?:\+?254|0)?[17]\d{8}$/.test(v.replace(/[\s-]/g, '')) || 'Enter a valid Kenyan number, e.g. 0712 345 678.',
      email: v => !v.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()) || 'That email address looks incomplete.',
      type: v => !!v || 'Choose the kind of project.',
      location: v => v.trim().length >= 2 || 'Tell us where the project is.',
    };
    const check = f => {
      const field = f.closest('.fld'), r = rules[f.name]; if (!r) return true;
      const res = r(f.value), ok = res === true;
      field.classList.toggle('bad', !ok);
      $('.err', field).textContent = ok ? '' : res;
      f.setAttribute('aria-invalid', String(!ok));
      return ok;
    };
    $$('input,select', form).forEach(f => { f.addEventListener('blur', () => f.value && check(f)); f.addEventListener('input', () => f.closest('.fld').classList.contains('bad') && check(f)); });
    form.addEventListener('submit', e => {
      e.preventDefault();
      if (form.company.value) return;                       // honeypot
      const fields = $$('input,select', form).filter(f => rules[f.name]);
      const bad = fields.filter(f => !check(f));
      if (bad.length) {
        bad[0].focus();
        toast({ type: 'bad', ic: 'x', title: 'Please check the highlighted fields', text: `${bad.length} ${bad.length > 1 ? 'fields need' : 'field needs'} your attention.`, duration: 5000 });
        return;
      }
      const d = new FormData(form);
      const opt = (k, v) => (v ? `${k}: ${v}` : null);
      const msg = ['Hello Kush Welding Services,', '', `My name is ${d.get('name').trim()}.`, opt('Phone', d.get('phone').trim()), opt('Email', d.get('email').trim()),
        opt('Project', d.get('type')), opt('Location', d.get('location').trim()), opt('Details', d.get('desc').trim()), '', 'I would like a free quote. Thank you.']
        .filter(x => x !== null).join('\n');
      const url = waUrl(msg);
      const w = window.open(url, '_blank', 'noopener');
      toast({ type: 'wa', ic: 'whatsapp', title: 'Opening WhatsApp with your request…', text: 'Your details are filled in. Press send in WhatsApp to reach our team.',
        action: w ? null : { label: 'Open WhatsApp', icon: 'whatsapp', href: url }, duration: 7500 });
      form.reset();
    });
  }


  /* ---------------- managed content: advertisement area + owner photos ----------------
     The owner edits these at /admin/. They are saved to content/content.json, which is read here on every visit.
     If that file is missing or unreachable the page simply keeps its built-in default ad and photos. */
  const adSec = $('#ads'), adStage = $('#adStage'), adCtrl = $('#adCtrl'), adDots = $('#adDots');
  let adCur = 0, adTimer = null, adHold = false, adSecs = 7;
  const todayEAT = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' });
  const adLive = a => {
    if (!a || !a.enabled || !(a.title || a.image)) return false;
    const t = todayEAT();
    return !(a.start && t < a.start) && !(a.end && t > a.end);
  };
  const safeSrc = p => (typeof p === 'string' && /^uploads\/(ads|photos)\/[\w.-]+$/.test(p)) ? p : '';
  function adTarget(a) {
    if (a.link === 'call') return { href: 'tel:' + K.tel, cls: 'js-call', ic: 'phone' };
    if (a.link === 'contact') return { href: '#contact', cls: '', ic: 'arrow' };
    if (a.link === 'url' && /^https?:\/\//i.test(a.url || '')) return { href: a.url, cls: '', ic: 'arrow', ext: true, sponsored: true };
    return { href: waUrl(`Hello Kush Welding Services, I saw your offer${a.title ? ': "' + a.title + '"' : ''}. I would like to know more.`), cls: 'js-wa', ic: 'whatsapp', ext: true };
  }
  function mk(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; }
  function aLink(t, cls) {
    const l = mk('a', cls + (t.cls ? ' ' + t.cls : ''));
    l.href = t.href;
    if (t.ext) { l.target = '_blank'; l.rel = t.sponsored ? 'sponsored noopener noreferrer' : 'noopener'; }
    return l;
  }
  function adSlide(a, i) {
    const only = !!(a.image && a.imageOnly), t = adTarget(a);
    const s = mk('div', 'ad-slide' + (i === 0 ? ' on' : '') + (only ? ' only' : ''));
    s.dataset.i = i;
    const img = safeSrc(a.image), mob = safeSrc(a.mobile);
    if (img) {
      const pic = document.createElement('picture');
      if (mob) { const so = document.createElement('source'); so.media = '(max-width:720px)'; so.srcset = mob; pic.appendChild(so); }
      const im = new Image(); im.src = img; im.alt = only ? (a.title || 'Advertisement') : ''; im.decoding = 'async'; if (i > 0) im.loading = 'lazy';
      if (a.imageW && a.imageH) { im.width = a.imageW; im.height = a.imageH; }
      pic.appendChild(im); s.appendChild(pic);
    } else { const pl = mk('div', 'ad-plate'); pl.setAttribute('aria-hidden', 'true'); s.appendChild(pl); }
    if (only) {
      const l = aLink(t, 'ad-link'); l.setAttribute('aria-label', (a.title || 'Advertisement') + ': learn more'); s.appendChild(l);
      return s;
    }
    s.appendChild(mk('div', 'ad-shade'));
    const body = mk('div', 'ad-body');
    if (a.title) body.appendChild(mk('h3', '', a.title));
    if (a.text) body.appendChild(mk('p', '', a.text));
    const btn = aLink(t, 'btn btn-gold btn-lg');
    btn.innerHTML = `${icon(t.ic)}<span></span>`;
    $('span', btn).textContent = a.button || 'Learn more';
    body.appendChild(btn); s.appendChild(body);
    return s;
  }
  function showAd(n) {
    const slides = $$('.ad-slide', adStage); if (!slides.length) return;
    adCur = (n + slides.length) % slides.length;
    slides.forEach((s, i) => s.classList.toggle('on', i === adCur));
    $$('button', adDots).forEach((b, i) => b.classList.toggle('on', i === adCur));
    queueAd();
  }
  function queueAd() {
    clearTimeout(adTimer);
    if (reduce || $$('.ad-slide', adStage).length < 2) return;
    adTimer = setTimeout(() => { if (adHold || document.hidden) queueAd(); else showAd(adCur + 1); }, adSecs * 1000);
  }
  if (adSec) {
    const hold = v => () => { adHold = v; };
    adSec.addEventListener('mouseenter', hold(true)); adSec.addEventListener('mouseleave', hold(false));
    adSec.addEventListener('focusin', hold(true)); adSec.addEventListener('focusout', hold(false));
    $('#adPrev').addEventListener('click', () => showAd(adCur - 1));
    $('#adNext').addEventListener('click', () => showAd(adCur + 1));
  }
  function renderAds(c) {
    if (!adSec) return;
    const st = (c && c.adSettings) || {};
    const live = ((c && c.ads) || []).filter(adLive);
    adSecs = [4, 5, 7, 10, 15].includes(+st.seconds) ? +st.seconds : 7;
    if (!live.length) {
      if (st.empty === 'hide') { adSec.hidden = true; adSec.dataset.state = 'hidden'; return; }
      adSec.hidden = false; adSec.dataset.state = 'default'; adCtrl.hidden = true; return;   // keep the pre-rendered default promo
    }
    adStage.textContent = ''; adDots.textContent = '';
    live.forEach((a, i) => {
      adStage.appendChild(adSlide(a, i));
      const d = mk('button', ''); d.type = 'button'; d.setAttribute('aria-label', `Show advertisement ${i + 1}`);
      d.addEventListener('click', () => showAd(i)); adDots.appendChild(d);
    });
    adCtrl.hidden = live.length < 2;
    adSec.hidden = false; adSec.dataset.state = 'custom';
    showAd(0);
  }

  const NEW_DAYS = 14;
  function pjFrom(p) {
    const fig = mk('figure', 'pj fade');
    fig.dataset.cats = (p.cats || []).join(' '); fig.dataset.title = p.title; fig.dataset.tag = p.tag; fig.dataset.id = p.id; fig.dataset.full = p.file; fig.dataset.owner = '1';
    const btn = mk('button', 'pj-btn'); btn.type = 'button'; btn.setAttribute('aria-label', 'View larger: ' + p.title);
    const im = new Image(); im.src = safeSrc(p.thumb) || p.file; im.alt = p.alt || p.title; im.loading = 'lazy'; im.decoding = 'async';
    if (p.w && p.h) { im.width = p.w; im.height = p.h; }
    btn.appendChild(im);
    if (p.added && Date.now() / 1000 - p.added < NEW_DAYS * 86400) btn.appendChild(mk('span', 'pj-new', 'New'));
    const cap = mk('span', 'pj-cap'); cap.appendChild(mk('small', '', p.tag)); cap.appendChild(mk('b', '', p.title)); btn.appendChild(cap);
    const z = mk('span', 'pj-zoom'); z.innerHTML = icon('zoom'); btn.appendChild(z);
    fig.appendChild(btn);
    return fig;
  }
  function renderPhotos(c) {
    $$('.pj[data-owner]', grid).forEach(f => f.remove());
    const hidden = new Set((c && c.hidden) || []);
    $$('.pj', grid).forEach(f => { f.dataset.off = hidden.has(f.dataset.id) ? '1' : '0'; });
    const mine = ((c && c.photos) || []).filter(p => p && p.visible !== false && safeSrc(p.file) && p.title && Array.isArray(p.cats));
    if (mine.length) { const frag = document.createDocumentFragment(); mine.forEach(p => frag.appendChild(pjFrom(p))); grid.prepend(frag); }
    recount(); applyFilter(false);
  }

  if (adSec) adSec.dataset.state = 'loading';
  (async () => {
    let c = null;
    try {
      const ctl = 'AbortController' in window ? new AbortController() : null;
      const to = setTimeout(() => ctl && ctl.abort(), 4500);
      const r = await fetch(K.content || 'content/content.json', { cache: 'no-cache', signal: ctl ? ctl.signal : undefined });
      clearTimeout(to);
      if (r.ok) c = await r.json();
    } catch (e) { c = null; }
    try { renderAds(c); } catch (e) { if (adSec) { adSec.hidden = false; adSec.dataset.state = 'default'; } }
    try { renderPhotos(c); } catch (e) {}
  })();

  const yr = $('#yr'); if (yr) yr.textContent = new Date().getFullYear();
})();
