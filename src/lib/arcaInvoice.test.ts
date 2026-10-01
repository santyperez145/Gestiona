import { describe, expect, it } from "vitest";
import {
  ARCA_QR_BASE_URL,
  arcaQrPayload,
  arcaQrUrl,
  condicionIvaLabel,
  fechaFiscalArgentina,
  numeroFiscal,
  printableArcaQrUrl,
} from "./arcaInvoice";

const invoice = {
  issue_date: "2026-09-03",
  total: 12100,
  currency: "ARS",
  customer_tax_id: "20-00000000-1",
  tipo_comprobante: 1,
  numero_afip: 94,
  cae: "70417054367476",
  emisor_cuit: "30000000007",
  punto_venta: 10,
  receptor_tipo_documento: 80,
  moneda_cotizacion: 1,
  codigo_autorizacion_tipo: "E",
};

const printable = {
  ...invoice,
  cae_vencimiento: "2026-09-13",
  emisor_razon_social: "Comercio de prueba SA",
  emisor_domicilio: "Calle 123, Buenos Aires",
  afip_environment: "produccion",
};

describe("comprobante electrónico ARCA", () => {
  it("arma el QR v1 oficial con la identidad congelada", () => {
    expect(arcaQrPayload(invoice)).toEqual({
      ver: 1,
      fecha: "2026-09-03",
      cuit: 30000000007,
      ptoVta: 10,
      tipoCmp: 1,
      nroCmp: 94,
      importe: 12100,
      moneda: "PES",
      ctz: 1,
      tipoDocRec: 80,
      nroDocRec: 20000000001,
      tipoCodAut: "E",
      codAut: 70417054367476,
    });

    const url = arcaQrUrl(invoice);
    expect(url?.startsWith(`${ARCA_QR_BASE_URL}?p=`)).toBe(true);
    const encoded = url!.split("?p=")[1];
    expect(JSON.parse(atob(encoded))).toEqual(arcaQrPayload(invoice));
  });

  it("prefiere el payload inmutable del servidor a valores vivos distintos", () => {
    const stored = arcaQrPayload(invoice)!;
    expect(arcaQrPayload({
      ...invoice,
      emisor_cuit: "20111111112",
      punto_venta: 999,
      arca_qr_payload: stored,
    })).toEqual(stored);
  });

  it("no fabrica un QR si falta un dato obligatorio", () => {
    expect(arcaQrUrl({ ...invoice, cae: null })).toBeNull();
    expect(arcaQrUrl({ ...invoice, emisor_cuit: null })).toBeNull();
    expect(arcaQrUrl({ ...invoice, numero_afip: null })).toBeNull();
  });

  it("no presenta como fiscal un PDF con CAE pero sin snapshot o QR completo", () => {
    expect(printableArcaQrUrl({ ...printable, cae: null })).toBeNull();
    expect(() => printableArcaQrUrl({ ...printable, emisor_razon_social: null })).toThrow("Faltan datos fiscales");
    expect(() => printableArcaQrUrl({ ...printable, emisor_domicilio: null })).toThrow("Faltan datos fiscales");
    expect(() => printableArcaQrUrl({ ...printable, cae_vencimiento: null })).toThrow("Faltan datos fiscales");
    expect(() => printableArcaQrUrl({ ...printable, numero_afip: null })).toThrow("Faltan datos fiscales");
    expect(printableArcaQrUrl(printable)).toBe(arcaQrUrl(printable));
    expect(printableArcaQrUrl({ ...printable, afip_environment: "homologacion", emisor_domicilio: null }))
      .toBe(arcaQrUrl(printable));
  });

  it("rechaza un QR guardado que no coincide con los importes o el número visibles", () => {
    const stored = arcaQrPayload(printable);
    expect(() => printableArcaQrUrl({ ...printable, total: 999, arca_qr_payload: stored })).toThrow("no coinciden");
    expect(() => printableArcaQrUrl({ ...printable, numero_afip: 95, arca_qr_payload: stored })).toThrow("no coinciden");
    expect(() => printableArcaQrUrl({ ...printable, punto_venta: 11, arca_qr_payload: stored })).toThrow("no coinciden");
  });

  it("formatea el número fiscal a cinco más ocho dígitos", () => {
    expect(numeroFiscal(10, 94)).toBe("00010-00000094");
    expect(numeroFiscal(null, 94)).toBeNull();
  });

  it("rotula las condiciones de emisor y receptor sin inventar", () => {
    expect(condicionIvaLabel("monotributo")).toBe("Responsable Monotributo");
    expect(condicionIvaLabel(1)).toBe("IVA Responsable Inscripto");
    expect(condicionIvaLabel(null)).toContain("no informada");
  });

  it("una fecha SQL no retrocede por timezone", () => {
    expect(fechaFiscalArgentina("2026-08-27")).toBe("27/08/2026");
    expect(fechaFiscalArgentina("2026-08-27T03:00:00.000Z")).toBe("27/08/2026");
  });
});
