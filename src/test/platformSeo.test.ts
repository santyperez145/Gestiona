import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import platformSeoHandler from '../../api/platform-seo';
import platformSitemapHandler from '../../api/platform-sitemap';
import { indiceDeSitemaps } from '../../api/sitemap-index';
import { platformCrawlerTarget } from '../../middleware';
import {
  PLATFORM_SEO_PAGES,
  platformCanonicalUrl,
  platformSeoPage,
  renderPlatformSeoHtml,
} from '@/lib/platformSeo';

describe('SEO público de Nerqia', () => {
  it('declara nombre de sitio, software y contenido útil sin meta keywords', () => {
    const page = platformSeoPage('/');
    expect(page).not.toBeNull();
    const html = renderPlatformSeoHtml(page!);
    expect(html).toContain('"@type":"WebSite"');
    expect(html).toContain('"@type":"SoftwareApplication"');
    expect(html).toContain('"alternateName":"Nerqia Commerce OS"');
    expect(html).toContain('<h1>Nerqia, tu tienda online conectada a todo tu negocio.</h1>');
    expect(html).toContain('Una tienda online preparada para vender');
    expect(html).not.toContain('name="keywords"');

    const shell = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
    expect(shell).toContain(`<title>${page!.title}</title>`);
    expect(shell).toContain(`content="${page!.description}"`);
    expect(shell).toContain('"@type": "WebSite"');
    expect(shell).not.toContain('name="keywords"');
  });

  it('hace canónico /precios y no indexa pantallas privadas o legales', async () => {
    expect(platformSeoPage('/pricing')?.path).toBe('/precios');
    expect(platformCanonicalUrl('/pricing')).toBe('https://nerqia.app/precios');
    expect(platformSeoPage('/privacidad')?.indexable).toBe(false);

    const response = platformSeoHandler(new Request('https://nerqia.app/api/platform-seo?path=/productos'));
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(await response.text()).toContain('Acceso privado');
  });

  it('deriva Google al HTML semántico de la plataforma, no compradores ni previews', () => {
    const google = platformCrawlerTarget(new Request('https://nerqia.app/precios?utm_source=google', {
      headers: { 'user-agent': 'Googlebot/2.1' },
    }));
    expect(google?.pathname).toBe('/api/platform-seo');
    expect(google?.searchParams.get('path')).toBe('/precios');
    expect(google?.searchParams.get('utm_source')).toBe('google');

    expect(platformCrawlerTarget(new Request('https://nerqia.app/', {
      headers: { 'user-agent': 'Mozilla/5.0' },
    }))).toBeNull();
    expect(platformCrawlerTarget(new Request('https://preview.vercel.app/', {
      headers: { 'user-agent': 'Googlebot' },
    }))).toBeNull();
  });

  it('publica un sitemap propio y lo enlaza desde el índice raíz', async () => {
    const platform = platformSitemapHandler();
    const xml = await platform.text();
    for (const page of PLATFORM_SEO_PAGES.filter(item => item.sitemap)) {
      expect(xml).toContain(`https://nerqia.app${page.path === '/' ? '/' : page.path}`);
    }
    expect(xml).not.toContain('/privacidad');

    const index = await indiceDeSitemaps(null);
    expect(await index.text()).toContain('https://nerqia.app/sitemap-platform.xml');

    const vercel = JSON.parse(readFileSync(resolve(process.cwd(), 'vercel.json'), 'utf8')) as {
      rewrites: Array<{ source: string; destination: string }>;
      redirects: Array<{ source: string; destination: string }>;
    };
    expect(vercel.rewrites).toContainEqual(expect.objectContaining({
      source: '/sitemap-platform.xml',
      destination: '/api/platform-sitemap',
    }));
    expect(vercel.redirects).toContainEqual(expect.objectContaining({
      source: '/pricing',
      destination: '/precios',
    }));
  });
});

// 2026-10-19: con la base caída el índice respondía 200 con sólo la plataforma.
describe('índice de sitemaps cuando falla la base', () => {
  it('lista cada tienda publicada además de la plataforma', async () => {
    const res = await indiceDeSitemaps(async () => ['exentryimports', 'ferreteriafamatina']);
    const xml = await res.text();
    expect(res.status).toBe(200);
    expect(xml).toContain('https://exentryimports.nerqia.app/sitemap.xml');
    expect(xml).toContain('https://ferreteriafamatina.nerqia.app/sitemap.xml');
    expect(xml).toContain('https://nerqia.app/sitemap-platform.xml');
  });

  it('si no se pueden leer las tiendas responde 503 sin guardar, en vez de un índice recortado', async () => {
    const original = console.error;
    console.error = () => {};
    const res = await indiceDeSitemaps(async () => { throw new Error('503'); });
    console.error = original;
    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBe('300');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.text()).not.toContain('<sitemapindex');
  });

  it('el sitemap de tienda y robots no conservan un fallo pasajero', () => {
    const tienda = readFileSync(resolve(process.cwd(), 'api/sitemap.ts'), 'utf8');
    expect(tienda).toContain('status >= 500 ? "no-store"');
    expect(tienda).toContain('{ "Retry-After": "300" }');
    const robots = readFileSync(resolve(process.cwd(), 'api/robots.ts'), 'utf8');
    expect(robots).toContain('tiendasLeidas ? "public, max-age=3600" : "public, max-age=300"');
  });
});
