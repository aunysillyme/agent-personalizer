import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const START = '<!-- set:start -->';
export const END = '<!-- set:end -->';
const unsafeUrl = /[\s)<>"'`]/;
// A registry or source description reaches README and llms.txt as plain text only.
export function plainLine(text) {
  return String(text ?? '').replace(/<!--[\s\S]*?(?:-->|$)/g, ' ').replace(/[<>[\]()`]/g, ' ').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200).trim();
}
// github.com/<owner>/<repo>, lower-cased, from https, git+https and .git spellings; null for anything else.
export function repoKey(value) {
  const raw = typeof value === 'string' ? value : value?.url;
  const m = typeof raw === 'string' ? raw.trim().match(/^(?:git\+)?https:\/\/github\.com\/([^/\s]+)\/([^/\s#?]+?)(?:\.git)?\/?(?:[#?].*)?$/i) : null;
  return m ? `${m[1]}/${m[2]}`.toLowerCase() : null;
}
// Read a vendored file only when no path component is a symlink; the error names the relative path alone.
export function readRegular(root, rel) {
  let current = root, info;
  for (const part of rel.split('/')) {
    current = path.join(current, part);
    try { info = fs.lstatSync(current); }
    catch (error) { if (error.code !== 'ENOENT') throw error; throw Object.assign(Error(`Missing file: ${rel}`), { code: 'ENOENT' }); }
    if (info.isSymbolicLink()) throw Error(`Symlink refused: ${rel}`);
  }
  if (!info.isFile()) throw Error(`Expected regular file: ${rel}`);
  return fs.readFileSync(current);
}
export function validateSet(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.rows)) throw Error('set.json needs version 1 and rows');
  const names = new Set();
  for (const row of value.rows) {
    if (!row || !['name', 'url', 'line'].every(key => typeof row[key] === 'string' && row[key].trim() && !/[\r\n]/.test(row[key]))) throw Error('Each set row needs name, url and line strings');
    if (names.has(row.name)) throw Error(`Duplicate set row: ${row.name}`);
    if (unsafeUrl.test(row.url)) throw Error(`Invalid set URL: ${row.name}`);
    const url = new URL(row.url);
    if (url.protocol !== 'https:' || url.username || url.password) throw Error(`Invalid set URL: ${row.name}`);
    if (row.line.includes('<!--')) throw Error(`Set line must not open an HTML comment: ${row.name}`);
    names.add(row.name);
  }
  return value;
}
const cell = value => value.replaceAll('|', '\\|');
export function renderBlocks(value, currentName) {
  const set = validateSet(value);
  const readmeRows = set.rows.map(row => `| ${row.name === currentName ? `**${cell(row.name)}**` : `[${cell(row.name)}](${row.url})`} | ${cell(row.line)} |`);
  const llmsRows = set.rows.filter(row => row.name !== currentName).map(row => `- [${row.name}](${row.url}): ${row.line}`);
  return {
    readme: [START, '## Part of a set', '', '| Repo | What it gives you |', '|---|---|', ...readmeRows, END].join('\n'),
    llms: [START, '## Part of a set', '', ...llmsRows, END].join('\n'),
  };
}
export function replaceBlock(text, block) {
  const starts = text.split(START).length - 1, ends = text.split(END).length - 1;
  if (!starts && !ends) return `${text.trimEnd()}\n\n${block}\n`;
  if (starts !== 1 || ends !== 1 || text.indexOf(END) < text.indexOf(START)) throw Error('Expected one ordered pair of set markers');
  return text.slice(0, text.indexOf(START)) + block + text.slice(text.indexOf(END) + END.length);
}
export function currentName(root) {
  for (const rel of ['.repo-build/facts.json', 'package.json']) {
    const full = path.join(root, rel);
    if (!fs.existsSync(full)) continue;
    const value = JSON.parse(fs.readFileSync(full, 'utf8'));
    if (typeof value.name === 'string' && value.name) return value.name;
  }
  throw Error('Set rendering needs a name in facts.json or package.json');
}
export function renderSet({ root = process.cwd(), check = false } = {}) {
  const set = JSON.parse(readRegular(root, '.repo-build/set.json').toString('utf8'));
  const blocks = renderBlocks(set, currentName(root)), changed = [];
  const outputs = [];
  for (const [file, block] of [['README.md', blocks.readme], ['llms.txt', blocks.llms]]) {
    const full = path.join(root, file);
    if (!fs.existsSync(full)) continue;
    if (!fs.lstatSync(full).isFile() || fs.lstatSync(full).isSymbolicLink()) throw Error(`Expected regular file: ${file}`);
    const before = fs.readFileSync(full, 'utf8'), after = replaceBlock(before, block);
    if (before !== after) { changed.push(file); outputs.push({ full, after }); }
  }
  if (!check) for (const output of outputs) fs.writeFileSync(output.full, output.after);
  return { code: check && changed.length ? 1 : 0, changed, blocks, message: changed.length ? `${check ? 'Set drift' : 'Set rendered'}: ${changed.join(', ')}` : 'Set blocks match.' };
}
const isMain = (() => {
  try { return !!process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
})();
if (isMain) {
  const args = process.argv.slice(2);
  try {
    if (args.some(arg => arg !== '--check')) throw Error('Usage: node .repo-build/render-set.mjs [--check]');
    const result = renderSet({ check: args.includes('--check') });
    console.log(result.message);
    process.exitCode = result.code;
  } catch (error) { console.error(error.message); process.exitCode = 2; }
}
