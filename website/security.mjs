import { isDeepStrictEqual } from 'node:util';
import { readFileSync, writeFileSync } from 'node:fs';
import { csp } from './resources.mjs';
const config = {
  installCommand: 'npm --prefix website ci',
  buildCommand: 'node website/build.mjs --live && node website/check.mjs --live',
  outputDirectory: 'website/dist',
  headers: [
    {
      source: '/(.*)',
      headers: [
        { key: 'Content-Security-Policy', value: csp },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'X-Frame-Options', value: 'DENY' },
      ],
    },
    {
      source: '/(.*\\.md)',
      headers: [
        { key: 'Content-Type', value: 'text/markdown; charset=utf-8' },
      ],
    },
  ],
};
const expected = JSON.stringify(config, null, 2) + '\n';
if (process.argv[2] === '--write') writeFileSync(new URL('../vercel.json', import.meta.url), expected);
else if (process.argv.length === 2 || (process.argv.length === 3 && process.argv[2] === '--check')) {
  const actual = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  delete actual.name;
  delete actual.version;
  if (isDeepStrictEqual(actual, config)) console.log('Vercel security config matches.');
  else { console.error('Run node website/security.mjs --write'); process.exitCode = 1; }
}
else { console.error('Run node website/security.mjs --write'); process.exitCode = 1; }
