import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import CalendarPage from "@/pages/CalendarPage";

const hoy = new Date().toISOString().slice(0, 10);
const { filasPorTabla } = vi.hoisted(() => ({ filasPorTabla: {} as Record<string, unknown[]> }));
vi.mock("@/lib/orgContext", () => ({ useOrg: () => ({ activeOrg: { id: "zz-org", name: "ZZ" } }) }));
vi.mock("@/integrations/supabase/client", () => {
  const consulta = (tabla: string) => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "neq", "not", "gt", "gte", "lte", "in"]) q[m] = () => q;
    q.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: filasPorTabla[tabla] ?? [], error: null }).then(ok);
    return q;
  };
  return { supabase: { from: consulta } };
});

describe("Calendario: lo que hay que pagar y los cheques", () => {
  it("muestra el pago a un proveedor y los cheques a depositar y a debitar", async () => {
    filasPorTabla.supplier_debts = [{ id: "d1", supplier_name: "ZZ Distribuidora", description: "Factura 1", due_date: hoy, remaining_ars: 1500 }];
    filasPorTabla.cheques = [
      { id: "c1", type: "received", customer_name: "ZZ Cliente", bank_name: "ZZ Banco", check_number: "111", amount_ars: 800, due_date: hoy },
      { id: "c2", type: "issued", customer_name: "ZZ Distribuidora", bank_name: "ZZ Banco", check_number: "0001", amount_ars: 1500, due_date: hoy },
    ];
    render(<MemoryRouter><CalendarPage /></MemoryRouter>);
    // Cada vencimiento aparece en la grilla del mes y en el detalle del día.
    expect((await screen.findAllByText("Pagar a ZZ Distribuidora")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Depositar cheque de ZZ Cliente").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Se debita cheque N.º 0001 a ZZ Distribuidora").length).toBeGreaterThan(0);
    expect(screen.queryByText(/No se pudo leer/)).toBeNull();
  });
});
