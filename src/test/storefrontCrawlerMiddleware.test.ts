import { describe, expect, it } from 'vitest';
import middleware, { storefrontCrawlerTarget } from '../../middleware';
import { STOREFRONT_CRAWLER_UA } from '@/lib/storefrontSeo';

function request(url: string, userAgent: string) {
  return new Request(url, { headers: { 'user-agent': userAgent } });
}

describe('Routing Middleware SEO del storefront', () => {
  it('sirve HTML semántico a Google en la home del subdominio antes del index estático', () => {
    const target = storefrontCrawlerTarget(request(
      'https://exentryimports.nerqia.app/?utm_source=google',
      'Googlebot/2.1 (+http://www.google.com/bot.html)',
    ));
    expect(target?.pathname).toBe('/api/og');
    expect(target?.searchParams.get('hostSlug')).toBe('exentryimports');
    expect(target?.searchParams.get('path')).toBe('/');
    expect(target?.searchParams.get('utm_source')).toBe('google');
  });

  it('conserva ruta y query de PDP/PLP y también resuelve dominios propios', () => {
    const plp = storefrontCrawlerTarget(request(
      'https://marca.nerqia.app/productos?cat=ropa',
      'bingbot/2.0',
    ));
    expect(plp?.searchParams.get('path')).toBe('/productos');
    expect(plp?.searchParams.get('cat')).toBe('ropa');

    const custom = storefrontCrawlerTarget(request(
      'https://tienda.marca.com/producto/abc',
      'facebookexternalhit/1.1',
    ));
    expect(custom?.searchParams.get('customHost')).toBe('tienda.marca.com');
    expect(custom?.searchParams.get('path')).toBe('/producto/abc');
  });

  it('mantiene el SEO del path heredado sin tratar la plataforma como una tienda', () => {
    const legacy = storefrontCrawlerTarget(request(
      'https://nerqia.app/tienda/exentryimports/producto/abc',
      'Googlebot',
    ));
    expect(legacy?.pathname).toBe('/api/og');
    expect(legacy?.searchParams.get('path')).toBe('/tienda/exentryimports/producto/abc');
    expect(legacy?.searchParams.has('hostSlug')).toBe(false);
    expect(storefrontCrawlerTarget(request('https://nerqia.app/', 'Googlebot'))).toBeNull();
  });

  it('no deriva compradores y emite las instrucciones oficiales next/rewrite', () => {
    const human = request('https://exentryimports.nerqia.app/', 'Mozilla/5.0');
    expect(storefrontCrawlerTarget(human)).toBeNull();
    expect(middleware(human).headers.get('x-middleware-next')).toBe('1');

    const bot = request('https://exentryimports.nerqia.app/', 'Googlebot');
    const response = middleware(bot);
    expect(response.headers.get('x-middleware-rewrite')).toContain('/api/og');
  });

  it('mantiene una única lista compartida para buscadores y previews sociales', () => {
    for (const token of STOREFRONT_CRAWLER_UA.split('|')) {
      expect(
        storefrontCrawlerTarget(request('https://marca.nerqia.app/', token)),
        token,
      ).not.toBeNull();
    }
  });
});
