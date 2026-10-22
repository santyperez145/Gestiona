import { describe, expect, it } from "vitest";
import { hojaPosicion, hojaRetenciones, subdiarioCompras, subdiarioVentas, totalesDeRetenciones, type RetencionSufrida } from "@/lib/subdiarioIva";
import type { ComprobanteVenta } from "@/lib/libroIvaVentas";
import type { ComprobanteCompra } from "@/lib/libroIvaCompras";

const venta = (extra: Partial<ComprobanteVenta> = {}): ComprobanteVenta => ({
  id: "v1", issue_date: "2026-09-03", tipo_comprobante: 1, punto_venta: 3, numero_afip: 125,
  customer_tax_id: "30-71234567-1", customer_name: "ZZ Cliente", subtotal: 2000, tax_amount: 315, tax_pct: 21, total: 2315,
  invoice_items: [{ total: 1000, tax_rate: 21, tax_amount: 210 }, { total: 1000, tax_rate: 10.5, tax_amount: 105 }], ...extra,
});

const compra: ComprobanteCompra = {
  id: "c1", fecha: "2026-09-05", tipo_comprobante: 1, punto_venta: 4, numero: 3321, cuit_emisor: "30712345671",
  razon_social_emisor: "ZZ Proveedor", alicuotas: [{ tasa: 21, neto: 10000, iva: 2100 }], no_gravado: 0, exento: 0,
  percepcion_iva: 300, percepcion_nacionales: 0, percepcion_iibb: 250, percepcion_municipal: 0, impuestos_internos: 0, otros_tributos: 0, total: 12650,
};

describe("subdiario de IVA en Excel", () => {
  it("ventas: una columna de neto e IVA por alícuota, notas de crédito en negativo y totales", () => {
    const nc = venta({ id: "v2", issue_date: "2026-09-10", tipo_comprobante: 3, numero_afip: 9, subtotal: 100, tax_amount: 21, total: 121, invoice_items: [] });
    const { filas, revisar } = subdiarioVentas([venta(), nc]);
    const encabezado = filas[0] as string[];
    const col = (titulo: string) => encabezado.indexOf(titulo);
    expect(filas[1][col("Neto 21%")]).toBe(1000);
    expect(filas[1][col("IVA 10,5%")]).toBe(105);
    expect(filas[1][col("CUIT / DNI")]).toBe("30712345671");
    expect(filas[2][col("IVA 21%")]).toBe(-21);
    expect(filas[2][col("Total")]).toBe(-121);
    expect(filas[3][0]).toBe("Totales");
    expect(filas[3][col("Total")]).toBe(2194);
    expect(revisar).toEqual([]);
  });

  it("ventas: lo que no se desglosa va a revisar", () => {
    const { revisar } = subdiarioVentas([venta({ total: 9999 })]);
    expect(revisar).toHaveLength(1);
    expect(revisar[0][1]).toBe("00003-00000125");
  });

  it("compras: alícuotas, percepciones y total", () => {
    const filas = subdiarioCompras([compra]);
    const encabezado = filas[0] as string[];
    const fila = filas[1];
    expect(fila[encabezado.indexOf("Neto 21%")]).toBe(10000);
    expect(fila[encabezado.indexOf("Percepción IVA")]).toBe(300);
    expect(fila[encabezado.indexOf("Percepción IIBB")]).toBe(250);
    expect(fila[encabezado.indexOf("Total")]).toBe(12650);
    expect(filas[2][0]).toBe("Totales");
  });

  it("posición: saldo a pagar o a favor", () => {
    expect(hojaPosicion({ debitoFiscal: 5000, creditoFiscal: 2100, percepcionesIva: 300, retencionesIva: 600, saldo: 2000 })[4]).toEqual(["Retenciones de IVA sufridas", -600]);
    expect(hojaPosicion({ debitoFiscal: 5000, creditoFiscal: 2100, percepcionesIva: 300, saldo: 2600 })[5]).toEqual(["Saldo a pagar", 2600]);
    expect(hojaPosicion({ debitoFiscal: 0, creditoFiscal: 100, percepcionesIva: 0, saldo: -100 })[5]).toEqual(["Saldo técnico a favor", 100]);
  });

  it("retenciones: totales por impuesto y hoja con total", () => {
    const r = (id: string, impuesto: RetencionSufrida["impuesto"], importe: number): RetencionSufrida => ({
      id, fecha: "2026-09-10", impuesto, agente_cuit: "30712345671", agente_nombre: "ZZ Agente", numero_certificado: id, jurisdiccion: null, importe,
    });
    const lista = [r("1", "iva", 1500), r("2", "iva", 0.1), r("3", "iibb", 300)];
    expect(totalesDeRetenciones(lista)).toEqual({ iva: 1500.1, ganancias: 0, iibb: 300, suss: 0 });
    const hoja = hojaRetenciones(lista);
    expect(hoja[1][1]).toBe("IVA");
    expect(hoja[hoja.length - 1]).toEqual(["Totales", "", "", "", "", "", 1800.1]);
  });
});

describe("subdiario de ventas con la factura completa (20261022000600)", () => {
  const suma = (fila: (string | number)[]) => fila.slice(5, -1).reduce<number>((s, v) => s + (typeof v === "number" ? v : 0), 0);

  it("cada fila suma su total: gravado, IVA, exento, no gravado y percepciones, en pesos", () => {
    const { filas, revisar } = subdiarioVentas([{
      id: "a", issue_date: "2026-09-10", tipo_comprobante: 1, punto_venta: 3, numero_afip: 7, customer_name: "ZZ SA", customer_tax_id: "30712345671",
      subtotal: 1000, tax_pct: 21, tax_amount: 210, importe_exento: 300, importe_no_gravado: 50, importe_tributos: 35, total: 1595,
      currency: "USD", moneda_cotizacion: 1000,
      tributos: [{ tipo: 7, base: 1000, alicuota: 3, importe: 30 }, { tipo: 6, base: 1000, alicuota: 0.5, importe: 5 }],
      invoice_items: [
        { total: 1000, tax_rate: 21, tax_amount: 210 },
        { total: 300, tax_rate: 0, tax_amount: 0, tratamiento: "exento" },
        { total: 50, tax_rate: 0, tax_amount: 0, tratamiento: "no_gravado" },
      ],
    }]);
    expect(revisar).toEqual([]);
    const [encabezado, fila] = filas;
    const col = (nombre: string) => fila[encabezado.indexOf(nombre)];
    expect(col("Total")).toBe(1595000);
    expect(col("Exento")).toBe(300000);
    expect(col("No gravado")).toBe(50000);
    expect(col("Percepción IIBB")).toBe(30000);
    expect(col("Percepción IVA")).toBe(5000);
    expect(suma(fila)).toBe(1595000);
  });

  it("una factura C va entera en «sin IVA discriminado»", () => {
    const { filas } = subdiarioVentas([{ id: "c", issue_date: "2026-09-11", tipo_comprobante: 11, punto_venta: 3, numero_afip: 8,
      subtotal: 500, tax_pct: 0, tax_amount: 0, total: 500, invoice_items: [{ total: 500, tax_rate: 0, tax_amount: 0 }] }]);
    expect(filas[1][filas[0].indexOf("Sin IVA discriminado (C)")]).toBe(500);
    expect(suma(filas[1])).toBe(500);
  });
});
