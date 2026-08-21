import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const matrix = read("scripts/payment-matrix.sql");
const migration = read("supabase/migrations/20260821000055_ledger_payment_source.sql");
const refundOverload = read("supabase/migrations/20260821000056_refund_rpc_overload.sql");
const settlement = read("supabase/functions/_shared/paymentSettlement.ts");

describe("matriz operativa de pagos", () => {
  it("mantiene un solo vocabulario ecommerce entre settlement y ledger", () => {
    expect(settlement).toContain('p_source: isStoreOrder ? "ecommerce"');
    expect(migration).toContain("'source = ''ecommerce_order'''");
    expect(migration).toContain("'source = ''ecommerce'''");
    expect(migration).toContain("v_old_count = 1");
  });

  it("ensaya checkout, timeout, webhook, rechazo y refund duplicados", () => {
    expect(matrix).toContain("checkout_idempotente");
    expect(matrix).toContain("timeout_sin_doble_cobro");
    expect(matrix).toContain("webhook_duplicado");
    expect(matrix).toContain("rechazo_reintentable");
    expect(matrix).toContain("refund_timeout");
    expect(matrix).toContain("refund_reconciliado");
  });

  it("mantiene inequívoco el wrapper de reintegro con tenant", () => {
    expect(refundOverload).toContain("p_requested_by      uuid\n");
    expect(refundOverload).not.toContain("p_requested_by      uuid DEFAULT");
    expect(refundOverload).toContain("pronargdefaults");
    expect(refundOverload).toContain("v_defaults <> 0");
  });

  it("demuestra que la comisión real llega a las partidas del ledger", () => {
    expect(matrix).toContain("public.record_payment_settlement(");
    expect(matrix).toContain("public.ledger_asentar_orden_pagada");
    expect(matrix).toContain("a.codigo = '5.2.01'");
    expect(matrix).toContain("v_provider_fee + v_provider_fee_iva");
  });

  it("revierte todos los datos ZZ incluso después de probar constraints diferidos", () => {
    expect(matrix).toContain("SET CONSTRAINTS ALL IMMEDIATE");
    expect(matrix).toContain("RAISE EXCEPTION 'payment matrix rollback'");
    expect(matrix).toContain("EXCEPTION WHEN SQLSTATE 'P0002'");
    expect(matrix).toContain("'zz_restos', true");
    expect(matrix).not.toMatch(/DELETE FROM public\./);
  });
});
