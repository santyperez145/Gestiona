import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { LARGO_REGISTRO_A122R, nombreLoteA122R, periodoA122R, registroA122R, textoLoteA122R, zipLoteA122R } from "@/lib/loteA122R";

const ret = { transaccion: 12, cuit: "30-71234567-1", fecha: "2026-10-07", alicuota: 2.5, base: 10000 };

describe("lote A-122R de ARBA (diseño oficial de alta de retenciones)", () => {
  it("arma cada registro en las posiciones del diseño", () => {
    const linea = registroA122R(ret);
    expect(linea).toHaveLength(LARGO_REGISTRO_A122R);
    expect(linea.slice(0, 20)).toBe("00000000000000000012");   // 1–20 transacción
    expect(linea.slice(20, 31)).toBe("30712345671");           // 21–31 CUIT
    expect(linea.slice(31, 36)).toBe("00001");                 // 32–36 sucursal
    expect(linea.slice(36, 46)).toBe("07/10/2026");            // 37–46 fecha
    expect(linea.slice(46, 51)).toBe("02.50");                 // 47–51 alícuota
    expect(linea.slice(51, 67)).toBe("0000000010000.00");      // 52–67 base
  });

  it("no deja pasar un registro que ARBA rechazaría", () => {
    expect(() => registroA122R({ ...ret, cuit: "123" })).toThrow(/CUIT/);
    expect(() => registroA122R({ ...ret, alicuota: 0 })).toThrow(/alícuota/);
    expect(() => registroA122R({ ...ret, base: 0 })).toThrow(/base/);
    expect(() => registroA122R({ ...ret, base: 1e14 })).toThrow(/no entra/);
  });

  it("nombra el lote con el CUIT del agente, el período y la actividad", () => {
    expect(periodoA122R(2026, 10, 1)).toEqual({ codigo: "2026101", desde: "2026-10-01", hasta: "2026-10-15" });
    expect(periodoA122R(2026, 2, 2)).toEqual({ codigo: "2026022", desde: "2026-02-16", hasta: "2026-02-28" });
    expect(periodoA122R(2026, 10, 0)).toEqual({ codigo: "2026100", desde: "2026-10-01", hasta: "2026-10-31" });
    expect(nombreLoteA122R("20-12345678-6", "2026101")).toBe("ER-20123456786-2026101-6-LOTE00001");
    expect(() => nombreLoteA122R("", "2026101")).toThrow(/CUIT del comercio/);
  });

  it("ordena por fecha, separa con CRLF y empaqueta un .txt con el nombre del lote, sin hash", async () => {
    const texto = textoLoteA122R([{ ...ret, transaccion: 2, fecha: "2026-10-09" }, { ...ret, transaccion: 1 }]);
    const [a, b] = texto.split("\r\n");
    expect(a.slice(0, 20)).toBe("00000000000000000001");
    expect(b.slice(0, 20)).toBe("00000000000000000002");
    expect(texto.endsWith("\r\n")).toBe(false);
    const blob = await zipLoteA122R("ER-20123456786-2026101-6-LOTE00001", texto);
    const bytes = await new Promise<ArrayBuffer>(ok => { const f = new FileReader(); f.onload = () => ok(f.result as ArrayBuffer); f.readAsArrayBuffer(blob); });
    const zip = await JSZip.loadAsync(bytes);
    expect(Object.keys(zip.files)).toEqual(["ER-20123456786-2026101-6-LOTE00001.txt"]);
    expect(await zip.file("ER-20123456786-2026101-6-LOTE00001.txt")!.async("string")).toBe(texto);
  });

  it("en ARBA la orden de pago no imprime un certificado propio: el comprobante es el A-122R", () => {
    const sql = readFileSync("supabase/migrations/20261022001600_retencion_iibb_orden_de_pago.sql", "utf8");
    expect(sql).toContain("'Retención IIBB ARBA · transacción N.º '");
    expect(readFileSync("src/components/afip/RetencionesConfig.tsx", "utf8")).toContain("<LoteArba");
  });
});
