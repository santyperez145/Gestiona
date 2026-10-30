import { describe, expect, it } from "vitest";
import { leameDelMes, nombresDelPaquete } from "@/lib/paqueteContador";

describe("paquete del mes para el contador", () => {
  const base = {
    periodo: "2026-09", monotributo: false, cierresZ: 2, homologacion: 1,
    ventas: { incluidos: 12, total: 121000, debitoFiscal: 21000, notasDeCredito: 1, porAlicuota: [{ tasa: 21, neto: 100000, iva: 21000 }] },
    compras: { incluidos: 5, creditoFiscal: 8000, percepcionesIva: 500 },
    posicion: { debitoFiscal: 21000, creditoFiscal: 8000, percepcionesIva: 500, retencionesIva: 200, saldo: 12300 },
    iibb: [{ jurisdiccion: "CABA", base: 100000, impuesto: 3000, retenciones: 100, saldo: 2900 }],
    pendientes: [] as string[],
  };

  it("los nombres son los que importa ARCA", () => {
    expect(nombresDelPaquete("2026-09")).toMatchObject({
      zip: "contador-2026-09.zip",
      ventasCbte: "LIBRO_IVA_DIGITAL_VENTAS_CBTE_202609.txt",
      comprasAlicuotas: "LIBRO_IVA_DIGITAL_COMPRAS_ALICUOTAS_202609.txt",
    });
  });

  it("el resumen trae ventas, compras, posición, IIBB y lo pendiente", () => {
    const texto = leameDelMes({ ...base, pendientes: ["Hay 1 cierre(s) Z en borrador"] });
    expect(texto).toContain("Paquete del mes para el contador — 09/2026");
    expect(texto).toContain("Comprobantes en el libro: 12 (1 notas de crédito)");
    expect(texto).toContain("21%: neto $ 100.000,00, IVA $ 21.000,00");
    expect(texto).toContain("Incluye 2 cierre(s) Z");
    expect(texto).toContain("Saldo a pagar: $ 12.300,00");
    expect(texto).toContain("CABA: base $ 100.000,00");
    expect(texto).toContain("· Hay 1 cierre(s) Z en borrador");
    expect(texto).toContain(String.fromCharCode(13, 10));
  });

  it("al monotributista no le arma compras ni posición", () => {
    const texto = leameDelMes({ ...base, monotributo: true });
    expect(texto).toContain("Monotributo: no se presenta Libro IVA");
    expect(texto).not.toContain("COMPRAS");
    expect(texto).not.toContain("POSICIÓN");
  });
});
