import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const page = readFileSync(resolve(process.cwd(), 'src/pages/LandingPage.tsx'), 'utf8');
const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');
const landingV4 = css.split('/* Landing v4:')[1]?.split('.auth-shell {')[0] ?? '';

describe('contrato visual de la landing de Nerqia', () => {
  it('presenta la marca y la categoría de producto en el H1', () => {
    expect(page).toContain('<h1><span>Nerqia</span>, el sistema operativo de tu comercio.</h1>');
  });

  it('usa una escena inmersiva y no vuelve al hero dividido', () => {
    expect(page).toContain('landing-hero__inner');
    expect(page).toContain('<DashboardPreview />');
    expect(page).not.toContain('landing-hero__grid');
  });

  it('declara los números del preview como ilustrativos', () => {
    expect(page).toContain('Datos ilustrativos');
    expect(page).toContain('Vista de demostración');
  });

  it('conecta Gestión, Tienda y Finance en tabs accesibles', () => {
    expect(page).toContain('role="tablist"');
    expect(page).toContain('role="tabpanel"');
    expect(page).toContain("'ArrowLeft', 'ArrowRight', 'Home', 'End'");
    expect(page).toContain('aria-labelledby={`landing-tab-${activeSurface.id}`}');
    expect(page).toContain("id: 'gestion'");
    expect(page).toContain("id: 'tienda'");
    expect(page).toContain("id: 'finance'");
  });

  it('usa color plano y evita gradientes u orbes decorativos', () => {
    expect(landingV4).toContain('background: hsl(var(--landing-berry));');
    expect(landingV4).not.toContain('linear-gradient');
    expect(page).not.toMatch(/glow|orb/i);
  });
});
