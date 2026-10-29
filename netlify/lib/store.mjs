// Storage layer. In production this is Netlify Blobs (included with every Netlify site, nothing to set up).
// For local tests only, KUSH_DEV_STORE=<folder> switches to a plain-folder stand-in with the same interface.
const cache = new Map();

/** Returns { getJSON, setJSON, getBin, setBin, del, list, meta } for a named store. */
export async function openStore(name) {
  if (cache.has(name)) return cache.get(name);
  let s;
  if (process.env.KUSH_DEV_STORE) {
    const { devStore } = await import('./dev-store.mjs');
    s = devStore(process.env.KUSH_DEV_STORE, name);
  } else {
    // "strong" = changes are visible straight away (the default can take up to a minute).
    const { getStore } = await import('@netlify/blobs');
    const st = getStore({ name, consistency: 'strong' });
    s = {
      getJSON: async (key) => (await st.get(key, { type: 'json' })) ?? null,
      setJSON: async (key, value) => { await st.setJSON(key, value); },
      getBin: async (key) => {
        const r = await st.getWithMetadata(key, { type: 'arrayBuffer' });
        return r ? { data: new Uint8Array(r.data), metadata: r.metadata || {} } : null;
      },
      setBin: async (key, bytes, metadata = {}) => {
        // Blobs stores an ArrayBuffer: copy exactly the bytes of this file (a Node Buffer can be a view into a larger pool).
        const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        await st.set(key, ab, { metadata });
      },
      del: async (key) => { await st.delete(key); },
      list: async (prefix) => {
        const out = [];
        const r = await st.list({ prefix });
        for (const b of r.blobs || []) out.push(b.key);
        return out;
      },
      meta: async (key) => {
        const r = await st.getMetadata(key);
        return r ? (r.metadata || {}) : null;
      },
    };
  }
  cache.set(name, s);
  return s;
}
