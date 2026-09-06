import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(process.cwd(), 'src/pages/ProveedoresPage.tsx'), 'utf8');

describe('historial real de pagos a proveedores', () => {
  it('lee movimientos persistidos y su deuda asociada', () => {
    expect(source).toContain('.from("supplier_payments")');
    expect(source).toContain('supplier_debts(supplier_name,description,supplier_id)');
    expect(source).toContain('{ count: "exact" }');
  });

  it('no conserva el placeholder de una función futura', () => {
    expect(source).not.toContain('Historial de pagos a proveedores — próximamente');
    expect(source).toContain('aria-label="Historial de pagos a proveedores"');
  });

  it('expone estados de carga, vacío y error recuperable', () => {
    expect(source).toContain('aria-label="Cargando pagos"');
    expect(source).toContain('Todavía no hay pagos registrados');
    expect(source).toContain('No pudimos actualizar proveedores, deudas y pagos');
    expect(source).toContain('onClick={() => void load()}');
  });

  it('el gate E2E explica la configuración local ausente antes de abrir browsers', () => {
    const config = readFileSync(resolve(process.cwd(), 'playwright.config.ts'), 'utf8');
    expect(config).toContain('missingLocalRuntime');
    expect(config).toContain('E2E_BASE_URL=https://nerqia.app');
  });
});
