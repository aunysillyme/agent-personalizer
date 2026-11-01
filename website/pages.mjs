import { content } from './content.mjs';
const page = (key, route, sources) => ({ route, ...content.documents[key], sources });
export const pages = [
  page('landing', '/', ['README.md']),
  page('overview', '/docs/overview/', ['README.md']),
  page('how', '/docs/how-it-works/', ['docs/tiers.md']),
  page('guides', '/docs/guides/', ['docs/paste-guide.md', 'docs/companions.md']),
  page('install', '/docs/install/', ['docs/install.md']),
  page('learning', '/docs/learning/', ['docs/learning.md']),
  page('proof', '/docs/proof/', ['docs/guarantees.md']),
  { route: '/docs/guarantees/', title: 'Guarantees | agent-personalizer', description: 'Read the rendering, drift detection and local operation guarantees.', h1: 'Guarantees', sources: ['docs/guarantees.md'] },
  page('changelog', '/docs/changelog/', ['CHANGELOG.md']),
];
