// Public: serves the photos and ad pictures the owner uploaded (stored in Netlify Blobs).
import { mediaStore } from '../lib/content-store.mjs';

const TYPES = { webp: 'image/webp', jpg: 'image/jpeg', png: 'image/png' };

export default async (req, context) => {
  const { folder, name } = context.params || {};
  if (!/^(photos|ads)$/.test(folder || '') || !/^[a-z0-9_-]+\.(webp|jpg|png)$/.test(name || '')) {
    return new Response('Not found', { status: 404 });
  }
  const hit = await (await mediaStore()).getBin(`${folder}/${name}`);
  if (!hit) return new Response('Not found', { status: 404 });
  const ext = name.split('.').pop();
  return new Response(hit.data, {
    headers: {
      'Content-Type': hit.metadata.contentType || TYPES[ext],
      'X-Content-Type-Options': 'nosniff',
      // File names are unique, so photos can be cached for a long time.
      'Cache-Control': 'public, max-age=2592000',
      'Netlify-CDN-Cache-Control': 'public, s-maxage=31536000',
    },
  });
};

export const config = { path: '/uploads/:folder/:name', method: 'GET' };
