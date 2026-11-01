import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, resolve, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { visibleText } from './facts.mjs';
import { renderProjectsPopup } from './lib/projects-popup-render.mjs';
import { pages } from './pages.mjs';
import { content } from './content.mjs';

const origin = 'https://agent-personalizer.aunysillyme.dev';
const repository = 'https://github.com/aunysillyme/agent-personalizer';
import { assets, media, fontStylesheet, csp } from './resources.mjs';
const read = (root, file) => readFileSync(join(root, file), 'utf8');
const json = (root, file) => JSON.parse(read(root, file));
const requireValue = (ok, message) => { if (!ok) throw Error(message); };
export const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const slug = text => visibleText(text).toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').trim().replace(/\s+/g, '-') || 'section';

function section(markdown, heading) {
  const start = markdown.indexOf(`## ${heading}\n`);
  requireValue(start >= 0, `README section missing: ${heading}`);
  const rest = markdown.slice(start);
  const end = rest.indexOf('\n## ');
  return (end < 0 ? rest : rest.slice(0, end)).trim();
}

function loadSourceFacts(root) {
  const pkg = json(root, 'package.json');
  return { name: pkg.name, description: pkg.description, version: pkg.version, repository, npm: `https://www.npmjs.com/package/${pkg.name}`, url: `${origin}/` };
}

function validatePages() {
  for (const page of pages) {
    requireValue(page.title && page.description && page.h1 && Array.isArray(page.sources), `Incomplete page: ${page.route}`);
  }
}

function sourceRoutes() {
  const routes = new Map();
  for (const page of pages.filter(page => page.route !== '/')) {
    for (const source of page.sources) if (!routes.has(source)) routes.set(source, page.route);
  }
  return routes;
}

export function rewriteUrl(href, source, { image = false, routes = sourceRoutes() } = {}) {
  if (!href || /[\u0000-\u0020\u007f\\]/.test(href)) return '';
  if (image) {
    const local = href.startsWith('/assets/') ? href.slice(8) : posix.normalize(posix.join(posix.dirname(source), href)).replace(/^website\/assets\//, '');
    return assets.includes(local) && /\.(?:png|svg)$/.test(local) ? `/assets/${local}` : '';
  }
  if (href.startsWith('#')) return href;
  if (/^https?:\/\//i.test(href)) return href;
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href)) return '';
  const [file, fragment] = href.split('#');
  const normalized = posix.normalize(file.startsWith('/') ? file.slice(1) : posix.join(posix.dirname(source), file));
  if (normalized === '..' || normalized.startsWith('../')) return '';
  const suffix = fragment ? `#${fragment}` : '';
  return routes.has(normalized) ? `${routes.get(normalized)}${suffix}` : `${repository}/blob/main/${normalized}${suffix}`;
}

function uniqueId(text, ids) {
  const base = slug(text);
  let id = base, count = 0;
  while (ids.has(id)) id = `${base}-${++count}`;
  ids.add(id);
  return id;
}

// Source HTML is data. Only tags constructed by this renderer reach the page.
export function renderMarkdown(markdown, { source = 'README.md', ids = new Set(), routes = sourceRoutes() } = {}) {
  const references = new Map();
  markdown = markdown.replace(/^---\n[^]*?\n---\n/, '').replace(/<!--[^]*?-->/g, '');
  markdown = markdown.replace(/^\[([^\]]+)\]:\s*(\S+).*$/gm, (_, label, href) => { references.set(label.toLowerCase(), href); return ''; });
  function inline(value, tokens = []) {
    const save = html => { tokens.push(html); return `\u0000${tokens.length - 1}\u0000`; };
    value = value.replace(/`([^`]+)`/g, (_, code) => save(`<code>${escape(code)}</code>`));
    value = value.replace(/<(script|style|iframe|object|svg)\b[^>]*>[^]*?<\/\1\s*>/gi, '').replace(/<\/?[a-z][^>]*>/gi, '');
    value = value.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, href) => {
      const src = rewriteUrl(href, source, { image: true, routes });
      return save(src ? `<img src="${escape(src)}" alt="${escape(alt)}" loading="lazy">` : '');
    });
    value = value.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
      const url = rewriteUrl(href, source, { routes });
      const rendered = inline(label, tokens);
      return save(rendered.trim() && url ? `<a href="${escape(url)}">${rendered}</a>` : rendered);
    });
    value = value.replace(/\[([^\]]+)\](?:\[([^\]]*)\])?/g, (whole, label, reference) => {
      const href = references.get((reference || label).toLowerCase());
      if (!href) return whole;
      const url = rewriteUrl(href, source, { routes });
      const rendered = inline(label, tokens);
      return save(rendered.trim() && url ? `<a href="${escape(url)}">${rendered}</a>` : rendered);
    });
    value = escape(value).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
    return value.replace(/\u0000(\d+)\u0000/g, (_, index) => tokens[Number(index)]);
  }
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    if (!line.trim()) { index++; continue; }
    if (/^\s*```/.test(line)) {
      const code = [];
      index++;
      while (index < lines.length && !/^\s*```/.test(lines[index])) code.push(lines[index++]);
      index++;
      blocks.push(`<pre><code>${escape(code.join('\n'))}</code></pre>`);
      continue;
    }
    // Drop active raw HTML blocks before joining their lines into paragraphs.
    if (/^\s*<(script|style|iframe|object|svg)\b/i.test(line)) {
      const tag = line.match(/<(\w+)/)[1];
      const raw = [];
      do { raw.push(lines[index]); if (new RegExp(`</${tag}\\s*>`, 'i').test(lines[index++])) break; } while (index < lines.length);
      const safe = inline(raw.join('\n'));
      if (safe.trim()) blocks.push(`<p>${safe}</p>`);
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const depth = Math.max(2, heading[1].length);
      const text = inline(heading[2]);
      blocks.push(`<h${depth} id="${uniqueId(text, ids)}">${text}</h${depth}>`);
      index++; continue;
    }
    if (/^\|/.test(line) && /^\|\s*:?-{3}/.test(lines[index + 1] || '')) {
      const cells = value => value.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(cell => inline(cell.trim().replace(/\\\|/g, '|')));
      const head = cells(line);
      index += 2;
      const rows = [];
      while (index < lines.length && /^\|/.test(lines[index])) rows.push(cells(lines[index++]));
      blocks.push(`<div class="table-scroll"><table><thead><tr>${head.map(cell => `<th scope="col">${cell}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    if (/^\s*(?:[-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line), items = [];
      const pattern = ordered ? /^\s*\d+\.\s+/ : /^\s*[-*]\s+/;
      while (index < lines.length && pattern.test(lines[index])) items.push(`<li>${inline(lines[index++].replace(pattern, ''))}</li>`);
      blocks.push(`<${ordered ? 'ol' : 'ul'}>${items.join('')}</${ordered ? 'ol' : 'ul'}>`);
      continue;
    }
    if (/^>/.test(line)) {
      const quote = [];
      while (index < lines.length && /^>/.test(lines[index])) quote.push(lines[index++].replace(/^>\s?/, ''));
      blocks.push(`<blockquote><p>${inline(quote.join('\n'))}</p></blockquote>`);
      continue;
    }
    if (/^\s*(?:---+|\*\*\*+)\s*$/.test(line)) { blocks.push('<hr>'); index++; continue; }
    const paragraph = [lines[index++]];
    while (index < lines.length && lines[index].trim() && !/^(?:#{1,6}\s|\s*```|\||>|\s*[-*]\s|\s*\d+\.\s|\s*<(?:script|style|iframe|object|svg)\b)/i.test(lines[index])) paragraph.push(lines[index++]);
    const rendered = inline(paragraph.join('\n'));
    if (rendered.trim()) blocks.push(`<p>${rendered}</p>`);
  }
  return blocks.join('\n');
}

// Border ray from https://aunysillyme.dev/; decorative on every card.
function cardTrace() {
  return '<svg class="card-trace" aria-hidden="true" focusable="false"><rect class="ray-tail" x=".5" y=".5" pathLength="100"/><rect class="ray-mid" x=".5" y=".5" pathLength="100"/><rect class="ray-tip" x=".5" y=".5" pathLength="100"/></svg>';
}

function proofTable(facts) {
  return `<div class="proof-card card">${cardTrace()}<div class="table-scroll"><table class="proof-table"><thead><tr><th scope="col">Claim</th><th scope="col">Value</th><th scope="col">Source</th></tr></thead><tbody><tr><th scope="row">Package version</th><td>${escape(facts.version)}</td><td><a href="${repository}/blob/main/package.json">package.json</a></td></tr><tr><th scope="row">Node requirement</th><td>${escape(json(fileURLToPath(new URL('..', import.meta.url)), 'package.json').engines.node)}</td><td><a href="${repository}/blob/main/package.json">package.json</a></td></tr></tbody></table></div></div>`;
}

function docsBody(root, page) {
  const ids = new Set(['main', 'page-title']);
  return `<article class="markdown">${page.sources.map(source => {
    let markdown = read(root, source).replace(/^# [^\n]+\n/, '');
    if (source === 'README.md') markdown = markdown.replace(/<!-- set:start -->[^]*?<!-- set:end -->/, `## Part of a set\n\n${siblings(root).map(link => `[${link.name}](${link.href})`).join(' · ')}`);
    return `<section class="source-section"><p class="source-note">${escape(content.sourceLabel)} <a href="${repository}/blob/main/${escape(source)}">${escape(source)}</a></p>${renderMarkdown(markdown, { source, ids })}</section>`;
  }).join('')}</article>`;
}

function siblings(root) {
  return json(root, '.repo-build/set.json').rows.filter(row => row.name !== 'agent-personalizer').map(row => ({ name: row.name, href: `https://${row.name}.aunysillyme.dev` }));
}

function flow() {
  return `<div class="routing card" id="flow">${cardTrace()}<div class="routing-head"><span>${escape(content.scene.title)}</span><span>${escape(content.scene.label)}</span></div><div class="route-core selected card">${escape(content.flow.core)}</div><div class="split"></div><div class="route-options">${content.flow.options.map(item => `<div class="card"><b>${escape(item.name)}</b>${escape(item.text)}</div>`).join('')}</div><p class="route-foot">${content.flow.foot}</p></div>`;
}

function landingBody(root, facts) {
  const heading = (title, id, body, label = '', classes = '') => `<section class="content ${classes}" id="${id}"><div class="section-title"><h2>${escape(title)}</h2>${label ? `<span>${escape(label)}</span>` : ''}</div>${body}</section>`;
  const release = readRelease(root, facts.version);

  return `<div class="crumb"><a href="https://aunysillyme.dev/">Home</a><span>/</span><b>${escape(facts.name)}</b></div>
<section class="hero" id="overview"><div><p class="eyebrow">${escape(content.eyebrow)}</p><h1>${escape(content.headline)}<br><em>${escape(content.headlineAccent)}</em></h1><p class="lede">${escape(content.heroContext)} ${escape(content.headlineSource)}</p><div class="install card">${cardTrace()}<span class="dollar" aria-hidden="true">$</span><code id="install-command">${escape(content.install.command)}</code><button class="copy card" type="button" data-copy="install-command" aria-label="${escape(content.install.copy)}" title="${escape(content.install.copy)}">⧉</button></div><p id="copy-status" role="status" class="sr-only" data-success="${escape(content.install.copySuccess)}" data-fallback="${escape(content.install.copyFallback)}"></p><div class="hero-actions"><a class="primary card" href="#quickstart">Get started ↓</a><a class="card" href="${repository}">Explore the source ↗</a></div></div>${flow(facts)}</section>
<div class="trust">${content.chips.map(chip => `<span>${escape(chip)}</span>`).join('')}</div>
${heading(content.sections.trailer, 'trailer', `<video autoplay muted loop playsinline preload="auto" width="1280" height="720" poster="/assets/trailer-poster.png" aria-label="agent-personalizer trailer" aria-describedby="trailer-note"><source src="/assets/trailer.mp4" type="video/mp4">Your browser does not support embedded video. <a href="/assets/trailer.mp4">Watch the trailer ↗</a></video><div class="trailer-caption"><p class="note" id="trailer-note">${escape(content.trailer.caption)}</p><button type="button" class="trailer-toggle" aria-pressed="false" aria-label="Play trailer"><svg class="icon-pause" viewBox="0 0 12 12" aria-hidden="true" focusable="false"><rect x="2" y="1.5" width="3" height="9"/><rect x="7" y="1.5" width="3" height="9"/></svg><svg class="icon-play" viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M3 1.5v9l7.5-4.5z"/></svg><span class="sr-only" data-button-label>Play trailer</span></button></div>`, 'TRAILER', 'trailer')}
${heading(content.columnsTitle, 'how-it-works', `<div class="three">${content.columns.map((column, index) => `<article class="card">${cardTrace()}<div class="feature-num">${String(index + 1).padStart(2, '0')} / ${escape(column.label)}</div><h3>${escape(column.title)}</h3><p>${escape(column.text)}</p><a href="${escape(column.href)}">${escape(column.link)} ↗</a></article>`).join('')}</div>`, content.sectionLabels.how)}
${heading(content.install.title, 'quickstart', `<div class="docs-grid"><div>${content.install.steps.map((step, index) => `<div class="step"><b>${String(index + 1).padStart(2, '0')}</b><div>${escape(step.title)}<p>${escape(step.text)}</p></div></div>`).join('')}</div><div><div class="code card">${cardTrace()}<pre><code>${escape(content.install.commands.join('\n\n'))}</code></pre></div><p class="note">${escape(content.install.note)}<br><a href="/docs/install/">${escape(content.install.guide)} ↗</a></p></div></div>`, content.sectionLabels.install)}
${heading(content.deeper.title, 'reference', `<div class="docs-links">${content.deeper.cards.map(card => `<a class="doc-link card" href="${escape(card.href)}">${cardTrace()}${escape(card.title)} ↗<span>${escape(card.text)}</span></a>`).join('')}</div>`, content.sectionLabels.deeper)}
${heading(content.sections.evidence, 'proof', `${proofTable(facts)}<div class="docs-grid"><p class="note">${escape(content.proof.intro)} ${escape(content.proof.note)}</p><div class="hero-actions"><a class="primary card" href="/docs/proof/">${escape(content.proof.details)} ↗</a><a class="card" href="/docs/guarantees/">${escape(content.proof.guarantees)} ↗</a></div></div>`, content.sectionLabels.evidence)}
${heading(content.sections.fresh, 'releases', `<div class="release"><strong>v${escape(release.version)}<small>${release.fallback ? 'last verified release' : release.verified ? '' : escape(content.release.pending)}</small></strong><div class="release-copy"><p>${escape(content.release.text)}</p><a href="/docs/changelog/">${escape(content.release.changelog)} ↗</a></div></div>`, content.sectionLabels.fresh)}
${heading(content.sections.requirements, 'requirements', `<div class="requirements">${content.requirements.map(item => `<article class="card">${cardTrace()}<h3>${escape(item.title)}</h3><p>${escape(item.text)}</p></article>`).join('')}</div>`)}

${heading(content.sections.set, 'set', `<p class="note">${siblings(root).map(link => `<a href="${escape(link.href)}">${escape(link.name)} ↗</a>`).join(' · ')}</p>`)}
`;
}

function readRelease(root, version) {
  if (!existsSync(join(root, 'website/release.json'))) {
    const fallback = json(root, 'website/release-fallback.json');
    requireValue(fallback.name === 'agent-personalizer' && /^\d+\.\d+\.\d+$/.test(fallback.version), 'Invalid release fallback');
    return { version: fallback.version, verified: true, fallback: true };
  }
  const release = json(root, 'website/release.json');
  if (release.verified !== true) return { version, verified: false };
  requireValue(typeof release.version === 'string' && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(release.version), 'Invalid verified release version');
  return release;
}

function navLinks(page) {
  return page.route === '/' ? content.nav.map(link => `<a href="${escape(link.href)}"${link.href === '#overview' ? ' class="active" aria-current="location"' : ''}>${escape(link.label)}</a>`).join('\n')
    : pages.filter(item => item.route !== '/').map(item => `<a href="${item.route}"${item.route === page.route ? ' class="active" aria-current="page"' : ''}>${escape(item.h1)}</a>`).join('\n');
}

function sidebar(root, page) {
  return `<p class="side-label">${page.route === '/' ? escape(content.brand.toUpperCase()) : 'DOCUMENTATION'}</p><nav class="side-links" aria-label="Documentation">${navLinks(page)}</nav><p class="side-label">THE REST OF THE SET</p><nav class="side-links" aria-label="Related repositories">${siblings(root).map(link => `<a href="${escape(link.href)}" target="_blank" rel="noopener noreferrer">${escape(link.name)} ↗</a>`).join('')}</nav><div class="side-bottom"><div>Questions or feedback?</div><a class="issue-button" href="${repository}/issues/new/choose" aria-label="File an issue for agent-personalizer on GitHub">File an issue ↗</a><span>Open source · MIT license</span></div>`;
}

function head(page, facts, live, notFound = false) {
  const url = `${origin}${page.route}`;
  const blocks = [];


  return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta http-equiv="Content-Security-Policy" content="${escape(csp)}">
<title>${escape(page.title)}</title>
<meta name="description" content="${escape(page.description)}">
<link rel="canonical" href="${url}">
${!live || notFound ? '<meta name="robots" content="noindex">' : `<link rel="describedby" href="${origin}/llms.txt">
<link rel="alternate" type="text/markdown" href="${url}index.md">
<meta property="og:type" content="website">
<meta property="og:title" content="${escape(page.title)}">
<meta property="og:description" content="${escape(page.description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${origin}/assets/avatar.png">
<meta property="og:image:alt" content="${escape(content.socialAlt)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escape(page.title)}">
<meta name="twitter:description" content="${escape(page.description)}">
<meta name="twitter:image" content="${origin}/assets/avatar.png">
<meta name="twitter:image:alt" content="${escape(content.socialAlt)}">`}
<link rel="icon" href="/assets/avatar.png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="${escape(fontStylesheet)}" rel="stylesheet">
<link rel="stylesheet" href="/assets/site.css">
<link rel="stylesheet" href="/assets/projects-popup.css">
<script defer src="/assets/projects-popup.js"></script>
<script src="/assets/site.js" defer></script>
<script type="module" src="/assets/navigation.js"></script>
<script type="module" src="/assets/trailer.js"></script>
`;
}

function footer(commit) {
  return `<footer class="bottom"><span>Built by <a href="https://aunysillyme.dev/">AunySillyMe</a> · ${escape(content.footer.text)}</span><a href="${repository}">${escape(content.footer.repository)} ↗</a><span>${escape(content.footer.source)} <a href="${repository}/commit/${commit}">${commit.slice(0, 7)}</a></span></footer>`;
}

function documentBody(page, body) {
  const sourceNote = body.match(/<p class="source-note">[^]*?<\/p>/)?.[0] || '';
  body = body.replace(sourceNote, '');
  return `<nav class="crumb" aria-label="${escape(content.breadcrumbs.label)}"><a href="/">${escape(content.breadcrumbs.home)}</a><span aria-hidden="true">/</span><a href="/docs/overview/">${escape(content.breadcrumbs.section)}</a><span aria-hidden="true">/</span><span aria-current="page">${escape(page.h1)}</span></nav>${sourceNote}<h1 class="document-title" id="page-title">${escape(page.h1)}</h1>${body}`;
}

function template(root, page, body, facts, live, commit, notFound = false) {
  const file = page.route === '/' && !notFound ? 'landing.template.html' : 'doc.template.html';
  const header = `<a class="skip" href="#main">${escape(content.skip)}</a><header class="top"><a class="brand" href="${page.route === '/' ? 'https://aunysillyme.dev/' : '/'}"><img src="/assets/avatar.png" alt="AunySillyMe"><span>${page.route === '/' ? 'AunySillyMe.dev' : escape(content.brand)}</span>${page.route === '/' ? `<span class="slash">/</span><b>${escape(content.brand)}</b>` : ''}</a><nav class="topnav" aria-label="${escape(content.projectLinks)}">${page.route === '/' ? `<span class="pill"><i class="dot"></i><span>v${escape(facts.version)}</span></span>` : '<a href="/">Home</a>'}${renderProjectsPopup({ rows: json(root, '.repo-build/set.json').rows, current: 'agent-personalizer', id: 'projects-popup', fallbackHref: 'https://aunysillyme.dev/#projects' })}<a href="${repository}">GitHub ↗</a><a href="${facts.npm}">npm ↗</a></nav></header>`;
  const mobileNav = `<details class="mobile-nav"><summary>${page.route === '/' ? content.onThisPage : 'Documentation'}</summary><nav aria-label="Mobile documentation">${navLinks(page)}</nav></details>`;
  const values = { head: head(page, facts, live, notFound), header, sidebar: sidebar(root, page), mobileNav, body, footer: footer(commit), pageClass: file.startsWith('doc') ? 'document' : 'landing' };
  return read(root, `website/${file}`).replace(/\{\{(\w+)\}\}/g, (_, key) => {
    requireValue(Object.hasOwn(values, key), `Unknown template slot: ${key}`);
    return values[key];
  });
}

function validateRendered(documents) {
  for (const { page, html } of documents) {
    requireValue((html.match(/<h1\b/g) || []).length === 1, `Expected one H1: ${page.route}`);
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
    requireValue(ids.length === new Set(ids).size, `Duplicate anchor: ${page.route}`);
  }
}

function markdownTwin(html, page) {
  let body = html.match(/<main\b[^>]*>([^]*?)<\/main>/)?.[1] || '';
  body = body.replace(/<details class="mobile-nav">[^]*?<\/details>/g, '').replace(/<footer\b[^>]*>[^]*?<\/footer>/g, '').replace(/<nav\b[^>]*>[^]*?<\/nav>/g, '');
  body = body.replace(/<h([1-6])\b[^>]*>([^]*?)<\/h\1>/g, (_, depth, text) => `\n\n${'#'.repeat(Number(depth))} ${visibleText(text)}\n\n`)
    .replace(/<a href="([^"]+)"[^>]*>([^]*?)<\/a>/g, (_, href, text) => `[${visibleText(text)}](${href.startsWith('/') ? origin : ''}${href.replace(/&amp;/g, '&')})`)
    .replace(/<pre><code>([^]*?)<\/code><\/pre>/g, (_, code) => `\n\n\`\`\`\n${decode(code)}\n\`\`\`\n\n`)
    .replace(/<code>([^]*?)<\/code>/g, (_, code) => `\`${decode(code)}\``)
    .replace(/<\/(?:p|div|section|article|details|tr|li|figure|summary)>/g, '\n\n').replace(/<\/(?:th|td)>/g, ' | ')
    .replace(/<[^>]+>/g, '');
  return `Canonical: ${origin}${page.route}\n\n${decode(body).replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

function decode(text) {
  return text.replace(/&(?:amp|lt|gt|quot|#39);/g, entity => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" })[entity]);
}

export function buildSite({ root = fileURLToPath(new URL('..', import.meta.url)), outDir = join(root, 'website/dist'), live = false, commit, buildTime = new Date().toISOString() } = {}) {
  // Check all inputs and render in memory before replacing the output directory.
  const facts = loadSourceFacts(root);
  validatePages(facts);
  commit ||= process.env.VERCEL_GIT_COMMIT_SHA || execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  requireValue(/^[a-f0-9]{40}$/i.test(commit), 'Expected a full source commit SHA');
  const documents = pages.map(page => ({ page, html: template(root, page, page.route === '/' ? landingBody(root, facts) : documentBody(page, docsBody(root, page, facts)), facts, live, commit) }));
  validateRendered(documents, facts);
  for (const asset of assets) requireValue(existsSync(join(root, 'website/assets', asset)), `Asset missing${live && media.includes(asset) ? " for live build" : ""}: website/assets/${asset}`);
  const output = resolve(outDir);
  requireValue(output !== resolve(root) && output !== resolve(root, 'website') && !resolve(root).startsWith(`${output}/`), 'Output must be a separate build directory');
  rmSync(output, { recursive: true, force: true });
  const write = (file, value) => { mkdirSync(dirname(join(output, file)), { recursive: true }); writeFileSync(join(output, file), value); };
  for (const { page, html } of documents) write(`${page.route.slice(1)}index.html`, html);
  const missing = { route: '/404.html', title: content.notFound.title, description: content.notFound.text, h1: content.notFound.title };
  write('404.html', template(root, missing, `<h1>${escape(missing.h1)}</h1><p>${escape(missing.description)}</p><a href="/">${escape(content.notFound.link)}</a>`, facts, false, commit, true));
  mkdirSync(join(output, 'assets'), { recursive: true });
  for (const asset of assets) copyFileSync(join(root, 'website/assets', asset), join(output, 'assets', asset));
  write('robots.txt', live ? `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n` : 'User-agent: *\nDisallow: /\n');
  if (live) {
    write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages.map(page => `  <url><loc>${origin}${page.route}</loc></url>`).join('\n')}\n</urlset>\n`);
    const twins = documents.map(({ page, html }) => ({ page, markdown: markdownTwin(html, page) }));
    for (const { page, markdown } of twins) write(`${page.route.slice(1)}index.md`, markdown);
    write('llms.txt', `# ${facts.name}\n\n> ${facts.description}\n\n${content.discovery.install} \`${content.install.command}\`\n\n## ${content.discovery.pages}\n\n${pages.map(page => `- [${page.h1}](${origin}${page.route}): ${page.description}`).join('\n')}\n\n## ${content.discovery.source}\n\n- [${content.discovery.readme}](${repository}/blob/main/README.md)\n- [${content.discovery.npm}](${facts.npm})\n`);
    write('llms-full.txt', twins.map(twin => twin.markdown).join('\n---\n\n'));
  }
  write('build-info.json', JSON.stringify({ commit, buildTime, packageVersion: facts.version, mode: live ? 'live' : 'default', pageCount: pages.length }, null, 2) + '\n');
  function count(directory) { return readdirSync(directory, { withFileTypes: true }).reduce((total, entry) => total + (entry.isDirectory() ? count(join(directory, entry.name)) : 1), 0); }
  return { pages: documents, files: count(output), outDir: output };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    requireValue(args.length <= 1 && args.every(arg => arg === '--live'), 'Usage: node website/build.mjs [--live]');
    const result = buildSite({ live: args.includes('--live') });
    console.log(`Built ${result.pages.length} pages and ${result.files} files (${args.includes('--live') ? 'live' : 'default'}).`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
