import { readFileSync } from "node:fs";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import FacturarRemitosDialog from "@/components/remitos/FacturarRemitosDialog";
import { clientesParaFacturar, type VentaDeRemito } from "@/lib/facturarRemitos";
import type { Remito } from "@/lib/remitos";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
const ventasMock: VentaDeRemito[] = [];
vi.mock("@/integrations/supabase/client", () => {
  const q: Record<string, unknown> = {};
  q.select = () => q; q.eq = () => q;
  q.in = async () => ({ data: ventasMock, error: null });
  return { supabase: { from: () => q, rpc } };
});

const remito = (p: Partial<Remito>): Remito => ({
  id: `zz-${Math.random()}`, punto_venta: 1, numero: 1, letra: "X", cai: null, cai_vence: null, fecha: "2026-10-05",
  sale_transaction_id: "tx1", customer_id: "cli-1", cliente_nombre: "ZZ Ferretería", cliente_cuit: null, cliente_domicilio: null,
  transportista: null, bultos: null, valor_declarado: null, observaciones: null, estado: "entregado", entregado_at: null,
  recibio_nombre: null, recibio_dni: null, anulado_at: null, anulado_motivo: null, created_at: "2026-10-05T10:00:00Z", remito_items: [], ...p,
});

const remitos = [
  remito({ numero: 1, sale_transaction_id: "tx1", fecha: "2026-10-05" }),
  remito({ numero: 2, sale_transaction_id: "tx1", fecha: "2026-10-06" }),
  remito({ numero: 3, sale_transaction_id: "tx2", fecha: "2026-10-12" }),
  remito({ numero: 4, sale_transaction_id: "tx3", fecha: "2026-10-13" }),
  remito({ numero: 5, sale_transaction_id: "tx4", estado: "anulado" }),
  remito({ numero: 6, sale_transaction_id: null }),
  remito({ numero: 7, sale_transaction_id: "tx5", customer_id: "cli-2", cliente_nombre: "ZZ Otra" }),
];
const ventas: VentaDeRemito[] = [
  { sale_transaction_id: "tx1", invoice_id: null, total_ars: 1000 },
  { sale_transaction_id: "tx1", invoice_id: null, total_ars: 250.5 },
  { sale_transaction_id: "tx2", invoice_id: null, total_ars: 500 },
  { sale_transaction_id: "tx3", invoice_id: "inv-ya", total_ars: 100 },
  { sale_transaction_id: "tx4", invoice_id: null, total_ars: 100 },
  { sale_transaction_id: "tx5", invoice_id: null, total_ars: 100 },
];

describe("Facturar remitos juntos: qué se puede agrupar", () => {
  it("una venta por transacción con sus remitos y su total; sin anulados, manuales ni facturadas", () => {
    expect(clientesParaFacturar(remitos, ventas)).toEqual([{
      customerId: "cli-1", nombre: "ZZ Ferretería",
      ventas: [
        { transaccion: "tx1", fecha: "2026-10-05", remitos: ["X 0001-00000001", "X 0001-00000002"].map(r => expect.stringContaining(r.slice(-8))), total: 1250.5 },
        { transaccion: "tx2", fecha: "2026-10-12", remitos: [expect.stringContaining("00000003")], total: 500 },
      ],
    }]);
  });
  it("un cliente con una sola venta no aparece", () => {
    expect(clientesParaFacturar([remito({ sale_transaction_id: "tx2" })], ventas)).toEqual([]);
  });
});

describe("Facturar remitos juntos: el diálogo", () => {
  beforeEach(() => { ventasMock.length = 0; ventasMock.push(...ventas); rpc.mockReset(); });

  it("elige el cliente, marca sus ventas y factura con la función de la base", async () => {
    rpc.mockResolvedValue({ data: { ok: true, invoice_id: "inv-1", number: "F-9", ventas: 2 }, error: null });
    render(<MemoryRouter><FacturarRemitosDialog open onOpenChange={() => {}} orgId="zz-org" remitos={remitos} /></MemoryRouter>);
    expect(await screen.findByText("Elegí al menos dos ventas")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Facturar juntas" })).toBeDisabled();
    expect(await screen.findByRole("combobox", { name: "Cliente" })).toBeInTheDocument();
  });

  it("la función está en la migración con sus controles", () => {
    const sql = readFileSync("supabase/migrations/20261022001200_facturar_ventas_juntas.sql", "utf8");
    expect(sql).toContain("Para facturar juntas, todas las ventas tienen que ser del mismo cliente registrado");
    expect(sql).toContain("UPDATE public.sales SET invoice_id = v_id WHERE sale_transaction_id = ANY(p_transacciones)");
    expect(sql).toContain("SELECT invoice_id FROM public.sales WHERE sale_transaction_id = p_transaction_id AND org_id = p_org AND invoice_id IS NOT NULL");
    expect(readFileSync("scripts/migraciones-pendientes.mjs", "utf8")).toContain("'20261022001200': 'scripts/facturar-ventas-juntas-matrix.sql'");
  });
});
