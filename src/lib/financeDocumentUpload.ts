import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';

export const FINANCE_DOCUMENT_BUCKET = 'finance-documents';
export const FINANCE_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
export const FINANCE_DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export type FinanceDocumentMimeType = typeof FINANCE_DOCUMENT_MIME_TYPES[number];
export type FinanceDocumentType = 'supplier_invoice' | 'receipt' | 'purchase_order' | 'other';
export type FinanceDocumentStatus = 'pending_upload' | 'upload_failed' | 'awaiting_inspection' | 'in_review' | 'approved' | 'rejected' | 'quarantined';
export type FinanceDocumentUploadStatus = 'pending_upload' | 'uploaded' | 'failed';
export type FinanceDocumentInspectionStatus =
  | 'pending'
  | 'scanning'
  | 'scanner_unavailable'
  | 'clean'
  | 'ready_for_extraction'
  | 'duplicate'
  | 'quarantined'
  | 'rejected';
export type FinanceDocumentExtractionStatus =
  | 'extracting'
  | 'needs_review'
  | 'ready_for_review'
  | 'reviewed'
  | 'failed';

export interface FinanceDocumentExtractionItem {
  description: string;
  sku: string | null;
  quantity: number | null;
  unit_price: number | null;
  line_total: number | null;
  tax_rate: number | null;
}

export interface FinanceDocumentExtractionPayload {
  supplier_name: string | null;
  supplier_tax_id: string | null;
  document_number: string | null;
  issue_date: string | null;
  currency: 'ARS' | 'USD' | null;
  subtotal: number | null;
  tax_total: number | null;
  total: number | null;
  items: FinanceDocumentExtractionItem[];
}

export interface FinanceDocumentExtraction {
  id: string;
  versionId: string;
  attempt: number;
  status: FinanceDocumentExtractionStatus;
  overallConfidence: number | null;
  validationErrors: string[];
  failureReason: string | null;
  provider: string | null;
  model: string | null;
  revisionNumber: number | null;
  revisionSource: 'model' | 'human' | null;
  payload: FinanceDocumentExtractionPayload | null;
  updatedAt: string;
}

export interface FinanceDocumentVersion {
  id: string;
  documentId: string;
  versionNumber: number;
  originalFilename: string;
  mimeType: FinanceDocumentMimeType;
  sizeBytes: number;
  sha256: string;
  hashStatus: 'declared' | 'verified' | 'mismatch';
  uploadStatus: FinanceDocumentUploadStatus;
  inspectionStatus: FinanceDocumentInspectionStatus;
  failureReason: string | null;
  storagePath: string;
  createdAt: string;
  uploadedAt: string | null;
  extraction: FinanceDocumentExtraction | null;
}

export interface FinanceDocument {
  id: string;
  orgId: string;
  documentType: FinanceDocumentType;
  title: string;
  status: FinanceDocumentStatus;
  createdAt: string;
  updatedAt: string;
  versions: FinanceDocumentVersion[];
}

export interface FinanceUploadIntent {
  documentId: string;
  versionId: string;
  versionNumber: number;
  storagePath: string;
}

export interface FinanceDocumentInspectionResult {
  document_id: string;
  version_id: string;
  document_status: FinanceDocumentStatus;
  inspection_status: FinanceDocumentInspectionStatus;
  hash_status: FinanceDocumentVersion['hashStatus'];
  duplicate_of_version_id: string | null;
}

export interface FinanceDocumentExtractionResult {
  extraction_id: string;
  extraction_status: FinanceDocumentExtractionStatus;
  overall_confidence: number | null;
  validation_errors: string[];
}

export function validateFinanceDocumentFile(file: Pick<File, 'name' | 'type' | 'size'>): string | null {
  if (!file.name.trim()) return 'El archivo necesita un nombre.';
  if (!FINANCE_DOCUMENT_MIME_TYPES.includes(file.type as FinanceDocumentMimeType)) {
    return 'Sólo se aceptan PDF, JPG, PNG o WEBP.';
  }
  if (file.size <= 0 || file.size > FINANCE_DOCUMENT_MAX_BYTES) {
    return 'El archivo debe pesar entre 1 byte y 10 MB.';
  }
  return null;
}

export async function sha256File(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function getFinanceDocuments(orgId: string): Promise<FinanceDocument[]> {
  const { data: documentRows, error: documentError } = await supabase
    .from('finance_documents')
    .select('id, org_id, document_type, title, status, created_at, updated_at')
    .eq('org_id', orgId)
    .order('updated_at', { ascending: false });
  if (documentError) throw documentError;

  const documents = (documentRows || []) as unknown as Array<{
    id: string;
    org_id: string;
    document_type: FinanceDocumentType;
    title: string;
    status: FinanceDocumentStatus;
    created_at: string;
    updated_at: string;
  }>;
  if (!documents.length) return [];

  const { data: versionRows, error: versionError } = await supabase
    .from('finance_document_versions')
    .select('id, document_id, version_number, storage_path, original_filename, mime_type, size_bytes, sha256, hash_status, upload_status, inspection_status, failure_reason, created_at, uploaded_at')
    .in('document_id', documents.map(document => document.id))
    .order('version_number', { ascending: false });
  if (versionError) throw versionError;

  const versionsByDocument = new Map<string, FinanceDocumentVersion[]>();
  for (const row of (versionRows || []) as unknown as Array<Record<string, unknown>>) {
    const version: FinanceDocumentVersion = {
      id: String(row.id),
      documentId: String(row.document_id),
      versionNumber: Number(row.version_number),
      originalFilename: String(row.original_filename),
      mimeType: row.mime_type as FinanceDocumentMimeType,
      sizeBytes: Number(row.size_bytes),
      sha256: String(row.sha256),
      hashStatus: row.hash_status as FinanceDocumentVersion['hashStatus'],
      uploadStatus: row.upload_status as FinanceDocumentUploadStatus,
      inspectionStatus: row.inspection_status as FinanceDocumentVersion['inspectionStatus'],
      failureReason: (row.failure_reason as string | null) || null,
      storagePath: String(row.storage_path),
      createdAt: String(row.created_at),
      uploadedAt: (row.uploaded_at as string | null) || null,
      extraction: null,
    };
    const current = versionsByDocument.get(version.documentId) || [];
    current.push(version);
    versionsByDocument.set(version.documentId, current);
  }

  const versionIds = [...versionsByDocument.values()].flat().map(version => version.id);
  if (versionIds.length) {
    const { data: extractionRows, error: extractionError } = await supabase
      .from('finance_document_extractions')
      .select('id, version_id, attempt, status, overall_confidence, validation_errors, failure_reason, provider, model, updated_at')
      .in('version_id', versionIds)
      .order('attempt', { ascending: false });
    if (extractionError && !isMissingFinanceExtractionRelation(extractionError)) throw extractionError;

    const latestByVersion = new Map<string, FinanceDocumentExtraction>();
    for (const row of (extractionRows || []) as unknown as Array<Record<string, unknown>>) {
      const versionId = String(row.version_id);
      if (latestByVersion.has(versionId)) continue;
      latestByVersion.set(versionId, {
        id: String(row.id),
        versionId,
        attempt: Number(row.attempt),
        status: row.status as FinanceDocumentExtractionStatus,
        overallConfidence: row.overall_confidence === null ? null : Number(row.overall_confidence),
        validationErrors: Array.isArray(row.validation_errors) ? row.validation_errors.map(String) : [],
        failureReason: (row.failure_reason as string | null) || null,
        provider: (row.provider as string | null) || null,
        model: (row.model as string | null) || null,
        revisionNumber: null,
        revisionSource: null,
        payload: null,
        updatedAt: String(row.updated_at),
      });
    }

    const extractionIds = [...latestByVersion.values()].map(extraction => extraction.id);
    if (extractionIds.length) {
      const { data: revisionRows, error: revisionError } = await supabase
        .from('finance_document_extraction_revisions')
        .select('extraction_id, revision_number, source, payload')
        .in('extraction_id', extractionIds)
        .order('revision_number', { ascending: false });
      if (revisionError && !isMissingFinanceExtractionRelation(revisionError)) throw revisionError;
      const seen = new Set<string>();
      for (const row of (revisionRows || []) as unknown as Array<Record<string, unknown>>) {
        const extractionId = String(row.extraction_id);
        if (seen.has(extractionId)) continue;
        seen.add(extractionId);
        const extraction = [...latestByVersion.values()].find(candidate => candidate.id === extractionId);
        if (!extraction) continue;
        extraction.revisionNumber = Number(row.revision_number);
        extraction.revisionSource = row.source as 'model' | 'human';
        extraction.payload = row.payload as unknown as FinanceDocumentExtractionPayload;
      }
    }

    for (const versions of versionsByDocument.values()) {
      for (const version of versions) version.extraction = latestByVersion.get(version.id) || null;
    }
  }

  return documents.map(document => ({
    id: document.id,
    orgId: document.org_id,
    documentType: document.document_type,
    title: document.title,
    status: document.status,
    createdAt: document.created_at,
    updatedAt: document.updated_at,
    versions: versionsByDocument.get(document.id) || [],
  }));
}

export async function createFinanceDocumentUpload(
  orgId: string,
  documentType: FinanceDocumentType,
  file: File,
  sha256: string,
): Promise<FinanceUploadIntent> {
  const { data, error } = await supabase.rpc('finance_document_create_upload', {
    p_org_id: orgId,
    p_document_type: documentType,
    p_file_name: file.name,
    p_mime_type: file.type,
    p_size_bytes: file.size,
    p_sha256: sha256,
  });
  if (error) throw error;
  const row = data?.[0];
  if (!row) throw new Error('La base no devolvió una intención de carga.');
  return {
    documentId: row.document_id,
    versionId: row.version_id,
    versionNumber: 1,
    storagePath: row.storage_path,
  };
}

export async function createFinanceDocumentVersion(
  documentId: string,
  file: File,
  sha256: string,
): Promise<FinanceUploadIntent> {
  const { data, error } = await supabase.rpc('finance_document_create_version', {
    p_document_id: documentId,
    p_file_name: file.name,
    p_mime_type: file.type,
    p_size_bytes: file.size,
    p_sha256: sha256,
  });
  if (error) throw error;
  const row = data?.[0];
  if (!row) throw new Error('La base no devolvió una versión nueva.');
  return {
    documentId: row.document_id,
    versionId: row.version_id,
    versionNumber: Number(row.version_number),
    storagePath: row.storage_path,
  };
}

export async function uploadFinanceDocument(intent: FinanceUploadIntent, file: File): Promise<void> {
  const { error } = await supabase.storage.from(FINANCE_DOCUMENT_BUCKET).upload(intent.storagePath, file, {
    contentType: file.type,
    cacheControl: '3600',
    upsert: false,
  });
  if (error) throw error;
  const { error: finalizeError } = await supabase.rpc('finance_document_finalize_upload', {
    p_document_id: intent.documentId,
    p_version_id: intent.versionId,
  });
  if (finalizeError) throw finalizeError;
}

export async function markFinanceDocumentUploadFailed(intent: FinanceUploadIntent, reason: string): Promise<void> {
  const { error } = await supabase.rpc('finance_document_mark_upload_failed', {
    p_document_id: intent.documentId,
    p_version_id: intent.versionId,
    p_reason: reason,
  });
  if (error) throw error;
}

export async function inspectFinanceDocument(
  documentId: string,
  versionId: string,
): Promise<FinanceDocumentInspectionResult | null> {
  const { data, error } = await supabase.functions.invoke('inspect-finance-document', {
    body: { documentId, versionId },
  });
  if (error) throw error;
  if (data?.error) throw new Error(String(data.error));
  if (data?.skipped) return null;
  return (data?.result || null) as FinanceDocumentInspectionResult | null;
}

export async function extractFinanceDocument(
  documentId: string,
  versionId: string,
): Promise<FinanceDocumentExtractionResult | null> {
  const { data, error } = await supabase.functions.invoke('extract-finance-document', {
    body: { documentId, versionId },
  });
  if (error) throw error;
  if (data?.error) throw new Error(String(data.error));
  if (data?.skipped) return null;
  return (data?.result || null) as FinanceDocumentExtractionResult | null;
}

export async function reviewFinanceDocumentExtraction(
  extractionId: string,
  payload: FinanceDocumentExtractionPayload,
  note?: string,
): Promise<void> {
  const { error } = await supabase.rpc('finance_document_submit_extraction_review', {
    p_extraction_id: extractionId,
    p_payload: payload as unknown as Json,
    p_note: note || null,
  });
  if (error) throw error;
}

export async function createFinanceDocumentSignedUrl(storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from(FINANCE_DOCUMENT_BUCKET)
    .createSignedUrl(storagePath, 60);
  if (error) throw error;
  return data.signedUrl;
}

export function financeDocumentTypeLabel(type: FinanceDocumentType): string {
  return {
    supplier_invoice: 'Factura de proveedor',
    receipt: 'Comprobante',
    purchase_order: 'Orden de compra',
    other: 'Otro documento',
  }[type];
}

export function financeDocumentStatusLabel(status: FinanceDocumentStatus): string {
  return {
    pending_upload: 'Carga pendiente',
    upload_failed: 'Carga fallida',
    awaiting_inspection: 'Esperando inspección',
    in_review: 'En revisión',
    approved: 'Aprobado',
    rejected: 'Rechazado',
    quarantined: 'En cuarentena',
  }[status];
}

function isMissingFinanceExtractionRelation(error: { code?: string; message?: string }): boolean {
  return ['42P01', 'PGRST205'].includes(error.code || '')
    || /finance_document_extractions|finance_document_extraction_revisions/i.test(error.message || '')
      && /does not exist|schema cache/i.test(error.message || '');
}
