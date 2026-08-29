import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("reintegros de MercadoPago", () => {
  const fn = read("supabase/functions/refund-store-payment/index.ts");
  const migration = read("supabase/migrations/20260821000045_payment_refunds.sql");
  const orgGuard = read("supabase/migrations/20260821000046_payment_refunds_org_guard.sql");
  const operations = read("supabase/migrations/20260821000047_payment_refund_operations.sql");
  const portal = read("src/components/sales/ReturnsPortalTab.tsx");
  const helper = read("src/lib/paymentRefunds.ts");

  it("exige usuario real y payments.edit antes de llamar al proveedor", () => {
    expect(fn).toContain("requireUser(req, corsHeaders)");
    expect(fn).toContain('userClient.rpc("has_permission"');
    expect(fn).toContain('p_module: "payments"');
    expect(fn).toContain('p_action: "edit"');
    expect(fn).toContain("if (permissionError)");
    expect(fn).toContain("if (canRefund !== true)");
    expect(fn).not.toContain('!["owner", "admin"].includes(membership.role)');
    expect(fn).toContain('admin.rpc("pago_reintegro_preparar"');
    expect(fn).toContain("p_org_id: orgId");
    expect(fn).toContain('getMpCredentials(admin, actualOrgId)');
    expect(fn.indexOf('userClient.rpc("has_permission"')).toBeLessThan(fn.indexOf('admin.rpc("pago_reintegro_preparar"'));
    expect(fn.indexOf('userClient.rpc("has_permission"')).toBeLessThan(fn.indexOf('getMpCredentials(admin, actualOrgId)'));
  });

  it("no acepta monto desde el navegador y manda la clave estable de idempotencia", () => {
    expect(fn).toContain("const amount = Number(refund.amount)");
    expect(fn).not.toContain("body.amount");
    expect(fn).toContain('"X-Idempotency-Key": clientKey');
    expect(fn).toContain("const refundBody = isTotal ? {} : { amount }");
    expect(migration).toContain("payment_refunds_client_key_unico");
    expect(migration).toContain("pago_reintegro_resultado");
  });

  it("deja el reembolso en verificación ante timeout y no lo marca como fallido", () => {
    expect(fn).toContain('status: "processing"');
    expect(fn).toContain("el retry usa exactamente la misma clave");
    expect(fn).toContain("pago_reintegro_resultado success");
    expect(migration).toContain("status IN ('processing', 'refunded', 'failed')");
  });

  it("puede reconciliar un timeout sin crear un segundo intento", () => {
    expect(fn).toContain('action !== "execute" && action !== "reconcile"');
    expect(fn).toContain('pago_reintegro_estado');
    expect(fn).toContain('/v1/payments/${encodeURIComponent(paymentId)}/refunds');
    expect(fn).toContain('String(row.status ?? "").toLowerCase() !== "approved"');
    expect(fn).toContain('pago_reintegro_observar');
    expect(operations).toContain('CREATE OR REPLACE FUNCTION public.pago_reintegro_estado');
    expect(operations).toContain('CREATE OR REPLACE FUNCTION public.pago_reintegro_observar');
  });

  it("expone la operación en RMA y no permite resolverla sólo con un cambio local", () => {
    expect(portal).toContain('r.resolution === "refund"');
    expect(portal).toContain('r.refund_method === "original_payment"');
    expect(portal).toContain("Ejecutar reintegro");
    expect(portal).toContain("!needsProviderRefund");
    expect(portal).toContain('reconcileRefund(r)');
    expect(portal).toContain('useModulePermissions("payments")');
    expect(portal).toContain("paymentPermissions.canEdit");
    expect(portal).toContain("Sin permiso para reintegrar");
    expect(portal).toContain('receiveStoreReturnRequest(request.id)');
    expect(helper).toContain('supabase.functions.invoke("refund-store-payment"');
    expect(helper).toContain('supabase.rpc("receive_store_return_request"');
  });

  it("recibe la mercadería una sola vez y la liga al RMA", () => {
    expect(operations).toContain("return_request_id uuid");
    expect(operations).toContain("received_at");
    expect(operations).toContain("record_stock_movement");
    expect(operations).toContain("idempotent', true");
    expect(operations).toContain("receive_store_return_request(uuid)");
  });

  it("cierra las ACL de escritura y de los RPCs de dinero", () => {
    expect(migration).toContain("REVOKE ALL ON public.payment_refunds FROM PUBLIC, anon, authenticated");
    expect(migration).toContain("GRANT SELECT ON public.payment_refunds TO authenticated");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.pago_reintegro_preparar(uuid, uuid) TO service_role");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.pago_reintegro_resultado(uuid, text, text, jsonb, text)");
    expect(orgGuard).toContain("p_org_id");
    expect(orgGuard).toContain("v_request_org <> p_org_id");
    expect(orgGuard).toContain("pago_reintegro_preparar(uuid,uuid,uuid)");
    expect(operations).toContain("GRANT EXECUTE ON FUNCTION public.receive_store_return_request(uuid)");
    expect(operations).toContain("pago_reintegro_estado(uuid,uuid)");
    expect(operations).toContain("pago_reintegro_observar(uuid,jsonb)");
    expect(migration).toContain("block_partial_order_reapproval");
  });
});
