import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const migration = read('supabase/migrations/20260822000012_finance_document_matching.sql');
const client = read('src/lib/financeDocumentUpload.ts');
const page = read('src/pages/FinanceDocumentsPage.tsx');

describe('autoridad de matching documental Finance', () => {
  it('sólo matchea una revisión humana confirmada', () => {
    expect(migration).toContain("v_extraction.status <> 'reviewed'");
    expect(migration).toContain("v_revision.source <> 'human'");
    expect(migration).toContain('Primero confirmá la revisión humana');
  });

  it('propone aliases o identidades exactas y conserva los empates', () => {
    expect(migration).toContain('public.normalize_identity_text');
    expect(migration).toContain('public.normalize_product_sku');
    expect(migration).toContain("v_product_method := 'ambiguous'");
    expect(migration).toContain("v_supplier_method := 'ambiguous'");
    expect(migration).not.toMatch(/similarity\s*\(|levenshtein\s*\(|word_similarity\s*\(/i);
  });

  it('aprende aliases sólo dentro de la confirmación protegida', () => {
    const confirmation = migration.split('CREATE OR REPLACE FUNCTION public.finance_document_confirm_matching')[1];
    expect(confirmation).toContain('INSERT INTO public.finance_supplier_aliases');
    expect(confirmation).toContain('INSERT INTO public.finance_product_aliases');
    expect(migration.split('CREATE OR REPLACE FUNCTION public.finance_document_run_matching')[1].split('CREATE OR REPLACE FUNCTION public.finance_document_confirm_matching')[0])
      .not.toContain('INSERT INTO public.finance_supplier_aliases');
  });

  it('impide reasignar silenciosamente un alias a otra entidad', () => {
    expect(migration).toContain('El CUIT ya pertenece a otro proveedor');
    expect(migration).toContain('El SKU del proveedor ya pertenece a otro producto');
    expect(migration).toContain('La descripción del proveedor ya pertenece a otro producto');
  });

  it('revoca escrituras directas y revalida tenant más finance.edit', () => {
    expect(migration).toMatch(/REVOKE ALL ON public\.finance_supplier_aliases FROM PUBLIC, anon, authenticated/);
    expect(migration).toMatch(/REVOKE ALL ON public\.finance_document_match_runs FROM PUBLIC, anon, authenticated/);
    expect(migration).toContain("finance_document_can(v_extraction.org_id, 'edit')");
    expect(migration).toContain("finance_document_can(v_run.org_id, 'edit')");
  });

  it('no crea efectos operativos y el cliente sólo usa RPC', () => {
    const confirmation = migration.split('CREATE OR REPLACE FUNCTION public.finance_document_confirm_matching')[1]
      .split('REVOKE ALL ON FUNCTION public.finance_document_get_matching')[0];
    expect(confirmation).not.toMatch(/INSERT INTO public\.(purchases|supplier_debts|stock_movements|ledger_entries)/);
    expect(client).toContain("supabase.rpc('finance_document_run_matching'");
    expect(client).toContain("supabase.rpc('finance_document_confirm_matching'");
  });

  it('la UI expone ambigüedad, selección canónica y límite de efectos', () => {
    expect(page).toContain('Confirmar proveedor y productos');
    expect(page).toContain('Un empate nunca se elige solo');
    expect(page).toContain('Confirmar y aprender aliases');
    expect(page).toContain('no crea compras, deuda, stock ni asientos');
  });

  it('el fixture prueba la factura siguiente, outsider, retry y restos cero', () => {
    expect(migration).toContain("'{supplier,match_method}' <> 'tax_alias'");
    expect(migration).toContain("'{lines,0,match_method}' <> 'supplier_sku_alias'");
    expect(migration).toContain("'{lines,1,match_method}' <> 'ambiguous'");
    expect(migration).toContain('Retry exacto: no duplica aliases ni eventos');
    expect(migration).toContain('Un outsider pudo leer/ejecutar matching Finance');
    expect(migration).toContain('cero efectos y restos 0');
  });
});
