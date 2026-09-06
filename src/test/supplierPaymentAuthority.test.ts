import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const migration = read('supabase/migrations/20260906000010_supplier_payment_transaction.sql');
const store = read('src/lib/supabaseStore.ts');
const page = read('src/pages/ProveedoresPage.tsx');

describe('autoridad del pago a proveedores', () => {
  it('bloquea la deuda y actualiza pago y saldo en una transacción SQL', () => {
    expect(migration).toContain('FOR UPDATE');
    expect(migration).toContain('INSERT INTO public.supplier_payments');
    expect(migration).toContain('UPDATE public.supplier_debts');
  });

  it('exige membresía y permiso de compras en el servidor', () => {
    expect(migration).toContain('FROM public.memberships');
    expect(migration).toContain("public.has_permission(v_debt.org_id, 'purchases', 'edit')");
    expect(migration).toContain("ERRCODE = '42501'");
  });

  it('rechaza importes inválidos, sobrepagos y métodos desconocidos', () => {
    expect(migration).toContain('v_amount <= 0');
    expect(migration).toContain('v_amount > v_debt.remaining_ars');
    expect(migration).toContain("v_method NOT IN ('efectivo', 'transferencia', 'cheque', 'debito', 'credito', 'otro')");
  });

  it('hace idempotente un replay y detecta una clave reutilizada con otro pago', () => {
    expect(migration).toContain('supplier_payments_org_idempotency_uq');
    expect(migration).toContain("'idempotent_replay', true");
    expect(migration).toContain("ERRCODE = '23505'");
  });

  it('el navegador sólo invoca la RPC y conserva claves al reintentar', () => {
    const helper = store.slice(store.indexOf('export async function addSupplierPaymentDB'), store.indexOf('// ========= CRM SEGMENTS'));
    expect(helper).toContain("supabase.rpc('record_supplier_payment'");
    expect(helper).not.toContain(".from('supplier_payments')");
    expect(helper).not.toContain(".from('supplier_debts')");
    expect(page).toContain('payAttemptKey || crypto.randomUUID()');
    expect(page).toContain('bulkPaymentKeys[debt.id] || crypto.randomUUID()');
  });

  it('no expone detalles internos inesperados en el cartel al comercio', () => {
    expect(store).toContain("const publicMessage = safeMessages.find");
    expect(store).toContain("throw new Error('No pudimos registrar el pago. Reintentá; el sistema no lo duplicará.')");
    expect(store).not.toContain('if (error) throw error;\n  return data;\n}\n\n// ========= CRM SEGMENTS');
  });
});
