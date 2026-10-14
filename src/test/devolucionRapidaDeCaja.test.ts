import { describe, it, expect, vi, beforeEach } from "vitest";

// 2026-10-14 (páginas legacy): la devolución rápida de la caja hacía tres
// escrituras sueltas desde el navegador y marcaba devuelta la venta entera.
// Ahora usa preview_sales_return + create_sales_return_v1, como Devoluciones.
const base = vi.hoisted(() => ({ llamadas: [] as Array<{ fn: string; args: Record<string, unknown> }>, preview: null as unknown, estado: "completed" }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      base.llamadas.push({ fn, args });
      if (fn === "preview_sales_return") return { data: base.preview, error: null };
      return { data: { status: base.estado, reused: false }, error: null };
    },
  },
}));

import { devolverDesdeLaCaja } from "@/lib/devolucionRapida";

const preview = (over: Record<string, unknown> = {}) => ({
  sale_id: "s1", ticket_code: "T-1", open_cash_session_id: "caja-1",
  lines: [{ sale_id: "s1", product_name: "Martillo", sold_quantity: 3, returned_quantity: 1, available_quantity: 2, sold_amount: 3000, returned_amount: 1000, available_amount: 2000 }],
  payments: [{ payment_transaction_id: null, sale_method: "efectivo", available_amount: 2000, execution_mode: "cash" }],
  ...over,
});
const args = { orgId: "o1", saleId: "s1", cantidad: 1, motivo: " Falla ", reponerStock: true, clave: "c-1" };

describe("devolución rápida de la caja", () => {
  beforeEach(() => { base.llamadas = []; base.preview = preview(); base.estado = "completed"; });

  it("devuelve por la operación atómica, con clave, motivo y reintegro por el mismo medio", async () => {
    const r = await devolverDesdeLaCaja(args);
    expect(r).toEqual({ total: 1000, ticket: "T-1", repetida: false, pendienteExterno: false });
    const crear = base.llamadas.find(l => l.fn === "create_sales_return_v1")!;
    expect(crear.args).toMatchObject({
      p_org_id: "o1", p_sale_id: "s1", p_lines: [{ sale_id: "s1", quantity: 1 }],
      p_refund_allocations: [{ payment_transaction_id: null, sale_method: "efectivo", amount: 1000 }],
      p_reason: "Falla", p_restock: true, p_client_return_id: "c-1",
    });
  });

  it("no deja devolver más de lo que queda (una devolución parcial deja el resto)", async () => {
    await expect(devolverDesdeLaCaja({ ...args, cantidad: 3 })).rejects.toThrow("Se pueden devolver hasta 2 de «Martillo»");
    expect(base.llamadas.some(l => l.fn === "create_sales_return_v1")).toBe(false);
  });

  it("devolver efectivo exige la caja abierta", async () => {
    base.preview = preview({ open_cash_session_id: null });
    await expect(devolverDesdeLaCaja(args)).rejects.toThrow("tiene que estar abierta la caja");
  });

  it("si la base no completa el reintegro (Mercado Pago), lo dice", async () => {
    base.preview = preview({ payments: [{ payment_transaction_id: "pt1", sale_method: "mercado_pago", available_amount: 2000, execution_mode: "mercadopago_api" }] });
    base.estado = "pending_external";
    const r = await devolverDesdeLaCaja(args);
    expect(r.pendienteExterno).toBe(true);
    const crear = base.llamadas.find(l => l.fn === "create_sales_return_v1")!;
    expect(crear.args.p_refund_allocations).toEqual([{ payment_transaction_id: "pt1", sale_method: undefined, amount: 1000 }]);
  });
});
