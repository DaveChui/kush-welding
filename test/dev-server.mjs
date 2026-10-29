// Tiny local stand-in for Netlify: serves public/ and routes the three functions. Tests and previews only.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.xml': 'application/xml', '.txt': 'text/plain', '.webmanifest': 'application/manifest+json' };

export async function startDevServer({ port = 0, storeDir }) {
  process.env.KUSH_DEV_STORE = storeDir;
  const admin = (await import('../netlify/functions/admin-api.mjs')).default;
  const content = (await import('../netlify/functions/content.mjs')).default;
  const media = (await import('../netlify/functions/media.mjs')).default;

  const server = http.createServer(async (nreq, nres) => {
    const url = new URL(nreq.url, `http://${nreq.headers.host}`);
    const ip = nreq.headers['x-test-ip'] || nreq.socket.remoteAddress;
    let fn = null, params = {};
    if (url.pathname === '/api/admin') fn = admin;
    else if (url.pathname === '/content/content.json' && nreq.method === 'GET') fn = content;
    else {
      const m = url.pathname.match(/^\/uploads\/([^/]+)\/([^/]+)$/);
      if (m && nreq.method === 'GET') { fn = media; params = { folder: m[1], name: m[2] }; }
    }
    if (fn) {
      const body = ['GET', 'HEAD'].includes(nreq.method) ? undefined : nreq;
      const req = new Request(url, { method: nreq.method, headers: nreq.headers, body, duplex: 'half' });
      const res = await fn(req, { ip, params });
      const headers = {};
      for (const [k, v] of res.headers) if (k !== 'set-cookie') headers[k] = v;
      const cookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
      if (cookies.length) headers['set-cookie'] = cookies;
      nres.writeHead(res.status, headers);
      nres.end(Buffer.from(await res.arrayBuffer()));
      return;
    }
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    let file = path.join(root, 'public', rel);
    if (!file.startsWith(path.join(root, 'public'))) { nres.writeHead(403).end(); return; }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) { nres.writeHead(404, { 'content-type': 'text/html' }); nres.end(fs.readFileSync(path.join(root, 'public/404.html'))); return; }
    nres.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    nres.end(fs.readFileSync(file));
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  return { server, port: server.address().port, close: () => new Promise((r) => server.close(r)) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { port } = await startDevServer({ port: Number(process.env.PORT || 8890), storeDir: process.env.STORE || path.join(root, '.dev-store') });
  console.log('dev server on http://127.0.0.1:' + port);
}
