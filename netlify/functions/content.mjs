// Public: the website reads the owner's ads and photos from here on every visit.
import { readContent } from '../lib/content-store.mjs';
import { defaultContent, publicContent } from '../lib/util.mjs';

export default async () => {
  let body;
  try { body = publicContent(await readContent()); } catch { body = defaultContent(); } // never break the public site
  return new Response(JSON.stringify(body), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=0, must-revalidate',
      'Netlify-CDN-Cache-Control': 'public, s-maxage=10',
      'X-Content-Type-Options': 'nosniff',
    },
  });
};

export const config = { path: '/content/content.json', method: 'GET' };
