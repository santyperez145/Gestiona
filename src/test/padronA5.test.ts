import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PadronError, condicionIvaDesdeImpuestos, cuitValido, leerPersonaA5 } from "../../supabase/functions/_shared/padronA5";

const sobre = (cuerpo: string) => `<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><ns2:getPersona_v2Response xmlns:ns2="http://a5.soap.ws.server.puc.sr/"><personaReturn>${cuerpo}</personaReturn></ns2:getPersona_v2Response></soap:Body></soap:Envelope>`;

const juridica = sobre(`<datosGenerales><estadoClave>ACTIVO</estadoClave><razonSocial>ZZ DISTRIBUIDORA S.A.</razonSocial><tipoPersona>JURIDICA</tipoPersona>
<domicilioFiscal><codPostal>1405</codPostal><descripcionProvincia>CIUDAD AUTONOMA BUENOS AIRES</descripcionProvincia><direccion>AV RIVADAVIA 5000</direccion><localidad>CABALLITO</localidad></domicilioFiscal></datosGenerales>
<datosRegimenGeneral><impuesto><descripcionImpuesto>GANANCIAS SOCIEDADES</descripcionImpuesto><idImpuesto>10</idImpuesto></impuesto><impuesto><descripcionImpuesto>IVA</descripcionImpuesto><idImpuesto>30</idImpuesto></impuesto></datosRegimenGeneral>`);

const monotributista = sobre(`<datosGenerales><apellido>PEREZ</apellido><nombre>ANA</nombre><tipoPersona>FISICA</tipoPersona><estadoClave>ACTIVO</estadoClave></datosGenerales>
<datosMonotributo><categoriaMonotributo><descripcionCategoria>D LOCACIONES DE SERVICIO</descripcionCategoria></categoriaMonotributo><impuesto><idImpuesto>20</idImpuesto></impuesto></datosMonotributo>`);

describe("padrón de ARCA (A5)", () => {
  it("lee una persona jurídica responsable inscripta con domicilio", () => {
    const p = leerPersonaA5(juridica, "30-71234567-1");
    expect(p).toMatchObject({
      cuit: "30712345671", nombre: "ZZ DISTRIBUIDORA S.A.", tipoPersona: "JURIDICA", condicionIva: "responsable_inscripto",
      domicilio: "AV RIVADAVIA 5000", localidad: "CABALLITO", codigoPostal: "1405", estadoClave: "ACTIVO",
    });
  });

  it("arma el nombre de una persona física monotributista", () => {
    const p = leerPersonaA5(monotributista, "27111111110");
    expect(p.nombre).toBe("PEREZ ANA");
    expect(p.condicionIva).toBe("monotributo");
    expect(p.categoriaMonotributo).toBe("D LOCACIONES DE SERVICIO");
  });

  it("deriva la condición frente al IVA de los impuestos", () => {
    expect(condicionIvaDesdeImpuestos([30], false)).toBe("responsable_inscripto");
    expect(condicionIvaDesdeImpuestos([32], false)).toBe("exento");
    expect(condicionIvaDesdeImpuestos([], true)).toBe("monotributo");
    expect(condicionIvaDesdeImpuestos([11], false)).toBe("consumidor_final");
  });

  it("informa un CUIT inexistente y una respuesta vacía", () => {
    expect(() => leerPersonaA5(sobre("<errorConstancia><error>No existe persona con ese Id</error></errorConstancia>"), "20111111112"))
      .toThrow(PadronError);
    expect(() => leerPersonaA5("<x/>", "20111111112")).toThrow(/no devolvió/);
  });

  it("valida el dígito verificador del CUIT", () => {
    expect(cuitValido("20-12345678-6")).toBe(true);
    expect(cuitValido("20-12345678-5")).toBe(false);
    expect(cuitValido("123")).toBe(false);
  });

  it("la Edge exige sesión y membresía, usa cache y tope diario", () => {
    const edge = readFileSync("supabase/functions/arca-padron/index.ts", "utf8");
    expect(edge).toContain('from("memberships")');
    expect(edge).toContain("CACHE_DIAS = 30");
    expect(edge).toContain("TOPE_DIARIO");
    expect(edge).toContain("pedirTicketWsaa(wsaaUrl, cert, key, PADRON_SERVICIO)");
  });
});
