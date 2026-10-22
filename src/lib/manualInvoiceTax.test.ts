import { describe, expect, it } from "vitest";
import {
  manualInvoiceTaxSummary,
  updateDefaultInvoiceTaxRate,
} from "./manualInvoiceTax";

describe("factura manual con IVA por renglón", () => {
  it("cierra una factura A/B con tasas mixtas sin promediar", () => {
    expect(manualInvoiceTaxSummary([
      { quantity: 1, unit_price: 100, tax_rate: 21 },
      { quantity: 2, unit_price: 50, tax_rate: 10.5 },
    ], { fiscalEnabled: true, classC: false, defaultRate: 21 })).toEqual({
      subtotal: 200,
      tax: 31.5,
      exento: 0,
      noGravado: 0,
      tributos: [],
      tributosTotal: 0,
      total: 231.5,
      lines: [
        { net: 100, taxRate: 21, tax: 21 },
        { net: 100, taxRate: 10.5, tax: 10.5 },
      ],
      groups: [
        { rate: 10.5, base: 100, amount: 10.5 },
        { rate: 21, base: 100, amount: 21 },
      ],
    });
  });

  it("lo exento y lo no gravado van aparte y las percepciones son base por alícuota", () => {
    const r = manualInvoiceTaxSummary([
      { quantity: 1, unit_price: 1000, tax_rate: 21 },
      { quantity: 1, unit_price: 300, tratamiento: "exento" },
      { quantity: 1, unit_price: 50, tratamiento: "no_gravado" },
    ], { fiscalEnabled: true, classC: false, defaultRate: 21 }, [
      { tipo: 7, descripcion: "Percepción IIBB", base: 1000, alicuota: 3 },
      { tipo: 4, base: 0, alicuota: 0, importe: 12.5 },
      { tipo: 6, base: 0, alicuota: 0 },
    ]);
    expect(r).toMatchObject({ subtotal: 1000, tax: 210, exento: 300, noGravado: 50, tributosTotal: 42.5, total: 1602.5 });
    expect(r.tributos.map(t => t.importe)).toEqual([30, 12.5]);
    expect(r.groups).toEqual([{ rate: 21, base: 1000, amount: 210 }]);
    expect(() => manualInvoiceTaxSummary([{ quantity: 1, unit_price: 10, tratamiento: "exento" }],
      { fiscalEnabled: true, classC: true, defaultRate: 0 })).toThrow("comprobante C");
  });

  it("fuerza tasa cero en C y no discrimina un borrador no fiscal", () => {
    const classC = manualInvoiceTaxSummary(
      [{ quantity: 1, unit_price: 121, tax_rate: 21 }],
      { fiscalEnabled: true, classC: true, defaultRate: 21 },
    );
    expect(classC).toMatchObject({ subtotal: 121, tax: 0, total: 121 });
    expect(classC.lines[0].taxRate).toBe(0);

    const draft = manualInvoiceTaxSummary(
      [{ quantity: 1, unit_price: 121, tax_rate: 21 }],
      { fiscalEnabled: false, classC: false, defaultRate: 21 },
    );
    expect(draft.groups).toEqual([]);
    expect(draft.lines[0].taxRate).toBeNull();
  });

  it("redondea por renglón igual que la base", () => {
    const result = manualInvoiceTaxSummary([
      { quantity: 1, unit_price: 0.03, tax_rate: 21 },
      { quantity: 1, unit_price: 0.03, tax_rate: 21 },
    ], { fiscalEnabled: true, classC: false, defaultRate: 21 });
    expect(result).toMatchObject({ subtotal: 0.06, tax: 0.02, total: 0.08 });
  });

  it("rechaza una tasa inventada", () => {
    expect(() => manualInvoiceTaxSummary(
      [{ quantity: 1, unit_price: 100, tax_rate: 19 }],
      { fiscalEnabled: true, classC: false, defaultRate: 21 },
    )).toThrow("no admitida");
  });

  it("actualiza solo los renglones que heredaban la tasa predeterminada", () => {
    expect(updateDefaultInvoiceTaxRate([
      { description: "Heredado", tax_rate: 21 },
      { description: "Personalizado", tax_rate: 10.5 },
      { description: "Sin tasa" },
    ], 21, 27)).toEqual([
      { description: "Heredado", tax_rate: 27 },
      { description: "Personalizado", tax_rate: 10.5 },
      { description: "Sin tasa", tax_rate: 27 },
    ]);
  });
});
