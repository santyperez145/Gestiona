import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..', '..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
const migration = read('supabase/migrations/20260822000009_finance_document_inbox.sql');
const page = read('src/pages/FinanceDocumentsPage.tsx');
const client = read('src/lib/financeDocumentUpload.ts');

describe('autoridad de Finance Document Inbox', () => {
  it('usa bucket privado con límites declarativos de MIME y tamaño', () => {
    expect(migration).toContain("'finance-documents'");
    expect(migration).toMatch(/INSERT INTO storage\.buckets[\s\S]*?VALUES \([\s\S]*?'finance-documents'[\s\S]*?false/);
    expect(migration).toContain('file_size_limit');
    expect(migration).toContain('allowed_mime_types');
    expect(migration).toContain('finance_document_storage_upload_allowed');
    expect(migration).toContain('finance_document_storage_read_allowed');
  });

  it('no deja reemplazar ni borrar originales desde la superficie', () => {
    expect(migration).toContain('Las versiones documentales son inmutables');
    expect(migration).toContain('Los datos originales de una versión no se pueden editar');
    expect(migration).not.toMatch(/CREATE POLICY[\s\S]{0,160}FOR DELETE[\s\S]{0,160}finance-documents/);
    expect(migration).not.toContain('FOR UPDATE TO authenticated');
    expect(page).not.toContain('getPublicUrl');
    expect(client).toContain('createSignedUrl');
  });

  it('separa intención, objeto subido e inspección', () => {
    expect(migration).toContain("upload_status IN ('pending_upload', 'uploaded', 'failed')");
    expect(migration).toContain("inspection_status IN ('pending', 'clean', 'rejected')");
    expect(migration).toContain("status = 'awaiting_inspection'");
    expect(migration).toContain('finance_document_finalize_upload');
    expect(migration).toContain('finance_document_events');
    expect(page).toContain('esperando inspección');
    expect(page).toContain('no crea deuda ni mueve stock');
  });

  it('mantiene el hash como declaración hasta la verificación server-side', () => {
    expect(migration).toMatch(/hash_status\s+text NOT NULL DEFAULT 'declared'/);
    expect(migration).toContain('Hash declarado al cargar');
    expect(page).toContain('El servidor recalcula hash, tamaño y firma binaria');
    expect(page).toContain('scanner privado');
  });
});
