import { describe, expect, it } from "vitest";
import { erroresDeComprobante, leerImporte, libroIvaCompras, posicionIva, type ComprobanteCompra } from "@/lib/libroIvaCompras";

const base: ComprobanteCompra = {
  id: "zz-1", fecha: "2026-09-05", tipo_comprobante: 1, punto_venta: 4, numero: 3321,
  cuit_emisor: "30712345671", razon_social_emisor: "Distribuidora Ñandú S.A.",
  alicuotas: [{ tasa: 21, neto: 10000, iva: 2100 }],
  no_gravado: 0, exento: 0, percepcion_iva: 300, percepcion_nacionales: 0, percepcion_iibb: 250,
  percepcion_municipal: 0, impuestos_internos: 0, otros_tributos: 0, total: 12650,
};
const renglones = (txt: string) => txt.split("\r\n").filter(Boolean);

describe("Libro IVA Digital — compras", () => {
  it("arma el renglón de comprobante con el diseño de 325 posiciones", () => {
    const [r] = renglones(libroIvaCompras([base]).cbte);
    expect(r).toHaveLength(325);
    expect(r.slice(0, 8)).toBe("20260905");
    expect(r.slice(8, 11)).toBe("001");
    expect(r.slice(11, 16)).toBe("00004");
    expect(r.slice(16, 36)).toBe("00000000000000003321");
    expect(r.slice(36, 52)).toBe("0".repeat(16));
    expect(r.slice(52, 54)).toBe("80");
    expect(r.slice(54, 74)).toBe("00000000030712345671");
    expect(r.slice(74, 104)).toBe("Distribuidora Nandu S.A.      ");
    expect(r.slice(104, 119)).toBe("000000001265000");
    expect(r.slice(149, 164)).toBe("000000000030000"); // percepción IVA
    expect(r.slice(179, 194)).toBe("000000000025000"); // percepción IIBB
    expect(r.slice(224, 227)).toBe("PES");
    expect(r.slice(227, 237)).toBe("0001000000");
    expect(r.slice(237, 238)).toBe("1");
    expect(r.slice(238, 239)).toBe(" ");
    expect(r.slice(239, 254)).toBe("000000000210000"); // crédito fiscal computable
    expect(r.slice(269, 280)).toBe("0".repeat(11));
    expect(r.slice(280, 310)).toBe(" ".repeat(30));
  });

  it("arma la alícuota con 84 posiciones", () => {
    const [a] = renglones(libroIvaCompras([base]).alicuotas);
    expect(a).toBe("001" + "00004" + "00000000000000003321" + "80" + "00000000030712345671" + "000000001000000" + "0005" + "000000000210000");
    expect(a).toHaveLength(84);
  });

  it("factura B o C: cero alícuotas, sin renglón y sin crédito fiscal", () => {
    const b = { ...base, tipo_comprobante: 6, alicuotas: [], percepcion_iva: 0, percepcion_iibb: 0, total: 1210 };
    const libro = libroIvaCompras([b]);
    const r = renglones(libro.cbte)[0];
    expect(r.slice(237, 238)).toBe("0");
    expect(r.slice(239, 254)).toBe("0".repeat(15));
    expect(libro.alicuotas).toBe("");
    expect(libro.resumen.creditoFiscal).toBe(0);
  });

  it("factura A exenta: una alícuota 0 % y código E", () => {
    const exenta = { ...base, alicuotas: [], exento: 5000, percepcion_iva: 0, percepcion_iibb: 0, total: 5000 };
    const libro = libroIvaCompras([exenta]);
    expect(renglones(libro.cbte)[0].slice(237, 239)).toBe("1E");
    expect(renglones(libro.alicuotas)[0].slice(65, 69)).toBe("0003");
  });

  it("las notas de crédito restan crédito fiscal y percepciones", () => {
    const nc = { ...base, id: "zz-2", tipo_comprobante: 3, numero: 15, alicuotas: [{ tasa: 21, neto: 1000, iva: 210 }], percepcion_iva: 30, percepcion_iibb: 0, total: 1240 };
    const libro = libroIvaCompras([base, nc]);
    expect(libro.resumen).toMatchObject({ creditoFiscal: 1890, percepcionesIva: 270, notasDeCredito: 1 });
    expect(libro.resumen.porAlicuota).toEqual([{ tasa: 21, neto: 9000, iva: 1890 }]);
  });

  it("posición de IVA: débito menos crédito menos percepciones", () => {
    const resumen = libroIvaCompras([base]).resumen;
    expect(posicionIva(5000, resumen)).toEqual({ debitoFiscal: 5000, creditoFiscal: 2100, percepcionesIva: 300, saldo: 2600 });
    expect(posicionIva(1000, resumen).saldo).toBe(-1400);
  });

  it("avisa antes de guardar lo que la base rechazaría", () => {
    expect(erroresDeComprobante(base)).toEqual([]);
    expect(erroresDeComprobante({ ...base, total: 13000 })).toEqual([expect.stringMatching(/no coincide con la suma/)]);
    expect(erroresDeComprobante({ ...base, alicuotas: [{ tasa: 21, neto: 10000, iva: 1000 }], total: 11550 }))
      .toContain("El IVA al 21 % no corresponde a su neto.");
    expect(erroresDeComprobante({ ...base, tipo_comprobante: 11 })).toContain("Los comprobantes B y C no discriminan IVA.");
    expect(erroresDeComprobante({ ...base, cuit_emisor: "30-71234567" })).toContain("El CUIT del proveedor tiene que tener 11 dígitos.");
  });

  it("lee importes escritos a la argentina o con punto decimal", () => {
    expect(leerImporte("1.234,56")).toBe(1234.56);
    expect(leerImporte("1234.56")).toBe(1234.56);
    expect(leerImporte("$ 2.100")).toBe(2100);
    expect(leerImporte("1.234.567")).toBe(1234567);
    expect(leerImporte("1.5")).toBe(1.5);
    expect(leerImporte("$ 2.100,00")).toBe(2100);
    expect(leerImporte("abc")).toBe(0);
  });
});
