import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  RESERVED_NERQIA_SUBDOMAINS,
  hostedStoreSlugFromUrl,
  hostedStoreOrigin,
  hostedStoreUrl,
  isValidStoreSubdomain,
  lookupStoreSlugByHost,
  publicStoreBaseUrl,
  resolveHostedStoreRequest,
  resolvedStoreOrigin,
  storeSlugFromHostname,
  storefrontBasePath,
  storefrontHomePath,
} from '@/lib/storefrontHost';
import { canonicalStorefrontPath, parseRutaTienda } from '@/lib/storefrontSeo';
import { urlPublicaDeTienda } from '@/lib/storeFirstPublish';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('host canónico de una tienda Nerqia', () => {
  it('resuelve exactamente un label DNS y nunca hosts de producto', () => {
    expect(storeSlugFromHostname('mateando.nerqia.app')).toBe('mateando');
    expect(storeSlugFromHostname('MATEANDO.NERQIA.APP.')).toBe('mateando');
    expect(storeSlugFromHostname('otra.mateando.nerqia.app')).toBeNull();
    expect(storeSlugFromHostname('nerqia.app')).toBeNull();
    expect(storeSlugFromHostname('evilnerqia.app')).toBeNull();
    for (const reserved of RESERVED_NERQIA_SUBDOMAINS) {
      expect(storeSlugFromHostname(`${reserved}.nerqia.app`), reserved).toBeNull();
    }
  });

  it('rechaza labels inválidos antes de construir una URL pública', () => {
    expect(isValidStoreSubdomain('mi-tienda')).toBe(true);
    expect(isValidStoreSubdomain('-tienda')).toBe(false);
    expect(isValidStoreSubdomain('tienda_1')).toBe(false);
    expect(isValidStoreSubdomain('app')).toBe(false);
    expect(hostedStoreUrl('https://nerqia.app', 'tienda_1')).toBeNull();
  });

  it('comparte subdominio en producción y conserva path verificable local', () => {
    expect(urlPublicaDeTienda('https://nerqia.app', 'mi-tienda'))
      .toBe('https://mi-tienda.nerqia.app');
    expect(urlPublicaDeTienda('https://app.nerqia.app', 'mi-tienda'))
      .toBe('https://mi-tienda.nerqia.app');
    expect(urlPublicaDeTienda('http://localhost:5173', 'mi-tienda'))
      .toBe('http://localhost:5173/tienda/mi-tienda');
  });

  it('usa rutas limpias en el wildcard y el prefijo heredado fuera de él', () => {
    expect(storefrontBasePath('mi-tienda', 'mi-tienda.nerqia.app')).toBe('');
    expect(storefrontHomePath('')).toBe('/');
    expect(storefrontBasePath('mi-tienda', 'nerqia.app')).toBe('/tienda/mi-tienda');
    expect(publicStoreBaseUrl('https://mi-tienda.nerqia.app', 'mi-tienda', true))
      .toBe('https://mi-tienda.nerqia.app');
  });

  it('interpreta home, PLP y PDP sin crear otro router', () => {
    expect(parseRutaTienda('/', new URLSearchParams(), 'mi-tienda'))
      .toEqual({ kind: 'home', slug: 'mi-tienda' });
    expect(parseRutaTienda('/productos', new URLSearchParams('cat=ropa'), 'mi-tienda'))
      .toEqual({ kind: 'plp', slug: 'mi-tienda', cat: 'ropa', page: 1 });
    expect(parseRutaTienda('/producto/abc', new URLSearchParams(), 'mi-tienda'))
      .toEqual({ kind: 'pdp', slug: 'mi-tienda', productId: 'abc' });
    expect(parseRutaTienda('/checkout', new URLSearchParams(), 'mi-tienda')?.kind)
      .toBe('private');
    expect(canonicalStorefrontPath({ kind: 'pdp', slug: 'mi-tienda', productId: 'a/b' }))
      .toBe('/producto/a%2Fb');
    expect(canonicalStorefrontPath({ kind: 'private', slug: 'mi-tienda' })).toBeNull();
  });

  it('acepta la captura del borde sólo si también es un slug válido', () => {
    expect(hostedStoreSlugFromUrl(new URL('https://mi-tienda.nerqia.app/producto/1')))
      .toBe('mi-tienda');
    expect(hostedStoreSlugFromUrl(new URL('https://nerqia.app/api/og?hostSlug=mi-tienda')))
      .toBe('mi-tienda');
    expect(hostedStoreSlugFromUrl(new URL('https://nerqia.app/api/og?hostSlug=app')))
      .toBeNull();
    expect(hostedStoreOrigin(
      new URL('https://nerqia.app/api/og?hostSlug=mi-tienda'),
      'mi-tienda',
    )).toBe('https://mi-tienda.nerqia.app');
  });

  it('resuelve un dominio propio por RPC mínima y conserva su origen canónico', async () => {
    const url = new URL('https://tienda.marca.com/producto/1?customHost=tienda.marca.com');
    const resolution = await resolveHostedStoreRequest(url, async host => {
      expect(host).toBe('tienda.marca.com');
      return 'mi-tienda';
    });
    expect(resolution).toEqual({
      slug: 'mi-tienda',
      customDomain: true,
      hostname: 'tienda.marca.com',
    });
    expect(resolvedStoreOrigin(url, resolution)).toBe('https://tienda.marca.com');
  });

  it('distingue un host inexistente de una caída del resolver público', async () => {
    const input = {
      hostname: 'tienda.marca.com',
      supabaseUrl: 'https://example.supabase.co',
      supabaseKey: 'anon-test',
    };
    await expect(lookupStoreSlugByHost({
      ...input,
      fetcher: async () => Response.json(null),
    })).resolves.toBeNull();
    await expect(lookupStoreSlugByHost({
      ...input,
      fetcher: async () => Response.json({ message: 'down' }, { status: 503 }),
    })).rejects.toThrow('HTTP 503');
    await expect(lookupStoreSlugByHost({
      ...input,
      fetcher: async () => Response.json('Mi-Tienda'),
    })).resolves.toBe('mi-tienda');
  });

  it('el dominio propio monta el mismo StorefrontPage y tiene SEO por host', () => {
    const app = source('src/App.tsx');
    const resolver = source('src/pages/CustomDomainStorefrontPage.tsx');
    expect(app).toContain('isPotentialCustomStoreHostname(hostname)');
    expect(resolver).toContain('<StorefrontPage hostedSlug={slug} basePath="" />');

    const vercel = JSON.parse(source('vercel.json')) as {
      rewrites: Array<{ source: string; destination: string }>;
    };
    const custom = vercel.rewrites.filter(rule => rule.destination.includes('customHost=:customHost'));
    expect(custom.some(rule => rule.source === '/robots.txt')).toBe(true);
    expect(custom.some(rule => rule.source === '/sitemap.xml')).toBe(true);
    expect(custom.some(rule => rule.source === '/feed.xml')).toBe(true);
    const middleware = source('middleware.ts');
    expect(middleware).toContain("source.pathname = '/api/og'");
    expect(middleware).toContain("from '@vercel/functions/middleware'");
    expect(source('api/robots.ts')).toContain('resolution.customDomain && !hostedSlug');
    expect(source('api/sitemap.ts')).toContain('xml("", 404, false)');
    expect(source('api/feed.ts')).toContain('404, false');
  });

  it('Vercel prioriza SEO por host y excluye todos los subdominios reservados', () => {
    const vercel = JSON.parse(source('vercel.json')) as {
      rewrites: Array<{ source: string; destination: string; has?: Array<{ type: string; value: string }> }>;
    };
    const hosted = vercel.rewrites.filter(rule => rule.destination.includes('hostSlug=:storeSlug'));
    expect(hosted.some(rule => rule.source === '/robots.txt')).toBe(true);
    expect(hosted.some(rule => rule.source === '/sitemap.xml')).toBe(true);
    expect(hosted.some(rule => rule.source === '/feed.xml')).toBe(true);
    expect(source('middleware.ts')).toContain('storeSlugFromHostname(source.hostname)');

    const hostPattern = hosted[0]?.has?.find(condition => condition.type === 'host')?.value ?? '';
    const regex = new RegExp(hostPattern);
    expect(regex.exec('mi-tienda.nerqia.app')?.groups?.storeSlug).toBe('mi-tienda');
    for (const reserved of RESERVED_NERQIA_SUBDOMAINS) {
      expect(regex.test(`${reserved}.nerqia.app`), reserved).toBe(false);
    }
  });

  it('todos los componentes compran la base del StoreContext', () => {
    const context = source('src/storefront/storeContext.tsx');
    const app = source('src/App.tsx');
    const storefront = [
      'ProductCard.tsx', 'ProductQuestions.tsx', 'ProductReviews.tsx',
      'StoreAccount.tsx', 'StoreCart.tsx', 'StoreCheckout.tsx', 'StoreHome.tsx',
      'StoreLayout.tsx', 'StoreOrder.tsx', 'StoreOrderLookup.tsx',
      'StorePage.tsx', 'StoreProduct.tsx',
    ];

    expect(context).toContain('basePath: string');
    expect(app).toContain('hostedSlug={hostedSlug} basePath=""');
    expect(source('supabase/config.toml')).toContain('"https://*.nerqia.app/**"');
    for (const file of storefront) {
      expect(source(`src/storefront/${file}`), file).not.toContain('`/tienda/${store?.slug');
    }
  });
});
