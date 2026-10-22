import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import LiquidacionIibbMes from "@/components/afip/LiquidacionIibbMes";
import { liquidacionIibb } from "@/lib/liquidacionIibb";

const ventas = [{ id: "zz-1", issue_date: "2026-10-10", tipo_comprobante: 6, punto_venta: 3, numero_afip: 1, subtotal: 10000, tax_amount: 2100, tax_pct: 21, total: 12100 }];

describe("Ingresos Brutos del período en pantalla", () => {
  it("muestra cada jurisdicción con su saldo y el total a pagar", () => {
    const l = liquidacionIibb({
      comprobantes: ventas, retenciones: [], percepcionesDeCompras: 0,
      inscripciones: [
        { id: "a", province: "CABA", regime: "convenio", rate_pct: 3, coeficiente: 0.6, active: true },
        { id: "b", province: "Buenos Aires", regime: "convenio", rate_pct: 3.5, coeficiente: 0.4, active: true },
      ],
    });
    render(<MemoryRouter><LiquidacionIibbMes liquidacion={l} /></MemoryRouter>);
    const tabla = screen.getByRole("table", { name: "Liquidación de Ingresos Brutos por jurisdicción" });
    expect(tabla).toHaveTextContent("CABA");
    expect(screen.getByRole("rowheader", { name: /Buenos Aires/ })).toBeInTheDocument();
    expect(tabla.querySelector("tfoot")).toHaveTextContent(/320,00/);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("sin inscripciones manda a cargarlas", () => {
    const l = liquidacionIibb({ comprobantes: ventas, inscripciones: [], retenciones: [], percepcionesDeCompras: 0 });
    render(<MemoryRouter><LiquidacionIibbMes liquidacion={l} /></MemoryRouter>);
    expect(screen.getByRole("link", { name: "Impuestos → IIBB" })).toHaveAttribute("href", "/impuestos?tab=iibb");
    expect(screen.getByRole("alert")).toHaveTextContent("No cargaste en qué jurisdicciones");
  });
});
