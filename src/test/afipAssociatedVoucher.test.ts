import { describe, expect, it } from "vitest";
import { associatedVoucherXml } from "../../supabase/functions/_shared/afipAssociatedVoucher";

describe("comprobante asociado para notas de credito ARCA", () => {
  it.each([
    [3, 1],
    [8, 6],
    [13, 11],
  ])("asocia NC tipo %i con factura tipo %i", (creditType, sourceType) => {
    expect(associatedVoucherXml(creditType, {
      tipo_comprobante: sourceType,
      punto_venta: 12,
      numero_afip: 345,
    })).toBe(
      `<ar:CbtesAsoc><ar:CbteAsoc><ar:Tipo>${sourceType}</ar:Tipo>` +
      `<ar:PtoVta>12</ar:PtoVta><ar:Nro>345</ar:Nro></ar:CbteAsoc></ar:CbtesAsoc>`,
    );
  });

  it("rechaza originales de otra clase o sin numeracion fiscal", () => {
    expect(() => associatedVoucherXml(8, {
      tipo_comprobante: 1,
      punto_venta: 12,
      numero_afip: 345,
    })).toThrow("factura original autorizada");
    expect(() => associatedVoucherXml(8, {
      tipo_comprobante: 6,
      punto_venta: 12,
      numero_afip: null,
    })).toThrow("factura original autorizada");
  });

  it("no asocia documentos a facturas ordinarias", () => {
    expect(associatedVoucherXml(1, null)).toBe("");
  });
});
