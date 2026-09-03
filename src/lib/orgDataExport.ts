/**
 * Export portable de la organización.
 *
 * La lectura la hace la Edge Function, no el navegador: exportar la base de un
 * negocio entero requiere que la persona sea su dueña. El manifiesto es parte
 * del contrato: una tabla que falló o se truncó jamás se disfraza de vacía.
 */
import { supabase } from "@/integrations/supabase/client";

export type ExportStatus = "exported" | "empty" | "truncated" | "error";

export interface ExportTableResult {
  table: string;
  status: ExportStatus;
  row_count: number;
  available_row_count?: number;
  rows: Record<string, unknown>[];
  reason?: string;
}

export interface OrganizationExport {
  schema_version: number;
  generated_at: string;
  org_id: string;
  max_rows_per_table: number;
  tables: ExportTableResult[];
  excluded_credentials: string[];
}

export interface ExportSummary {
  exported: number;
  empty: number;
  truncated: number;
  failed: number;
}

/** Convierte filas a CSV con comillas y escapes correctos. */
export function toCSV(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const cols = [...new Set(rows.flatMap(r => Object.keys(r)))];
  const cell = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    // Se entrecomilla si hay separador, comillas o saltos de línea.
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map(r => cols.map(c => cell(r[c])).join(","))].join("\r\n");
}

export interface ExportProgress {
  table: string;
  done: number;
  total: number;
}

export function summarizeExport(tables: Pick<ExportTableResult, "status">[]): ExportSummary {
  return tables.reduce<ExportSummary>((summary, table) => {
    summary[table.status === "error" ? "failed" : table.status] += 1;
    return summary;
  }, { exported: 0, empty: 0, truncated: 0, failed: 0 });
}

export function exportReadme(
  data: OrganizationExport,
  businessName: string,
  summary: ExportSummary,
): string {
  const observations = data.tables
    .filter(table => table.status === "error" || table.status === "truncated")
    .map(table => `- ${table.table}: ${table.status}${table.reason ? ` — ${table.reason}` : ""}`);

  return [
    `Export de datos — ${businessName || "Nerqia"}`,
    `Fecha: ${new Date(data.generated_at).toLocaleString("es-AR")}`,
    "",
    "Un archivo CSV por tabla exportada, codificado en UTF-8 y separado por comas.",
    `Tablas con filas: ${summary.exported}; vacías: ${summary.empty}; truncadas: ${summary.truncated}; con error: ${summary.failed}.`,
    "El archivo export-manifest.json es la fuente de verdad de cobertura y errores.",
    "",
    "Esto no es una copia completa de la base ni un mecanismo de restauración.",
    "Incluye solamente relaciones operativas cuyo dato pertenece directamente a la organización; las relaciones hijas sin org_id propio pueden requerir una migración asistida.",
    "Las credenciales de acceso (OAuth, AFIP, API, sesiones, push y webhooks) quedan fuera deliberadamente.",
    "",
    "Observaciones:",
    ...(observations.length ? observations : ["- Sin tablas truncadas ni errores de lectura."]),
    "",
    "Generado para portabilidad y derecho de acceso de datos. Conservá el manifiesto junto con los CSV.",
  ].join("\n");
}

/**
 * Pide al servidor una exportación autorizada. No convierte un error de acceso
 * ni una relación ausente en una tabla vacía.
 */
export async function collectOrgData(
  orgId: string,
  onProgress?: (p: ExportProgress) => void,
): Promise<OrganizationExport> {
  onProgress?.({ table: "Solicitando datos al servidor…", done: 0, total: 1 });
  const { data, error } = await supabase.functions.invoke("export-organization-data", {
    body: { orgId },
  });
  if (error) throw error;
  const result = data as OrganizationExport | { error?: string } | null;
  if (!result || !("tables" in result) || !Array.isArray(result.tables)) {
    throw new Error("La exportación no devolvió un manifiesto válido");
  }
  onProgress?.({ table: "", done: 1, total: 1 });
  return result;
}

/** Arma el ZIP y dispara la descarga. */
export async function downloadOrgExport(
  orgId: string,
  businessName: string,
  onProgress?: (p: ExportProgress) => void,
): Promise<ExportSummary> {
  const data = await collectOrgData(orgId, onProgress);
  const summary = summarizeExport(data.tables);

  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  const stamp = new Date().toISOString().slice(0, 10);

  data.tables
    .filter(table => table.status === "exported" || table.status === "truncated")
    .forEach(table => zip.file(`${table.table}.csv`, toCSV(table.rows)));
  zip.file("export-manifest.json", JSON.stringify({
    schema_version: data.schema_version,
    generated_at: data.generated_at,
    org_id: data.org_id,
    max_rows_per_table: data.max_rows_per_table,
    tables: data.tables.map(({ rows: _rows, ...table }) => table),
    excluded_credentials: data.excluded_credentials,
  }, null, 2));
  zip.file("LEEME.txt", exportReadme(data, businessName, summary));

  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `nerqia-export-${stamp}.zip`;
  a.click();
  URL.revokeObjectURL(url);
  return summary;
}
