import { readFileSync } from "node:fs";
import { documentoDelReceptor } from "../../supabase/functions/_shared/wsfeComprobante";
import { describe, expect, it } from "vitest";
import { documentoDelComprador, importe, libroIvaVentas, periodoAPresentar, rangoDelPeriodo, texto, type ComprobanteVenta } from "@/lib/libroIvaVentas";

const base: ComprobanteVenta = {
  id: "zz-1", issue_date: "2026-09-03", tipo_comprobante: 1, punto_venta: 3, numero_afip: 125,
  customer_tax_id: "20-12345678-6", customer_name: "Ferretería Núñez S.R.L.",
  subtotal: 1000, tax_amount: 210, tax_pct: 21, total: 1210,
};
const renglones = (txt: string) => txt.split("\r\n").filter(Boolean);

describe("Libro IVA Digital — ventas", () => {
  it("arma el renglón de comprobante con el diseño de 266 posiciones", () => {
    const libro = libroIvaVentas([base]);
    const [r] = renglones(libro.cbte);
    expect(r).toHaveLength(266);
    expect(r.slice(0, 8)).toBe("20260903");
    expect(r.slice(8, 11)).toBe("001");
    expect(r.slice(11, 16)).toBe("00003");
    expect(r.slice(16, 36)).toBe("00000000000000000125");
    expect(r.slice(36, 56)).toBe("00000000000000000125");
    expect(r.slice(56, 58)).toBe("80");
    expect(r.slice(58, 78)).toBe("00000000020123456786");
    expect(r.slice(78, 108)).toBe("Ferreteria Nunez S.R.L.       ");
    expect(r.slice(108, 123)).toBe("000000000121000");
    expect(r.slice(228, 231)).toBe("PES");
    expect(r.slice(231, 241)).toBe("0001000000");
    expect(r.slice(241, 242)).toBe("1");
    expect(r.slice(242, 243)).toBe(" ");
    expect(r.slice(258, 266)).toBe("00000000");
  });

  it("arma un renglón de 62 posiciones por alícuota, con el desglose que se mandó a WSFE", () => {
    const mixto = { ...base, subtotal: 2000, tax_amount: 315, total: 2315, invoice_items: [
      { total: 1000, tax_rate: 21, tax_amount: 210 },
      { total: 1000, tax_rate: 10.5, tax_amount: 105 },
    ] };
    const libro = libroIvaVentas([mixto]);
    const filas = renglones(libro.alicuotas);
    expect(filas.map(f => f.length)).toEqual([62, 62]);
    expect(filas[0]).toBe("00100003" + "00000000000000000125" + "000000000100000" + "0004" + "000000000010500");
    expect(filas[1].slice(43, 47)).toBe("0005");
    expect(renglones(libro.cbte)[0].slice(241, 242)).toBe("2");
    expect(libro.resumen.porAlicuota).toEqual([{ tasa: 10.5, neto: 1000, iva: 105 }, { tasa: 21, neto: 1000, iva: 210 }]);
  });

  it("las notas de crédito restan en el resumen pero van con importes positivos en el archivo", () => {
    const nc = { ...base, id: "zz-2", tipo_comprobante: 3, numero_afip: 7, subtotal: 100, tax_amount: 21, total: 121 };
    const libro = libroIvaVentas([base, nc]);
    expect(libro.resumen).toMatchObject({ total: 1089, debitoFiscal: 189, notasDeCredito: 1 });
    expect(renglones(libro.cbte)[1].slice(108, 123)).toBe("000000000012100");
  });

  it("consumidor final sin datos: documento 99 y nombre genérico", () => {
    const cf = { ...base, tipo_comprobante: 6, customer_tax_id: "", customer_name: "" };
    const r = renglones(libroIvaVentas([cf]).cbte)[0];
    expect(r.slice(56, 78)).toBe("99" + "0".repeat(20));
    expect(r.slice(78, 108).trim()).toBe("CONSUMIDOR FINAL");
    expect(documentoDelComprador("30.123.456")).toEqual({ tipo: 99, numero: "0" });
    expect(documentoDelComprador("30123456")).toEqual({ tipo: 96, numero: "30123456" });
  });

  it("operación sólo al 0 %: código E", () => {
    const exenta = { ...base, tax_amount: 0, tax_pct: 0, total: 1000 };
    expect(renglones(libroIvaVentas([exenta]).cbte)[0].slice(242, 243)).toBe("E");
  });

  it("factura C: sin alícuotas", () => {
    const c = { ...base, tipo_comprobante: 11, tax_amount: 0, tax_pct: 0, subtotal: 1210, total: 1210 };
    const libro = libroIvaVentas([c]);
    expect(libro.alicuotas).toBe("");
    expect(renglones(libro.cbte)[0].slice(241, 242)).toBe("0");
    expect(libro.resumen.debitoFiscal).toBe(0);
  });

  it("un comprobante que no se puede desglosar no se omite en silencio", () => {
    const roto = { ...base, id: "zz-3", total: 1300 };
    const sinNumero = { ...base, id: "zz-4", numero_afip: null };
    const libro = libroIvaVentas([base, roto, sinNumero]);
    expect(libro.incluidos).toBe(1);
    expect(libro.problemas.map(p => p.id).sort()).toEqual(["zz-3", "zz-4"]);
    expect(libro.problemas.find(p => p.id === "zz-3")).toMatchObject({ comprobante: "00003-00000125", motivo: expect.stringMatching(/neto y el IVA/) });
  });

  it("ordena por fecha, tipo, punto de venta y número", () => {
    const libro = libroIvaVentas([{ ...base, id: "b", numero_afip: 200 }, { ...base, id: "a", issue_date: "2026-09-01" }]);
    expect(renglones(libro.cbte).map(r => r.slice(0, 8))).toEqual(["20260901", "20260903"]);
  });

  it("formatos auxiliares", () => {
    expect(importe(0.1 + 0.2)).toBe("000000000000030");
    expect(texto("Peña—x\n", 6)).toBe("Pena x");
    expect(texto("ab", 4)).toBe("ab  ");
    expect(rangoDelPeriodo("2026-02")).toEqual({ desde: "2026-02-01", hasta: "2026-02-28" });
    expect(rangoDelPeriodo("2028-02").hasta).toBe("2028-02-29");
    expect(periodoAPresentar("2026-10")).toBe("2026-09");
    expect(periodoAPresentar("2027-01")).toBe("2026-12");
  });

  // Si afip-authorize cambia cómo informa al comprador, el libro tiene que cambiar con él.
  it("usa la misma regla de documento que la emisión (wsfeComprobante)", () => {
    for (const taxId of ["20-12345678-6", "30123456", "1234567", "", null, "123"]) {
      const emision = documentoDelReceptor(taxId);
      const libro = documentoDelComprador(taxId);
      expect([libro.tipo, Number(libro.numero)]).toEqual([emision.docTipo, emision.docNro]);
    }
    expect(readFileSync("supabase/functions/afip-authorize/index.ts", "utf8")).toContain("detalleWsfe(");
  });

  it("exento, no gravado, percepciones, servicios y dólares van en su columna", () => {
    const libro = libroIvaVentas([{
      id: "x", issue_date: "2026-09-15", tipo_comprobante: 1, punto_venta: 3, numero_afip: 200,
      customer_tax_id: "30712345671", customer_name: "ZZ SA",
      subtotal: 1000, tax_pct: 21, tax_amount: 210, importe_exento: 300, importe_no_gravado: 50,
      importe_tributos: 35, total: 1595, currency: "USD", moneda_cotizacion: 1050.5, concepto: 2, due_date: "2026-10-10",
      tributos: [{ tipo: 7, base: 1000, alicuota: 3, importe: 30 }, { tipo: 6, base: 1000, alicuota: 0.5, importe: 5 }],
      invoice_items: [
        { total: 1000, tax_rate: 21, tax_amount: 210 },
        { total: 300, tax_rate: 0, tax_amount: 0, tratamiento: "exento" },
        { total: 50, tax_rate: 0, tax_amount: 0, tratamiento: "no_gravado" },
      ],
    }]);
    expect(libro.problemas).toEqual([]);
    const linea = libro.cbte.replace(/\r\n$/, "");
    expect(linea).toHaveLength(266);
    const campo = (desde: number, largo: number) => linea.slice(desde - 1, desde - 1 + largo);
    expect(campo(109, 15)).toBe("000000000159500"); // total
    expect(campo(124, 15)).toBe("000000000005000"); // no gravado
    expect(campo(139, 15)).toBe("000000000000000"); // percepción a no categorizados
    expect(campo(154, 15)).toBe("000000000030000"); // exento
    expect(campo(169, 15)).toBe("000000000000500"); // percepción nacional (IVA)
    expect(campo(184, 15)).toBe("000000000003000"); // percepción IIBB
    expect(campo(229, 3)).toBe("DOL");
    expect(campo(232, 10)).toBe("1050500000");
    expect(campo(243, 1)).toBe(" ");
    expect(campo(259, 8)).toBe("20261010");
    expect(libro.alicuotas.trim()).toHaveLength(62);
    expect(libro.resumen.debitoFiscal).toBe(220605);
  });

  it("en moneda extranjera sin cotización no entra, y dice por qué", () => {
    const libro = libroIvaVentas([{ id: "y", issue_date: "2026-09-15", tipo_comprobante: 6, punto_venta: 3, numero_afip: 9,
      subtotal: 100, tax_pct: 21, tax_amount: 21, total: 121, currency: "EUR" }]);
    expect(libro.incluidos).toBe(0);
    expect(libro.problemas[0].motivo).toMatch(/cotización/);
  });
});
