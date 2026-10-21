import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LibroIvaDigital from "@/components/afip/LibroIvaDigital";

const { respuestas, llamadas } = vi.hoisted(() => ({ respuestas: [] as unknown[], llamadas: [] as string[][] }));
vi.mock("@/integrations/supabase/client", () => {
  const consulta = () => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "not", "gte", "lte", "order"]) q[m] = (...a: unknown[]) => { llamadas.push([m, ...a.map(String)]); return q; };
    q.range = async () => respuestas.shift() ?? { data: [], error: null };
    return q;
  };
  return { supabase: { from: () => consulta() } };
});

const factura = (id: string, extra: Record<string, unknown> = {}) => ({
  id, number: id, issue_date: "2026-09-10", tipo_comprobante: 6, punto_venta: 3, numero_afip: Number(id.replace(/\D/g, "")) || 1,
  customer_tax_id: "", customer_name: "", subtotal: 100, tax_amount: 21, tax_pct: 21, total: 121, afip_environment: "produccion", invoice_items: [], ...extra,
});

beforeEach(() => { respuestas.length = 0; llamadas.length = 0; });

describe("Libro IVA Digital en la pantalla de ARCA", () => {
  it("resume el mes, deja afuera homologación y avisa lo que no entra", async () => {
    respuestas.push({ data: [factura("zz1"), factura("zz2", { afip_environment: "homologacion" }), factura("zz3", { total: 999 })], error: null });
    render(<LibroIvaDigital orgId="zz-org" monotributo={false} />);
    expect(await screen.findByText("IVA débito fiscal")).toBeVisible();
    expect(screen.getByText(/1 comprobante no entra en el libro/)).toBeVisible();
    expect(screen.getByText(/1 comprobantes de homologación/)).toBeVisible();
    expect(screen.getByRole("button", { name: /Comprobantes \(\.txt\)/ })).toBeEnabled();
    expect(llamadas).toContainEqual(["eq", "afip_status", "authorized"]);
    expect(llamadas).toContainEqual(["not", "cae", "is", "null"]);
  });

  it("un error de lectura se ve y se puede reintentar, nunca como libro vacío", async () => {
    respuestas.push({ data: null, error: { message: "zz" } });
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<LibroIvaDigital orgId="zz-org" monotributo />);
    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudieron leer las facturas del período");
    expect(screen.queryByText("No hay facturas con CAE en este período.")).not.toBeInTheDocument();
    respuestas.push({ data: [], error: null });
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await waitFor(() => expect(screen.getByText("No hay facturas con CAE en este período.")).toBeVisible());
    expect(screen.getByText(/monotributistas no presentan Libro IVA/)).toBeVisible();
  });
});
