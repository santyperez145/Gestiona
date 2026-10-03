import { describe, expect, it } from "vitest";
import { ArcaReadError, leerUltimoAutorizadoWsfe } from "../../supabase/functions/_shared/wsfeRespuesta";
const soap = (body: string) => `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><FECompUltimoAutorizadoResponse><FECompUltimoAutorizadoResult>${body}</FECompUltimoAutorizadoResult></FECompUltimoAutorizadoResponse></s:Body></s:Envelope>`;

describe("respuesta de FECompUltimoAutorizado", () => {
  it("acepta cero sólo cuando ARCA lo informa explícitamente", () => {
    expect(leerUltimoAutorizadoWsfe(soap("<CbteNro>0</CbteNro>"))).toBe(0);
    expect(leerUltimoAutorizadoWsfe(soap('<ar:CbteNro xmlns:ar="http://ar.gov.afip.dif.FEV1/">123</ar:CbteNro>'))).toBe(123);
  });

  it("rechaza errores embebidos aunque el HTTP haya sido 200", () => {
    const xml = soap("<Errors><Err><Code>10016</Code><Msg>ZZ private provider detail</Msg></Err></Errors>");
    expect(() => leerUltimoAutorizadoWsfe(xml)).toThrow(ArcaReadError);
    try { leerUltimoAutorizadoWsfe(xml); } catch (error) {
      expect((error as ArcaReadError).code).toBe("provider_rejected");
      expect(String(error)).not.toContain("private provider detail");
    }
  });

  it("no convierte una respuesta incompleta o inválida en falso éxito", () => {
    expect(() => leerUltimoAutorizadoWsfe(soap(""))).toThrow(ArcaReadError);
    expect(() => leerUltimoAutorizadoWsfe(soap("<CbteNro>NaN</CbteNro>"))).toThrow(/último número/);
    expect(() => leerUltimoAutorizadoWsfe("<CbteNro>0</CbteNro>")).toThrow(ArcaReadError);
  });
});
