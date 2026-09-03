import {
  platformSeoPage,
  renderPlatformSeoHtml,
  renderPrivatePlatformSeoHtml,
} from '../src/lib/platformSeo.js';

export const config = { runtime: 'edge' };

export default function handler(req: Request): Response {
  const url = new URL(req.url);
  const path = url.searchParams.get('path') ?? '/';
  const page = platformSeoPage(path);
  const indexable = Boolean(page?.indexable);
  const body = page ? renderPlatformSeoHtml(page) : renderPrivatePlatformSeoHtml(path);

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': indexable ? 'public, max-age=300' : 'private, no-store',
      ...(!indexable ? { 'X-Robots-Tag': 'noindex, nofollow' } : {}),
    },
  });
}
