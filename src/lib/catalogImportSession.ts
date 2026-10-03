import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import type { CatalogMigrationProduct } from "@/lib/catalogMigration";
import type { ImportMapping } from "@/lib/productImportWorkbook";
export { catalogImportChunks } from "@/lib/productImport";

export function catalogImportErrorMessage(cause: unknown, fallback: string): string {
  const message = cause && typeof cause === "object" && "message" in cause && typeof cause.message === "string" ? cause.message : "";
  const domainMessage = /^(El catálogo supera el límite|El archivo (cambió|debe|supera)|El máximo por archivo|La hoja (seleccionada|supera)|La lectura se interrumpió|Las exportaciones de plataforma|No encontramos una fila|No tenés (permiso|acceso)|No pudimos (leer|recuperar|aplicar)|La importación (necesita|no terminó)|El servidor no confirmó|Seleccioná el mismo archivo|Un producto supera|Volvé a seleccionar)/;
  return domainMessage.test(message) ? message : fallback;
}

export type CatalogImportOptions = {
  stock_mode: "replace" | "ignore"; location_id: string; destination_store_id: string;
  exchange_rate: number; margin_percent: number; auto_price: boolean;
  mapping: ImportMapping; cost_currency: "ARS" | "USD"; sheet_name: string; fingerprint: string;
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

export async function applyCatalogImportChunk(id: string, position: number) {
  const { data, error } = await supabase.rpc("apply_catalog_import_chunk", { p_session_id: id, p_position: position });
  if (error) throw error;
  return data as unknown as CatalogImportSession;
}

export async function cancelCatalogImport(id: string) {
  const { error } = await supabase.rpc("cancel_catalog_import", { p_session_id: id });
  if (error) throw error;
}
