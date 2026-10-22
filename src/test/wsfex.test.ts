import { describe, expect, it } from "vitest";
import {
  cmpFex, erroresExportacion, leerAutorizacionFex, leerCotizacionFex, leerParametroFex, leerUltimoFex, soapFex,
  type ComprobanteExportacion, type DatosExportacion,
} from "../../supabase/functions/_shared/wsfex";

const sobre = (cuerpo: string) =>
  `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>${cuerpo}</soap:Body></soap:Envelope>`;
const NS = 'xmlns="http://ar.gov.afip.dif.fexv1/"';

const bienes: DatosExportacion = {
  tipo_expo: 1, pais_destino: 220, domicilio_cliente: "ZZ Avenida 1, Asunción", id_impositivo: "ZZ-99", idioma: 2,
  forma_pago: "Transferencia", incoterms: "FOB", permiso_existente: "N",
};
const factura: ComprobanteExportacion = {
  issue_date: "2026-10-22", customer_name: "ZZ Importadora SA", currency: "USD", moneda_cotizacion: 1015.5, cancela_misma_moneda: true,
  total: 1250, invoice_items: [{ description: "ZZ Vino Malbec", quantity: 100, unit_price: 12.5, total: 1250 }],
};

describe("Factura E: lo que ARCA rechazaría, dicho antes", () => {
  it("una factura de bienes completa no tiene errores", () => {
    expect(erroresExportacion(bienes, 19, "2026-10-22")).toEqual([]);
  });
  it("pide Incoterm, forma de pago y permiso en bienes; fecha de pago en servicios", () => {
    expect(erroresExportacion({ ...bienes, incoterms: null, forma_pago: "", permiso_existente: null }, 19)).toEqual([
      "La forma de pago es obligatoria en la factura de exportación.",
      "En una exportación de bienes el Incoterm es obligatorio.",
      "Indicá si ya tenés el permiso de embarque.",
    ]);
    const servicios = { ...bienes, tipo_expo: 2, incoterms: null, permiso_existente: null };
    expect(erroresExportacion(servicios, 19, "2026-10-22")).toEqual(["En servicios y otros la fecha de pago es obligatoria."]);
    expect(erroresExportacion({ ...servicios, fecha_pago: "2026-10-01" }, 19, "2026-10-22")).toEqual(["La fecha de pago no puede ser anterior a la fecha del comprobante."]);
    expect(erroresExportacion({ ...bienes, id_impositivo: "", cuit_pais: "" }, 19)).toContain("Cargá la identificación tributaria del cliente o la CUIT del país.");
  });
  it("valida el formato del permiso de embarque", () => {
    expect(erroresExportacion({ ...bienes, permiso_existente: "S", permisos: [{ id: "26001EC01000123A", destino: 220 }] }, 19)).toEqual([]);
    expect(erroresExportacion({ ...bienes, permiso_existente: "S", permisos: [{ id: "123", destino: 220 }] }, 19)[0]).toMatch(/formato de ARCA/);
    expect(erroresExportacion({ ...bienes, permiso_existente: "S", permisos: [] }, 19)[0]).toMatch(/Cargá el permiso/);
  });
});

describe("Factura E: el pedido FEXAuthorize", () => {
  it("arma el Cmp en el orden del WSDL, con cotización y cancelación en la misma moneda", () => {
    const xml = cmpFex(factura, bienes, { id: 17612345678901, tipoCbte: 19, puntoVenta: 5, numero: 8, asociado: null });
    const orden = ["Id", "Fecha_cbte", "Cbte_Tipo", "Punto_vta", "Cbte_nro", "Tipo_expo", "Permiso_existente", "Dst_cmp", "Cliente",
      "Domicilio_cliente", "Id_impositivo", "Moneda_Id", "Moneda_ctz", "CanMisMonExt", "Imp_total", "Forma_pago", "Incoterms", "Idioma_cbte", "Items"];
    const posiciones = orden.map(t => xml.indexOf(`<ar:${t}>`));
    expect(posiciones.every(p => p >= 0)).toBe(true);
    expect([...posiciones].sort((a, b) => a - b)).toEqual(posiciones);
    expect(xml).toContain("<ar:Fecha_cbte>20261022</ar:Fecha_cbte><ar:Cbte_Tipo>19</ar:Cbte_Tipo><ar:Punto_vta>5</ar:Punto_vta><ar:Cbte_nro>8</ar:Cbte_nro>");
    expect(xml).toContain("<ar:Moneda_Id>DOL</ar:Moneda_Id><ar:Moneda_ctz>1015.5</ar:Moneda_ctz><ar:CanMisMonExt>S</ar:CanMisMonExt>");
    expect(xml).toContain("<ar:Pro_qty>100</ar:Pro_qty><ar:Pro_umed>7</ar:Pro_umed><ar:Pro_precio_uni>12.5</ar:Pro_precio_uni><ar:Pro_bonificacion>0</ar:Pro_bonificacion><ar:Pro_total_item>1250.00</ar:Pro_total_item>");
    expect(xml).not.toContain("Cmps_asoc");
    expect(xml).not.toContain("Fecha_pago");
  });

  it("la nota de crédito asocia la factura con su CUIT y no lleva permiso ni forma de pago obligatoria", () => {
    const xml = cmpFex({ ...factura, total: 100, invoice_items: [{ description: "ZZ crédito", quantity: 1, unit_price: 100, total: 100 }] },
      { ...bienes, forma_pago: null }, { id: 2, tipoCbte: 21, puntoVenta: 5, numero: 1, asociado: { tipo: 19, puntoVenta: 5, numero: 8, cuit: "20-12345678-6" } });
    expect(xml).toContain("<ar:Permiso_existente></ar:Permiso_existente>");
    expect(xml).toContain("<ar:Cmps_asoc><ar:Cmp_asoc><ar:Cbte_tipo>19</ar:Cbte_tipo><ar:Cbte_punto_vta>5</ar:Cbte_punto_vta><ar:Cbte_nro>8</ar:Cbte_nro><ar:Cbte_cuit>20123456786</ar:Cbte_cuit></ar:Cmp_asoc></ar:Cmps_asoc>");
    expect(xml).not.toContain("CanMisMonExt");
    expect(() => cmpFex(factura, bienes, { id: 3, tipoCbte: 21, puntoVenta: 5, numero: 2, asociado: null })).toThrow(/factura que corrige/);
  });

  it("no manda un total que no es la suma de los ítems ni una moneda sin cotización", () => {
    expect(() => cmpFex({ ...factura, total: 1300 }, bienes, { id: 1, tipoCbte: 19, puntoVenta: 5, numero: 1, asociado: null })).toThrow(/suma de sus ítems/);
    expect(() => cmpFex({ ...factura, moneda_cotizacion: null }, bienes, { id: 1, tipoCbte: 19, puntoVenta: 5, numero: 1, asociado: null })).toThrow(/cotización/);
    expect(cmpFex({ ...factura, moneda_cotizacion: null }, bienes, { id: 1, tipoCbte: 19, puntoVenta: 5, numero: 1, asociado: null, cotizacion: 1000 }))
      .toContain("<ar:Moneda_ctz>1000</ar:Moneda_ctz>");
  });

  it("FEXGetLast_CMP lleva punto y tipo dentro de Auth", () => {
    expect(soapFex("FEXGetLast_CMP", "", { token: "t", sign: "s", cuit: "20-12345678-6" }, "<ar:Pto_venta>5</ar:Pto_venta><ar:Cbte_Tipo>19</ar:Cbte_Tipo>"))
      .toContain("<ar:Cuit>20123456786</ar:Cuit><ar:Pto_venta>5</ar:Pto_venta><ar:Cbte_Tipo>19</ar:Cbte_Tipo></ar:Auth>");
  });
});

describe("Factura E: las respuestas de ARCA", () => {
  it("lee el CAE otorgado y el reproceso", () => {
    const xml = sobre(`<FEXAuthorizeResponse ${NS}><FEXAuthorizeResult><FEXResultAuth><Id>2</Id><Cuit>20123456786</Cuit><Cae>76123456789012</Cae>` +
      `<Cbte_Tipo>19</Cbte_Tipo><Punto_vta>5</Punto_vta><Cbte_nro>8</Cbte_nro><Fch_venc_Cae>20261101</Fch_venc_Cae><Fch_cbte>20261022</Fch_cbte>` +
      `<Resultado>A</Resultado><Reproceso>S</Reproceso><Motivos_Obs></Motivos_Obs></FEXResultAuth><FEXErr><ErrCode>0</ErrCode><ErrMsg>OK</ErrMsg></FEXErr>` +
      `</FEXAuthorizeResult></FEXAuthorizeResponse>`);
    expect(leerAutorizacionFex(xml)).toEqual({ resultado: "A", cae: "76123456789012", vencimiento: "2026-11-01", numero: 8, puntoVenta: 5, tipo: 19,
      reproceso: true, observaciones: "", error: null });
  });
  it("lee el rechazo con su código", () => {
    const xml = sobre(`<FEXAuthorizeResponse ${NS}><FEXAuthorizeResult><FEXErr><ErrCode>1620</ErrCode><ErrMsg>Forma de pago obligatoria</ErrMsg></FEXErr></FEXAuthorizeResult></FEXAuthorizeResponse>`);
    expect(leerAutorizacionFex(xml)).toMatchObject({ resultado: null, cae: null, error: { codigo: 1620, mensaje: "Forma de pago obligatoria" } });
  });
  it("lee el último comprobante, la cotización y los parámetros", () => {
    expect(leerUltimoFex(sobre(`<FEXGetLast_CMPResponse ${NS}><FEXGetLast_CMPResult><FEXResult_LastCMP><Cbte_nro>7</Cbte_nro><Cbte_fecha>20261021</Cbte_fecha></FEXResult_LastCMP><FEXErr><ErrCode>0</ErrCode></FEXErr></FEXGetLast_CMPResult></FEXGetLast_CMPResponse>`))).toBe(7);
    expect(() => leerUltimoFex(sobre(`<FEXGetLast_CMPResponse ${NS}><FEXGetLast_CMPResult><FEXErr><ErrCode>1607</ErrCode><ErrMsg>Pto_venta no valido</ErrMsg></FEXErr></FEXGetLast_CMPResult></FEXGetLast_CMPResponse>`))).toThrow(/Pto_venta/);
    expect(leerCotizacionFex(sobre(`<FEXGetPARAM_CtzResponse ${NS}><FEXGetPARAM_CtzResult><FEXResultGet><Mon_ctz>1015.5</Mon_ctz><Mon_fecha>20261021</Mon_fecha></FEXResultGet><FEXErr><ErrCode>0</ErrCode></FEXErr></FEXGetPARAM_CtzResult></FEXGetPARAM_CtzResponse>`)))
      .toEqual({ cotizacion: 1015.5, fecha: "2026-10-21" });
    const paises = sobre(`<FEXGetPARAM_DST_paisResponse ${NS}><FEXGetPARAM_DST_paisResult><FEXResultGet><ClsFEXResponse_DST_pais><DST_Codigo>220</DST_Codigo><DST_Ds>PARAGUAY</DST_Ds></ClsFEXResponse_DST_pais>` +
      `<ClsFEXResponse_DST_pais><DST_Codigo>225</DST_Codigo><DST_Ds>URUGUAY</DST_Ds></ClsFEXResponse_DST_pais></FEXResultGet><FEXErr><ErrCode>0</ErrCode></FEXErr></FEXGetPARAM_DST_paisResult></FEXGetPARAM_DST_paisResponse>`);
    expect(leerParametroFex(paises, "paises")).toEqual([{ codigo: "220", descripcion: "PARAGUAY" }, { codigo: "225", descripcion: "URUGUAY" }]);
  });
});
