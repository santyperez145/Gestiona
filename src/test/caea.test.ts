import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { detalleWsfe, quincenaDe, quincenaSiguiente, type ComprobanteParaWsfe } from "../../supabase/functions/_shared/wsfeComprobante";
import { leerCaeaWsfe, leerInformeCaeaWsfe, leerSinMovimientoWsfe } from "../../supabase/functions/_shared/wsfeRespuesta";

const sobre = (cuerpo: string) =>
  `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>${cuerpo}</soap:Body></soap:Envelope>`;
const NS = 'xmlns="http://ar.gov.afip.dif.FEV1/"';

describe("CAEA: quincenas", () => {
  it("la primera quincena va del 1 al 15 y la segunda hasta fin de mes", () => {
    expect(quincenaDe("2026-10-07")).toEqual({ periodo: 202610, orden: 1, desde: "2026-10-01", hasta: "2026-10-15" });
    expect(quincenaDe("2026-02-20")).toEqual({ periodo: 202602, orden: 2, desde: "2026-02-16", hasta: "2026-02-28" });
  });
  it("la siguiente cruza de mes y de año", () => {
    expect(quincenaSiguiente("2026-10-07")).toMatchObject({ periodo: 202610, orden: 2 });
    expect(quincenaSiguiente("2026-12-20")).toMatchObject({ periodo: 202701, orden: 1, desde: "2027-01-01" });
  });
});

describe("CAEA: respuestas de ARCA", () => {
  it("lee el CAEA otorgado con su vigencia y tope de informe", () => {
    const xml = sobre(`<FECAEASolicitarResponse ${NS}><FECAEASolicitarResult><ResultGet><CAEA>31234567890123</CAEA><Periodo>202611</Periodo><Orden>1</Orden>` +
      `<FchVigDesde>20261101</FchVigDesde><FchVigHasta>20261115</FchVigHasta><FchTopeInf>20261123</FchTopeInf><FchProceso>20261027</FchProceso></ResultGet></FECAEASolicitarResult></FECAEASolicitarResponse>`);
    expect(leerCaeaWsfe(xml, "FECAEASolicitar")).toEqual({
      caea: { caea: "31234567890123", periodo: 202611, orden: 1, vigDesde: "2026-11-01", vigHasta: "2026-11-15", topeInforme: "2026-11-23" }, errores: [],
    });
  });

  it("si ya estaba otorgado, devuelve el error para consultarlo", () => {
    const xml = sobre(`<FECAEASolicitarResponse ${NS}><FECAEASolicitarResult><Errors><Err><Code>15008</Code><Msg>Ya existe un CAEA otorgado</Msg></Err></Errors></FECAEASolicitarResult></FECAEASolicitarResponse>`);
    expect(leerCaeaWsfe(xml, "FECAEASolicitar")).toEqual({ caea: null, errores: [{ code: 15008, msg: "Ya existe un CAEA otorgado" }] });
  });

  it("lee el resultado de informar un comprobante y de «sin movimiento»", () => {
    const informe = sobre(`<FECAEARegInformativoResponse ${NS}><FECAEARegInformativoResult><FeCabResp><Resultado>A</Resultado></FeCabResp>` +
      `<FeDetResp><FECAEADetResponse><Resultado>A</Resultado><CAEA>31234567890123</CAEA></FECAEADetResponse></FeDetResp></FECAEARegInformativoResult></FECAEARegInformativoResponse>`);
    expect(leerInformeCaeaWsfe(informe)).toEqual({ resultado: "A", errores: [], observaciones: [] });
    const rechazo = sobre(`<FECAEARegInformativoResponse ${NS}><FECAEARegInformativoResult><FeDetResp><FECAEADetResponse><Resultado>R</Resultado>` +
      `<Observaciones><Obs><Code>10015</Code><Msg>Documento invalido</Msg></Obs></Observaciones></FECAEADetResponse></FeDetResp></FECAEARegInformativoResult></FECAEARegInformativoResponse>`);
    expect(leerInformeCaeaWsfe(rechazo)).toMatchObject({ resultado: "R", observaciones: [{ code: 10015, msg: "Documento invalido" }] });
    const sin = sobre(`<FECAEASinMovimientoInformarResponse ${NS}><FECAEASinMovimientoInformarResult><Resultado>A</Resultado></FECAEASinMovimientoInformarResult></FECAEASinMovimientoInformarResponse>`);
    expect(leerSinMovimientoWsfe(sin)).toEqual({ resultado: "A", errores: [] });
  });
});

describe("CAEA: el comprobante a informar", () => {
  const c: ComprobanteParaWsfe = { issue_date: "2026-11-03", customer_tax_id: "", subtotal: 100, tax_pct: 0, tax_amount: 0, total: 100,
    invoice_items: [{ total: 100, tax_rate: 0, tax_amount: 0 }] };

  it("es un FECAEADetRequest con el CAEA y la hora de generación al final", () => {
    const xml = detalleWsfe(c, { puntoVenta: 9, tipoCbte: 11, numero: 3, asociado: null, caea: { codigo: "31234567890123", generado: new Date("2026-11-03T18:30:05Z") } });
    expect(xml.startsWith("<ar:FECAEADetRequest>")).toBe(true);
    expect(xml.endsWith("<ar:CAEA>31234567890123</ar:CAEA><ar:CbteFchHsGen>20261103153005</ar:CbteFchHsGen></ar:FECAEADetRequest>")).toBe(true);
  });
  it("sin CAEA sigue siendo un FECAEDetRequest", () => {
    expect(detalleWsfe(c, { puntoVenta: 9, tipoCbte: 11, numero: 3, asociado: null })).toMatch(/^<ar:FECAEDetRequest>.*<\/ar:FECAEDetRequest>$/);
  });
});

describe("CAEA: la función", () => {
  const leer = (p: string) => readFileSync(p, "utf8");
  it("pide el ticket con el mismo candado que afip-authorize", () => {
    const clave = 'const clave = `afip:ta:${cred.modo === "propio" ? orgId : "plataforma"}`;';
    expect(leer("supabase/functions/afip-authorize/index.ts")).toContain(clave);
    expect(leer("supabase/functions/_shared/wsfeSoap.ts")).toContain(clave);
  });
  it("sólo el cron o un dueño/administrador, y el cron queda programado", () => {
    const fn = leer("supabase/functions/arca-caea/index.ts");
    expect(fn).toContain("esLlamadaDeCron(req)");
    expect(fn).toContain('.in("role", ["owner", "admin"])');
    expect(leer("supabase/config.toml")).toMatch(/\[functions\.arca-caea\]\s*verify_jwt = true/);
    expect(leer("supabase/migrations/20261022000900_caea_contingencia.sql")).toContain("cron.schedule('arca-caea-ciclo'");
  });
});

describe("CAEA: el panel", () => {
  it("ofrece emitir con CAEA sólo si ARCA no respondió y la contingencia está activa", async () => {
    const { puedeEmitirEnContingencia } = await import("@/lib/contingenciaCaea");
    const sinRed = { cae: null, tipo_comprobante: 6, afip_status: "network_error" };
    expect(puedeEmitirEnContingencia(sinRed, true)).toBe(true);
    expect(puedeEmitirEnContingencia(sinRed, false)).toBe(false);
    expect(puedeEmitirEnContingencia({ ...sinRed, afip_status: "rejected" }, true)).toBe(false);
    expect(puedeEmitirEnContingencia({ ...sinRed, afip_status: "processing" }, true)).toBe(false);
    expect(puedeEmitirEnContingencia({ ...sinRed, tipo_comprobante: 206 }, true)).toBe(false);
    expect(puedeEmitirEnContingencia({ ...sinRed, cae: "31234567890123" }, true)).toBe(false);
  });
  it("lee el estado del informe y nombra la quincena", async () => {
    const { informeCaea, nombreQuincena } = await import("@/lib/contingenciaCaea");
    const caea = { cae: "31234567890123", tipo_comprobante: 6, afip_status: "authorized", codigo_autorizacion_tipo: "A" };
    expect(informeCaea(caea)).toBe("pendiente");
    expect(informeCaea({ ...caea, caea_informado_at: "2026-10-22T10:00:00Z" })).toBe("informado");
    expect(informeCaea({ ...caea, caea_informe_error: "10015: Documento invalido" })).toBe("rechazado");
    expect(informeCaea({ ...caea, codigo_autorizacion_tipo: "E" })).toBeNull();
    expect(nombreQuincena(202610, 2)).toBe("2.ª quincena de octubre de 2026");
  });
});
