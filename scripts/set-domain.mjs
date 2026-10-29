// Runs on every Netlify build. Replaces the placeholder web address (https://kushwelding.co.ke) in the
// site files with your real one, so canonical links, the sitemap and social previews are correct.
// Uses SITE_DOMAIN if you set it, otherwise Netlify's own URL variable (your custom domain once you add one).
import fs from 'node:fs';
import path from 'node:path';

const PLACEHOLDER = 'https://kushwelding.co.ke';
const raw = (process.env.SITE_DOMAIN || process.env.URL || '').trim().replace(/\/+$/, '');
if (!raw) { console.log('set-domain: no URL available, leaving the placeholder address.'); process.exit(0); }
const target = /^https?:\/\//i.test(raw) ? raw : 'https://' + raw;

let changed = 0;
const walk = (dir) => {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) { walk(p); continue; }
    if (!/\.(html|xml|txt|json|webmanifest|js)$/i.test(name)) continue;
    const s = fs.readFileSync(p, 'utf8');
    if (!s.includes(PLACEHOLDER)) continue;
    fs.writeFileSync(p, s.split(PLACEHOLDER).join(target));
    changed++;
  }
};
walk(new URL('../public', import.meta.url).pathname);
console.log(`set-domain: now using ${target} (${changed} files updated)`);
