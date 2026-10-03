import { describe, expect, it } from "vitest";
import { assertEnabledPoint, leerUltimoAutorizadoWsfe } from "../../supabase/functions/_shared/wsfeRespuesta";
const exports = { assertEnabledPoint, readLastAuthorized: leerUltimoAutorizadoWsfe };
const soap = (operation: string, body: string) => `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><${operation}Response><${operation}Result>${body}</${operation}Result></${operation}Response></s:Body></s:Envelope>`;
const point = (number = "1", emission = "CAE", blocked = "N", date = "") => `<PtoVenta><Nro>${number}</Nro><EmisionTipo>${emission}</EmisionTipo><Bloqueado>${blocked}</Bloqueado><FchBaja>${date}</FchBaja></PtoVenta>`;

describe("ARCA read-only verification responses", () => {
  it.each(["0", "1", "99999999"])("requires an explicit valid last authorized number %s", value => {
    expect(exports.readLastAuthorized(soap("FECompUltimoAutorizado", `<CbteNro>${value}</CbteNro>`))).toBe(Number(value));
  });
  it.each(["", "<CbteNro/>", "<CbteNro>-1</CbteNro>", "<CbteNro>0.2</CbteNro>", "<CbteNro>NaN</CbteNro>", "<CbteNro>100000000</CbteNro>", "<Errors><Err><Code>600</Code><Msg>ZZ secret provider error</Msg></Err></Errors>"])("never treats absent, rejected or malformed responses as zero: %s", body => {
    expect(() => exports.readLastAuthorized(soap("FECompUltimoAutorizado", body))).toThrow();
    try { exports.readLastAuthorized(soap("FECompUltimoAutorizado", body)); } catch (error) { expect(String(error)).not.toContain("secret"); }
  });
  it.each(["<html>invalid</html>", "<unclosed", '<!DOCTYPE foo [<!ENTITY x "secret">]><foo>&x;</foo>', '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><s:Fault><faultstring>ZZ secret</faultstring></s:Fault></s:Body></s:Envelope>'])("rejects non-result, fault, invalid XML and entities", xml => {
    expect(() => exports.readLastAuthorized(xml)).toThrow();
  });
  it("accepts a single or multiple explicitly enabled CAE points", () => {
    expect(() => exports.assertEnabledPoint(soap("FEParamGetPtosVenta", `<ResultGet>${point()}</ResultGet>`), 1)).not.toThrow();
    expect(() => exports.assertEnabledPoint(soap("FEParamGetPtosVenta", `<ResultGet>${point("2")}${point()}</ResultGet>`), 1)).not.toThrow();
  });
  it.each([point("2"), point("1", "CAEA"), point("1", "CAE", "S"), point("1", "CAE", "N", "20260101"), ""])("does not verify missing, blocked, closed or CAEA points", body => {
    expect(() => exports.assertEnabledPoint(soap("FEParamGetPtosVenta", `<ResultGet>${body}</ResultGet>`), 1)).toThrow(/punto de venta/);
  });
});
