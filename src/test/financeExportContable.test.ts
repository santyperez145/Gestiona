import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Guardia F5.3 — Exportación contable auditada.
 *
 * El contador recibe el libro desde la base, no desde una pantalla:
 * - `finance_export_create` exige balance cuadrado y permiso, y reusa lotes
 *   preparados en vez de duplicarlos;
 * - `finance_export_batch_csv` sólo exporta lotes en estado 'listo';
 * - `finance_export_mark_exported` deja la traza de auditoría;
 * - la UI vive en la página del libro (misma autoridad, mismo período).
 */

const read = (p: string) => readFileSync(p, "utf8");

describe("F5.3 — exportación contable auditada", () => {
  const migracion = read("supabase/migrations/20260925000100_finance_export_contable.sql");

  it("existe el lote exportable con auditoría de quién y cuándo", () => {
    expect(migracion).toContain("CREATE TABLE IF NOT EXISTS public.finance_export_batches");
    expect(migracion).toContain("exported_at  timestamptz");
    expect(migracion).toContain("created_by   uuid");
    // Estados explícitos: preparar → listo → exportado; error con motivo.
    expect(migracion).toContain("'preparado', 'listo', 'exportado', 'error'");
  });

  it("una fila por partida con mapeo de cuenta y referencia", () => {
    expect(migracion).toContain("CREATE TABLE IF NOT EXISTS public.finance_export_rows");
    expect(migracion).toContain("cuenta_codigo text");
    expect(migracion).toContain("centro_costo text");
    // Idempotencia: un reintento no duplica partidas del mismo lote.
    expect(migracion).toContain("UNIQUE (batch_id, line_id)");
  });

  it("RLS por organización con permiso de gastos", () => {
    expect(migracion).toContain("ALTER TABLE public.finance_export_batches ENABLE ROW LEVEL SECURITY");
    expect(migracion).toContain("ALTER TABLE public.finance_export_rows ENABLE ROW LEVEL SECURITY");
    expect(migracion).toContain("public.has_permission(org_id, 'expenses', 'view')");
    expect(migracion).toContain("public.is_org_member(org_id, auth.uid())");
  });

  it("no exporta un libro descuadrado", () => {
    expect(migracion).toContain("El libro tiene descuadre");
    expect(migracion).toContain("corregi antes de exportar");
  });

  it("idempotencia: reuso del lote no exportado, sin duplicar filas", () => {
    // El reuso cubre preparado/listo/error; el lote exportado no se reescribe.
    expect(migracion).toContain("AND b.status IN ('preparado', 'listo', 'error')");
    expect(migracion).toContain("DELETE FROM public.finance_export_rows WHERE batch_id = v_batch");
  });

  it("el CSV sólo sale de lotes en estado listo y con permiso", () => {
    expect(migracion).toContain("finance_export_batch_csv");
    expect(migracion).toContain("El lote no esta listo para exportar");
    // es-AR: separador ; y decimales con coma.
    expect(migracion).toContain("replace(r.debe::text, '.', ',')");
    expect(migracion).toContain("replace(r.haber::text, '.', ',')");
  });

  it("la traza de exportación está protegida y otorgada a authenticated", () => {
    expect(migracion).toContain("finance_export_mark_exported");
    expect(migracion).toContain("GRANT EXECUTE ON FUNCTION public.finance_export_create(uuid, date, date) TO authenticated");
    expect(migracion).toContain("GRANT EXECUTE ON FUNCTION public.finance_export_batch_csv(uuid) TO authenticated");
  });

  it("el panel vive en la página del libro, junto al resultado", () => {
    const libro = read("src/pages/LibroPage.tsx");
    expect(libro).toContain("FinanceExportPanel");
    const panel = read("src/components/finance/FinanceExportPanel.tsx");
    expect(panel).toContain("finance_export_create");
    expect(panel).toContain("finance_export_batch_csv");
    expect(panel).toContain("finance_export_mark_exported");
  });

  it("la descarga lleva BOM UTF-8 para Excel (acento intacto)", () => {
    const lib = read("src/lib/financeExport.ts");
    expect(lib).toContain("\\uFEFF");
    expect(lib).toContain("libro-diario_");
  });
});