import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("reintegros de MercadoPago", () => {
  const fn = read("supabase/functions/refund-store-payment/index.ts");
  const migration = read("supabase/migrations/20260821000045_payment_refunds.sql");
  const orgGuard = read("supabase/migrations/20260821000046_payment_refunds_org_guard.sql");
  const portal = read("src/components/sales/ReturnsPortalTab.tsx");

  it("exige usuario real y dueño/admin antes de llamar al proveedor", () => {
    expect(fn).toContain("requireUser(req, corsHeaders)");
    expect(fn).toContain('!["owner", "admin"].includes(membership.role)');
    expect(fn).toContain('admin.rpc("pago_reintegro_preparar"');
    expect(fn).toContain("p_org_id: orgId");
    expect(fn).toContain('getMpCredentials(admin, actualOrgId)');
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

  it("expone la operación en RMA y no permite resolverla sólo con un cambio local", () => {
    expect(portal).toContain('supabase.functions.invoke("refund-store-payment"');
    expect(portal).toContain('r.resolution === "refund"');
    expect(portal).toContain('r.refund_method === "original_payment"');
    expect(portal).toContain("Ejecutar reintegro");
    expect(portal).toContain("!needsProviderRefund");
  });

  it("cierra las ACL de escritura y de los RPCs de dinero", () => {
    expect(migration).toContain("REVOKE ALL ON public.payment_refunds FROM PUBLIC, anon, authenticated");
    expect(migration).toContain("GRANT SELECT ON public.payment_refunds TO authenticated");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.pago_reintegro_preparar(uuid, uuid) TO service_role");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.pago_reintegro_resultado(uuid, text, text, jsonb, text)");
    expect(orgGuard).toContain("p_org_id");
    expect(orgGuard).toContain("v_request_org <> p_org_id");
    expect(orgGuard).toContain("pago_reintegro_preparar(uuid,uuid,uuid)");
    expect(migration).toContain("block_partial_order_reapproval");
  });
});
