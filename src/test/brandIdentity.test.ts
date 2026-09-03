import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

const runtimeFiles = (directory: string): string[] => readdirSync(resolve(process.cwd(), directory))
  .flatMap(entry => {
    const relative = `${directory}/${entry}`;
    const absolute = resolve(process.cwd(), relative);
    if (statSync(absolute).isDirectory()) {
      if (relative === 'src/test') return [];
      return runtimeFiles(relative);
    }
    return /\.(?:ts|tsx|json|html)$/.test(entry) && !/\.test\.tsx?$/.test(entry)
      ? [relative]
      : [];
  });

describe('identidad canónica de Nerqia', () => {
  it('versiona un símbolo PNG cuadrado con transparencia real', () => {
    const mark = readFileSync(resolve(process.cwd(), 'public/brand/nerqia-mark.png'));

    expect(mark.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(mark.readUInt32BE(16)).toBe(mark.readUInt32BE(20));
    expect(mark.readUInt32BE(16)).toBe(389);
    expect(mark[25], 'el PNG debe conservar canal alpha RGBA').toBe(6);
  });

  it('versiona el wordmark horizontal oficial como activo transparente', () => {
    const wordmark = readFileSync(resolve(process.cwd(), 'public/brand/nerqia-wordmark.png'));

    expect(wordmark.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(wordmark.readUInt32BE(16)).toBe(1369);
    expect(wordmark.readUInt32BE(20)).toBe(459);
    expect(wordmark[25], 'el wordmark debe conservar canal alpha RGBA').toBe(6);
    expect(source('src/lib/brand.ts')).toContain("BRAND_WORDMARK_SRC = '/brand/nerqia-wordmark.png'");
  });

  it('centraliza ruta, nombre accesible y dimensiones en un solo componente', () => {
    const component = source('src/components/shared/BrandLogo.tsx');
    const brand = source('src/lib/brand.ts');

    expect(brand).toContain("BRAND_MARK_SRC = '/brand/nerqia-mark.png'");
    expect(component).toContain('`${BRAND_NAME} ${product}`');
    expect(component).toContain('aria-label={decorative ? undefined : label}');
    expect(component).toContain('width="389"');
    expect(component).toContain('height="389"');
  });

  it('reemplaza marcas improvisadas en shells y accesos críticos', () => {
    const brandedSurfaces = [
      'src/components/AppLayout.tsx',
      'src/components/PlatformLayout.tsx',
      'src/components/finance-product/FinanceLayout.tsx',
      'src/components/auth/MfaGate.tsx',
      'src/pages/LandingPage.tsx',
      'src/pages/AuthPage.tsx',
      'src/pages/OnboardingPage.tsx',
      'src/pages/InvitationAcceptPage.tsx',
      'src/pages/ResetPasswordPage.tsx',
      'src/pages/PricingPage.tsx',
      'src/pages/ServiceStatusPage.tsx',
      'src/pages/TermsPage.tsx',
      'src/pages/PrivacyPage.tsx',
    ];

    for (const path of brandedSurfaces) {
      expect(source(path), `${path} quedó sin la identidad oficial`).toContain('<BrandLogo');
    }
    expect(source('src/components/AppLayout.tsx')).not.toContain('config.logoUrl ?');
    expect(source('src/pages/AuthPage.tsx')).not.toContain('auth-brand__mark');
  });

  it('mantiene la marca del comercio aislada en Storefront y catálogo público', () => {
    const storefrontFiles = readdirSync(resolve(process.cwd(), 'src/storefront'))
      .filter(path => path.endsWith('.tsx'));

    for (const path of storefrontFiles) {
      expect(source(`src/storefront/${path}`), `${path} mezcló Nerqia con la tienda`).not.toContain('BrandLogo');
    }
    const publicCatalog = source('src/pages/PublicCatalogPage.tsx');
    expect(publicCatalog).not.toContain('BrandLogo');
    expect(publicCatalog).toContain('storeBranding?.logo_url');
  });

  it('usa el símbolo oficial en favicon, Apple y PWA sin una G dibujada', () => {
    const html = source('index.html');
    const vite = source('vite.config.ts');

    expect(html.match(/nerqia\.app\/brand\/nerqia-mark\.png|\/brand\/nerqia-mark\.png/g)?.length).toBeGreaterThanOrEqual(4);
    expect(vite).toContain('brand/nerqia-mark.png');
    expect(vite).toContain('sizes: "389x389"');
    expect(vite).not.toContain("<text y='130'");
  });

  it('no deja reaparecer la marca o el dominio anterior en superficies activas', () => {
    const files = [
      ...runtimeFiles('src'),
      ...runtimeFiles('supabase/functions'),
      ...runtimeFiles('api'),
      ...runtimeFiles('public/developer'),
      'index.html',
      'vite.config.ts',
    ];

    for (const path of files) {
      const content = source(path)
        // Compatibilidad deliberada: headers publicados, no copy visible.
        .replaceAll(/X-Gestiona-[A-Za-z-]+/g, 'X-Legacy-Header')
        // El origen Vercel anterior queda temporalmente en CORS durante el corte.
        .replaceAll('https://exentryimports.vercel.app', 'https://legacy.invalid');
      expect(content, `${path} conserva la marca visible anterior`).not.toMatch(/\bGestiona\b/);
      expect(content, `${path} conserva un dominio anterior`).not.toMatch(/gestiona\.app|exentryimports\.vercel\.app/);
    }
  });

  it('declara nerqia.app como origen canónico y preserva namespaces compatibles', () => {
    const vercel = JSON.parse(source('vercel.json'));
    const auth = source('supabase/config.toml');

    expect(vercel.redirects).toContainEqual(expect.objectContaining({
      destination: 'https://nerqia.app/:path*',
      permanent: true,
    }));
    expect(auth).toContain('site_url = "https://nerqia.app"');
    expect(source('src/App.tsx')).toContain('storageKey="gestiona-theme"');
    expect(source('src/lib/gestionaPay.ts')).toContain('gestiona_pay');
    expect(source('supabase/functions/_shared/outboundWebhook.ts')).toContain('"X-Gestiona-Signature"');
  });
});
