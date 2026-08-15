import { supabase } from "@/integrations/supabase/client";

export type BackupStatus = "processing" | "completed" | "failed";
export type BackupVerificationStatus = "passed" | "failed" | null;

export interface OrganizationBackup {
  id: string;
  status: BackupStatus;
  trigger: "manual" | "scheduled";
  created_at: string;
  completed_at: string | null;
  expires_at: string;
  size_bytes: number | null;
  total_rows: number;
  table_count: number;
  last_verified_at: string | null;
  last_verification_status: BackupVerificationStatus;
  failure_reason: string | null;
}

type BackupResponse<T> = T & { error?: string };

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("weekly-backup", { body });
  if (error) throw error;
  const result = data as BackupResponse<T> | null;
  if (!result) throw new Error("El servicio de respaldos no respondió");
  if (result.error) throw new Error(result.error);
  return result;
}

export async function listOrganizationBackups(orgId: string): Promise<OrganizationBackup[]> {
  const result = await invoke<{ backups?: OrganizationBackup[] }>({ action: "list", orgId });
  if (!Array.isArray(result.backups)) throw new Error("El historial de respaldos no es válido");
  return result.backups;
}

export async function createOrganizationBackup(orgId: string) {
  return invoke<{ ok?: boolean; id?: string; reason?: string; totalRows?: number; tableCount?: number }>({
    action: "create",
    orgId,
  });
}

export async function downloadOrganizationBackup(orgId: string, backupId: string): Promise<string> {
  const result = await invoke<{ url?: string }>({ action: "download", orgId, backupId });
  if (!result.url) throw new Error("No se recibió el enlace de descarga");
  return result.url;
}

export async function verifyOrganizationBackup(orgId: string, backupId: string) {
  return invoke<{ ok?: boolean; reason?: string }>({ action: "verify", orgId, backupId });
}

export function formatBackupBytes(bytes: number | null): string {
  if (bytes === null || bytes === undefined) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function backupTrustLabel(backup: Pick<OrganizationBackup, "status" | "last_verification_status">): string {
  if (backup.status === "failed") return "Falló";
  if (backup.status === "processing") return "En proceso";
  if (backup.last_verification_status === "passed") return "Integridad verificada";
  if (backup.last_verification_status === "failed") return "Integridad con error";
  return "Pendiente de verificar";
}
