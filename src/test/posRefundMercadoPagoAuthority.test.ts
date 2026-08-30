import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const migration = read("supabase/migrations/20260830000010_pos_refund_mercadopago.sql");
const edge = read("supabase/functions/refund-pos-payment/index.ts");
const helper = read("src/lib/posPaymentRefund.ts");
const page = read("src/pages/DevolucionesPage.tsx");

describe("refund Mercado Pago de una devolución POS", () => {
  it("exige usuario real y payments.edit antes de credenciales o RPC privada", () => {
    expect(edge).toContain("requireUser(req, corsHeaders)");
    expect(edge).toContain('userClient.rpc("has_permission"');
    expect(edge).toContain('p_module: "payments"');
    expect(edge).toContain('p_action: "edit"');
    expect(edge.indexOf('userClient.rpc("has_permission"')).toBeLessThan(
      edge.indexOf('admin.rpc("pos_mp_refund_prepare"'),
    );
    expect(edge.indexOf('userClient.rpc("has_permission"')).toBeLessThan(
      edge.indexOf("getMpCredentials(admin, orgId)"),
    );
  });

  it("el navegador no decide monto, credencial ni identificadores de Mercado Pago", () => {
    expect(helper).toContain('body: { orgId, refundId, action }');
    expect(helper).toContain("mensajeDeEdgeFunction(error, data)");
    expect(helper).not.toContain("amount:");
    expect(edge).not.toContain("body.amount");
    expect(edge).not.toContain("body.provider");
    expect(migration).toContain("v_payment.raw->>'provider_order_id'");
    expect(migration).toContain("v_payment.raw->>'provider_payment_id'");
    expect(migration).toContain("v_refund.amount");
  });

  it("soporta Orders API y Payments API con la misma identidad estable", () => {
    expect(edge).toContain('/v1/orders/${encodeURIComponent(orderId)}');
    expect(edge).toContain('/v1/payments/${encodeURIComponent(paymentId)}/refunds');
    expect(edge).toContain('"X-Idempotency-Key": String(prepared.client_key)');
    expect(edge).toContain("providerBody(prepared)");
    expect(edge).toContain("transactions: [{ id: paymentId, amount }]");
    expect(migration).toContain("'pos-refund:' || id::text");
    expect(migration).toContain("sales_return_refund_provider_key_uidx");
  });

  it("un timeout o rechazo conserva la deuda y obliga a verificar", () => {
    expect(edge).toContain('p_provider_status: "network_unknown"');
    expect(edge).toContain('status: "pending_external"');
    expect(edge).toContain("provider.response.status === 409 || provider.response.status >= 500");
    expect(migration).toContain("CHECK (status IN ('completed', 'pending_external'))");
    expect(migration).toContain("El reintegro continúa pending_external");
    expect(migration).not.toContain("CHECK (status IN ('completed', 'pending_external', 'failed'))");
  });

  it("sólo evidencia positiva cancela el pasivo local", () => {
    expect(edge).toContain('admin.rpc("pos_mp_refund_observe"');
    expect(edge).toContain('admin.rpc("sales_return_refund_complete"');
    expect(edge.indexOf('p_provider_status: cleanText(match.row.status')).toBeLessThan(
      edge.indexOf('admin.rpc("sales_return_refund_complete"'),
    );
    expect(edge).toContain("confirmedStatus(row, mode)");
    expect(edge).toContain('status === "processed"');
    expect(edge).toContain('status === "approved"');
  });

  it("las funciones internas no quedan disponibles para authenticated", () => {
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.pos_mp_refund_prepare(uuid, uuid, uuid, boolean)",
    );
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.pos_mp_refund_observe(uuid, text, text, text, jsonb)",
    );
    expect(migration).toContain("TO service_role");
    expect(migration).toContain("has_function_privilege(");
  });

  it("la UI ejecuta, reintenta y reconcilia bajo la matriz de permisos", () => {
    expect(page).toContain('useModulePermissions("payments")');
    expect(page).toContain('operateProviderRefund(refund.id, "execute")');
    expect(page).toContain('operateProviderRefund(refund.id, "reconcile")');
    expect(page).toContain("Requiere permiso Pagos · Editar");
    expect(page).toContain("El dinero sigue pendiente hasta que Mercado Pago lo confirme");
    expect(page).toContain("Gestiona nunca permite cerrarlo a mano");
  });

  it("la creación intenta el refund automáticamente sin perder la devolución", () => {
    expect(page).toContain('refund.execution_mode === "mercadopago_api"');
    expect(page).toContain('await operateProviderRefund(refund.refund_id, "execute")');
    expect(page).toContain("La devolución quedó registrada; el dinero sigue pendiente");
    expect(page.indexOf('supabase.rpc("create_sales_return_v1"')).toBeLessThan(
      page.indexOf('await operateProviderRefund(refund.refund_id, "execute")'),
    );
  });
});
