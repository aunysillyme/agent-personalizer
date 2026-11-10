export function removeRepeated(text, pattern, replacement = '') {
  let previous;
  do { previous = text; text = text.replace(pattern, replacement); } while (text !== previous);
  return text;
}
const compact = text => text.replace(/\s+/g, ' ').trim();
export function visibleText(html) {
  return compact(removeRepeated(removeRepeated(html, /<!--[^]*?-->/g), /<(script|style)\b[^]*?<\/\1>/gi)
    .replace(/<\/?(?:a|code|strong|em|span|time)\b[^>]*>/gi, '')
    .replace(/<[^>]*>/g, ' ').replace(/&(?:amp|lt|gt|quot|#39);/g, entity => ({
      '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'",
    })[entity]));
}

