// Local stand-in for Netlify Blobs, used only by the tests (KUSH_DEV_STORE). Not used on Netlify.
import fs from 'node:fs/promises';
import path from 'node:path';

export function devStore(root, name) {
  const dir = path.join(root, name);
  const file = (key) => path.join(dir, encodeURIComponent(key));
  const ensure = () => fs.mkdir(dir, { recursive: true });
  const read = async (key) => {
    try {
      const raw = await fs.readFile(file(key));
      let metadata = {};
      try { metadata = JSON.parse(await fs.readFile(file(key) + '.meta', 'utf8')); } catch { /* none */ }
      return { data: new Uint8Array(raw), metadata };
    } catch { return null; }
  };
  return {
    getJSON: async (key) => { const r = await read(key); return r ? JSON.parse(Buffer.from(r.data).toString('utf8')) : null; },
    setJSON: async (key, v) => { await ensure(); await fs.writeFile(file(key), JSON.stringify(v)); },
    getBin: read,
    setBin: async (key, bytes, metadata = {}) => { await ensure(); await fs.writeFile(file(key), bytes); await fs.writeFile(file(key) + '.meta', JSON.stringify(metadata)); },
    del: async (key) => { await fs.rm(file(key), { force: true }); await fs.rm(file(key) + '.meta', { force: true }); },
    list: async (prefix = '') => {
      try {
        return (await fs.readdir(dir)).filter((f) => !f.endsWith('.meta')).map(decodeURIComponent).filter((k) => k.startsWith(prefix));
      } catch { return []; }
    },
    meta: async (key) => { const r = await read(key); return r ? r.metadata : null; },
  };
}
