import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const matrix = read("scripts/payment-matrix.sql");
const migration = read("supabase/migrations/20260821000055_ledger_payment_source.sql");
const refundOverload = read("supabase/migrations/20260821000056_refund_rpc_overload.sql");
const correlation = read("supabase/migrations/20260821000057_payment_correlation_trace.sql");
const settlement = read("supabase/functions/_shared/paymentSettlement.ts");
const orchestrator = read("supabase/functions/_shared/paymentOrchestrator.ts");
const storePay = read("supabase/functions/store-pay/index.ts");
const tracePanel = read("src/components/finance/PaymentSettlementsPanel.tsx");

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
    expect(matrix).toContain("traza_end_to_end");
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

  it("propaga una correlación server-side hasta proveedor, eventos y ledger", () => {
    expect(correlation).toContain("payment_intents.correlation_id");
    expect(correlation).toContain("trg_payment_transaction_correlation");
    expect(correlation).toContain("SELECT i.correlation_id INTO v_payment_correlation");
    expect(correlation).toContain("''correlation_id'', v_pt.correlation_id");
    expect(orchestrator).toContain("correlationId: typeof row.correlation_id");
    expect(storePay.match(/metadata: \{ correlation_id: attempt\.correlationId \}/g)).toHaveLength(2);
  });

  it("expone una timeline RLS sin payloads ni datos del comprador", () => {
    expect(correlation).toContain("VIEW public.payment_operation_trace");
    expect(correlation).toContain("WITH (security_invoker = true)");
    expect(correlation).toContain("REVOKE ALL ON public.payment_operation_trace FROM PUBLIC, anon");
    const viewDefinition = correlation.slice(
      correlation.indexOf("CREATE OR REPLACE VIEW public.payment_operation_trace"),
      correlation.indexOf("REVOKE ALL ON public.payment_operation_trace"),
    );
    expect(viewDefinition).not.toContain("customer_email");
    expect(viewDefinition).not.toContain("customer_name");
    expect(viewDefinition).not.toMatch(/\braw\b/);
    expect(tracePanel).toContain("payment_operation_trace");
    expect(tracePanel).toContain("sin datos del comprador");
  });

  it("revierte todos los datos ZZ incluso después de probar constraints diferidos", () => {
    expect(matrix).toContain("SET CONSTRAINTS ALL IMMEDIATE");
    expect(matrix).toContain("RAISE EXCEPTION 'payment matrix rollback'");
    expect(matrix).toContain("EXCEPTION WHEN SQLSTATE 'P0002'");
    expect(matrix).toContain("'zz_restos', true");
    expect(matrix).not.toMatch(/DELETE FROM public\./);
  });
});
