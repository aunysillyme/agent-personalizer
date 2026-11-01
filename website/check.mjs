import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pages } from './pages.mjs';
import { assets, csp } from './resources.mjs';
import { renderProjectsPopup } from './lib/projects-popup-render.mjs';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = file => readFileSync(join(root, file), 'utf8');
const assert = (condition, message) => { if (!condition) throw Error(message); };
const rows = JSON.parse(read('.repo-build/set.json')).rows;
const popup = renderProjectsPopup({ rows, current: 'agent-personalizer', id: 'projects-popup', fallbackHref: 'https://aunysillyme.dev/#projects' });
assert(rows.some(row => row.name === 'agent-personalizer'), 'Current project missing from set');
assert(popup.includes('aria-current="page"') && popup.includes('href="https://aunysillyme.dev/#projects"'), 'Popup current or fallback missing');
for (const asset of assets) assert(existsSync(join(root, 'website/assets', asset)), `Missing asset: ${asset}`);
for (const page of pages) {
  assert(page.title && page.description && page.h1, `Missing page metadata: ${page.route}`);
  for (const source of page.sources) assert(existsSync(join(root, source)), `Missing source: ${source}`);
}
const config = JSON.parse(read('vercel.json'));
assert(config.headers.some(group => group.headers.some(header => header.key === 'Content-Security-Policy' && header.value === csp)), 'CSP header mismatch');
if (process.argv.includes('--source')) {
  console.log('Source checks passed.');
} else {
  for (const page of pages) {
    const html = read(`website/dist/${page.route.slice(1)}index.html`);
    assert(html.includes('data-projects-trigger') && html.includes('href="https://aunysillyme.dev/#projects"'), `Popup missing: ${page.route}`);
    assert(html.includes('/assets/projects-popup.js') && html.includes('/assets/projects-popup.css'), `Popup assets missing: ${page.route}`);
    assert(!/<script\b(?![^>]*\bsrc=)/i.test(html), `Inline script: ${page.route}`);
    assert((html.match(/<h1\b/g) || []).length === 1, `Expected one H1: ${page.route}`);
  }
  console.log(`Checked ${pages.length} generated pages.`);
}
