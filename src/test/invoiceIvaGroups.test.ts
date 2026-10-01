import { describe, expect, it } from "vitest";
import { invoiceIvaGroups, invoiceIvaXml, invoiceDisplayLines } from "../../supabase/functions/_shared/invoiceIva";

const mixed = {
  tipo_comprobante: 6, subtotal: 200, tax_pct: 0, tax_amount: 31.5, total: 231.5,
  invoice_items: [
    { quantity: 1, unit_price: 100, total: 100, tax_rate: 21, tax_amount: 21 },
    { quantity: 2, unit_price: 50, total: 100, tax_rate: 10.5, tax_amount: 10.5 },
  ],
};

describe("IVA por alícuota y representación del comprobante", () => {
  it("envía un único AlicIva por tasa, nunca una alícuota promedio", () => {
    const groups = invoiceIvaGroups(mixed);
    expect(groups).toEqual([
      { rate: 10.5, id: 4, base: 100, amount: 10.5 },
      { rate: 21, id: 5, base: 100, amount: 21 },
    ]);
    const xml = new DOMParser().parseFromString(`<root xmlns:ar="urn:arca">${invoiceIvaXml(mixed)}</root>`, "text/xml");
    expect(xml.getElementsByTagName("parsererror")).toHaveLength(0);
    expect(xml.getElementsByTagName("ar:AlicIva")).toHaveLength(2);
    expect([...xml.getElementsByTagName("ar:Id")].map((element) => element.textContent)).toEqual(["4", "5"]);
    expect(groups.reduce((sum, group) => sum + group.base + group.amount, 0)).toBe(mixed.total);
  });

  it("agrupa renglones de una misma alícuota sin perder centavos", () => {
    const invoice = { ...mixed, subtotal: 0.06, tax_amount: 0.02, total: 0.08,
      invoice_items: [0, 1].map(() => ({ total: 0.03, tax_rate: 21, tax_amount: 0.01 })) };
    expect(invoiceIvaGroups(invoice)).toEqual([{ rate: 21, id: 5, base: 0.06, amount: 0.02 }]);
  });

  it("admite un documento anterior con su tasa guardada, sin consultar productos actuales", () => {
    expect(invoiceIvaGroups({ tipo_comprobante: 1, subtotal: 100, tax_amount: 21, tax_pct: 21, total: 121 }))
      .toEqual([{ rate: 21, id: 5, base: 100, amount: 21 }]);
  });

  it("rechaza una tasa promedio heredada, un desglose parcial y totales inconsistentes", () => {
    expect(() => invoiceIvaGroups({ ...mixed, invoice_items: [], tax_pct: 15.75 })).toThrow("no esta admitida");
    expect(() => invoiceIvaGroups({ ...mixed, invoice_items: [mixed.invoice_items[0], { total: 100 }] })).toThrow("incompleto");
    expect(() => invoiceIvaGroups({ ...mixed, total: 230 })).toThrow("total");
    expect(() => invoiceIvaGroups({ ...mixed, subtotal: 199, total: 230.5 })).toThrow("cabecera");
  });

  it("rechaza importes no finitos o IVA atribuido a tasa cero", () => {
    expect(() => invoiceIvaGroups({ ...mixed, tax_amount: NaN })).toThrow("inválidos");
    expect(() => invoiceIvaGroups({ ...mixed, tipo_comprobante: 8,
      invoice_items: mixed.invoice_items.map((line) => ({ ...line, tax_rate: 0 })) })).toThrow("alícuota");
  });

  it("C no lleva bloque Iva y no normaliza silenciosamente un comprobante mal calculado", () => {
    expect(invoiceIvaXml({ tipo_comprobante: 11, subtotal: 121, tax_amount: 0, tax_pct: 0, total: 121 })).toBe("");
    expect(() => invoiceIvaXml({ ...mixed, tipo_comprobante: 11 })).toThrow("C no discriminan");
  });

  it("preserva el IVA acreditado aunque la suma original haya redondeado por producto", () => {
    const note = { tipo_comprobante: 8, subtotal: 3, tax_pct: 21, tax_amount: 1, total: 4,
      invoice_items: [{ total: 3, tax_rate: 21, tax_amount: 1 }] };
    expect(invoiceIvaGroups(note)[0].amount).toBe(1);
  });

  it("B muestra precios finales y A muestra neto más IVA, también en notas de crédito", () => {
    const gross = invoiceDisplayLines(mixed);
    expect(gross.map((line) => line.total)).toEqual([121, 110.5]);
    expect(gross[1].unit_price).toBe(55.25);
    expect(gross.reduce((sum, line) => sum + line.total, 0)).toBe(231.5);
    expect(invoiceDisplayLines({ ...mixed, tipo_comprobante: 3 }).map((line) => line.total)).toEqual([100, 100]);
  });

  it("reparte IVA de facturas manuales anteriores con cierre exacto al centavo", () => {
    const invoice = { tipo_comprobante: 6, subtotal: 0.06, tax_pct: 21, tax_amount: 0.01, total: 0.07,
      invoice_items: [0, 1].map(() => ({ quantity: 1, unit_price: 0.03, total: 0.03 })) };
    expect(invoiceDisplayLines(invoice).map((line) => line.total)).toEqual([0.04, 0.03]);
  });

  it("no vuelve a sumar IVA a los renglones brutos del POS anterior", () => {
    const legacy = { ...mixed, invoice_items: [{ quantity: 1, unit_price: 231.5, total: 231.5 }] };
    expect(invoiceDisplayLines(legacy)[0].total).toBe(231.5);
  });

  it("bloquea una representación con precios o cantidades incompatibles", () => {
    expect(() => invoiceDisplayLines({ ...mixed, invoice_items: [{ quantity: 1, unit_price: 1, total: 1 }] })).toThrow("no coinciden");
    expect(() => invoiceDisplayLines({ ...mixed, invoice_items: [{ quantity: 0, unit_price: 231.5, total: 231.5 }] })).toThrow("cantidades");
  });
});
