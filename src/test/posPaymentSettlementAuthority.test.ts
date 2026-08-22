import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(resolve(
  process.cwd(),
  'supabase/migrations/20260822000006_pos_payment_settlements.sql',
), 'utf8');
const store = readFileSync(resolve(process.cwd(), 'src/lib/supabaseStore.ts'), 'utf8');
const panel = readFileSync(resolve(
  process.cwd(),
  'src/components/finance/PaymentSettlementsPanel.tsx',
), 'utf8');
const pos = readFileSync(resolve(process.cwd(), 'src/pages/POSPage.tsx'), 'utf8');

describe('POS payment settlement authority', () => {
  it('crea venta y evidencia de cobro en un único RPC', () => {
    expect(migration).toContain('public.create_sales_transaction_v3');
    expect(migration).toContain('public.capture_pos_payment_transactions');
    expect(store).toContain("'create_sales_transaction_v3'");
  });

  it('no expone los helpers que escriben cobros o ledger', () => {
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.capture_pos_payment_transactions(uuid, uuid)',
    );
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.ledger_asentar_liquidacion_pos(uuid)',
    );
  });

  it('exige permiso financiero en la base y no sólo en la UI', () => {
    expect(migration).toContain("public.has_permission(v_payment.org_id, 'payments', 'edit')");
    expect(panel).toContain("useHasPermission('payments', 'edit')");
  });

  it('no deja que una parte aprobada esconda otra pendiente', () => {
    expect(migration).toContain("HAVING bool_or(payment.status <> 'approved')");
    expect(migration).toContain("THEN 'liquidacion_cobro'");
  });

  it('concilia por residuo y deja auditoría y asiento', () => {
    expect(migration).toContain('v_payment.gross_amount');
    expect(migration).toContain("'liquidacion_pos'");
    expect(migration).toContain("'payment_settlement'");
    expect(panel).toContain("'confirm_pos_payment_settlement'");
  });

  it('persiste el total posterior a cupón y descuento global con su baseline', () => {
    expect(pos).toContain('const finalUnitPrice = item.quantity > 0 ? adjustedTotal / item.quantity : 0');
    expect(pos).toContain('unit_price_ars: finalUnitPrice');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS precio_autoritativo');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS override_de_precio');
  });
});
