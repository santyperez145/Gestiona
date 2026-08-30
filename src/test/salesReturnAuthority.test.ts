import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const migration = fs.readFileSync(
  path.resolve("supabase/migrations/20260829000045_devolucion_pos_transaccional.sql"),
  "utf8",
);
const page = fs.readFileSync(path.resolve("src/pages/DevolucionesPage.tsx"), "utf8");

describe("autoridad de devoluciones POS", () => {
  it("hace una sola operación servidor, idempotente y limitada al cobro original", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.create_sales_return_v1");
    expect(migration).toContain("client_return_id");
    expect(migration).toContain("request_fingerprint");
    expect(migration).toContain("supera el saldo original disponible");
    expect(migration).toContain("Abrí la caja de la sucursal antes de devolver efectivo");
    expect(migration).toContain("pending_external");
    expect(migration).toContain("credit_note_required");
  });

  it("cierra las mutaciones directas que partían stock, caja y devolución", () => {
    expect(migration).toContain("REVOKE INSERT, UPDATE, DELETE ON public.returns");
    expect(page).not.toMatch(/\.from\(["']returns["']\)\s*\.insert/);
    expect(page).not.toMatch(/\.from\(["']returns["']\)\s*\.delete/);
    expect(page).toContain('supabase.rpc("create_sales_return_v1"');
  });

  it("no presenta un HTML interno como comprobante fiscal", () => {
    expect(page).toContain("Comprobante interno");
    expect(page).toContain("No reemplaza un comprobante fiscal autorizado por ARCA");
    expect(page).not.toContain("Este documento certifica");
  });

  it("el cambio de estado de devolución no dispara falsos Kardex", () => {
    expect(migration).toContain(
      "AFTER INSERT OR DELETE OR UPDATE OF product_id, variant_id, quantity, location_id",
    );
  });
});
