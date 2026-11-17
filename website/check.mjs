import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pages } from './pages.mjs';
import { assets, csp } from './resources.mjs';
import { renderProjectsPopup } from './lib/projects-popup-render.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const origin = 'https://agent-personalizer.aunysillyme.dev';
const read = file => readFileSync(join(root, file), 'utf8');
const assert = (condition, message) => { if (!condition) throw Error(message); };
const decodeAttr = s => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

const rows = JSON.parse(read('.repo-build/set.json')).rows;
const popup = renderProjectsPopup({ rows, current: 'agent-personalizer', id: 'projects-popup', fallbackHref: 'https://aunysillyme.dev/#projects' });
assert(rows.some(row => row.name === 'agent-personalizer'), 'Current project missing from set');
assert(popup.includes('aria-current="page"') && popup.includes('href="https://aunysillyme.dev/#projects"'), 'Popup current or fallback missing');
for (const asset of assets) assert(existsSync(join(root, 'website/assets', asset)), `Missing asset: ${asset}`);

const titles = new Set();
const descriptions = new Set();
for (const page of pages) {
  assert(page.title && page.description && page.h1, `Missing page metadata: ${page.route}`);
  assert(page.title.length <= 60, `Title exceeds 60 chars (${page.title.length}): ${page.route}`);
  assert(page.description.length >= 130 && page.description.length <= 155, `Description length ${page.description.length} outside 130-155: ${page.route}`);
  assert(!titles.has(page.title), `Duplicate title: ${page.route}`);
  assert(!descriptions.has(page.description), `Duplicate description: ${page.route}`);
  titles.add(page.title);
  descriptions.add(page.description);
  for (const source of page.sources) assert(existsSync(join(root, source)), `Missing source: ${source}`);
}

const config = JSON.parse(read('vercel.json'));
assert(config.buildCommand === 'node website/build.mjs --live && node website/check.mjs --live', 'vercel.json buildCommand must run --live unconditionally');
assert(config.headers.some(group => group.headers.some(header => header.key === 'Content-Security-Policy' && header.value === csp)), 'CSP header mismatch');
assert(config.headers.some(group => group.source === '/(.*\\.md)' && group.headers.some(header => header.key === 'Content-Type' && header.value === 'text/markdown; charset=utf-8')), 'Markdown Content-Type header missing in vercel.json');

const live = process.argv.includes('--live');

if (process.argv.includes('--source')) {
  console.log('Source checks passed.');
} else {
  assert(existsSync(join(root, 'website/dist/favicon.ico')), 'Missing website/dist/favicon.ico');
  assert(existsSync(join(root, 'website/dist/404.html')), 'Missing website/dist/404.html');
  assert(read('website/dist/404.html').includes('name="robots" content="noindex"'), '404.html missing noindex');

  for (const page of pages) {
    const html = read(`website/dist/${page.route.slice(1)}index.html`);
    assert(!html.includes('\u2014'), `Em dash in HTML: ${page.route}`);
    assert(html.includes('data-projects-trigger') && html.includes('href="https://aunysillyme.dev/#projects"'), `Popup missing: ${page.route}`);
    assert(html.includes('/assets/projects-popup.js') && html.includes('/assets/projects-popup.css'), `Popup assets missing: ${page.route}`);
    assert(!/<script\b(?![^>]*\bsrc=|[^>]*\btype="application\/ld\+json")/i.test(html), `Inline script: ${page.route}`);
    assert((html.match(/<h1\b/g) || []).length === 1, `Expected one H1: ${page.route}`);
    assert(html.includes('href="/favicon.ico"'), `Missing /favicon.ico link: ${page.route}`);

    const renderedTitle = decodeAttr(html.match(/<title>([^<]+)<\/title>/)?.[1] || '');
    const renderedDesc = decodeAttr(html.match(/<meta name="description" content="([^"]+)">/)?.[1] || '');
    assert(renderedTitle === page.title, `Title mismatch: ${page.route}`);
    assert(renderedDesc === page.description, `Description mismatch: ${page.route}`);

    if (live) {
      assert(!html.includes('noindex'), `Unexpected noindex in live build: ${page.route}`);
      for (const expected of [
        `href="${origin}${page.route}"`,
        `href="${origin}${page.route}index.md"`,
        `href="${origin}/llms.txt"`,
        `href="${origin}/sitemap.xml"`,
        `content="${origin}/assets/social-preview.png"`,
        'property="og:site_name" content="AunySillyMe.dev"',
        'property="og:image:width" content="1200"',
        'property="og:image:height" content="630"',
        'name="twitter:card" content="summary_large_image"',
        'name="twitter:site" content="@AunySillyMe"',
        'type="application/ld+json"',
      ]) {
        assert(html.includes(expected), `Missing ${expected} on ${page.route}`);
      }
      const ldMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
      assert(ldMatch, `Missing JSON-LD script on ${page.route}`);
      const ld = JSON.parse(ldMatch[1]);
      assert(Array.isArray(ld['@graph']) && ld['@graph'].length > 0, `Invalid JSON-LD @graph on ${page.route}`);
      const types = new Set(ld['@graph'].map(item => item['@type']));
      if (page.route === '/') {
        for (const t of ['SoftwareSourceCode', 'SoftwareApplication', 'Person']) assert(types.has(t), `Missing ${t} on /`);
      } else {
        assert(types.has('BreadcrumbList'), `Missing BreadcrumbList on ${page.route}`);
      }
    }
  }

  if (live) {
    const robots = read('website/dist/robots.txt');
    assert(robots.includes('Allow: /') && !robots.includes('Disallow: /') && robots.includes(`Sitemap: ${origin}/sitemap.xml`), 'Invalid live robots.txt');

    const sitemap = read('website/dist/sitemap.xml');
    const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
    assert(locs.length === pages.length && sitemap.includes('<lastmod>'), 'Invalid live sitemap.xml');
    assert(!locs.some(u => u.endsWith('.md') || u.endsWith('.txt') || u.includes('404')), 'Non-canonical URL in sitemap.xml');

    const mdTwins = pages.map(p => `${p.route.slice(1)}index.md`);
    for (const file of ['llms.txt', 'llms-full.txt', 'AGENTS.md', 'agents.md', ...mdTwins]) {
      assert(existsSync(join(root, 'website/dist', file)), `Missing live file: ${file}`);
      const text = read(`website/dist/${file}`);
      assert(!text.includes('\u2014'), `Em dash in ${file}`);
      assert(!/\]\((?!https?:\/\/)/i.test(text), `Relative Markdown link in ${file}`);
    }
    for (const twin of mdTwins) {
      assert(read(`website/dist/${twin}`).startsWith(`Canonical: ${origin}/`), `Missing Canonical header in ${twin}`);
    }
  }

  console.log(`Checked ${pages.length} generated pages (${live ? 'live' : 'default'}).`);
}
