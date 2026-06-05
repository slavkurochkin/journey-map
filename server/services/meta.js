// Extract title/description/date from a page's HTML meta tags (best-effort).
export function parseMeta(html, url) {
  const decode = (s) => s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
  const pick = (re) => { const m = html.match(re); return m ? decode(m[1].trim()) : null; };
  const og = (p) =>
    pick(new RegExp(`<meta[^>]+property=["']og:${p}["'][^>]+content=["']([^"']+)["']`, 'i')) ||
    pick(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:${p}["']`, 'i'));
  const metaName = (n) => pick(new RegExp(`<meta[^>]+name=["']${n}["'][^>]+content=["']([^"']+)["']`, 'i'));

  const title = og('title') || pick(/<title[^>]*>([^<]+)<\/title>/i) || url;
  const description = og('description') || metaName('description') || null;
  const date =
    pick(/<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i) ||
    metaName('date') || null;
  return { title, description, date, url };
}
