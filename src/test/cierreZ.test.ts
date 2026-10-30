import { describe, expect, it } from "vitest";
import { controlesZ, informeDiarioElectronico, libroIvaDesdeZ, libroIvaTiquesA, totalesZ, type CierreZ } from "@/lib/cierreZ";
import { interpretarLecturaJornada, loteLecturaJornada, numeroDeZ } from "@/lib/fiscalPrinter/jornadaEpson";

const z = (extra: Partial<CierreZ> = {}): CierreZ => ({
  origen: "controlador", punto_venta: 2, numero: 41, fecha: "2026-10-23", estado: "confirmado",
  comprobantes: [
    { tipo: 82, desde: 101, hasta: 110, cantidad: 10, total: 12100, alicuotas: [{ tasa: 21, neto: 10000, iva: 2100 }] },
    { tipo: 113, desde: 5, hasta: 5, cantidad: 1, total: 1210, alicuotas: [{ tasa: 21, neto: 1000, iva: 210 }] },
  ],
  ...extra,
});

describe("cierre Z en el Libro IVA Digital", () => {
  it("cada tipo de un Z es un renglón de venta global diaria con el rango desde/hasta", () => {
    const libro = libroIvaDesdeZ([z()]);
    expect(libro.cbte).toHaveLength(2);
    const [b] = libro.cbte;
    expect(b).toHaveLength(266 + 2);
    expect(b.slice(0, 8)).toBe("20261023");
    expect(b.slice(8, 11)).toBe("082");
    expect(b.slice(11, 16)).toBe("00002");
    expect(b.slice(16, 36)).toBe("00000000000000000101");
    expect(b.slice(36, 56)).toBe("00000000000000000110");
    expect(b.slice(56, 58)).toBe("99");
    expect(b.slice(78, 108)).toBe("VENTA GLOBAL DIARIA           ");
    expect(b.slice(108, 123)).toBe("000000001210000");
    // El registro de alícuotas lleva el número del campo 4 (el primero del rango).
    expect(libro.alicuotas[0]).toBe("08200002" + "00000000000000000101" + "000000001000000" + "0005" + "000000000210000" + "\r\n");
    expect(libro.resumen).toEqual({ total: 10890, debitoFiscal: 1890, porAlicuota: [{ tasa: 21, neto: 9000, iva: 1890 }] });
  });

  it("los borradores y los cierres electrónicos no entran; los A van uno por uno", () => {
    const conA = z({ comprobantes: [{ tipo: 81, desde: 3, hasta: 4, cantidad: 2, total: 2420, alicuotas: [{ tasa: 21, neto: 2000, iva: 420 }] }] });
    const libro = libroIvaDesdeZ([z({ estado: "borrador" }), z({ origen: "electronico" }), conA]);
    expect(libro.cbte).toHaveLength(0);
    // Los A salen de los tiques registrados (libroIvaTiquesA), no del resumen.
    expect(libro.avisos).toEqual([]);
  });

  it("los controles avisan lo que no cierra antes de guardar", () => {
    expect(controlesZ(z().comprobantes)).toEqual([]);
    const malo = controlesZ([{ tipo: 82, desde: 10, hasta: 9, cantidad: 1, total: 100, alicuotas: [{ tasa: 21, neto: 50, iva: 10 }] }]);
    expect(malo.map(o => o.nivel)).toEqual(["error", "error", "error"]);
    expect(totalesZ(z().comprobantes)).toEqual({ total: 10890, iva: 1890 });
  });
});

describe("informe diario electrónico", () => {
  it("agrupa lo autorizado por tipo con el desglose del Libro IVA", () => {
    const factura = (numero: number, tipo: number, neto: number) => ({
      id: `zz${numero}`, issue_date: "2026-10-23", tipo_comprobante: tipo, punto_venta: 3, numero_afip: numero,
      subtotal: neto, tax_amount: neto * 0.21, tax_pct: 21, total: neto * 1.21, invoice_items: [],
    });
    const { comprobantes, problemas } = informeDiarioElectronico([factura(1, 6, 100), factura(2, 6, 200), factura(7, 1, 1000)]);
    expect(problemas).toEqual([]);
    expect(comprobantes).toEqual([
      expect.objectContaining({ tipo: 1, desde: 7, hasta: 7, cantidad: 1, total: 1210, alicuotas: [{ tasa: 21, neto: 1000, iva: 210 }] }),
      expect.objectContaining({ tipo: 6, desde: 1, hasta: 2, cantidad: 2, total: 363, alicuotas: [{ tasa: 21, neto: 300, iva: 63 }] }),
    ]);
  });
});

describe("jornada del controlador Epson", () => {
  const ok = (fields: string[]) => ({ "return code": "0000", fields });
  const noUsado = { "return code": "0B05" };

  it("lee totales y numeración antes del Z, y detecta si el vendido incluye IVA", () => {
    const tipos = [82, 111];
    const respuestas = [
      // 82: 10 emitidos, 1 cancelado, $12.100 con $2.100 de IVA; último 110
      ok(["231026", "080000", "00040", "N", "231026", "080500", "10", "1", "1210000", "210000", "0", "0", "0", "S"]),
      ok(["210000", "2100", "210000", "1210000", "0", "0"]),
      ok(["00040", "0", "0", "0", "110", "110", "1"]),
      noUsado, noUsado, noUsado,
    ];
    const lectura = interpretarLecturaJornada(respuestas, tipos, { 82: 99 });
    expect(lectura.problemas).toEqual([]);
    expect(lectura.ultimoZ).toBe(40);
    expect(lectura.comprobantes).toEqual([
      { tipo: 82, desde: 100, hasta: 110, cantidad: 10, cancelados: 1, total: 12100, internos: 0, otros_tributos: 0,
        alicuotas: [{ tasa: 21, neto: 10000, iva: 2100 }] },
    ]);
    // Sin el Z anterior, el primero sale de emitidos + cancelados.
    expect(interpretarLecturaJornada(respuestas, tipos).comprobantes[0].desde).toBe(100);
  });

  it("si las alícuotas no cierran con el total no lo adivina", () => {
    const respuestas = [
      ok(["231026", "080000", "00040", "N", "231026", "080500", "1", "0", "1000000", "210000", "0", "0", "0", "S"]),
      ok(["210000", "2100", "210000", "500000", "0", "0"]),
      ok(["00040", "0", "0", "0", "5", "5", "0"]),
    ];
    expect(interpretarLecturaJornada(respuestas, [82]).problemas[0]).toMatch(/no cierran con el total/);
  });

  it("pide 080A, 080B y 0830 por tipo sin frenar en un tipo no usado, y lee el número de Z", () => {
    expect(loteLecturaJornada([82]).map(c => c.command)).toEqual(["080A", "080B", "0830"]);
    expect(loteLecturaJornada([82]).every(c => c["ignore error"])).toBe(true);
    expect(numeroDeZ([ok(["00041"])])).toBe(41);
    expect(numeroDeZ([{ "return code": "0101" }])).toBeNull();
  });
});

describe("Tique-Factura A del controlador, uno por uno", () => {
  const zConA = z({ comprobantes: [{ tipo: 81, desde: 3, hasta: 5, cantidad: 3, total: 3630, alicuotas: [{ tasa: 21, neto: 3000, iva: 630 }] }] });
  const dia = (iso: string) => iso.slice(0, 10);

  it("cada tique A es un renglón con su CUIT, el punto de venta del Z y el IVA de sus renglones", () => {
    const libro = libroIvaTiquesA([
      { numero: "00000003", emitido: "2026-10-23T14:00:00Z", total: 1210, lineas: [{ total: 1210, tasa: 21 }], cuit: "30-71234567-1", nombre: "ZZ Obra Norte SA" },
      { numero: 4, emitido: "2026-10-23T15:00:00Z", total: 1315, lineas: [{ total: 1210, tasa: 21 }, { total: 105, tasa: 10.5 }], cuit: "30712345671", nombre: "ZZ Obra Norte SA" },
    ], [zConA], dia);
    expect(libro.cbte).toHaveLength(2);
    const [primero] = libro.cbte;
    expect(primero).toHaveLength(266 + 2);
    expect(primero.slice(8, 11)).toBe("081");
    expect(primero.slice(11, 16)).toBe("00002");
    expect(primero.slice(16, 36)).toBe("00000000000000000003");
    expect(primero.slice(56, 58)).toBe("80");
    expect(primero.slice(58, 78)).toBe("00000000030712345671");
    expect(libro.alicuotas).toHaveLength(3);
    expect(libro.resumen.porAlicuota).toEqual([{ tasa: 10.5, neto: 95.02, iva: 9.98 }, { tasa: 21, neto: 2000, iva: 420 }]);
    // El Z informa 3 y la caja registró 2.
    expect(libro.avisos).toEqual([expect.stringMatching(/Z 41: informa 3 Tique-Factura A y la caja registró 2/)]);
  });

  it("sin Z que lo incluya o sin CUIT no entra, y se avisa", () => {
    const libro = libroIvaTiquesA([
      { numero: 99, emitido: "2026-10-23T14:00:00Z", total: 121, lineas: [{ total: 121, tasa: 21 }], cuit: "30712345671" },
      { numero: 3, emitido: "2026-10-23T14:00:00Z", total: 121, lineas: [{ total: 121, tasa: 21 }], cuit: null },
    ], [zConA], dia);
    expect(libro.cbte).toHaveLength(0);
    expect(libro.avisos).toEqual(expect.arrayContaining([
      expect.stringMatching(/Tique-Factura A 99: ningún cierre Z confirmado lo incluye/),
      expect.stringMatching(/Tique-Factura A 3: el cliente no tiene CUIT/),
    ]));
  });
});
