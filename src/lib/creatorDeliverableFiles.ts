import { supabase } from '@/integrations/supabase/client';

export const CREATOR_DELIVERABLE_BUCKET = 'creator-deliverables';
export const CREATOR_DELIVERABLE_MAX_BYTES = 50 * 1024 * 1024;
export const CREATOR_DELIVERABLE_MIME_TYPES = [
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const;

export type CreatorDeliverableMimeType = typeof CREATOR_DELIVERABLE_MIME_TYPES[number];
export type CreatorDeliverableUploadStatus = 'pending_upload' | 'uploaded' | 'failed' | 'quarantined';

export interface CreatorDeliverableFile {
  id: string;
  org_id: string;
  campaign_id: string;
  deliverable_id: string;
  influencer_id: string;
  version_number: number;
  storage_path: string;
  original_filename: string;
  mime_type: CreatorDeliverableMimeType;
  size_bytes: number;
  sha256: string;
  upload_status: CreatorDeliverableUploadStatus;
  failure_reason: string | null;
  retention_until: string;
  created_by: string;
  created_at: string;
  uploaded_at: string | null;
}

interface CreatorDeliverableUploadIntent {
  deliverableId: string;
  fileId: string;
  versionNumber: number;
  storagePath: string;
  retentionUntil: string;
}

// The generated database types are updated in the same migration batch. This
// adapter keeps the upload transaction compact and gives errors one boundary.
const db = supabase as any;

export function validateCreatorDeliverableFile(file: Pick<File, 'name' | 'type' | 'size'>): string | null {
  if (!file.name.trim() || file.name.length > 255) return 'El archivo necesita un nombre de hasta 255 caracteres.';
  if (!CREATOR_DELIVERABLE_MIME_TYPES.includes(file.type as CreatorDeliverableMimeType)) {
    return 'Usá un archivo MP4, MOV, WEBM, JPG, PNG, WEBP o PDF.';
  }
  if (file.size <= 0 || file.size > CREATOR_DELIVERABLE_MAX_BYTES) {
    return 'El archivo debe pesar hasta 50 MB.';
  }
  return null;
}

async function sha256File(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function uploadCreatorDeliverableFile(
  campaignId: string,
  description: string,
  file: File,
): Promise<CreatorDeliverableFile> {
  const validation = validateCreatorDeliverableFile(file);
  if (validation) throw new Error(validation);
  const sha256 = await sha256File(file);
  const { data: prepared, error: prepareError } = await db.rpc('creator_prepare_deliverable_file', {
    p_campaign_id: campaignId,
    p_description: description,
    p_file_name: file.name,
    p_mime_type: file.type,
    p_size_bytes: file.size,
    p_sha256: sha256,
  });
  if (prepareError) throw prepareError;
  const row = prepared?.[0] as Record<string, unknown> | undefined;
  if (!row) throw new Error('No pudimos preparar la carga privada.');
  const intent: CreatorDeliverableUploadIntent = {
    deliverableId: String(row.deliverable_id),
    fileId: String(row.file_id),
    versionNumber: Number(row.version_number),
    storagePath: String(row.storage_path),
    retentionUntil: String(row.retention_until),
  };

  const { error: uploadError } = await supabase.storage
    .from(CREATOR_DELIVERABLE_BUCKET)
    .upload(intent.storagePath, file, { contentType: file.type, cacheControl: '3600', upsert: false });
  if (uploadError) {
    await db.rpc('creator_fail_deliverable_file', {
      p_file_id: intent.fileId,
      p_reason: uploadError.message,
    });
    throw uploadError;
  }

  const { data: finalized, error: finalizeError } = await db.rpc('creator_finalize_deliverable_file', {
    p_file_id: intent.fileId,
  });
  if (finalizeError) throw finalizeError;
  return finalized as CreatorDeliverableFile;
}

export async function listCreatorDeliverableFiles(userId: string): Promise<CreatorDeliverableFile[]> {
  const { data, error } = await db
    .from('influencer_deliverable_files')
    .select('*')
    .eq('created_by', userId)
    .eq('upload_status', 'uploaded')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as CreatorDeliverableFile[];
}

export async function listBrandDeliverableFiles(deliverableIds: string[]): Promise<CreatorDeliverableFile[]> {
  if (!deliverableIds.length) return [];
  const { data, error } = await db
    .from('influencer_deliverable_files')
    .select('*')
    .in('deliverable_id', deliverableIds)
    .eq('upload_status', 'uploaded')
    .order('version_number', { ascending: false });
  if (error) throw error;
  return (data ?? []) as CreatorDeliverableFile[];
}

export async function openCreatorDeliverableFile(file: CreatorDeliverableFile): Promise<void> {
  const { data, error } = await supabase.storage
    .from(CREATOR_DELIVERABLE_BUCKET)
    .createSignedUrl(file.storage_path, 60);
  if (error) throw error;
  window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
}

export function formatDeliverableFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
