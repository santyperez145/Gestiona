import { supabase } from '@/integrations/supabase/client';

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
    };
    const current = versionsByDocument.get(version.documentId) || [];
    current.push(version);
    versionsByDocument.set(version.documentId, current);
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
