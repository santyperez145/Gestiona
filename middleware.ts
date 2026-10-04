/**
 * HTML semántico para crawlers antes de que el filesystem entregue index.html.
 *
 * Vercel prioriza archivos estáticos sobre rewrites. Por eso una condición de
 * User-Agent en vercel.json no intercepta `/`: Google recibía el canonical de
 * la plataforma dentro del subdominio de la tienda. Routing Middleware corre
 * antes del cache/filesystem y deriva sólo bots al handler SEO; compradores y
 * recursos estáticos continúan por el pipeline normal.
 */
import { next, rewrite } from '@vercel/functions/middleware';
import { BRAND_DOMAIN } from './src/lib/brand.js';
import { isPotentialCustomStoreHostname } from './src/lib/storeCustomDomain.js';
import { isValidStoreSubdomain, normalizeHostname, storeSlugFromHostname } from './src/lib/storefrontHost.js';
import { STOREFRONT_CRAWLER_UA } from './src/lib/storefrontSeo.js';

const CRAWLER = new RegExp(`(?:${STOREFRONT_CRAWLER_UA})`, 'i');
// Machine-readable documents must reach their XML/text handlers unchanged,
// including the legacy /tienda/:slug endpoints that still match middleware.
const CRAWLER_DOCUMENT = /(?:^|\/)(?:robots\.txt|sitemap(?:-platform)?\.xml|feed\.xml)$/i;

function isCrawlerPage(request: Request): boolean {
  return CRAWLER.test(request.headers.get('user-agent') ?? '')
    && !CRAWLER_DOCUMENT.test(new URL(request.url).pathname);
}

export function storefrontCrawlerTarget(request: Request): URL | null {
  if (!isCrawlerPage(request)) return null;

  const source = new URL(request.url);
  const slug = storeSlugFromHostname(source.hostname);
  const legacySlug = (/^\/tienda\/([^/]+)/.exec(source.pathname)?.[1] ?? '').toLowerCase();
  const customHost = !slug && isPotentialCustomStoreHostname(source.hostname)
    ? source.hostname.toLowerCase()
    : null;
  if (!slug && !customHost && !isValidStoreSubdomain(legacySlug)) return null;

  const originalPath = source.pathname;
  source.pathname = '/api/og';
  source.searchParams.set('path', originalPath);
  if (slug) source.searchParams.set('hostSlug', slug);
  else if (customHost) source.searchParams.set('customHost', customHost);
  return source;
}

/** La plataforma también necesita HTML antes del index vacío de la SPA. */
export function platformCrawlerTarget(request: Request): URL | null {
  if (!isCrawlerPage(request)) return null;
  const source = new URL(request.url);
  const host = normalizeHostname(source.hostname);
  if (host !== BRAND_DOMAIN && host !== `www.${BRAND_DOMAIN}`) return null;

  const originalPath = source.pathname;
  source.pathname = '/api/platform-seo';
  source.searchParams.set('path', originalPath);
  return source;
}

export default function middleware(request: Request): Response {
  const target = storefrontCrawlerTarget(request) ?? platformCrawlerTarget(request);
  return target ? rewrite(target) : next();
}

export const config = {
  runtime: 'nodejs',
  matcher: [
    '/((?!api/|assets/|brand/|developer/|robots\\.txt|sitemap(?:-platform)?\\.xml|feed\\.xml|sw\\.js|registerSW\\.js|manifest\\.webmanifest|favicon\\.ico).*)',
  ],
};
