import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("límite de crédito del fiado", () => {
  it("la base rechaza la deuda que supera el límite y sólo el encargado lo cambia", () => {
    const sql = readFileSync("supabase/migrations/20261009001100_limite_credito_fiado.sql", "utf8");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS credit_limit_ars numeric(14,2)");
    expect(sql).toContain("BEFORE INSERT ON public.debts");
    expect(sql).toContain("FOR UPDATE;");
    expect(sql).toContain("public.has_org_role(NEW.org_id, auth.uid(), ARRAY['owner', 'admin'])");
  });

  it("el POS usa el cliente elegido y frena antes de enviar", () => {
    const pos = readFileSync("src/pages/POSPage.tsx", "utf8");
    expect(pos).toContain('debtQuery.eq("customer_id", posCustomerId)');
    expect(pos).toContain("(customerDebt ?? 0) + cartTotal > customerCreditLimit");
    const clientes = readFileSync("src/pages/CustomersPage.tsx", "utf8");
    expect(clientes).toContain("...(canEditCredit ? { credit_limit_ars: limite } : {})");
  });
});
