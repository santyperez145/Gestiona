import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ConciliacionArca from "@/components/afip/ConciliacionArca";

const { facturas, filtros } = vi.hoisted(() => ({ facturas: [] as unknown[], filtros: [] as string[][] }));
vi.mock("@/integrations/supabase/client", () => {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "not", "gte", "lte", "order"]) q[m] = (...a: unknown[]) => { filtros.push([m, ...a.map(String)]); return q; };
  q.range = async () => ({ data: facturas, error: null });
  return { supabase: { from: () => q } };
});

const CSV = [
  "Fecha;Tipo;Punto de Venta;Número Desde;Número Hasta;Cód. Autorización;Tipo Doc. Receptor;Nro. Doc. Receptor;Denominación Receptor;Tipo Cambio;Moneda;Imp. Total",
  "05/10/2026;6 - Factura B;3;1;1;76123456789012;80;30712345671;ZZ Cliente SA;1,00;$;1210,00",
  "06/10/2026;6 - Factura B;3;2;2;76123456789013;80;30712345671;ZZ Cliente SA;1,00;$;500,00",
].join("\n");

beforeEach(() => { facturas.length = 0; filtros.length = 0; });

describe("Conciliar con ARCA en pantalla", () => {
  it("lee el archivo, busca las facturas de esas fechas y señala el CAE que no se guardó", async () => {
    facturas.push(
      { id: "zz-1", number: "F-1", issue_date: "2026-10-05", tipo_comprobante: 6, punto_venta: 3, numero_afip: 1, cae: "76123456789012", total: 1210, currency: "ARS", afip_status: "authorized", afip_environment: "produccion" },
      { id: "zz-2", number: "F-2", issue_date: "2026-10-06", tipo_comprobante: 6, punto_venta: 3, numero_afip: null, cae: null, total: 500, currency: "ARS", afip_status: "network_error", afip_candidate_number: 2, afip_environment: "produccion" },
    );
    const { container } = render(<MemoryRouter><ConciliacionArca orgId="zz-org" /></MemoryRouter>);
    const input = container.querySelector("input[type=file]") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File([CSV], "MisComprobantesEmitidos.csv", { type: "text/csv" })] } });

    expect(await screen.findByRole("alert")).toHaveTextContent("ARCA otorgó un CAE que Nerqia no llegó a guardar");
    expect(screen.getByRole("link", { name: /factura F-2/ })).toHaveAttribute("href", "/facturas?invoice=zz-2");
    expect(screen.getByText("Coinciden").nextElementSibling).toHaveTextContent("1");
    expect(filtros).toContainEqual(["gte", "issue_date", "2026-10-05"]);
    expect(filtros).toContainEqual(["lte", "issue_date", "2026-10-06"]);
  });
});
