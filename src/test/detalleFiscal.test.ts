import { describe, expect, it } from "vitest";
import { detalleFiscalInicial, detalleFiscalParaEnviar, erroresDelDetalleFiscal } from "@/lib/detalleFiscal";
import { CLASE_C, FACTURA_DE_LA_NOTA, NOMBRE_DE_COMPROBANTE, esNotaDeCredito, letraDeComprobante } from "../../supabase/functions/_shared/comprobantesArca";

describe("detalle fiscal de la factura manual", () => {
  it("servicios sin período y cotización inválida se avisan antes de enviar", () => {
    expect(erroresDelDetalleFiscal({ ...detalleFiscalInicial(2) })).toEqual(["Indicá el período del servicio (desde y hasta)."]);
    expect(erroresDelDetalleFiscal({ ...detalleFiscalInicial(), moneda: "USD", cotizacion: "abc" })).toEqual(["La cotización tiene que ser un número mayor a cero."]);
  });

  it("la FCE pide CUIT del cliente, vencimiento y un CBU válido", () => {
    const fce = { ...detalleFiscalInicial(), fce: true, fceCbu: "0110599520000001234567" };
    expect(erroresDelDetalleFiscal(fce, { vencimiento: "", cuitCliente: "" })).toEqual([
      "La factura de crédito MiPyME es para una empresa con CUIT.",
      "La factura de crédito MiPyME necesita el vencimiento del pago.",
      "Cargá un CBU válido del comercio (22 números) para la factura de crédito.",
    ]);
    expect(erroresDelDetalleFiscal({ ...fce, fceCbu: "0170099220000067797370" }, { vencimiento: "2026-11-21", cuitCliente: "30-71234567-1" })).toEqual([]);
  });

  it("sólo manda los datos de FCE si la factura es FCE", () => {
    expect(detalleFiscalParaEnviar(detalleFiscalInicial())).not.toHaveProperty("fce");
    expect(detalleFiscalParaEnviar({ ...detalleFiscalInicial(), fce: true, fceCbu: "0170 0992 2000 0067 7973 70", fceTransferencia: "ADC" }))
      .toMatchObject({ fce: true, fce_cbu: "0170099220000067797370", fce_transferencia: "ADC", fce_alias: null });
  });
});

describe("clases de comprobante", () => {
  it("la FCE conserva su clase y sus notas se asocian a ella", () => {
    expect(letraDeComprobante(201)).toBe("A");
    expect(letraDeComprobante(208)).toBe("B");
    expect(CLASE_C.has(213)).toBe(true);
    expect(esNotaDeCredito(203)).toBe(true);
    expect(FACTURA_DE_LA_NOTA[212]).toBe(211);
    expect(NOMBRE_DE_COMPROBANTE[206]).toBe("Factura de Crédito Electrónica MiPyME B");
  });
});
