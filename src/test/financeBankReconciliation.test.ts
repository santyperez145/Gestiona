import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Guardia F5.4 — Conciliación bancaria contra el ledger.
 *
 * El extracto del banco y el libro tienen que contar lo mismo, y la prueba
 * es constatar, no ajustar:
 * - `bank_statement_upload` importa el extracto idempotentemente (hash);
 * - `bank_lines_match` propone matches contra asientos de 1.1.02 (±3 días,
 *   un asiento por movimiento);
 * - `bank_line_confirm` confirma o rechaza; lo confirmado es historial;
 * - RLS por organización con permiso de gastos, igual que F5.3;
 * - la UI vive en Movimientos, junto a las liquidaciones digitales.
 */

const read = (p: string) => readFileSync(p, "utf8");

describe("F5.4 — conciliación bancaria contra el ledger", () => {
  const migracion = read("supabase/migrations/20260925000300_finance_bank_reconciliation.sql");

  it("existen el extracto y sus movimientos con estados explícitos", () => {
    expect(migracion).toContain("CREATE TABLE IF NOT EXISTS public.finance_bank_statements");
    expect(migracion).toContain("CREATE TABLE IF NOT EXISTS public.finance_bank_lines");
    expect(migracion).toContain("'importado', 'parcial', 'conciliado'");
    expect(migracion).toContain("'pendiente', 'propuesto', 'confirmado', 'sin_match'");
    // Un match siempre apunta a un asiento real.
    expect(migracion).toContain("match_requiere_entry CHECK");
  });

  it("idempotencia por contenido: reimportar el mismo archivo no duplica", () => {
    expect(migracion).toContain("content_hash");
    expect(migracion).toContain("UNIQUE (org_id, banco, fecha_desde, fecha_hasta, content_hash)");
    expect(migracion).toContain("IF v_existing IS NOT NULL THEN");
  });

  it("RLS por organización con permiso de gastos, igual que el export contable", () => {
    expect(migracion).toContain("ALTER TABLE public.finance_bank_statements ENABLE ROW LEVEL SECURITY");
    expect(migracion).toContain("ALTER TABLE public.finance_bank_lines ENABLE ROW LEVEL SECURITY");
    expect(migracion).toContain("public.has_permission(org_id, 'expenses', 'view')");
    expect(migracion).toContain("public.is_org_member(org_id, auth.uid())");
  });

  it("los matches se proponen contra asientos reales de banco", () => {
    expect(migracion).toContain("bank_lines_match");
    // Sólo asientos vigentes que mueven la cuenta banco.
    expect(migracion).toContain("e.anulado_por IS NULL");
    expect(migracion).toContain("a.codigo = '1.1.02'");
    // Un asiento no matchea dos movimientos.
    expect(migracion).toContain("other.match_status IN ('propuesto', 'confirmado')");
  });

  it("confirmar exige permiso de edición y lo confirmado no se re-decide", () => {
    expect(migracion).toContain("bank_line_confirm");
    expect(migracion).toContain("'expenses', 'edit'");
    expect(migracion).toContain("already_confirmed");
    expect(migracion).toContain("El movimiento no tiene un match propuesto para confirmar");
  });

  it("deja traza de auditoría en cada decisión", () => {
    expect(migracion).toContain("'bank_line_match'");
    expect(migracion).toContain("ARRAY['finance', 'bank_reconciliation']::text[]");
  });

  it("no escribe en el ledger: conciliar es constatar", () => {
    expect(migracion).not.toContain("ledger_asentar(");
    expect(migracion).not.toContain("INSERT INTO public.ledger_entries");
    expect(migracion).not.toContain("UPDATE public.ledger_entries");
  });

  it("los RPC están otorgados a authenticated y revocados del resto", () => {
    expect(migracion).toContain("GRANT EXECUTE ON FUNCTION public.bank_statement_upload(uuid, text, date, date, jsonb) TO authenticated");
    expect(migracion).toContain("GRANT EXECUTE ON FUNCTION public.bank_lines_match(uuid) TO authenticated");
    expect(migracion).toContain("GRANT EXECUTE ON FUNCTION public.bank_line_confirm(uuid, boolean) TO authenticated");
  });

  it("el panel vive en Movimientos, junto a las liquidaciones", () => {
    const movimientos = read("src/pages/FinancialMovementsPage.tsx");
    expect(movimientos).toContain("BankReconciliationPanel");
    const panel = read("src/components/finance/BankReconciliationPanel.tsx");
    // Importa, matchea y confirma; nada se inventa en el cliente.
    expect(panel).toContain("bankStatementUpload");
    expect(panel).toContain("bankLinesMatch");
    expect(panel).toContain("bankLineConfirm");
    expect(panel).toContain("parseBankCsv");
  });

  it("el cliente no escribe extractos por fuera de la RPC", () => {
    const cliente = read("src/lib/financeBank.ts");
    expect(cliente).not.toContain('.from("finance_bank_lines")');
    expect(cliente).not.toContain('.from("finance_bank_statements")');
    // El parser exige fecha, concepto y monto; si no, falla con mensaje accionable.
    expect(cliente).toContain("No pudimos reconocer las columnas");
  });
});
