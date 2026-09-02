import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const leer = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

/**
 * El camino de la primera venta POS tiene que medirse como lo recorre el
 * comercio, no como un INSERT de producto con stock ya puesto.
 *
 * `20260827_comercio_nuevo_puede_vender.sql` nace la org a mano y escribe
 * `products.stock` en el alta. El wizard, Casa central, el Kardex del primer
 * SKU y cobrar sin turno no pasan por ahí. Esta guarda exige la verificación
 * que sí los recorre.
 */
const VERIF = leer('supabase/verificaciones/20260901_primera_venta_pos.sql');
const ALTA_PRODUCTO = leer('src/lib/supabaseStore.ts');
const WIZARD_VIEJO = leer('supabase/verificaciones/20260827_comercio_nuevo_puede_vender.sql');

describe('primera venta POS del comercio nuevo', () => {
  it('parte del alta real y del wizard, no de una organización plantada', () => {
    expect(VERIF).toContain("INSERT INTO auth.users");
    expect(VERIF).toContain('complete_business_onboarding');
    expect(VERIF).toContain("'pos'");
    expect(VERIF).toContain('Casa central');
    expect(VERIF).not.toContain('INSERT INTO public.organizations');
  });

  it('el primer SKU entra por Kardex, como addProductDB', () => {
    expect(VERIF).toContain('adjust_stock');
    expect(VERIF).toMatch(
      /INSERT INTO public\.products \(id, org_id, user_id, name, sale_price_ars, is_active\)/,
    );
    expect(VERIF).not.toMatch(/INSERT INTO public\.products \([^)]*stock/);
    expect(ALTA_PRODUCTO).toContain('El cliente no escribe `products.stock`');
    expect(ALTA_PRODUCTO).toContain(".rpc('adjust_stock'");
  });

  it('cobra efectivo pagado y no abre un turno para poder vender', () => {
    expect(VERIF).toContain('create_sales_transaction_v3');
    expect(VERIF).toContain("'efectivo'");
    expect(VERIF).toContain("'paid', true");
    expect(VERIF).toContain('no_open_session');
    expect(VERIF).toContain('SET LOCAL ROLE authenticated');
  });

  it('la verificación de agosto no alcanza: sigue escribiendo el stock en el alta', () => {
    expect(WIZARD_VIEJO).toMatch(/INSERT INTO public\.products \([^)]*stock/);
    expect(WIZARD_VIEJO).not.toContain('complete_business_onboarding');
    expect(WIZARD_VIEJO).not.toContain('adjust_stock');
  });

  it('borra todo: transacción revertida y restos en cero', () => {
    expect(VERIF).toContain('ROLLBACK');
    expect(VERIF).toContain('restos_zz');
  });
});
