import { describe, expect, it } from "vitest";
import { deducirAlicuota, entradaParaPlanilla, fechaIso, leerMisComprobantes, monto, tipoDeComprobante } from "@/lib/misComprobantes";

const ENCABEZADO_TOTAL = ["Fecha de Emisión", "Tipo de Comprobante", "Punto de Venta", "Número Desde", "Número Hasta", "Cód. Autorización",
  "Tipo Doc. Emisor", "Nro. Doc. Emisor", "Denominación Emisor", "Tipo Cambio", "Moneda", "Imp. Neto Gravado", "Imp. Neto No Gravado",
  "Imp. Op. Exentas", "Otros Tributos", "IVA", "Imp. Total"];

describe("lectura de «Mis Comprobantes – Recibidos»", () => {
  it("formato con IVA total: deduce la alícuota única y arma el comprobante", () => {
    const r = leerMisComprobantes([
      ["Mis Comprobantes Recibidos - CUIT 23228915599"],
      ENCABEZADO_TOTAL,
      ["2026-09-05", "1 - Factura A", "4", "3321", "3321", "7612345678901", "80", "30712345671", "ZZ Distribuidora SA", "1,00", "PES", "10000,00", "0,00", "0,00", "250,00", "2100,00", "12350,00"],
    ], "2026-09");
    expect(r.error).toBeNull();
    expect(r.filas).toHaveLength(1);
    expect(r.filas[0].problemas).toEqual([]);
    expect(r.filas[0].comprobante).toMatchObject({
      fecha: "2026-09-05", tipo_comprobante: 1, punto_venta: 4, numero: 3321, cuit_emisor: "30712345671",
      razon_social_emisor: "ZZ Distribuidora SA", alicuotas: [{ tasa: 21, neto: 10000, iva: 2100 }], otros_tributos: 250, total: 12350,
    });
  });

  it("formato por alícuota: usa cada columna", () => {
    const r = leerMisComprobantes([
      ["Fecha", "Tipo", "Punto de Venta", "Número Desde", "Nro. Doc. Emisor", "Denominación Emisor", "Neto Gravado IVA 21%", "IVA 21%",
        "Neto Gravado IVA 10,5%", "IVA 10,5%", "Imp. Total"],
      ["05/09/2026", "Factura A", 2, 10, "30-71234567-1", "ZZ", 1000, 210, 2000, 210, 3420],
    ], "2026-09");
    expect(r.filas[0].comprobante?.alicuotas).toEqual([{ tasa: 21, neto: 1000, iva: 210 }, { tasa: 10.5, neto: 2000, iva: 210 }]);
  });

  it("factura B o C: sin alícuotas, sólo el total", () => {
    const r = leerMisComprobantes([ENCABEZADO_TOTAL,
      ["2026-09-07", "11 - Factura C", "1", "55", "55", "1", "80", "20123456786", "ZZ Monotributista", "1", "PES", "1500,00", "0", "0", "0", "0", "1500,00"],
    ], "2026-09");
    expect(r.filas[0].comprobante).toMatchObject({ tipo_comprobante: 11, alicuotas: [], total: 1500 });
  });

  it("lo que no se puede interpretar vuelve con el motivo, no se inventa", () => {
    const r = leerMisComprobantes([ENCABEZADO_TOTAL,
      ["2026-09-05", "1", "4", "1", "1", "1", "80", "30712345671", "ZZ", "1", "PES", "3000,00", "0", "0", "0", "420,00", "3420,00"], // 21 % y 10,5 % mezclados
      ["2026-09-05", "1", "4", "2", "2", "1", "96", "30123456", "ZZ persona", "1", "PES", "100", "0", "0", "0", "21", "121"],     // DNI
      ["2026-10-02", "1", "4", "3", "3", "1", "80", "30712345671", "ZZ", "1", "PES", "100", "0", "0", "0", "21", "121"],          // mes posterior
      ["2026-09-05", "1", "4", "4", "4", "1", "80", "30712345671", "ZZ", "1", "PES", "100", "0", "0", "0", "21", "130"],          // total no suma
    ], "2026-09");
    expect(r.filas.map(f => f.comprobante)).toEqual([null, null, null, null]);
    expect(r.filas[0].problemas[0]).toMatch(/alícuota/);
    expect(r.filas[1].problemas[0]).toMatch(/CUIT/);
    expect(r.filas[2].problemas[0]).toMatch(/posterior al período/);
    expect(r.filas[3].problemas[0]).toMatch(/no coincide con la suma/);
  });

  it("moneda extranjera: convierte con el tipo de cambio", () => {
    const r = leerMisComprobantes([ENCABEZADO_TOTAL,
      ["2026-09-05", "1", "4", "9", "9", "1", "80", "30712345671", "ZZ", "1000,00", "DOL", "10,00", "0", "0", "0", "2,10", "12,10"],
    ], "2026-09");
    expect(r.filas[0].comprobante).toMatchObject({ alicuotas: [{ tasa: 21, neto: 10000, iva: 2100 }], total: 12100 });
  });

  it("rechaza el archivo de emitidos y uno sin las columnas", () => {
    expect(leerMisComprobantes([["Fecha", "Tipo", "Nro. Doc. Receptor", "Denominación Receptor", "Imp. Total"]], "2026-09").error).toMatch(/emitidos/);
    expect(leerMisComprobantes([["Producto", "Precio"]], "2026-09").error).toMatch(/No encontramos las columnas/);
  });

  it("formatos auxiliares", () => {
    expect(monto("4687,20")).toBe(4687.2);
    expect(monto("1.234,56")).toBe(1234.56);
    expect(monto(12.5)).toBe(12.5);
    expect(fechaIso("05/09/2026")).toBe("2026-09-05");
    expect(fechaIso(46270)).toBe("2026-09-05");
    expect(tipoDeComprobante("Nota de Crédito B")).toBe(8);
    expect(tipoDeComprobante("Factura de Crédito Electrónica MiPyMEs (FCE) A")).toBe(201);
    expect(deducirAlicuota(1000, 105)).toBe(10.5);
    expect(deducirAlicuota(0, 0)).toBeNull();
  });
});

import * as XLSX from "xlsx";

describe("archivo real pasado por SheetJS, como en la pantalla", () => {
  const leerComoPantalla = (contenido: string | Uint8Array) => {
    const entrada = entradaParaPlanilla(typeof contenido === "string" ? new TextEncoder().encode(contenido) : contenido);
    const libro = XLSX.read(entrada.datos, { type: entrada.tipo, raw: true, cellDates: true });
    return XLSX.utils.sheet_to_json<unknown[]>(libro.Sheets[libro.SheetNames[0]], { header: 1, raw: true, defval: "" });
  };

  it("CSV con punto y coma y coma decimal: los montos no se reinterpretan", () => {
    const csv = [
      "Fecha de Emisión;Tipo de Comprobante;Punto de Venta;Número Desde;Número Hasta;Cód. Autorización;Tipo Doc. Emisor;Nro. Doc. Emisor;Denominación Emisor;Tipo Cambio;Moneda;Imp. Neto Gravado;Imp. Neto No Gravado;Imp. Op. Exentas;Otros Tributos;IVA;Imp. Total",
      "2026-09-05;1 - Factura A;00004;00003321;00003321;76123456789012;80;30712345671;ZZ DISTRIBUIDORA SA;1,000000;PES;4687,20;0,00;0,00;0,00;984,31;5671,51",
    ].join("\n");
    const r = leerMisComprobantes(leerComoPantalla(csv), "2026-09");
    expect(r.error).toBeNull();
    expect(r.filas[0].problemas).toEqual([]);
    expect(r.filas[0].comprobante).toMatchObject({ punto_venta: 4, numero: 3321, alicuotas: [{ tasa: 21, neto: 4687.2, iva: 984.31 }], total: 5671.51 });
  });

  it("CSV en Windows-1252 (como lo baja ARCA en algunos equipos): tildes bien leídas", () => {
    const texto = "Fecha de Emisión;Tipo de Comprobante;Punto de Venta;Número Desde;Nro. Doc. Emisor;Denominación Emisor;Imp. Neto Gravado;IVA;Imp. Total\n"
      + "05/09/2026;6 - Factura B;2;77;30712345671;FERRETERÍA ÑANDÚ;0;0;1210,00";
    const bytes = Uint8Array.from([...texto].map(c => c.charCodeAt(0)));
    const r = leerMisComprobantes(leerComoPantalla(bytes), "2026-09");
    expect(r.error).toBeNull();
    expect(r.filas[0].comprobante).toMatchObject({ tipo_comprobante: 6, razon_social_emisor: "FERRETERÍA ÑANDÚ", total: 1210 });
  });

  it("un Excel verdadero va como bytes", () => {
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet([["Fecha de Emisión", "Tipo de Comprobante", "Punto de Venta", "Número Desde", "Nro. Doc. Emisor", "Denominación Emisor", "Imp. Total"],
      [new Date(2026, 8, 5), "11 - Factura C", 1, 9, "20123456786", "ZZ", 500]]), "Hoja1");
    const bytes = new Uint8Array(XLSX.write(libro, { type: "array", bookType: "xlsx" }));
    expect(entradaParaPlanilla(bytes).tipo).toBe("array");
    const r = leerMisComprobantes(leerComoPantalla(bytes), "2026-09");
    expect(r.filas[0].comprobante).toMatchObject({ fecha: "2026-09-05", tipo_comprobante: 11, total: 500 });
  });
});
