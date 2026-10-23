import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  LARGO_EARCIBA, LARGO_EARCIBA_NC, archivoEarciba, armarPeriodoEarciba, faltanDatos, percepcionesAgip,
  registroEarciba, registroNotaDeCreditoEarciba, type FacturaLeida, type FichaIb, type OperacionEarciba,
} from "@/lib/earciba";

const proveedor: FichaIb = { id: "p1", tabla: "suppliers", nombre: "ZZ DISTRIBUIDORA SA", cuit: "30712345671", situacionIb: 2, inscripcionIb: "30712345671", condicionIva: "responsable_inscripto" };
const cliente: FichaIb = { id: "c1", tabla: "customers", nombre: "ZZ COMERCIO SRL", cuit: "30699999993", situacionIb: 1, inscripcionIb: "1234567890", condicionIva: "responsable_inscripto" };

const retencion: OperacionEarciba = {
  tipo: 1, norma: "29", fecha: "2026-10-07", comprobanteTipo: "03", letra: "A", comprobanteNumero: 7, comprobanteFecha: "2026-10-07",
  montoComprobante: 12100, iva: 0, base: 10000, alicuota: 2.5, importe: 250, certificado: "00000001",
  sujeto: { cuit: "30712345671", razonSocial: "ZZ DISTRIBUIDORA SA", situacionIb: 2, inscripcionIb: null, situacionIva: 1 },
};

describe("e-ARCIBA (diseño de AGIP vigente desde enero de 2022)", () => {
  it("arma la retención en las 226 posiciones del diseño", () => {
    const l = registroEarciba(retencion);
    expect(l).toHaveLength(LARGO_EARCIBA);
    const campo = (desde: number, hasta: number) => l.slice(desde - 1, hasta);
    expect(campo(1, 1)).toBe("1");
    expect(campo(2, 4)).toBe("029");
    expect(campo(5, 14)).toBe("07/10/2026");
    expect(campo(15, 16)).toBe("03");
    expect(campo(17, 17)).toBe(" ");                       // orden de pago: sin letra
    expect(campo(18, 33)).toBe("0000000000000007");
    expect(campo(34, 43)).toBe("07/10/2026");
    expect(campo(44, 59)).toBe("0000000012100,00");
    expect(campo(60, 75)).toBe("00000001        ");
    expect(campo(76, 76)).toBe("3");
    expect(campo(77, 87)).toBe("30712345671");
    expect(campo(88, 88)).toBe("2");
    expect(campo(89, 99)).toBe("30712345671");              // Convenio Multilateral: la CUIT
    expect(campo(100, 100)).toBe("1");
    expect(campo(101, 130)).toBe("ZZ DISTRIBUIDORA SA".padEnd(30, " "));
    expect(campo(131, 146)).toBe("0000000002100,00");       // otros conceptos = monto − IVA − base
    expect(campo(147, 162)).toBe("0000000000000,00");
    expect(campo(163, 178)).toBe("0000000010000,00");
    expect(campo(179, 183)).toBe("02,50");
    expect(campo(184, 199)).toBe("0000000000250,00");
    expect(campo(200, 215)).toBe("0000000000250,00");
    expect(campo(216, 226)).toBe(" ".repeat(11));
  });

  it("la percepción no lleva certificado y la factura sí lleva su letra", () => {
    const l = registroEarciba({ ...retencion, tipo: 2, comprobanteTipo: "01", letra: "A", comprobanteNumero: 300001234, certificado: "X", iva: 2100 });
    expect(l.slice(16, 17)).toBe("A");
    expect(l.slice(59, 75)).toBe(" ".repeat(16));
    expect(l.slice(130, 146)).toBe("0000000000000,00");
  });

  it("arma la nota de crédito en las 119 posiciones de su diseño", () => {
    const l = registroNotaDeCreditoEarciba({
      norma: "029", numero: 300000045, fecha: "2026-10-20", base: 1000, importe: 25, alicuota: 2.5,
      origenTipo: "01", origenLetra: "A", origenNumero: 300001234, origenFecha: "2026-10-05", cuit: "30699999993",
    });
    expect(l).toHaveLength(LARGO_EARCIBA_NC);
    expect(l.slice(0, 1)).toBe("2");
    expect(l.slice(1, 13)).toBe("000300000045");
    expect(l.slice(13, 23)).toBe("20/10/2026");
    expect(l.slice(23, 39)).toBe("0000000001000,00");
    expect(l.slice(55, 57)).toBe("01");
    expect(l.slice(57, 58)).toBe("A");
    expect(l.slice(58, 74)).toBe("0000000300001234");
    expect(l.slice(74, 85)).toBe("30699999993");
    expect(l.slice(85, 88)).toBe("029");
    expect(l.slice(88, 98)).toBe("05/10/2026");
    expect(l.slice(98, 114)).toBe("0000000000025,00");
    expect(l.slice(114, 119)).toBe("02,50");
  });

  it("no arma un registro con datos que AGIP rechazaría", () => {
    expect(faltanDatos({ ...retencion.sujeto, situacionIb: null })).toMatch(/Ingresos Brutos/);
    expect(faltanDatos({ ...retencion.sujeto, situacionIb: 1, inscripcionIb: "123" })).toMatch(/inscripción local/);
    expect(faltanDatos({ ...retencion.sujeto, situacionIva: null })).toMatch(/IVA/);
    expect(() => registroEarciba({ ...retencion, base: 20000 })).toThrow(/supera el monto/);
    expect(() => registroEarciba({ ...retencion, norma: "1234" })).toThrow(/norma/);
  });

  it("junta el mes: retenciones, percepciones, notas de crédito y a quién le faltan datos", () => {
    const factura: FacturaLeida = {
      id: "f1", fecha: "2026-10-05", tipo: 1, puntoVenta: 3, numero: 1234, total: 12350, iva: 2100, cuit: "30699999993", nombre: "ZZ Comercio",
      condicionReceptor: 1, notaCreditoDe: null, percepciones: [{ base: 10000, alicuota: 2.5, importe: 250 }],
    };
    const nc: FacturaLeida = { ...factura, id: "n1", tipo: 3, numero: 45, fecha: "2026-10-20", notaCreditoDe: "f1", percepciones: [{ base: 1000, alicuota: 2.5, importe: 25 }] };
    const sinDatos: FacturaLeida = { ...factura, id: "f2", cuit: "27222222228", nombre: "ZZ Sin Datos" };
    const p = armarPeriodoEarciba({
      norma: "029",
      retenciones: [{ certificado: 1, cuit: "30712345671", nombre: "ZZ", fecha: "2026-10-07", alicuota: 2.5, base: 10000, importe: 250, orden: { numero: 7, fecha: "2026-10-07", total: 12100 } }],
      facturas: [factura, nc, sinDatos], originales: new Map([["f1", factura]]), proveedores: [proveedor], clientes: [cliente],
    });
    expect(p.operaciones.map(o => o.tipo)).toEqual([1, 2]);
    expect(p.operaciones[1].iva).toBe(2100);
    expect(p.notas).toHaveLength(1);
    expect(p.notas[0].origenNumero).toBe(300001234);
    expect(p.incompletos).toEqual([{ ficha: null, cuit: "27222222228", nombre: "ZZ Sin Datos", motivo: "falta su situación en Ingresos Brutos" }]);
    const archivo = archivoEarciba(p.operaciones, o => o.fecha, registroEarciba);
    expect(archivo.split("\r\n").map(l => l.slice(4, 14))).toEqual(["05/10/2026", "07/10/2026"]);
  });

  it("toma sólo las percepciones de AGIP de cada factura", () => {
    const tributos = [
      { tipo: 7, descripcion: "Percepción IIBB AGIP", base: 100, alicuota: 3, importe: 3 },
      { tipo: 7, descripcion: "Percepción IIBB ARBA", base: 100, alicuota: 2, importe: 2 },
      { tipo: 6, descripcion: "Percepción IVA", base: 100, alicuota: 3, importe: 3 },
    ];
    expect(percepcionesAgip(tributos, "ARBA")).toEqual([{ base: 100, alicuota: 3, importe: 3 }]);
    expect(percepcionesAgip([{ tipo: 7, descripcion: "Percepción IIBB", base: 50, alicuota: 1, importe: 0.5 }], "AGIP")).toHaveLength(1);
  });

  it("la pantalla deja completar los datos que faltan antes de descargar", () => {
    const ui = readFileSync("src/components/afip/DeclaracionAgip.tsx", "utf8");
    expect(ui).toContain("disabled={periodo.incompletos.length > 0}");
    expect(ui).toContain('supabase.from("suppliers").update(');
    expect(readFileSync("src/pages/AFIPPage.tsx", "utf8")).toContain("<DeclaracionAgip");
  });
});
