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
export type FinanceDocumentMatchingStatus = 'proposed' | 'confirmed' | 'superseded';
export type FinanceSupplierMatchMethod = 'tax_alias' | 'name_alias' | 'exact_name' | 'none' | 'ambiguous';
export type FinanceProductMatchMethod = 'supplier_sku_alias' | 'exact_sku' | 'description_alias' | 'exact_name' | 'none' | 'ambiguous';

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
  matching: FinanceDocumentMatching | null;
  updatedAt: string;
}

export interface FinanceDocumentMatchingSupplier {
  extractedName: string | null;
  extractedTaxId: string | null;
  proposedSupplierId: string | null;
  confirmedSupplierId: string | null;
  selectedSupplierId: string | null;
  selectedSupplierName: string | null;
  matchMethod: FinanceSupplierMatchMethod;
  candidateCount: number;
}

export interface FinanceDocumentLineMatching {
  lineNumber: number;
  description: string;
  sku: string | null;
  proposedProductId: string | null;
  confirmedProductId: string | null;
  selectedProductId: string | null;
  selectedProductName: string | null;
  selectedProductSku: string | null;
  matchMethod: FinanceProductMatchMethod;
  candidateCount: number;
  confirmationMethod: 'accepted' | 'manual' | 'unmatched' | null;
}

export interface FinanceDocumentMatching {
  runId: string;
  extractionId: string;
  revisionNumber: number;
  status: FinanceDocumentMatchingStatus;
  supplier: FinanceDocumentMatchingSupplier;
  lines: FinanceDocumentLineMatching[];
}

export interface FinanceMatchingSupplierOption {
  id: string;
  name: string;
}

export interface FinanceMatchingProductOption {
  id: string;
  name: string;
  brand: string;
  sku: string | null;
  supplierId: string | null;
}

export interface FinanceMatchingOptions {
  suppliers: FinanceMatchingSupplierOption[];
  products: FinanceMatchingProductOption[];
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
        matching: null,
        updatedAt: String(row.updated_at),
      });
    }

    const extractionIds = [...latestByVersion.values()].map(extraction => extraction.id);
    if (extractionIds.length) {
      const extractionById = new Map([...latestByVersion.values()].map(extraction => [extraction.id, extraction]));
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
        const extraction = extractionById.get(extractionId);
        if (!extraction) continue;
        extraction.revisionNumber = Number(row.revision_number);
        extraction.revisionSource = row.source as 'model' | 'human';
        extraction.payload = row.payload as unknown as FinanceDocumentExtractionPayload;
      }

      const { data: runRows, error: runError } = await supabase
        .from('finance_document_match_runs')
        .select('id, extraction_id, revision_number, status, proposed_supplier_id, supplier_match_method, supplier_candidate_count, confirmed_supplier_id, created_at')
        .in('extraction_id', extractionIds)
        .order('created_at', { ascending: false });
      if (runError && !isMissingFinanceMatchingRelation(runError)) throw runError;

      const latestRunByExtraction = new Map<string, Record<string, unknown>>();
      for (const row of (runRows || []) as unknown as Array<Record<string, unknown>>) {
        const extractionId = String(row.extraction_id);
        if (!latestRunByExtraction.has(extractionId)) latestRunByExtraction.set(extractionId, row);
      }
      const runIds = [...latestRunByExtraction.values()].map(row => String(row.id));
      if (runIds.length) {
        const { data: lineRows, error: lineError } = await supabase
          .from('finance_document_line_matches')
          .select('match_run_id, line_number, extracted_sku, extracted_description, proposed_product_id, proposed_method, candidate_count, confirmed_product_id, confirmation_method')
          .in('match_run_id', runIds)
          .order('line_number');
        if (lineError && !isMissingFinanceMatchingRelation(lineError)) throw lineError;
        const linesByRun = new Map<string, Array<Record<string, unknown>>>();
        for (const row of (lineRows || []) as unknown as Array<Record<string, unknown>>) {
          const runId = String(row.match_run_id);
          const lines = linesByRun.get(runId) || [];
          lines.push(row);
          linesByRun.set(runId, lines);
        }

        for (const [extractionId, run] of latestRunByExtraction) {
          const extraction = extractionById.get(extractionId);
          if (!extraction) continue;
          const payload = extraction.payload;
          const runId = String(run.id);
          extraction.matching = {
            runId,
            extractionId,
            revisionNumber: Number(run.revision_number),
            status: run.status as FinanceDocumentMatchingStatus,
            supplier: {
              extractedName: payload?.supplier_name || null,
              extractedTaxId: payload?.supplier_tax_id || null,
              proposedSupplierId: (run.proposed_supplier_id as string | null) || null,
              confirmedSupplierId: (run.confirmed_supplier_id as string | null) || null,
              selectedSupplierId: ((run.confirmed_supplier_id || run.proposed_supplier_id) as string | null) || null,
              selectedSupplierName: null,
              matchMethod: run.supplier_match_method as FinanceSupplierMatchMethod,
              candidateCount: Number(run.supplier_candidate_count || 0),
            },
            lines: (linesByRun.get(runId) || []).map(line => ({
              lineNumber: Number(line.line_number),
              description: String(line.extracted_description),
              sku: (line.extracted_sku as string | null) || null,
              proposedProductId: (line.proposed_product_id as string | null) || null,
              confirmedProductId: (line.confirmed_product_id as string | null) || null,
              selectedProductId: ((line.confirmed_product_id || line.proposed_product_id) as string | null) || null,
              selectedProductName: null,
              selectedProductSku: null,
              matchMethod: line.proposed_method as FinanceProductMatchMethod,
              candidateCount: Number(line.candidate_count || 0),
              confirmationMethod: (line.confirmation_method as FinanceDocumentLineMatching['confirmationMethod']) || null,
            })),
          };
        }
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

export async function runFinanceDocumentMatching(extractionId: string): Promise<FinanceDocumentMatching> {
  const { data, error } = await supabase.rpc('finance_document_run_matching', {
    p_extraction_id: extractionId,
  });
  if (error) throw error;
  const matching = parseFinanceDocumentMatching(data);
  if (!matching) throw new Error('La base no devolvió una propuesta de matching.');
  return matching;
}

export async function confirmFinanceDocumentMatching(
  matchRunId: string,
  supplierId: string,
  lines: Array<{ line_number: number; product_id: string | null }>,
): Promise<FinanceDocumentMatching> {
  const { data, error } = await supabase.rpc('finance_document_confirm_matching', {
    p_match_run_id: matchRunId,
    p_supplier_id: supplierId,
    p_lines: lines as unknown as Json,
  });
  if (error) throw error;
  const matching = parseFinanceDocumentMatching(data);
  if (!matching) throw new Error('La base no devolvió el matching confirmado.');
  return matching;
}

export async function getFinanceMatchingOptions(orgId: string): Promise<FinanceMatchingOptions> {
  const [supplierResult, productResult] = await Promise.all([
    supabase.from('suppliers').select('id, name').eq('org_id', orgId).eq('active', true).order('name'),
    supabase.from('products').select('id, name, brand, sku, supplier_id').eq('org_id', orgId).eq('is_active', true).order('name'),
  ]);
  if (supplierResult.error) throw supplierResult.error;
  if (productResult.error) throw productResult.error;
  return {
    suppliers: (supplierResult.data || []).map(row => ({ id: row.id, name: row.name })),
    products: (productResult.data || []).map(row => ({
      id: row.id,
      name: row.name,
      brand: row.brand,
      sku: row.sku,
      supplierId: row.supplier_id,
    })),
  };
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

function isMissingFinanceMatchingRelation(error: { code?: string; message?: string }): boolean {
  return ['42P01', '42883', 'PGRST202', 'PGRST205'].includes(error.code || '')
    || /finance_document_(get_matching|match_runs|line_matches)/i.test(error.message || '')
      && /does not exist|schema cache|could not find/i.test(error.message || '');
}

function parseFinanceDocumentMatching(value: Json | null): FinanceDocumentMatching | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, Json | undefined>;
  const supplierRaw = raw.supplier;
  if (!raw.run_id || !raw.extraction_id || !supplierRaw || typeof supplierRaw !== 'object' || Array.isArray(supplierRaw)) return null;
  const supplier = supplierRaw as Record<string, Json | undefined>;
  const lines = Array.isArray(raw.lines) ? raw.lines : [];
  return {
    runId: String(raw.run_id),
    extractionId: String(raw.extraction_id),
    revisionNumber: Number(raw.revision_number),
    status: String(raw.status) as FinanceDocumentMatchingStatus,
    supplier: {
      extractedName: nullableString(supplier.extracted_name),
      extractedTaxId: nullableString(supplier.extracted_tax_id),
      proposedSupplierId: nullableString(supplier.proposed_supplier_id),
      confirmedSupplierId: nullableString(supplier.confirmed_supplier_id),
      selectedSupplierId: nullableString(supplier.selected_supplier_id),
      selectedSupplierName: nullableString(supplier.selected_supplier_name),
      matchMethod: String(supplier.match_method) as FinanceSupplierMatchMethod,
      candidateCount: Number(supplier.candidate_count || 0),
    },
    lines: lines.flatMap(line => {
      if (!line || typeof line !== 'object' || Array.isArray(line)) return [];
      const item = line as Record<string, Json | undefined>;
      return [{
        lineNumber: Number(item.line_number),
        description: String(item.description || ''),
        sku: nullableString(item.sku),
        proposedProductId: nullableString(item.proposed_product_id),
        confirmedProductId: nullableString(item.confirmed_product_id),
        selectedProductId: nullableString(item.selected_product_id),
        selectedProductName: nullableString(item.selected_product_name),
        selectedProductSku: nullableString(item.selected_product_sku),
        matchMethod: String(item.match_method) as FinanceProductMatchMethod,
        candidateCount: Number(item.candidate_count || 0),
        confirmationMethod: nullableString(item.confirmation_method) as FinanceDocumentLineMatching['confirmationMethod'],
      }];
    }),
  };
}

function nullableString(value: Json | undefined): string | null {
  return typeof value === 'string' && value ? value : null;
}
