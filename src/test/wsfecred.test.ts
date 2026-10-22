import { describe, expect, it } from "vitest";
import { leerObligadoRecepcion, soapObligadoRecepcion, WsfecredError } from "../../supabase/functions/_shared/wsfecred";

const respuesta = (cuerpo: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>` +
  `<ns2:consultarMontoObligadoRecepcionResponse xmlns:ns2="http://ar.gob.afip.wsfecred/FECredService/">` +
  `<consultarMontoObligadoRecepcionReturn>${cuerpo}</consultarMontoObligadoRecepcionReturn>` +
  `</ns2:consultarMontoObligadoRecepcionResponse></soap:Body></soap:Envelope>`;

describe("WSFECRED: obligado a recibir FCE", () => {
  it("arma el pedido con la raíz calificada y los hijos sin calificar, como el WSDL", () => {
    const xml = soapObligadoRecepcion({ token: "T<1>", sign: "S", cuitRepresentada: "20-12345678-6", cuitConsultada: "30712345671", fecha: "2026-10-22" });
    expect(xml).toContain('<fec:consultarMontoObligadoRecepcionRequest><authRequest><token>T&lt;1&gt;</token><sign>S</sign><cuitRepresentada>20123456786</cuitRepresentada></authRequest>');
    expect(xml).toContain("<cuitConsultada>30712345671</cuitConsultada><fechaEmision>2026-10-22</fechaEmision>");
    expect(() => soapObligadoRecepcion({ token: "", sign: "", cuitRepresentada: "1", cuitConsultada: "30712345671", fecha: "2026-10-22" })).toThrow("11 dígitos");
  });

  it("lee obligado y monto desde", () => {
    expect(leerObligadoRecepcion(respuesta("<obligado>S</obligado><montoDesde>4484000.00</montoDesde>")))
      .toEqual({ obligado: true, montoDesde: 4484000, observaciones: [] });
    expect(leerObligadoRecepcion(respuesta("<obligado>N</obligado>"))).toEqual({ obligado: false, montoDesde: null, observaciones: [] });
  });

  it("las observaciones se conservan y los errores de ARCA se explican", () => {
    const conObs = leerObligadoRecepcion(respuesta("<obligado>N</obligado><arrayObservacion><codigoDescripcion><codigo>1</codigo><descripcion>CUIT sin actividad</descripcion></codigoDescripcion></arrayObservacion>"));
    expect(conObs.observaciones).toEqual(["CUIT sin actividad"]);
    try {
      leerObligadoRecepcion(respuesta("<arrayErrores><codigoDescripcion><codigo>1007</codigo><descripcion>Token invalido</descripcion></codigoDescripcion></arrayErrores>"));
      throw new Error("no falló");
    } catch (e) {
      expect(e).toBeInstanceOf(WsfecredError);
      expect((e as WsfecredError).codigos).toEqual([1007]);
      expect((e as Error).message).toBe("ARCA: Token invalido");
    }
  });

  it("una respuesta rara o con entidades no se procesa", () => {
    expect(() => leerObligadoRecepcion("<!DOCTYPE x [<!ENTITY a 'b'>]><x/>")).toThrow("no pudimos leer");
    expect(() => leerObligadoRecepcion(respuesta("<montoDesde>1</montoDesde>"))).toThrow("no dijo si");
  });
});
