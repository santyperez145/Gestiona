import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const migration = read('supabase/migrations/20260822000011_finance_document_extraction.sql');
const edge = read('supabase/functions/extract-finance-document/index.ts');
const page = read('src/pages/FinanceDocumentsPage.tsx');
const client = read('src/lib/financeDocumentUpload.ts');

describe('autoridad de extracción documental Finance', () => {
  it('revalida JWT y finance.edit antes de usar service_role o proveedor pago', () => {
    expect(edge).toContain('requireUser(req, corsHeaders)');
    expect(edge.indexOf('requireUser(req, corsHeaders)')).toBeLessThan(edge.indexOf('createClient(url, serviceRole)'));
    expect(edge.indexOf('finance_document_begin_extraction')).toBeLessThan(edge.indexOf('ANTHROPIC_API_KEY'));
    expect(migration).toContain("finance_document_can(v_version.org_id, 'edit')");
  });

  it('el navegador sólo envía ids y la Edge descarga el original privado', () => {
    expect(client).toContain("body: { documentId, versionId }");
    expect(edge).not.toContain('fileBase64');
    expect(edge).toContain('.from("finance-documents")');
    expect(edge).toContain('actualSha256 !== target.source_sha256');
  });

  it('sólo extrae una versión inspeccionada, limpia y con hash verificado', () => {
    expect(migration).toContain("v_version.inspection_status <> 'ready_for_extraction'");
    expect(migration).toContain("v_version.scanner_status <> 'clean'");
    expect(migration).toContain("v_version.hash_status <> 'verified'");
    expect(migration).toContain('actual_sha256 IS DISTINCT FROM lower(v_version.sha256)');
  });

  it('falla cerrado hasta aprobar privacidad, proveedor y modelo', () => {
    expect(edge).toContain('Deno.env.get("FINANCE_DOCUMENT_EXTRACTION_ENABLED") === "true"');
    expect(edge).toContain('FINANCE_DOCUMENT_MODEL');
    expect(edge.indexOf('if (!enabled || !apiKey || !model)')).toBeLessThan(edge.indexOf('https://api.anthropic.com/v1/messages'));
    expect(edge).toContain('tool_choice: { type: "tool", name: extractionTool.name }');
  });

  it('completion es service-only y confidence bajo obliga revisión', () => {
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.finance_document_complete_extraction[\s\S]*?FROM PUBLIC, anon, authenticated/);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.finance_document_complete_extraction[\s\S]*?TO service_role/);
    expect(migration).toContain("v_confidence := least(v_confidence, 0.69)");
    expect(migration).toContain("THEN 'ready_for_review' ELSE 'needs_review'");
  });

  it('la revisión es append-only y no toca dominios operativos', () => {
    expect(migration).toContain("source IN ('model', 'human')");
    expect(migration).toContain("'human', p_payload");
    const reviewFunction = migration.split('CREATE OR REPLACE FUNCTION public.finance_document_submit_extraction_review')[1];
    expect(reviewFunction).not.toMatch(/INSERT INTO public\.(purchases|supplier_debts|stock_movements|ledger_entries)/);
    expect(migration).toContain('cero efectos y restos 0');
  });

  it('la UI muestra confidence, observaciones y editor estructurado', () => {
    expect(page).toContain('Confianza {confidence}%');
    expect(page).toContain('Observaciones del borrador del modelo');
    expect(page).toContain('Confirmar revisión');
    expect(page).toContain('no crea compras, obligaciones, stock ni asientos');
  });
});
