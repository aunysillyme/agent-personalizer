import assert from 'node:assert/strict';
import { renderMarkdown, markdownTwin } from '../website/build.mjs';
import { visibleText } from '../website/facts.mjs';
const nested = '<scr<script>x</script>ipt>alert(1)</script>'; 
assert.doesNotMatch(renderMarkdown(nested), /alert\(1\)|<script\b/i);
assert.doesNotMatch(renderMarkdown('<!<!-- inner -->-- hidden -->visible'), /hidden/);
assert.equal(visibleText('<scr<script>x</script>ipt>hidden</script>visible'), 'visible');
assert.doesNotMatch(markdownTwin('<main><scr<script>ipt>hidden</script>visible</main>', { route: '/' }), /<script/i);
console.log('PASS security: nested tags and comments are removed to a fixed point');
