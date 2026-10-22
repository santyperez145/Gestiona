import { readFileSync } from "node:fs";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ComprobantesDeCompra from "@/components/afip/ComprobantesDeCompra";

const { rpc, filas } = vi.hoisted(() => ({ rpc: vi.fn(), filas: [] as unknown[] }));
vi.mock("@/integrations/supabase/client", () => {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order"]) q[m] = () => q;
  q.range = async () => ({ data: filas, error: null });
  return { supabase: { from: () => q, rpc } };
});

const comprobante = (p: Record<string, unknown>) => ({
  id: "zz-1", fecha: "2026-10-05", tipo_comprobante: 1, punto_venta: 3, numero: 1234, cuit_emisor: "30712345671", razon_social_emisor: "ZZ Distribuidora",
  alicuotas: [{ tasa: 21, neto: 1000, iva: 210 }], no_gravado: 0, exento: 0, percepcion_iva: 0, percepcion_nacionales: 0, percepcion_iibb: 0,
  percepcion_municipal: 0, impuestos_internos: 0, otros_tributos: 0, total: 1210, supplier_debt_id: null, aplicado_at: null, saldo_a_favor: 0, vencimiento: null, ...p,
});

beforeEach(() => { filas.length = 0; rpc.mockReset(); });

describe("La factura del proveedor en su cuenta corriente", () => {
  it("una factura sin deuda ofrece pasarla, con vencimiento a 30 días, y llama a la base", async () => {
    filas.push(comprobante({}));
    rpc.mockResolvedValue({ data: { ok: true, importe: 1210 }, error: null });
    render(<ComprobantesDeCompra orgId="zz-org" periodo="2026-10" canEdit onResumen={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "A cuenta corriente" }));
    expect(screen.getByLabelText("Vencimiento del pago")).toHaveValue("2026-11-04");
    fireEvent.click(screen.getByRole("button", { name: "Registrar la deuda" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("pasar_comprobante_a_cuenta_corriente", { p_comprobante: "zz-1", p_vencimiento: "2026-11-04" }));
  });

  it("una registrada ya no se puede borrar ni pasar de nuevo; una nota de crédito se aplica", async () => {
    filas.push(comprobante({ supplier_debt_id: "deuda-1", vencimiento: "2026-11-04" }), comprobante({ id: "zz-2", tipo_comprobante: 3, numero: 15, total: 300 }));
    render(<ComprobantesDeCompra orgId="zz-org" periodo="2026-10" canEdit onResumen={() => {}} />);
    expect(await screen.findByText("Deuda registrada, vence 04/11/2026")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Borrar comprobante 3-1234" })).toBeNull();
    expect(screen.getByRole("button", { name: "Aplicar a la deuda" })).toBeInTheDocument();
  });

  it("la base crea la deuda una sola vez, aplica la nota de crédito de la más vieja a la más nueva y no deja borrar", () => {
    const sql = readFileSync("supabase/migrations/20261022001300_factura_proveedor_cuenta_corriente.sql", "utf8");
    expect(sql).toContain("IF c.supplier_debt_id IS NOT NULL OR c.aplicado_at IS NOT NULL THEN");
    expect(sql).toContain("ORDER BY due_date NULLS LAST, created_at, id FOR UPDATE");
    expect(sql).toContain("Este comprobante ya esta en la cuenta corriente del proveedor: no se puede borrar");
    expect(sql).toContain("has_permission(c.org_id, 'purchases', 'edit')");
  });
});
