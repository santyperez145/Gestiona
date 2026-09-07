import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const page = readFileSync(resolve(process.cwd(), 'src/pages/LandingPage.tsx'), 'utf8');
const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');
const landingCommerce = css.split('/* Landing Commerce OS:')[1]?.split('.auth-shell {')[0] ?? '';

describe('contrato visual de la landing de Nerqia', () => {
  it('presenta la marca y la tienda online como puerta principal en el hero', () => {
    expect(page).toContain('landing-brand-kicker');
    expect(page).toContain('>Nerqia</p>');
    expect(page).toContain('<h1>Creá tu tienda online y vendé hoy.</h1>');
    expect(page).toContain('sin ser un CRM más');
  });

  it('usa una escena inmersiva de ecommerce y no vuelve al hero dividido', () => {
    expect(page).toContain('landing-hero__inner');
    expect(page).toContain('<StorefrontPreview />');
    expect(page).toContain('/landing/storefront-aurea.webp');
    expect(page).toContain('Nueva compra online');
    expect(page).toContain('Stock actualizado');
    expect(page).toContain('Margen explicado');
    expect(page).not.toContain('landing-hero__grid');
  });

  it('declara los números del preview como ilustrativos', () => {
    expect(page).toContain('Contenido ilustrativo');
    expect(page).toContain('dato ilustrativo');
  });

  it('conecta Gestión, Tienda y Finance en tabs accesibles', () => {
    expect(page).toContain('role="tablist"');
    expect(page).toContain('role="tabpanel"');
    expect(page).toContain("'ArrowLeft', 'ArrowRight', 'Home', 'End'");
    expect(page).toContain('aria-labelledby={`landing-tab-${activeSurface.id}`}');
    expect(page).toContain("id: 'gestion'");
    expect(page).toContain("id: 'tienda'");
    expect(page).toContain("id: 'finance'");
    expect(page.indexOf("id: 'tienda'")).toBeLessThan(page.indexOf("id: 'gestion'"));
    expect(page).toContain("useState<(typeof SURFACES)[number]['id']>('tienda')");
  });

  it('ancla el hero en cobalto Commerce OS con tipografía de marca', () => {
    expect(landingCommerce).toContain('--landing-gold: 230 87% 51%');
    expect(landingCommerce).toContain('linear-gradient(145deg');
    expect(landingCommerce).toContain('.landing-brand-kicker');
    expect(page).not.toMatch(/glow|orb/i);
  });

  it('conserva continuidad en notebooks anchos de poca altura', () => {
    expect(landingCommerce).toContain('@media (min-width: 821px) and (max-height: 780px)');
    expect(landingCommerce).toContain('transform: scale(0.72);');
    expect(landingCommerce).toContain('transform-origin: top left;');
  });
});
