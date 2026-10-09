import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { leerSolicitudCaeWsfe, ArcaReadError } from "../../supabase/functions/_shared/wsfeRespuesta";
import {
  advertenciasArca,
  explicacionesDesdeMensaje,
  explicarCodigoArca,
  resumirRechazoArca,
} from "../../supabase/functions/_shared/arcaRechazos";

const soap = (result: string) =>
  `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><FECAESolicitarResponse xmlns="http://ar.gov.afip.dif.FEV1/"><FECAESolicitarResult>${result}</FECAESolicitarResult></FECAESolicitarResponse></soap:Body></soap:Envelope>`;
const cab = (resultado: string) => `<FeCabResp><Cuit>20111111112</Cuit><PtoVta>4</PtoVta><CbteTipo>6</CbteTipo><Resultado>${resultado}</Resultado></FeCabResp>`;
const evento = "<Events><Evt><Code>51</Code><Msg>ZZ aviso general de ARCA</Msg></Evt></Events>";

describe("respuesta de FECAESolicitar", () => {
  it("lee un CAE aprobado y su vencimiento", () => {
    const r = leerSolicitudCaeWsfe(soap(`${cab("A")}<FeDetResp><FECAEDetResponse><Resultado>A</Resultado><CAE>41124599989845</CAE><CAEFchVto>20261019</CAEFchVto></FECAEDetResponse></FeDetResp>`));
    expect(r).toMatchObject({ resultado: "A", cae: "41124599989845", caeVencimiento: "2026-10-19", errores: [], observaciones: [] });
  });

  it("lee observaciones en la forma del ejemplo y en la del esquema del manual v4.7", () => {
    const ejemplo = leerSolicitudCaeWsfe(soap(`${cab("R")}<FeDetResp><FECAEDetResponse><Resultado>R</Resultado><CAE></CAE><Observaciones><Obs><Code>10013</Code><Msg>DocTipo debe ser 80</Msg></Obs><Obs><Code>10016</Code><Msg>no es el próximo</Msg></Obs></Observaciones></FECAEDetResponse></FeDetResp>${evento}`));
    expect(ejemplo.resultado).toBe("R");
    expect(ejemplo.cae).toBeNull();
    expect(ejemplo.observaciones.map(o => o.code)).toEqual([10013, 10016]);

    const esquema = leerSolicitudCaeWsfe(soap(`${cab("R")}<FeDetResp><FEDetResponse><Resultado>R</Resultado><Obs><Observaciones><Code>10246</Code><Msg>Condición IVA</Msg></Observaciones></Obs></FEDetResponse></FeDetResp>`));
    expect(esquema.observaciones).toEqual([{ code: 10246, msg: "Condición IVA" }]);
  });

  it("separa Errors de los Eventos generales", () => {
    const r = leerSolicitudCaeWsfe(soap(`${evento}<Errors><Err><Code>600</Code><Msg>No se corresponden token y firma</Msg></Err></Errors>`));
    expect(r.errores).toEqual([{ code: 600, msg: "No se corresponden token y firma" }]);
    expect(r.observaciones).toEqual([]);
    expect(r.resultado).toBeNull();
  });

  it("no acepta CAE ni vencimiento malformados", () => {
    const r = leerSolicitudCaeWsfe(soap(`${cab("A")}<FeDetResp><FECAEDetResponse><Resultado>A</Resultado><CAE>123</CAE><CAEFchVto>2026-10</CAEFchVto></FECAEDetResponse></FeDetResp>`));
    expect(r.cae).toBeNull();
    expect(r.caeVencimiento).toBeNull();
  });

  it.each([
    "<html>nope</html>",
    '<!DOCTYPE x [<!ENTITY a "b">]><x>&a;</x>',
    '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><soap:Fault><faultstring>ZZ</faultstring></soap:Fault></soap:Body></soap:Envelope>',
    soap(`<FeDetResp><FECAEDetResponse><Resultado>A</Resultado></FECAEDetResponse><FECAEDetResponse><Resultado>A</Resultado></FECAEDetResponse></FeDetResp>`),
  ])("trata respuestas inválidas, Faults o lotes inesperados como inciertas", xml => {
    expect(() => leerSolicitudCaeWsfe(xml)).toThrow(ArcaReadError);
  });
});

describe("explicación de rechazos ARCA", () => {
  it("traduce un rechazo conocido a una acción para el comercio", () => {
    const r = resumirRechazoArca([], [{ code: 10013, msg: "texto oficial" }]);
    expect(r.estado).toBe("rejected");
    expect(r.accion).toBe("corregir_cliente");
    expect(r.mensaje).toContain("La factura A necesita el CUIT del cliente");
    expect(r.mensaje).toContain("código ARCA 10013");
  });

  it("los errores internos de ARCA quedan inciertos para conciliar", () => {
    const r = resumirRechazoArca([{ code: 501, msg: "Error interno de base de datos" }], [{ code: 10048, msg: "x" }]);
    expect(r.estado).toBe("network_error");
    expect(r.codigos).toEqual([501, 10048]);
    expect(r.mensaje).toContain("Otros códigos: 10048.");
  });

  it("token o CUIT fuera del ticket es un problema de conexión, no del comprobante", () => {
    expect(resumirRechazoArca([{ code: 601, msg: "" }], []).estado).toBe("config_error");
    expect(resumirRechazoArca([{ code: 600, msg: "" }], []).accion).toBe("revisar_conexion_arca");
  });

  it("una advertencia no oculta el motivo real del rechazo", () => {
    const r = resumirRechazoArca([], [{ code: 10236, msg: "categoría" }, { code: 10017, msg: "padrón" }]);
    expect(r.mensaje).toContain("código ARCA 10017");
    expect(r.mensaje).toContain("Otros códigos: 10236.");
  });

  it("un código desconocido conserva el texto oficial acotado y sin marcado", () => {
    const largo = `<b>ZZ</b> ${"motivo ".repeat(80)}`;
    const r = resumirRechazoArca([], [{ code: 19999, msg: largo }]);
    expect(r.mensaje).toMatch(/^ARCA rechazó el comprobante \(código ARCA 19999\): ZZ motivo/);
    expect(r.mensaje).not.toContain("<b>");
    expect(r.mensaje.length).toBeLessThan(320);
  });

  it("sin códigos no inventa un motivo", () => {
    const r = resumirRechazoArca([], []);
    expect(r.mensaje).toContain("sin informar el motivo");
    expect(r.codigos).toEqual([]);
  });

  it("separa advertencias de un CAE otorgado", () => {
    expect(advertenciasArca([{ code: 10236, msg: "" }, { code: 10013, msg: "" }]).map(a => a.code)).toEqual([10236]);
  });

  it("recupera las explicaciones desde el mensaje persistido", () => {
    const { mensaje } = resumirRechazoArca([], [{ code: 10096, msg: "" }, { code: 10013, msg: "" }]);
    expect(explicacionesDesdeMensaje(mensaje).map(e => e.accion).sort()).toEqual(["corregir_cliente", "revisar_punto_venta"]);
    expect(explicacionesDesdeMensaje("Error de conexión con AFIP")).toEqual([]);
    expect(explicacionesDesdeMensaje(null)).toEqual([]);
  });

  it("cada código del catálogo tiene título y acción concretos", () => {
    for (const code of [500, 501, 502, 600, 601, 10013, 10015, 10016, 10017, 10048, 10063, 10096, 10197, 10246, 10247]) {
      const e = explicarCodigoArca(code);
      expect(e, String(code)).not.toBeNull();
      expect(e!.titulo.length).toBeGreaterThan(10);
      expect(e!.queHacer.length).toBeGreaterThan(10);
    }
    expect(explicarCodigoArca(1)).toBeNull();
  });
});

describe("afip-authorize usa la lectura estructurada", () => {
  const fn = readFileSync("supabase/functions/afip-authorize/index.ts", "utf8");

  it("no busca ErrMsg ni el primer Msg del SOAP", () => {
    expect(fn).not.toContain('extractXml(xml, "ErrMsg")');
    expect(fn).not.toContain('extractXml(xml, "Msg")');
    expect(fn).toContain("leerSolicitudCaeWsfe(xml)");
    expect(fn).toContain("e instanceof ArcaAutorizacionError");
  });

  it("no expone SOAP crudo en mensajes persistidos", () => {
    expect(fn).not.toContain('"AFIP no devolvió CAE. Respuesta: " + xml');
    expect(fn).not.toMatch(/throw new Error\(`WSFE HTTP \$\{resp\.status\}: \$\{xml/);
  });
});
