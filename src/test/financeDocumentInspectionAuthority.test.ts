import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..', '..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
const migration = read('supabase/migrations/20260822000010_finance_document_inspection.sql');
const edge = read('supabase/functions/inspect-finance-document/index.ts');
const page = read('src/pages/FinanceDocumentsPage.tsx');
const client = read('src/lib/financeDocumentUpload.ts');

describe('autoridad del inspector de Finance Document Inbox', () => {
  it('revalida al usuario antes de habilitar service_role y storage privado', () => {
    expect(edge).toContain('requireUser');
    expect(edge.indexOf('requireUser(req')).toBeLessThan(edge.indexOf('SUPABASE_SERVICE_ROLE_KEY'));
    expect(edge).toContain('userClient.rpc');
    expect(edge).toContain('finance_document_begin_inspection');
    expect(edge).toContain('admin.storage');
  });

  it('recalcula hash, tamaño y MIME sobre los bytes descargados', () => {
    expect(edge).toContain('new Uint8Array(await original.arrayBuffer())');
    expect(edge).toContain('actualSizeBytes = bytes.byteLength');
    expect(edge).toContain('detectFinanceDocumentMime(bytes)');
    expect(edge).toContain('sha256Hex(bytes)');
    expect(migration).toContain('actual_sha256');
    expect(migration).toContain("WHEN v_hash_ok THEN 'verified'");
  });

  it('no confunde scanner ausente o caído con documento limpio', () => {
    expect(edge).toContain('FINANCE_DOCUMENT_SCANNER_URL');
    expect(edge).toContain('FINANCE_DOCUMENT_SCANNER_TOKEN');
    expect(edge).toContain('status: "unavailable"');
    expect(migration).toContain("p_scanner_status IN ('error', 'unavailable')");
    expect(migration).toContain("v_inspection_status := 'scanner_unavailable'");
    expect(edge.toLowerCase()).not.toContain('virustotal');
  });

  it('usa lease para que un timeout viejo no pise un retry', () => {
    expect(migration).toContain('inspection_token');
    expect(migration).toContain("interval '5 minutes'");
    expect(migration).toContain('Lease de inspección vencido o reemplazado');
    expect(migration).toContain('inspection_attempts = inspection_attempts + 1');
  });

  it('detecta duplicados por organización y sólo service_role completa estados', () => {
    expect(migration).toContain('other.org_id = v_version.org_id');
    expect(migration).toContain('other.actual_sha256 = p_actual_sha256');
    expect(migration).toContain("v_inspection_status := 'duplicate'");
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.finance_document_complete_inspection[\s\S]*?FROM PUBLIC, anon, authenticated/);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.finance_document_complete_inspection[\s\S]*?TO service_role/);
  });

  it('expone al usuario el bloqueo, cuarentena y retry sin activar OCR', () => {
    expect(client).toContain("supabase.functions.invoke('inspect-finance-document'");
    expect(page).toContain('Inspeccionar');
    expect(page).toContain('Listo para extraer');
    expect(page).toContain('Scanner pendiente');
    expect(page).toContain('Cuarentena');
    expect(edge).not.toContain('extract-invoice');
  });
});
