import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import type { CatalogMigrationProduct } from "@/lib/catalogMigration";
import type { ImportMapping } from "@/lib/productImportWorkbook";
export { catalogImportChunks } from "@/lib/productImport";

export function catalogImportErrorMessage(cause: unknown, fallback: string): string {
  const message = cause && typeof cause === "object" && "message" in cause && typeof cause.message === "string" ? cause.message : "";
  const domainMessage = /^(No se pudo aplicar el lote que empieza en la fila \d+|El catálogo supera el límite|El archivo (cambió|debe|supera)|El máximo por archivo|La hoja (seleccionada|supera)|La lectura se interrumpió|Las exportaciones de plataforma|No encontramos una fila|No tenés (permiso|acceso)|No pudimos (leer|recuperar|aplicar)|La importación (necesita|no terminó)|El servidor no confirmó|Seleccioná el mismo archivo|Un producto supera|Volvé a seleccionar)/;
  if (!domainMessage.test(message)) return fallback;
  // El motivo de un lote viene de la base: si es un error técnico (SQL,
  // restricciones, identificadores) se cambia por uno legible.
  const [lote, motivo] = message.split(" Motivo: ");
  if (motivo !== undefined && /violates|constraint|relation|column|syntax|function|[0-9a-f]{8}-[0-9a-f]{4}-/i.test(motivo)) {
    return `${lote} Motivo: un error interno al guardar. Reintentá; si se repite, escribinos desde Ayuda.`;
  }
  return message;
}

export type CatalogImportOptions = {
  stock_mode: "replace" | "ignore"; location_id: string; destination_store_id: string;
  exchange_rate: number; margin_percent: number; auto_price: boolean;
  mapping: ImportMapping; cost_currency: "ARS" | "USD"; sheet_name: string; fingerprint: string;
  header_row?: number;
  column_mapping?: Record<string, string>;
};
export type CatalogImportSession = {
  ok: boolean; id: string; org_id: string; filename: string; source_format: "xls" | "xlsx" | "csv";
  source_system: "generic" | "nerqia" | "shopify" | "tiendanube" | "empretienda";
  source_rows: number; total: number; prepared: number; applied: number;
  status: "preparing" | "ready" | "applying" | "completed" | "cancelled";
  options: CatalogImportOptions; skip_invalid: boolean; valid: number; invalid: number;
  creates: number; updates: number; created: number; updated: number; stock_movements: number;
  skipped: number; variants: number; images: number; variants_created: number; variants_updated: number;
  redirects: number; reconciled: boolean;
};

export async function getCatalogImportSession(id: string): Promise<CatalogImportSession> {
  const { data, error } = await supabase.rpc("catalog_import_status", { p_session_id: id });
  if (error) throw error;
  const session = data as unknown as CatalogImportSession;
  if (!session?.ok || !session.id) throw new Error("No pudimos recuperar la importación.");
  return session;
}

export async function startCatalogImport(session: Pick<CatalogImportSession, "id" | "org_id" | "filename" | "source_format" | "source_system" | "total" | "source_rows" | "options">) {
  const { data, error } = await supabase.rpc("start_catalog_import", {
    p_session_id: session.id, p_org_id: session.org_id, p_filename: session.filename,
    p_source_format: session.source_format, p_source_system: session.source_system,
    p_total: session.total, p_source_rows: session.source_rows, p_options: session.options as unknown as Json,
  });
  if (error) throw error;
  return data as unknown as CatalogImportSession;
}

export async function stageCatalogImportChunk(id: string, position: number, rows: CatalogMigrationProduct[]) {
  const { data, error } = await supabase.rpc("stage_catalog_import_chunk", { p_session_id: id, p_position: position, p_rows: rows as unknown as Json });
  if (error) throw error;
  return data as unknown as CatalogImportSession;
}

export async function approveCatalogImport(id: string, skipInvalid: boolean) {
  const { data, error } = await supabase.rpc("approve_catalog_import", { p_session_id: id, p_skip_invalid: skipInvalid });
  if (error) throw error;
  return data as unknown as CatalogImportSession;
}

/**
 * Un lote que se corta por tiempo (la app corta cada consulta a los 8 s) o
 * por un corte de red momentáneo se reintenta una vez antes de mostrar error.
 * Medido 2026-10-10 con la sesión real de Ferretería Famatina: el primer lote
 * en una conexión fría tarda ~6 s y los siguientes 1–2 s, así que el
 * reintento casi siempre pasa. Es seguro: cada lote es una transacción, y si
 * el primer intento sí se guardó y sólo se perdió la respuesta, la base
 * devuelve el estado sin volver a aplicarlo.
 */
export function isTransientCatalogImportError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  const message = "message" in error ? String((error as { message?: unknown }).message ?? "") : "";
  return code === "57014"
    || /statement timeout|canceling statement|Failed to fetch|NetworkError|Load failed|network request failed/i.test(message);
}

export async function applyCatalogImportChunk(id: string, position: number, retryDelayMs = 1500) {
  for (let attempt = 0; ; attempt++) {
    const { data, error } = await supabase.rpc("apply_catalog_import_chunk", { p_session_id: id, p_position: position });
    if (!error) return data as unknown as CatalogImportSession;
    if (attempt >= 1 || !isTransientCatalogImportError(error)) throw error;
    await new Promise(resolve => setTimeout(resolve, retryDelayMs));
  }
}

export async function cancelCatalogImport(id: string) {
  const { error } = await supabase.rpc("cancel_catalog_import", { p_session_id: id });
  if (error) throw error;
}
