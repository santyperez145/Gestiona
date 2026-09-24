import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const portal = readFileSync(resolve(root, "src/pages/CreatorPortalPage.tsx"), "utf8");
const migration = readFileSync(resolve(root, "supabase/migrations/20260924000200_creator_authenticated_withdrawal.sql"), "utf8");

describe("paridad Go-Marz: retiros de comisiones desde el portal del creador", () => {
  it("la base expone creator_request_withdrawal para usuarios autenticados con contrato versionado", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.creator_request_withdrawal");
    expect(migration).toContain("p_amount_ars numeric");
    expect(migration).toContain("v_user_id uuid := auth.uid();");
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.creator_request_withdrawal(numeric, text) FROM PUBLIC, anon;");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.creator_request_withdrawal(numeric, text) TO authenticated;");
    expect(migration).toContain("'creator_request_withdrawal', 'p_amount_ars numeric, p_notes text', 'authenticated_delegate'");
  });

  it("el portal del creador ofrece botón y modal para solicitar retiro sobre el saldo disponible", () => {
    expect(portal).toContain("handleSolicitarRetiro");
    expect(portal).toContain('"creator_request_withdrawal"');
    expect(portal).toContain("Solicitar retiro de comisiones");
    expect(portal).toContain("CBU / CVU / Alias de cobro");
    expect(portal).toContain("<ArrowDownToLine");
  });

  it("valida que el monto a retirar no supere el saldo disponible en cliente y servidor", () => {
    expect(portal).toContain("monto > disponible");
    expect(migration).toContain("IF p_amount_ars > v_available THEN");
    expect(migration).toContain("supera tu saldo disponible");
  });
});
