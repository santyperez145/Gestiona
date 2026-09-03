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
import { isPotentialCustomStoreHostname } from './src/lib/storeCustomDomain.js';
import { isValidStoreSubdomain, storeSlugFromHostname } from './src/lib/storefrontHost.js';
import { STOREFRONT_CRAWLER_UA } from './src/lib/storefrontSeo.js';

const CRAWLER = new RegExp(`(?:${STOREFRONT_CRAWLER_UA})`, 'i');

export function storefrontCrawlerTarget(request: Request): URL | null {
  if (!CRAWLER.test(request.headers.get('user-agent') ?? '')) return null;

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

export default function middleware(request: Request): Response {
  const target = storefrontCrawlerTarget(request);
  return target ? rewrite(target) : next();
}

export const config = {
  matcher: [
    '/((?!api/|assets/|brand/|developer/|robots\\.txt|sitemap\\.xml|feed\\.xml|sw\\.js|registerSW\\.js|manifest\\.webmanifest|favicon\\.ico).*)',
  ],
};
