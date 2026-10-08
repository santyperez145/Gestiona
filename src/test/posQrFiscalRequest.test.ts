import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { posQrFiscalResult, type PosQrSession } from "@/lib/posQr";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20261008000000_pos_qr_durable_fiscal_request.sql"), "utf8");
const legacyRetry = readFileSync(resolve(process.cwd(), "supabase/migrations/20261008000010_pos_qr_legacy_fiscal_retry.sql"), "utf8");
const edge = readFileSync(resolve(process.cwd(), "supabase/functions/mercadopago-pos-qr/index.ts"), "utf8");
const pos = readFileSync(resolve(process.cwd(), "src/pages/POSPage.tsx"), "utf8");
const session = (extra: Partial<PosQrSession> = {}): PosQrSession => ({
  session_id: "qr", org_id: "org", state: "completed", amount: 9000,
  platform_fee: 0, currency: "ARS", expires_at: "2026-10-08T12:00:00Z",
  payment_attempt_id: "attempt", invoice_requested: true, ...extra,
});

describe("durable POS fiscal request", () => {
  it("delegates ticket/invoice/outbox authorities without touching stock or calling ARCA in the payment transaction", () => {
    expect(migration).toContain("public.pos_qr_session_prepare(p_org_id, p_sales, p_client_key)");
    expect(migration).toContain("public.facturar_venta_pos(NEW.org_id, NEW.sale_transaction_id)");
    expect(migration).not.toMatch(/INSERT INTO public\.(sales|invoices|invoice_items)|UPDATE public\.products/i);
    expect(migration).not.toContain("invoke_edge_function");
    expect(migration).toContain("OLD.state IS DISTINCT FROM NEW.state AND NEW.invoice_requested");
  });
  it("freezes opt-in before the provider order and revalidates the actor without exposing the trigger", () => {
    expect(migration).toContain("invoice_request_set_at IS NOT NULL");
    expect(migration).toContain("invoice_requested IS DISTINCT FROM p_request_invoice");
    expect(migration).toContain("v_session.provider_order_id IS NOT NULL");
    expect(migration).toContain("NEW.created_by");
    expect(migration).toContain("FROM PUBLIC, anon, authenticated, service_role");
    expect(migration).toContain("v_claims, ''");
    expect(migration).toContain("WHEN insufficient_privilege THEN v_error := 'permission_required'");
    expect(legacyRetry).toContain("no admite una solicitud fiscal retroactiva");
    expect(legacyRetry).toContain("jsonb_build_object('reused', true)");
    expect(legacyRetry).toContain("v_session.created_by IS DISTINCT FROM auth.uid()");
  });
  it("the Edge validates a boolean and fiscal permission before creating a QR", () => {
    expect(edge).toContain('typeof body.requestInvoice !== "boolean"');
    expect(edge).toContain('permission(userClient, orgId, "invoices", "edit")');
    expect(edge).toContain('rpc("pos_qr_session_prepare_fiscal"');
    expect(pos).toContain("requestInvoice: wantArcaInvoice");
    expect(pos).toContain("requestInvoice: checkout.requestInvoice ?? wantArcaInvoice");
    expect(pos).toContain("posQrFiscalResult(session)");
  });
  it("does not advertise invoices before accreditation or without opt-in", () => {
    expect(posQrFiscalResult(session({ state: "pending" }))).toBeNull();
    expect(posQrFiscalResult(session({ state: "manual_review" }))).toBeNull();
    expect(posQrFiscalResult(session({ invoice_requested: false }))).toBeNull();
  });
  it("represents a persisted draft as pending CAE, not as a fiscal success", () => {
    expect(posQrFiscalResult(session({ invoice: { ok: true, invoice_id: "invoice", number: "F-1", cae: null, afip_status: "pending" } })))
      .toMatchObject({ ok: true, invoiceId: "invoice", cae: undefined, afipStatus: "pending" });
  });
  it("reads actual CAE from the canonical invoice", () => {
    expect(posQrFiscalResult(session({ invoice: { ok: true, invoice_id: "invoice", cae: "12345678901234", afip_status: "authorized" } })))
      .toMatchObject({ invoiceId: "invoice", cae: "12345678901234", afipStatus: "authorized" });
  });
  it("fiscal failure preserves the paid sale and never leaks database details", () => {
    const denied = posQrFiscalResult(session({ invoice_preparation_error: "permission_required" }));
    expect(denied).toMatchObject({ ok: false });
    expect(denied.motivo).toContain("encargado");
    const invalid = posQrFiscalResult(session({ invoice_preparation_error: "SQL secret postgres" }));
    expect(invalid.motivo).toContain("No vuelvas a cobrar");
    expect(invalid.motivo).not.toMatch(/SQL|secret|postgres/);
  });
});
