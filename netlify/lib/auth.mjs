// Owner login: scrypt password hashes, signed session cookie, CSRF token, lockout after 5 wrong tries.
import { scrypt, randomBytes, createHmac, createHash, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { openStore } from './store.mjs';

const scryptAsync = promisify(scrypt);
const COOKIE = 'kush_admin';
const IDLE_MS = 12 * 60 * 60 * 1000;

// Starting password hash. The owner is made to choose their own password at first login,
// and can be reset any time with the ADMIN_PASSWORD setting (see README).
const INITIAL_HASH = 'scrypt$16384$8$1$p-tSIHwd1uYOV5rJm3_iag$3o-frPoOTQpEbS-75RwYRP8Ed8JpAGp4zd7HrahhVmk';

const priv = () => openStore('kush-private');
const b64 = (buf) => Buffer.from(buf).toString('base64url');
const safeEq = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

export async function hashPassword(pw) {
  const salt = randomBytes(16);
  const h = await scryptAsync(pw.normalize('NFKC'), salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$16384$8$1$${b64(salt)}$${b64(h)}`;
}
export async function verifyHash(pw, stored) {
  const [alg, N, r, p, salt, hash] = String(stored).split('$');
  if (alg !== 'scrypt' || !hash) return false;
  const want = Buffer.from(hash, 'base64url');
  const got = await scryptAsync(pw.normalize('NFKC'), Buffer.from(salt, 'base64url'), want.length, { N: +N, r: +r, p: +p, maxmem: 64 * 1024 * 1024 });
  return got.length === want.length && timingSafeEqual(got, want);
}

/* ---------- secret used to sign sessions (created once, kept private) ---------- */
let secretCache = null;
export async function secret() {
  if (secretCache) return secretCache;
  const s = await priv();
  let rec = await s.getJSON('secret.json');
  if (!rec || !rec.secret) {
    rec = { secret: randomBytes(32).toString('hex') };
    await s.setJSON('secret.json', rec);
    rec = (await s.getJSON('secret.json')) || rec; // if two requests raced, use whichever was stored
  }
  secretCache = rec.secret;
  return secretCache;
}

/* ---------- which password is currently valid ---------- */
const tagOf = (pw) => createHash('sha256').update(pw).digest('hex').slice(0, 16);
/** Returns { kind, mustChange, v, check(pw) } */
export async function activeAuth() {
  const stored = (await (await priv()).getJSON('auth.json')) || null;
  const v = stored?.v || 0;
  const envPw = process.env.ADMIN_PASSWORD || '';
  // A new ADMIN_PASSWORD value acts as a password reset until the owner picks their own password.
  if (envPw && (!stored || stored.consumed !== tagOf(envPw))) {
    return { kind: 'env', mustChange: true, v, check: async (pw) => safeEq(pw, envPw) };
  }
  if (stored?.hash) return { kind: 'stored', mustChange: !!stored.mustChange, v, check: (pw) => verifyHash(pw, stored.hash) };
  return { kind: 'initial', mustChange: true, v, check: (pw) => verifyHash(pw, INITIAL_HASH) };
}
export async function savePassword(newPw, prev) {
  const rec = {
    hash: await hashPassword(newPw), mustChange: false, v: (prev?.v || 0) + 1,
    consumed: process.env.ADMIN_PASSWORD ? tagOf(process.env.ADMIN_PASSWORD) : '', changed: new Date().toISOString(),
  };
  await (await priv()).setJSON('auth.json', rec);
  return rec.v;
}

/* ---------- sessions ---------- */
const sign = async (payload) => b64(createHmac('sha256', await secret()).update(payload).digest());
export async function makeCookie(session, secure) {
  const payload = b64(JSON.stringify(session));
  const sig = await sign(payload);
  return `${COOKIE}=${payload}.${sig}; Path=/; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`;
}
export const clearCookie = (secure) => `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`;
export const isSecure = (req) => new URL(req.url).protocol === 'https:' || req.headers.get('x-forwarded-proto') === 'https';

function readCookie(req) {
  const m = (req.headers.get('cookie') || '').match(new RegExp('(?:^|;\\s*)' + COOKIE + '=([^;]+)'));
  return m ? m[1] : '';
}
/** Returns { sid, v, t } for a valid, current session, otherwise null. */
export async function readSession(req, auth) {
  const raw = readCookie(req);
  const [payload, sig] = raw.split('.');
  if (!payload || !sig) return null;
  if (!safeEq(sig, await sign(payload))) return null;
  let s;
  try { s = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { return null; }
  if (!s || typeof s.sid !== 'string' || typeof s.t !== 'number') return null;
  if (Date.now() - s.t > IDLE_MS) return null;
  if (s.v !== auth.v) return null; // password changed: older sessions end
  const revoked = (await (await priv()).getJSON('revoked.json')) || {};
  if (revoked[s.sid]) return null;  // logged out
  return s;
}
/** Logging out ends the session on the server too, not just in the browser. */
export async function revokeSession(sid) {
  const st = await priv(), now = Date.now();
  const d = (await st.getJSON('revoked.json')) || {};
  for (const k of Object.keys(d)) if (now - d[k] > 2 * IDLE_MS) delete d[k];
  d[sid] = now;
  await st.setJSON('revoked.json', d);
}
export const newSession = (v) => ({ sid: randomBytes(12).toString('hex'), t: Date.now(), v });
export async function csrfFor(session) {
  return createHmac('sha256', await secret()).update('csrf:' + session.sid).digest('hex').slice(0, 48);
}
export async function csrfOk(req, session) {
  const sent = req.headers.get('x-csrf') || '';
  return sent !== '' && safeEq(sent, await csrfFor(session));
}

/* ---------- login throttle: 5 wrong passwords = 15 minute lock, per IP ---------- */
const ipKey = (ip) => 'ip-' + createHash('sha256').update(String(ip || '0')).digest('hex').slice(0, 16);
export async function throttleState(ip) {
  const d = (await (await priv()).getJSON('throttle.json')) || {};
  const e = d[ipKey(ip)] || { n: 0, until: 0 };
  const left = Math.max(0, (e.until || 0) - Date.now());
  return { locked: left > 0, waitMin: Math.max(1, Math.ceil(left / 60000)), left: Math.max(0, 5 - (e.n || 0)) };
}
export async function throttleFail(ip) {
  const s = await priv(), now = Date.now();
  const d = (await s.getJSON('throttle.json')) || {};
  for (const k of Object.keys(d)) if ((d[k].t || 0) < now - 86400000) delete d[k];
  let e = d[ipKey(ip)] || { n: 0, until: 0 };
  if (e.until && e.until < now) e = { n: 0, until: 0 };
  e.n += 1; e.t = now;
  if (e.n >= 5) e.until = now + 15 * 60000;
  d[ipKey(ip)] = e;
  await s.setJSON('throttle.json', d);
}
export async function throttleClear(ip) {
  const s = await priv();
  const d = (await s.getJSON('throttle.json')) || {};
  delete d[ipKey(ip)];
  await s.setJSON('throttle.json', d);
}
