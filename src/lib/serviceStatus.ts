import { supabase } from "@/integrations/supabase/client";

export type PublicServiceState = "operational" | "degraded" | "unknown" | "not_applicable";

export interface PublicServiceStatus {
  component: string;
  status: PublicServiceState;
  checked_at: string;
  detail: string;
}

const KNOWN_STATES = new Set<PublicServiceState>(["operational", "degraded", "unknown", "not_applicable"]);

export function isPublicServiceStatus(value: unknown): value is PublicServiceStatus {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<PublicServiceStatus>;
  return typeof row.component === "string"
    && typeof row.detail === "string"
    && typeof row.checked_at === "string"
    && typeof row.status === "string"
    && KNOWN_STATES.has(row.status as PublicServiceState);
}

export function overallServiceState(rows: PublicServiceStatus[]): PublicServiceState {
  if (!rows.length) return "unknown";
  if (rows.some(row => row.status === "degraded")) return "degraded";
  if (rows.some(row => row.status === "unknown")) return "unknown";
  return "operational";
}

export function serviceStateLabel(state: PublicServiceState): string {
  switch (state) {
    case "operational": return "Operativo";
    case "degraded": return "Con incidencia";
    case "not_applicable": return "No aplica";
    default: return "Sin datos suficientes";
  }
}

export async function fetchPublicServiceStatus(): Promise<PublicServiceStatus[]> {
  const { data, error } = await supabase.rpc("get_public_service_status");
  if (error) throw error;
  if (!Array.isArray(data) || !data.every(isPublicServiceStatus)) {
    throw new Error("El estado del servicio no devolvió un formato válido");
  }
  return data;
}
