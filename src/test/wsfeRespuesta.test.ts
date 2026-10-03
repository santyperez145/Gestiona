import { describe, expect, it } from "vitest";
import { erroresWsfe, leerUltimoAutorizadoWsfe } from "../../supabase/functions/_shared/wsfeRespuesta";

describe("respuesta de FECompUltimoAutorizado", () => {
  it("acepta cero sólo cuando ARCA lo informa explícitamente", () => {
    expect(leerUltimoAutorizadoWsfe("<FECompUltimoAutorizadoResult><CbteNro>0</CbteNro></FECompUltimoAutorizadoResult>"))
      .toBe(0);
    expect(leerUltimoAutorizadoWsfe("<ar:CbteNro>123</ar:CbteNro>")).toBe(123);
  });

  it("rechaza errores embebidos aunque el HTTP haya sido 200", () => {
    const xml = `<FECompUltimoAutorizadoResult><Errors><Err><Code>10016</Code><Msg>El punto de venta no existe</Msg></Err></Errors></FECompUltimoAutorizadoResult>`;
    expect(erroresWsfe(xml)).toEqual(["El punto de venta no existe (código 10016)"]);
    expect(() => leerUltimoAutorizadoWsfe(xml)).toThrow(/punto de venta no existe/);
  });

  it("no convierte una respuesta incompleta o inválida en falso éxito", () => {
    expect(() => leerUltimoAutorizadoWsfe("<FECompUltimoAutorizadoResult />")).toThrow(/sin un número/);
    expect(() => leerUltimoAutorizadoWsfe("<CbteNro>NaN</CbteNro>")).toThrow(/sin un número/);
  });
});
