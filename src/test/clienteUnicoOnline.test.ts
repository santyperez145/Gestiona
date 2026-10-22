import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/20261022001500_cliente_unico_online.sql", "utf8");

describe("Cliente único: el comprador online es el cliente del local", () => {
  it("lo busca primero por documento y después por email", () => {
    const porDocumento = sql.indexOf("WHERE org_id = v_order.org_id AND tax_id = v_doc");
    const porEmail = sql.indexOf("WHERE org_id = v_order.org_id AND lower(btrim(COALESCE(email, ''))) = v_email");
    expect(porDocumento).toBeGreaterThan(0);
    expect(porEmail).toBeGreaterThan(porDocumento);
  });

  it("completa la identidad fiscal sin pisar la que cargó el comercio", () => {
    expect(sql).toContain("tax_id = COALESCE(tax_id, v_doc)");
    expect(sql).toContain("vat_condition = CASE WHEN tax_id IS NULL AND v_doc IS NOT NULL AND v_order.buyer_tax_condition IS NOT NULL");
    expect(sql).toContain("legal_name = COALESCE(legal_name, NULLIF(btrim(v_order.buyer_business_name), ''))");
    expect(sql).toContain("email = COALESCE(NULLIF(btrim(email), ''), v_email)");
  });

  it("tiene simulacro registrado", () => {
    expect(readFileSync("scripts/migraciones-pendientes.mjs", "utf8")).toContain("'20261022001500': 'scripts/cliente-unico-online-matrix.sql'");
  });
});
