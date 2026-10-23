import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { md5Hex } from "@/lib/md5";
import {
  LARGO_PERCEPCION_ARBA, nombreLotePercepcionesArba, percepcionesDeJurisdiccion, registroPercepcionArba, zipLotePercepcionesArba,
} from "@/lib/lotePercepcionesArba";

const bytes = (t: string) => new TextEncoder().encode(t);
const leer = (blob: Blob) => new Promise<ArrayBuffer>(ok => { const f = new FileReader(); f.onload = () => ok(f.result as ArrayBuffer); f.readAsArrayBuffer(blob); });

describe("MD5 (RFC 1321)", () => {
  it("da los vectores de prueba del RFC", () => {
    expect(md5Hex(bytes(""))).toBe("d41d8cd98f00b204e9800998ecf8427e");
    expect(md5Hex(bytes("a"))).toBe("0cc175b9c0f1b6a831c399e269772661");
    expect(md5Hex(bytes("abc"))).toBe("900150983cd24fb0d6963f7d28e17f72");
    expect(md5Hex(bytes("message digest"))).toBe("f96b697d7cb7938d525a2f31aaf161d0");
    expect(md5Hex(bytes("abcdefghijklmnopqrstuvwxyz"))).toBe("c3fcd3d76192e4007dfb496cca67e13b");
    expect(md5Hex(bytes("12345678901234567890123456789012345678901234567890123456789012345678901234567890"))).toBe("57edf4a22be3c955ac49da2e2107b67a");
  });
});

const p = { cuit: "30699999993", fecha: "2026-10-05", tipoArca: 1, puntoVenta: 3, numero: 1234, base: 10000, alicuota: 2.5, importe: 250 };

describe("lote de percepciones de ARBA (diseño 1.1, 71 posiciones)", () => {
  it("arma cada registro en las posiciones del diseño", () => {
    const l = registroPercepcionArba(p);
    expect(l).toHaveLength(LARGO_PERCEPCION_ARBA);
    expect(l.slice(0, 13)).toBe("30-69999999-3");
    expect(l.slice(13, 23)).toBe("05/10/2026");
    expect(l.slice(23, 24)).toBe("F");
    expect(l.slice(24, 25)).toBe("A");
    expect(l.slice(25, 30)).toBe("00003");
    expect(l.slice(30, 38)).toBe("00001234");
    expect(l.slice(38, 52)).toBe("00000010000.00");
    expect(l.slice(52, 57)).toBe("02.50");
    expect(l.slice(57, 70)).toBe("0000000250.00");
    expect(l.slice(70, 71)).toBe("A");
  });

  it("la nota de crédito va con base e importe negativos y el signo adelante", () => {
    const l = registroPercepcionArba({ ...p, tipoArca: 8, base: 1000, importe: 25 });
    expect(l.slice(23, 25)).toBe("CB");
    expect(l.slice(38, 52)).toBe("-0000001000.00");
    expect(l.slice(57, 70)).toBe("-000000025.00");
    expect(l).toHaveLength(LARGO_PERCEPCION_ARBA);
  });

  it("no arma un registro que ARBA rechazaría", () => {
    expect(() => registroPercepcionArba({ ...p, cuit: "" })).toThrow(/CUIT/);
    expect(() => registroPercepcionArba({ ...p, tipoArca: 19 })).toThrow(/no admite/);
    expect(() => registroPercepcionArba({ ...p, importe: 0 })).toThrow(/importe/);
  });

  it("nombra el .txt y el .zip con el MD5 del .zip, como el GenHash de ARBA", async () => {
    const nombre = nombreLotePercepcionesArba("20-12345678-6", "2026100");
    expect(nombre).toBe("AR-20123456786-2026100-D7-LOTE1");
    const { archivo, zip } = await zipLotePercepcionesArba(nombre, [{ ...p, fecha: "2026-10-09", numero: 2 }, p]);
    const contenido = new Uint8Array(await leer(zip));
    expect(archivo).toBe(`${nombre}_${md5Hex(contenido)}.zip`);
    const z = await JSZip.loadAsync(contenido);
    expect(Object.keys(z.files)).toEqual([`${nombre}.txt`]);
    const lineas = (await z.file(`${nombre}.txt`)!.async("string")).split("\r\n");
    expect(lineas.map(l => l.slice(13, 23))).toEqual(["05/10/2026", "09/10/2026"]);
    // El mismo lote da el mismo .zip: el nombre no cambia si se vuelve a descargar.
    expect((await zipLotePercepcionesArba(nombre, [p, { ...p, fecha: "2026-10-09", numero: 2 }])).archivo).toBe(archivo);
  });

  it("separa las percepciones de cada jurisdicción", () => {
    const tributos = [
      { tipo: 7, descripcion: "Percepción IIBB ARBA", base: 100, alicuota: 2, importe: 2 },
      { tipo: 7, descripcion: "Percepción IIBB AGIP", base: 100, alicuota: 3, importe: 3 },
      { tipo: 7, descripcion: "Percepción IIBB", base: 100, alicuota: 1, importe: 1 },
    ];
    expect(percepcionesDeJurisdiccion(tributos, "ARBA", "ARBA").map(t => t.importe)).toEqual([2, 1]);
    expect(percepcionesDeJurisdiccion(tributos, "ARBA", "AGIP").map(t => t.importe)).toEqual([2]);
    expect(percepcionesDeJurisdiccion(tributos, "AGIP", "AGIP").map(t => t.importe)).toEqual([3, 1]);
  });

  it("la página de ARCA ofrece el lote", () => {
    expect(readFileSync("src/pages/AFIPPage.tsx", "utf8")).toContain("<DeclaracionArbaPercepciones");
  });
});
