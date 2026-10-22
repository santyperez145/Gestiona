import { describe, expect, it } from "vitest";
import {
  detalleWsfe, documentoDelReceptor, importesWsfe, monedaWsfe, type ComprobanteParaWsfe,
} from "../../supabase/functions/_shared/wsfeComprobante";

const base = (cambios: Partial<ComprobanteParaWsfe> = {}): ComprobanteParaWsfe => ({
  issue_date: "2026-10-22", customer_tax_id: "30712345671", condicion_iva_receptor: 1,
  subtotal: 1000, tax_pct: 21, tax_amount: 210, total: 1210,
  invoice_items: [{ total: 1000, tax_rate: 21, tax_amount: 210 }],
  ...cambios,
});
const args = { puntoVenta: 3, tipoCbte: 1, numero: 125, asociado: null };
const etiqueta = (xml: string, tag: string) => new RegExp(`<ar:${tag}>([^<]*)</ar:${tag}>`).exec(xml)?.[1];

describe("detalle de FECAESolicitar", () => {
  it("una factura A de productos en pesos, en el orden del WSDL", () => {
    const xml = detalleWsfe(base(), args);
    const orden = [...xml.matchAll(/<ar:([A-Za-z]+)>/g)].map(m => m[1]);
    expect(orden.slice(0, 18)).toEqual([
      "FECAEDetRequest", "Concepto", "DocTipo", "DocNro", "CbteDesde", "CbteHasta", "CbteFch", "ImpTotal", "ImpTotConc",
      "ImpNeto", "ImpOpEx", "ImpTrib", "ImpIVA", "MonId", "MonCotiz", "CondicionIVAReceptorId", "Iva", "AlicIva",
    ]);
    expect(etiqueta(xml, "Concepto")).toBe("1");
    expect(etiqueta(xml, "DocTipo")).toBe("80");
    expect(etiqueta(xml, "ImpTotal")).toBe("1210.00");
    expect(etiqueta(xml, "MonId")).toBe("PES");
    expect(xml).not.toContain("FchServDesde");
    expect(xml).not.toContain("CanMisMonExt");
  });

  it("servicios: período del servicio y vencimiento del pago", () => {
    const xml = detalleWsfe(base({ concepto: 2, servicio_desde: "2026-10-01", servicio_hasta: "2026-10-31", due_date: "2026-11-10" }), args);
    expect(etiqueta(xml, "Concepto")).toBe("2");
    expect(etiqueta(xml, "FchServDesde")).toBe("20261001");
    expect(etiqueta(xml, "FchServHasta")).toBe("20261031");
    expect(etiqueta(xml, "FchVtoPago")).toBe("20261110");
  });

  it("servicios sin período o con vencimiento anterior a la fecha: no se manda", () => {
    expect(() => detalleWsfe(base({ concepto: 2 }), args)).toThrow("período del servicio");
    expect(() => detalleWsfe(base({ concepto: 3, servicio_desde: "2026-10-31", servicio_hasta: "2026-10-01" }), args)).toThrow("empieza después");
    expect(() => detalleWsfe(base({ concepto: 2, servicio_desde: "2026-10-01", servicio_hasta: "2026-10-31", due_date: "2026-10-01" }), args))
      .toThrow("vencimiento del pago no puede ser anterior");
  });

  it("sin vencimiento, el pago de un servicio vence el día de la factura", () => {
    const xml = detalleWsfe(base({ concepto: 2, servicio_desde: "2026-10-01", servicio_hasta: "2026-10-22" }), args);
    expect(etiqueta(xml, "FchVtoPago")).toBe("20261022");
  });

  it("exento y no gravado van aparte, no como IVA al 0 %", () => {
    const c = base({
      subtotal: 1000, tax_amount: 210, importe_exento: 300, importe_no_gravado: 50, total: 1560,
      invoice_items: [
        { total: 1000, tax_rate: 21, tax_amount: 210, tratamiento: "gravado" },
        { total: 300, tax_rate: 0, tax_amount: 0, tratamiento: "exento" },
        { total: 50, tax_rate: 0, tax_amount: 0, tratamiento: "no_gravado" },
      ],
    });
    const xml = detalleWsfe(c, args);
    expect(etiqueta(xml, "ImpOpEx")).toBe("300.00");
    expect(etiqueta(xml, "ImpTotConc")).toBe("50.00");
    expect(etiqueta(xml, "ImpNeto")).toBe("1000.00");
    expect(xml.match(/<ar:AlicIva>/g)).toHaveLength(1);
    expect(etiqueta(xml, "Id")).toBe("5");
  });

  it("percepciones en Tributos, que suman en el total", () => {
    const c = base({
      importe_tributos: 35, total: 1245,
      tributos: [
        { tipo: 7, descripcion: "Percepción IIBB Buenos Aires", base: 1000, alicuota: 3, importe: 30 },
        { tipo: 6, descripcion: "Percepción IVA", base: 1000, alicuota: 0.5, importe: 5 },
      ],
    });
    const xml = detalleWsfe(c, args);
    expect(etiqueta(xml, "ImpTrib")).toBe("35.00");
    expect(xml).toContain("<ar:Tributo><ar:Id>7</ar:Id><ar:Desc>Percepción IIBB Buenos Aires</ar:Desc><ar:BaseImp>1000.00</ar:BaseImp><ar:Alic>3.00</ar:Alic><ar:Importe>30.00</ar:Importe></ar:Tributo>");
    expect(xml.indexOf("<ar:Tributos>")).toBeLessThan(xml.indexOf("<ar:Iva>"));
  });

  it("un tributo mal calculado o de un tipo inexistente no sale", () => {
    expect(() => detalleWsfe(base({ importe_tributos: 31, total: 1241, tributos: [{ tipo: 7, base: 1000, alicuota: 3, importe: 31 }] }), args))
      .toThrow("no es la base por la alícuota");
    expect(() => detalleWsfe(base({ importe_tributos: 10, total: 1220, tributos: [{ tipo: 42, base: 0, alicuota: 0, importe: 10 }] }), args))
      .toThrow("no existe en ARCA");
    expect(() => detalleWsfe(base({ importe_tributos: 10, total: 1220, tributos: [] }), args)).toThrow("no suman");
  });

  it("el total tiene que cerrar con todas las partes", () => {
    expect(() => importesWsfe(base({ total: 1300 }), 1)).toThrow("no es la suma");
  });

  it("en dólares: moneda, cotización y si se cancela en la misma moneda", () => {
    const xml = detalleWsfe(base({ currency: "USD", moneda_cotizacion: 1045.5, cancela_misma_moneda: true }), args);
    expect(etiqueta(xml, "MonId")).toBe("DOL");
    expect(etiqueta(xml, "MonCotiz")).toBe("1045.5");
    expect(etiqueta(xml, "CanMisMonExt")).toBe("S");
    expect(detalleWsfe(base({ currency: "EUR" }), { ...args, cotizacionOficial: 1180.25 })).toContain("<ar:MonId>060</ar:MonId><ar:MonCotiz>1180.25</ar:MonCotiz><ar:CanMisMonExt>N</ar:CanMisMonExt>");
    expect(() => detalleWsfe(base({ currency: "USD" }), args)).toThrow("cotización");
  });

  it("un comprobante C no lleva IVA ni separa exento", () => {
    const c = base({ customer_tax_id: "", subtotal: 1000, tax_pct: 0, tax_amount: 0, total: 1000, invoice_items: [{ total: 1000, tax_rate: 0, tax_amount: 0 }] });
    const xml = detalleWsfe(c, { ...args, tipoCbte: 11 });
    expect(xml).not.toContain("<ar:Iva>");
    expect(etiqueta(xml, "DocTipo")).toBe("99");
    expect(() => detalleWsfe({ ...c, importe_exento: 100, total: 1100 }, { ...args, tipoCbte: 11 })).toThrow("comprobante C");
  });

  it("una factura A sin CUIT no sale", () => {
    expect(() => detalleWsfe(base({ customer_tax_id: "30123456" }), args)).toThrow("requiere el CUIT");
  });

  it("opcionales y factura de crédito MiPyME con vencimiento de pago", () => {
    const fce = base({ due_date: "2026-11-21" });
    const xml = detalleWsfe(fce, { ...args, tipoCbte: 201, opcionales: [{ id: "2101", valor: "0170099220000067797370" }, { id: "27", valor: "SCA" }] });
    expect(etiqueta(xml, "FchVtoPago")).toBe("20261121");
    expect(xml).toContain("<ar:Opcionales><ar:Opcional><ar:Id>2101</ar:Id><ar:Valor>0170099220000067797370</ar:Valor></ar:Opcional><ar:Opcional><ar:Id>27</ar:Id><ar:Valor>SCA</ar:Valor></ar:Opcional></ar:Opcionales>");
    expect(() => detalleWsfe(base(), { ...args, tipoCbte: 201 })).toThrow("vencimiento del pago");
  });
});

describe("piezas", () => {
  it("monedas y documentos", () => {
    expect(monedaWsfe("ARS")).toBe("PES");
    expect(monedaWsfe(null)).toBe("PES");
    expect(monedaWsfe("usd")).toBe("DOL");
    expect(() => monedaWsfe("BRL")).toThrow("no está admitida");
    expect(documentoDelReceptor("20-12345678-6")).toEqual({ docTipo: 80, docNro: 20123456786 });
    expect(documentoDelReceptor("30.123.456")).toEqual({ docTipo: 96, docNro: 30123456 });
    expect(documentoDelReceptor("")).toEqual({ docTipo: 99, docNro: 0 });
  });
});
