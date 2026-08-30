import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const migration = read("supabase/migrations/20260829000044_pos_turno_autoritativo.sql");
const pos = read("src/pages/POSPage.tsx");
const sessionPage = read("src/pages/CashSessionPage.tsx");

describe("turno autoritativo del POS", () => {
  it("serializa la apertura por organización y ubicación", () => {
    expect(migration).toContain("cash_sessions_one_open_per_location_idx");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("public.pos_cash_session_open");
    expect(migration).toContain("public.pos_cash_session_close");
  });

  it("vincula una entrada por ticket y medio después de capturar el cobro", () => {
    const paymentCapture = migration.indexOf("v_payments := public.capture_pos_payment_transactions");
    const cashCapture = migration.indexOf("v_cash_session := public.capture_pos_cash_session", paymentCapture);
    expect(paymentCapture).toBeGreaterThan(-1);
    expect(cashCapture).toBeGreaterThan(paymentCapture);
    expect(migration).toContain("cash_entries_one_sale_part_idx");
    expect(migration).toContain("sale_transaction_id");
  });

  it("no vuelve a inferir el tenant por la primera membresía", () => {
    const trigger = migration.slice(migration.indexOf("FUNCTION public.trg_sale_cash_entry"));
    expect(trigger).toContain("session.org_id = NEW.org_id");
    expect(trigger).not.toContain("ORDER BY m.joined_at");
  });

  it("expone la sesión real en el POS y muta apertura/cierre sólo por RPC", () => {
    expect(pos).toContain("cash_session_summary");
    expect(pos).toContain("Gestionar turno");
    expect(sessionPage).toContain("pos_cash_session_open");
    expect(sessionPage).toContain("pos_cash_session_close");
    expect(sessionPage).toContain('to="/sucursales"');
    expect(pos).toContain("Caja todavía no tiene una sucursal");
    expect(sessionPage).not.toContain('.from("cash_sessions").insert');
    expect(sessionPage).not.toContain('.from("cash_sessions").update');
  });
});
