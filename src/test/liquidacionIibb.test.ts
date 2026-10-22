import { describe, expect, it } from "vitest";
import { baseIibb, claveJurisdiccion, hojaIibb, liquidacionIibb, type InscripcionIibb } from "@/lib/liquidacionIibb";
import type { ComprobanteVenta } from "@/lib/libroIvaVentas";
import type { RetencionSufrida } from "@/lib/subdiarioIva";

const venta = (p: Partial<ComprobanteVenta> & Pick<ComprobanteVenta, "subtotal" | "tax_amount" | "total">): ComprobanteVenta => ({
  id: `zz-${Math.random()}`, issue_date: "2026-10-10", tipo_comprobante: 6, punto_venta: 3, numero_afip: 1, tax_pct: 21, ...p,
});
const inscripcion = (p: Partial<InscripcionIibb> & Pick<InscripcionIibb, "province">): InscripcionIibb => ({
  id: `zz-${p.province}`, regime: "convenio", rate_pct: 3, coeficiente: null, active: true, ...p,
});
const retencion = (jurisdiccion: string | null, importe: number): RetencionSufrida => ({
  id: `zz-${Math.random()}`, fecha: "2026-10-15", impuesto: "iibb", agente_cuit: "30712345671", agente_nombre: "ZZ Agente",
  numero_certificado: "1", jurisdiccion, importe,
});

describe("IIBB: base imponible de cada comprobante", () => {
  it("sin IVA ni otros tributos, y la nota de crédito resta", () => {
    expect(baseIibb(venta({ subtotal: 1000, tax_amount: 210, total: 1210 }))).toBe(1000);
    expect(baseIibb(venta({ tipo_comprobante: 8, subtotal: 1000, tax_amount: 210, total: 1210 }))).toBe(-1000);
    expect(baseIibb(venta({ tipo_comprobante: 11, subtotal: 500, tax_amount: 0, tax_pct: 0, total: 500 }))).toBe(500);
    expect(baseIibb(venta({
      subtotal: 1000, tax_amount: 210, total: 1245, importe_tributos: 35,
      tributos: [{ tipo: 2, descripcion: "Percepción IIBB", base: 1000, alicuota: 3.5, importe: 35 }],
    }))).toBe(1000);
  });
  it("suma lo exento y no gravado, y pasa la moneda extranjera a pesos", () => {
    expect(baseIibb(venta({ subtotal: 1000, tax_amount: 210, importe_exento: 300, importe_no_gravado: 200, total: 1710 }))).toBe(1500);
    expect(baseIibb(venta({ subtotal: 10, tax_amount: 2.1, total: 12.1, currency: "USD", moneda_cotizacion: 1000 }))).toBe(10000);
    expect(() => baseIibb(venta({ subtotal: 10, tax_amount: 2.1, total: 12.1, currency: "USD" }))).toThrow(/cotización/);
  });
});

describe("IIBB: liquidación del mes", () => {
  const ventas = [venta({ subtotal: 10000, tax_amount: 2100, total: 12100 })];

  it("reparte con el coeficiente del Convenio y resta las retenciones de cada jurisdicción", () => {
    const l = liquidacionIibb({
      comprobantes: ventas,
      inscripciones: [inscripcion({ province: "CABA", coeficiente: 0.6 }), inscripcion({ province: "Buenos Aires", rate_pct: 3.5, coeficiente: 0.4 })],
      retenciones: [retencion("Ciudad Autónoma de Buenos Aires", 50)],
      percepcionesDeCompras: 12.5,
    });
    expect(l.baseTotal).toBe(10000);
    expect(l.renglones).toEqual([
      { jurisdiccion: "CABA", regimen: "convenio", coeficiente: 0.6, base: 6000, alicuota: 3, impuesto: 180, retenciones: 50, saldo: 130 },
      { jurisdiccion: "Buenos Aires", regimen: "convenio", coeficiente: 0.4, base: 4000, alicuota: 3.5, impuesto: 140, retenciones: 0, saldo: 140 },
    ]);
    expect(l.avisos).toEqual([]);
    expect(l.percepcionesDeCompras).toBe(12.5);
  });

  it("el contribuyente local lleva toda la base a su jurisdicción", () => {
    const l = liquidacionIibb({ comprobantes: ventas, inscripciones: [inscripcion({ province: "Córdoba", regime: "local", rate_pct: 4.75 })], retenciones: [], percepcionesDeCompras: 0 });
    expect(l.renglones[0]).toMatchObject({ base: 10000, coeficiente: 1, impuesto: 475, saldo: 475 });
  });

  it("avisa lo que no cierra en vez de calcular a ciegas", () => {
    const l = liquidacionIibb({
      comprobantes: [...ventas, venta({ subtotal: 100, tax_amount: 21, total: 999 })],
      inscripciones: [inscripcion({ province: "CABA", coeficiente: 0.5 }), inscripcion({ province: "Mendoza", coeficiente: 0.4 })],
      retenciones: [retencion("Salta", 20)],
      percepcionesDeCompras: 0,
    });
    expect(l.problemas).toHaveLength(1);
    expect(l.baseTotal).toBe(10000);
    expect(l.retencionesSinJurisdiccion).toBe(20);
    expect(l.avisos.join(" ")).toMatch(/suman 0\.9000/);
    expect(l.avisos.join(" ")).toMatch(/sin una jurisdicción inscripta/);
    expect(liquidacionIibb({ comprobantes: ventas, inscripciones: [], retenciones: [], percepcionesDeCompras: 0 }).avisos[0]).toMatch(/Impuestos → IIBB/);
    expect(liquidacionIibb({
      comprobantes: ventas, retenciones: [], percepcionesDeCompras: 0,
      inscripciones: [inscripcion({ province: "CABA", regime: "local" }), inscripcion({ province: "Salta", regime: "local" })],
    }).avisos.join(" ")).toMatch(/más de una jurisdicción/);
  });

  it("reconoce la misma jurisdicción escrita distinto", () => {
    expect(claveJurisdiccion("Ciudad Autónoma de Buenos Aires")).toBe("caba");
    expect(claveJurisdiccion("AGIP")).toBe("caba");
    expect(claveJurisdiccion("Provincia de Buenos Aires")).toBe("buenos aires");
    expect(claveJurisdiccion("Córdoba")).toBe("cordoba");
    expect(claveJurisdiccion("Provincia de Córdoba")).toBe("cordoba");
  });

  it("la hoja de Excel lleva cada jurisdicción y la base del mes", () => {
    const l = liquidacionIibb({ comprobantes: ventas, inscripciones: [inscripcion({ province: "Córdoba", regime: "local", rate_pct: 4.75 })], retenciones: [], percepcionesDeCompras: 0 });
    const hoja = hojaIibb(l);
    expect(hoja[1]).toEqual(["Córdoba", "Local", 1, 10000, 4.75, 475, 0, 475]);
    expect(hoja.some(f => f[0] === "Base imponible total del mes" && f[3] === 10000)).toBe(true);
  });
});
