import { readFileSync } from "node:fs";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import FacturaDeExportacion from "@/components/invoices/FacturaDeExportacion";
import { detalleFiscalInicial, detalleFiscalParaEnviar, erroresDelDetalleFiscal, exportacionInicial, exportacionParaEnviar, type DetalleFiscal } from "@/lib/detalleFiscal";
import { libroIvaVentas } from "@/lib/libroIvaVentas";
import { liquidacionIibb } from "@/lib/liquidacionIibb";

vi.mock("@/integrations/supabase/client", () => {
  const q: Record<string, unknown> = {};
  q.select = () => q;
  q.eq = async () => ({ data: [
    { tipo: "paises", datos: [{ codigo: "220", descripcion: "PARAGUAY" }, { codigo: "225", descripcion: "URUGUAY" }] },
    { tipo: "incoterms", datos: [{ codigo: "FOB", descripcion: "FREE ON BOARD" }, { codigo: "CIF", descripcion: "COST INSURANCE AND FREIGHT" }] },
  ], error: null });
  return { supabase: { from: () => q, functions: { invoke: vi.fn() } } };
});

describe("Factura E: el formulario", () => {
  it("se convierte en los datos que guarda la factura y valida como ARCA", () => {
    const e = { ...exportacionInicial(), paisDestino: "220", domicilio: "ZZ Avenida 1", idImpositivo: "ZZ-99", formaPago: "Transferencia" };
    expect(exportacionParaEnviar(e)).toEqual({
      tipo_expo: 1, pais_destino: 220, domicilio_cliente: "ZZ Avenida 1", id_impositivo: "ZZ-99", cuit_pais: null, idioma: 1,
      forma_pago: "Transferencia", incoterms: "FOB", incoterms_ds: null, permiso_existente: "N", permisos: null, fecha_pago: null, obs_comerciales: null,
    });
    const d: DetalleFiscal = { ...detalleFiscalInicial(), moneda: "USD", exportacion: e };
    expect(erroresDelDetalleFiscal(d, { hoy: "2026-10-22" })).toEqual([]);
    expect(detalleFiscalParaEnviar(d)).toMatchObject({ moneda: "USD", tributos: [], exportacion: { pais_destino: 220 } });
    expect(detalleFiscalParaEnviar(d)).not.toHaveProperty("fce");
    const conTributo = { ...d, tributos: [{ tipo: 2, descripcion: "", base: 100, alicuota: 3, importe: 3 }] } as DetalleFiscal;
    expect(erroresDelDetalleFiscal(conTributo)[0]).toMatch(/no lleva percepciones/);
    expect(erroresDelDetalleFiscal({ ...d, exportacion: { ...e, tipoExpo: "2" } }, { hoy: "2026-10-22" })).toContain("En servicios y otros la fecha de pago es obligatoria.");
  });

  it("muestra los datos de exportación al activarla, con los países de ARCA", async () => {
    function Probar() {
      const [d, setD] = useState<DetalleFiscal>(detalleFiscalInicial());
      return <FacturaDeExportacion valor={d} onChange={setD} orgId="zz-org" ambiente="homologacion" puedeActualizar />;
    }
    render(<Probar />);
    expect(screen.queryByLabelText("País de destino")).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: /Factura de exportación \(E\)/ }));
    const pais = await screen.findByLabelText("País de destino");
    expect(document.querySelector('#fe-paises option[value="220 — PARAGUAY"]')).not.toBeNull();
    fireEvent.change(pais, { target: { value: "220 — PARAGUAY" } });
    expect(screen.getByRole("radio", { name: "Todavía no" })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: "Sí" }));
    expect(screen.getByLabelText("País (código)")).toHaveValue("220");
    expect(screen.queryByText(/Todavía no se trajeron de ARCA/)).toBeNull();
  });
});

describe("Factura E en los libros", () => {
  const e = {
    id: "zz-e", issue_date: "2026-10-10", tipo_comprobante: 19, punto_venta: 5, numero_afip: 1, customer_tax_id: "ZZ-99", customer_name: "ZZ Importadora",
    subtotal: 0, tax_amount: 0, tax_pct: 0, total: 1000, importe_exento: 1000, currency: "USD", moneda_cotizacion: 1000,
    invoice_items: [{ total: 1000, tax_rate: 0, tax_amount: 0, tratamiento: "exento" as const }],
  };
  it("el Libro IVA la informa como exportación al exterior («X»)", () => {
    const libro = libroIvaVentas([e]);
    expect(libro.problemas).toEqual([]);
    expect(libro.cbte.slice(0, 3 + 8)).toContain("20261010019");
    const linea = libro.cbte.split("\r\n")[0];
    // Moneda, cotización (4 enteros y 6 decimales), cantidad de alícuotas y código de operación.
    expect(linea).toContain("DOL" + "1000000000" + "0" + "X");
  });
  it("no integra la base de Ingresos Brutos", () => {
    const l = liquidacionIibb({ comprobantes: [e], retenciones: [], percepcionesDeCompras: 0,
      inscripciones: [{ id: "a", province: "CABA", regime: "local", rate_pct: 3, active: true }] });
    expect(l.baseTotal).toBe(0);
    expect(l.exportaciones).toBe(1_000_000);
  });
});

describe("Factura E: el circuito", () => {
  it("afip-authorize la reenvía a arca-fex con la misma autoridad, antes de tocar WSFE", () => {
    const fuente = readFileSync("supabase/functions/afip-authorize/index.ts", "utf8");
    const reenvio = fuente.indexOf("if ([19, 20, 21].includes(Number(invoice.tipo_comprobante)))");
    expect(reenvio).toBeGreaterThan(0);
    expect(reenvio).toBeLessThan(fuente.indexOf('"afip_autorizacion_reservar"'));
    expect(fuente).toContain('if (outbox) headers["x-cron-secret"] = req.headers.get("x-cron-secret") ?? "";');
  });
  it("arca-fex guarda el Id antes de llamar y verifica que el CAE recuperado sea de este comprobante", () => {
    const fuente = readFileSync("supabase/functions/arca-fex/index.ts", "utf8");
    expect(fuente.indexOf('"afip_fex_asignar_id"')).toBeLessThan(fuente.indexOf('"FEXAuthorize"'));
    expect(fuente).toContain("if (r.numero !== numero || r.puntoVenta !== puntoVenta || r.tipo !== tipo)");
    expect(fuente).toContain('if (r.cred.modo !== "propio")');
    expect(readFileSync("supabase/config.toml", "utf8")).toMatch(/\[functions\.arca-fex\]\s*verify_jwt = true/);
  });
});
