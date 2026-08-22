import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const migration = read('supabase/migrations/20260822000013_finance_document_drafts.sql');
const client = read('src/lib/financeDocumentUpload.ts');
const page = read('src/pages/FinanceDocumentsPage.tsx');

describe('autoridad de borradores documentales Finance', () => {
  it('separa factura, compra, líneas y obligación bajo RLS de sólo lectura', () => {
    for (const table of [
      'finance_supplier_invoice_drafts',
      'finance_purchase_drafts',
      'finance_purchase_draft_lines',
      'finance_payable_drafts',
    ]) {
      expect(migration).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
      expect(migration).toContain(`REVOKE ALL ON public.${table} FROM PUBLIC, anon, authenticated`);
    }
  });

  it('sólo prepara la última revisión humana con matching confirmado', () => {
    const creation = migration.split('CREATE OR REPLACE FUNCTION public.finance_document_create_drafts')[1]
      .split('CREATE OR REPLACE FUNCTION public.finance_document_approve_drafts')[0];
    expect(creation).toContain("v_extraction.status <> 'reviewed'");
    expect(creation).toContain("v_revision.source <> 'human'");
    expect(creation).toContain("run.status = 'confirmed'");
    expect(creation).toContain('Confirmá el matching vigente antes de crear borradores');
  });

  it('crear borradores no escribe ningún efecto del Business Core', () => {
    const creation = migration.split('CREATE OR REPLACE FUNCTION public.finance_document_create_drafts')[1]
      .split('CREATE OR REPLACE FUNCTION public.finance_document_approve_drafts')[0];
    expect(creation).not.toMatch(/INSERT INTO public\.(purchase_orders|purchase_order_items|purchases|supplier_debts|stock_movements|ledger_entries)/);
    expect(creation).toContain("'drafts_created'");
  });

  it('segrega aprobación a owner/admin con finance.edit y retry idempotente', () => {
    const approval = migration.split('CREATE OR REPLACE FUNCTION public.finance_document_approve_drafts')[1]
      .split('CREATE OR REPLACE FUNCTION public.guard_approved_finance_invoice_revision')[0];
    expect(approval).toContain("finance_document_can(v_invoice.org_id, 'edit')");
    expect(approval).toContain("has_org_role(v_invoice.org_id, auth.uid(), ARRAY['owner', 'admin'])");
    expect(approval.indexOf("IF v_invoice.status = 'approved'"))
      .toBeLessThan(approval.indexOf('INSERT INTO public.purchase_orders'));
  });

  it('la aprobación crea orden y deuda pero deja recepción, stock y ledger afuera', () => {
    const approval = migration.split('CREATE OR REPLACE FUNCTION public.finance_document_approve_drafts')[1]
      .split('CREATE OR REPLACE FUNCTION public.guard_approved_finance_invoice_revision')[0];
    expect(approval).toContain('INSERT INTO public.purchase_orders');
    expect(approval).toContain("'confirmed', v_invoice.currency");
    expect(approval).toContain('INSERT INTO public.supplier_debts');
    expect(approval).not.toMatch(/INSERT INTO public\.(purchases|stock_movements|ledger_entries)/);
    expect(migration).toContain('el stock espera receive_purchase_order');
  });

  it('obliga a clasificar inventario versus cargo no inventariable', () => {
    expect(migration).toContain("disposition IN ('inventory', 'non_inventory', 'unresolved')");
    expect(migration).toContain("v_disposition = 'non_inventory'");
    expect(migration).toContain('Resolvé la línea % como inventario o cargo no inventariable');
    expect(page).toContain('Cargo no inventariable');
  });

  it('el cliente usa RPC y la UI explica los tres estados y el efecto físico', () => {
    expect(client).toContain("supabase.rpc('finance_document_create_drafts'");
    expect(client).toContain("supabase.rpc('finance_document_get_drafts'");
    expect(client).toContain("supabase.rpc('finance_document_approve_drafts'");
    expect(page).toContain('Supplier Invoice Draft');
    expect(page).toContain('Purchase Draft');
    expect(page).toContain('Payable Draft');
    expect(page).toContain('el stock no cambia hasta registrar la recepción');
    expect(page).toContain("['needs_review', 'ready_for_review', 'reviewed']");
    expect(page).toContain('Borradores por regenerar');
  });

  it('el fixture prueba outsider, retry, Core aprobado, stock quieto y restos cero', () => {
    expect(migration).toContain('Un outsider pudo crear borradores Finance');
    expect(migration).toContain('Retry exacto: el estado aprobado es la clave idempotente');
    expect(migration).toContain("quantity_received <> 0");
    expect(migration).toContain("stock FROM public.products WHERE id = v_product");
    expect(migration).toContain('stock quieto y restos 0');
  });
});
