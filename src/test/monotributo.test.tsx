import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ESCALA_MONOTRIBUTO, situacionMonotributo, ventanaDeDoceMeses } from "@/lib/monotributo";
import MonotributoPanel from "@/components/afip/MonotributoPanel";

const { respuestas } = vi.hoisted(() => ({ respuestas: { invoices: [] as unknown[], products: [] as unknown[] } }));
vi.mock("@/integrations/supabase/client", () => {
  const consulta = (tabla: "invoices" | "products") => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "not", "gte", "lte", "gt", "order"]) q[m] = () => q;
    q.range = async () => respuestas.invoices.shift() ?? { data: [], error: null };
    q.limit = async () => respuestas.products.shift() ?? { data: [], count: 0, error: null };
    return q;
  };
  return { supabase: { from: (t: "invoices" | "products") => consulta(t) } };
});
vi.mock("@/lib/fechaAR", () => ({ hoyAR: () => "2026-10-21" }));

const c = (issue_date: string, total: number, tipo_comprobante = 11) => ({ issue_date, total, tipo_comprobante });

describe("situación de monotributo", () => {
  it("toma los 12 meses: los 11 anteriores completos y el actual", () => {
    expect(ventanaDeDoceMeses("2026-10-21")).toEqual({ desde: "2025-11-01", hasta: "2026-10-21" });
    expect(ventanaDeDoceMeses("2027-01-05")).toEqual({ desde: "2026-02-01", hasta: "2027-01-05" });
  });

  it("suma facturas, resta notas de crédito y ubica la categoría por ingresos", () => {
    const s = situacionMonotributo([
      c("2025-10-31", 99_000_000), // fuera de la ventana
      c("2026-01-10", 20_000_000),
      c("2026-09-10", 6_000_000),
      c("2026-09-12", 1_000_000, 13),
    ], "2026-10-21");
    expect(s.facturado).toBe(25_000_000);
    expect(s).toMatchObject({ categoria: "D", tope: 30_628_651.43, excedido: false, escalaDesactualizada: false });
    expect(s.margen).toBe(5_628_651.43);
  });

  it("el tope es inclusivo y pasar la K es exceso", () => {
    expect(situacionMonotributo([c("2026-10-01", 12_009_410.45)], "2026-10-21").categoria).toBe("A");
    const excedido = situacionMonotributo([c("2026-10-01", 130_000_000)], "2026-10-21");
    expect(excedido).toMatchObject({ categoria: null, margen: null, excedido: true });
  });

  it("avisa cuando la escala puede estar vieja", () => {
    expect(situacionMonotributo([], ESCALA_MONOTRIBUTO.revisarDesde).escalaDesactualizada).toBe(true);
  });

  it("la escala está ordenada y es la publicada desde el 1/08/2026", () => {
    const topes = ESCALA_MONOTRIBUTO.categorias.map(x => x.tope);
    expect([...topes].sort((a, b) => a - b)).toEqual(topes);
    expect(ESCALA_MONOTRIBUTO.categorias.map(x => x.categoria).join("")).toBe("ABCDEFGHIJK");
    expect(ESCALA_MONOTRIBUTO.vigenteDesde).toBe("2026-08-01");
  });
});

describe("panel de monotributo", () => {
  beforeEach(() => { respuestas.invoices.length = 0; respuestas.products.length = 0; });

  it("muestra lo facturado, la categoría y los productos por encima del precio máximo", async () => {
    respuestas.invoices.push({ data: [
      { issue_date: "2026-09-10", tipo_comprobante: 11, total: 25_000_000, afip_environment: "produccion" },
      { issue_date: "2026-09-11", tipo_comprobante: 11, total: 90_000_000, afip_environment: "homologacion" },
    ], error: null });
    respuestas.products.push({ data: [{ name: "Generador ZZ", sale_price_ars: 900_000 }], count: 1, error: null });
    render(<MonotributoPanel orgId="zz-org" />);
    expect(await screen.findByText("D")).toBeVisible();
    expect(screen.getByText(/1 producto activo supera/)).toBeVisible();
    expect(screen.getByText(/Generador ZZ/)).toBeVisible();
  });

  it("un error se ve con reintento", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    respuestas.invoices.push({ data: null, error: { message: "zz" } });
    render(<MonotributoPanel orgId="zz-org" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo leer tu facturación");
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeEnabled();
  });
});
