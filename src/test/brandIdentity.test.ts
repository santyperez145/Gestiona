import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('identidad canónica de Gestiona', () => {
  it('versiona un símbolo PNG cuadrado con transparencia real', () => {
    const mark = readFileSync(resolve(process.cwd(), 'public/brand/gestiona-mark.png'));

    expect(mark.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(mark.readUInt32BE(16)).toBe(mark.readUInt32BE(20));
    expect(mark[25], 'el PNG debe conservar canal alpha RGBA').toBe(6);
  });

  it('centraliza ruta, nombre accesible y dimensiones en un solo componente', () => {
    const component = source('src/components/shared/BrandLogo.tsx');

    expect(component).toContain("'/brand/gestiona-mark.png'");
    expect(component).toContain("const label = product ? `Gestiona ${product}` : 'Gestiona'");
    expect(component).toContain('aria-label={decorative ? undefined : label}');
    expect(component).toContain('width="1254"');
    expect(component).toContain('height="1254"');
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
      expect(source(`src/storefront/${path}`), `${path} mezcló Gestiona con la tienda`).not.toContain('BrandLogo');
    }
    const publicCatalog = source('src/pages/PublicCatalogPage.tsx');
    expect(publicCatalog).not.toContain('BrandLogo');
    expect(publicCatalog).toContain('storeBranding?.logo_url');
  });

  it('usa el símbolo oficial en favicon, Apple y PWA sin una G dibujada', () => {
    const html = source('index.html');
    const vite = source('vite.config.ts');

    expect(html.match(/\/brand\/gestiona-mark\.png/g)?.length).toBeGreaterThanOrEqual(4);
    expect(vite).toContain('brand/gestiona-mark.png');
    expect(vite).toContain('sizes: "1254x1254"');
    expect(vite).not.toContain("<text y='130'");
  });
});
