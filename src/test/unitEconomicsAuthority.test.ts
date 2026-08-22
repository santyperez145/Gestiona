import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const component = readFileSync(
  'src/components/platform/UnitEconomicsWorkbench.tsx',
  'utf8',
);
const model = readFileSync('src/lib/unitEconomics.ts', 'utf8');
const economicsDoc = readFileSync('docs/ECONOMICS.md', 'utf8');

describe('autoridad y evidencia de unit economics', () => {
  it('el workbench no puede escribir pricing ni datos de plataforma', () => {
    expect(component).not.toContain('@/integrations/supabase');
    expect(component).not.toMatch(/supabase\.(from|rpc)/);
    expect(component).toContain('simulación · no activa pricing');
  });

  it('piso, techo y redondeo reutilizan la autoridad de comisiones', () => {
    expect(model).toContain("import { platformFeeFor, round2");
    expect(model).toContain('platformFeeFor(averageTicket, commissionRule)');
  });

  it('el benchmark y la muestra insuficiente quedan documentados con fuente', () => {
    expect(economicsDoc).toContain('2 × ARS 1');
    expect(economicsDoc).toContain('demasiado chica para fijar pricing');
    expect(economicsDoc).toContain('ayuda.tiendanube.com');
    expect(economicsDoc).toContain('mercadopago.com.ar/developers');
  });
});
