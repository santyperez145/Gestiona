import { BRAND_ORIGIN } from '../src/lib/brand.js';
import { PLATFORM_SEO_PAGES } from '../src/lib/platformSeo.js';

export const config = { runtime: 'edge' };

const escapeXml = (value: string) => value.replace(/[&<>"']/g, character => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
}[character]!));

export default function handler(): Response {
  const urls = PLATFORM_SEO_PAGES
    .filter(page => page.indexable && page.sitemap)
    .map(page => `${BRAND_ORIGIN}${page.path === '/' ? '/' : page.path}`);
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${
    urls.map(url => `  <url><loc>${escapeXml(url)}</loc></url>`).join('\n')
  }\n</urlset>`;

  return new Response(body, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
