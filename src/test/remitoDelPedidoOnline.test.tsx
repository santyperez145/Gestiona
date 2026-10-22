import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import OrderShipmentDialog from "@/components/ecommerce/OrderShipmentDialog";

const { filtros, emitir } = vi.hoisted(() => ({ filtros: [] as string[][], emitir: vi.fn() }));
vi.mock("@/lib/usePermissions", () => ({ useHasPermission: () => true, useModulePermissions: () => ({ canCreate: true, canEdit: true, canDelete: false, canView: true }) }));
vi.mock("@/lib/useUserRole", () => ({ useUserRole: () => ({ isAdmin: true }) }));
vi.mock("@/lib/orgContext", () => ({ useOrg: () => ({ activeOrg: { id: "zz-org" } }) }));
vi.mock("@/components/remitos/EmitirRemitoDialog", () => ({
  default: (p: { open: boolean; venta: unknown }) => { if (p.open) emitir(p.venta); return p.open ? <div role="dialog" aria-label="Remito" /> : null; },
}));
vi.mock("@/integrations/supabase/client", () => {
  const consulta = (tabla: string) => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "order", "limit", "in"]) q[m] = (...a: unknown[]) => { filtros.push([tabla, m, ...a.map(String)]); return q; };
    q.maybeSingle = async () => ({ data: null, error: null });
    q.then = (ok: (v: unknown) => unknown) => Promise.resolve({
      data: tabla === "sales" ? [{ id: "s1", product_name: "ZZ Remera", quantity: 2, returned_quantity: 0, sale_transaction_id: "tx-1" }] : [],
      error: null,
    }).then(ok);
    return q;
  };
  return { supabase: { from: consulta, functions: { invoke: vi.fn() } } };
});

describe("Del pedido online al remito", () => {
  it("un pedido pagado ofrece el remito con las líneas de su venta", async () => {
    render(<OrderShipmentDialog storeName="ZZ" onClose={() => {}} onDone={() => {}}
      order={{ id: "o1", order_number: "#1001", customer_name: "ZZ Comprador", customer_email: "zz@example.com", total: 100,
        payment_status: "paid", fulfillment_status: "unfulfilled", shipping_address: { calle: "ZZ 1" } }} />);
    fireEvent.click(await screen.findByRole("button", { name: "Remito" }));
    await waitFor(() => expect(emitir).toHaveBeenCalledWith({
      saleTransactionId: "tx-1", codigo: "#1001", clienteNombre: "ZZ Comprador",
      lineas: [{ id: "s1", product_name: "ZZ Remera", quantity: 2, returned_quantity: 0, sale_transaction_id: "tx-1" }],
    }));
    expect(filtros).toContainEqual(["sales", "eq", "ecommerce_order_id", "o1"]);
  });
});
