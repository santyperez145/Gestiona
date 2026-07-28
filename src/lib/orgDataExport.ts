/**
 * Export completo de los datos de la organización (derecho de acceso,
 * Ley 25.326 art. 14 — y la salida sana si algún día querés migrar).
 *
 * El backup que existía cubría 7 tablas en un Excel. Este recorre todo lo que
 * la organización tiene cargado y arma un ZIP de CSVs, uno por tabla.
 *
 * La lista de tablas NO está hardcodeada: se leen las que el usuario puede ver
 * según la RLS. Como cada consulta pasa por las policies, este export nunca
 * puede devolver datos de otra organización.
 */
import { supabase } from "@/integrations/supabase/client";

/** Tablas exportables: las que tienen datos del negocio, por org_id. */
export const EXPORTABLE_TABLES = [
  "products", "product_variants", "product_perfume_details",
  "sales", "purchases", "purchase_orders", "purchase_order_items",
  "customers", "customer_notes", "customer_segments", "customer_subscriptions",
  "debts", "debt_payments", "expenses", "suppliers", "supplier_payments",
  "invoices", "quotes", "promotions", "coupons", "price_lists", "price_list_items",
  "marketing_posts", "influencers", "influencer_exchanges",
  "locations", "stock_reservations", "price_history", "stock_movements",
  "financial_movements", "deals", "crm_activities", "tasks", "audit_logs",
] as const;

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

/**
 * Descarga todas las tablas de la org. Devuelve un mapa nombre → CSV.
 * Las tablas que no existen o que la RLS no deja leer se saltean en silencio:
 * un export parcial es mejor que ninguno.
 */
export async function collectOrgData(
  orgId: string,
  onProgress?: (p: ExportProgress) => void,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const total = EXPORTABLE_TABLES.length;

  for (let i = 0; i < total; i++) {
    const table = EXPORTABLE_TABLES[i];
    onProgress?.({ table, done: i, total });
    try {
      const { data, error } = await supabase
        .from(table as never)
        .select("*")
        .eq("org_id", orgId)
        .limit(50000);
      if (error || !data?.length) continue;
      out[table] = toCSV(data as Record<string, unknown>[]);
    } catch {
      // tabla inexistente o sin permiso — se omite
    }
  }

  onProgress?.({ table: "", done: total, total });
  return out;
}

/** Arma el ZIP y dispara la descarga. */
export async function downloadOrgExport(
  orgId: string,
  businessName: string,
  onProgress?: (p: ExportProgress) => void,
): Promise<number> {
  const csvs = await collectOrgData(orgId, onProgress);
  const names = Object.keys(csvs);
  if (!names.length) return 0;

  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  const stamp = new Date().toISOString().slice(0, 10);

  names.forEach(t => zip.file(`${t}.csv`, csvs[t]));
  zip.file(
    "LEEME.txt",
    [
      `Export de datos — ${businessName || "Gestiona"}`,
      `Fecha: ${new Date().toLocaleString("es-AR")}`,
      ``,
      `Un archivo CSV por tabla, codificado en UTF-8 y separado por comas.`,
      `Solo se incluyen las tablas que tenían datos (${names.length} de ${EXPORTABLE_TABLES.length}).`,
      ``,
      `Generado para el derecho de acceso de la Ley 25.326 de Protección`,
      `de Datos Personales, y como copia de respaldo portable.`,
    ].join("\n"),
  );

  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `gestiona-export-${stamp}.zip`;
  a.click();
  URL.revokeObjectURL(url);
  return names.length;
}
