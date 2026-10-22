import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { conciliar, hojaConciliacion, leerEmitidosArca, type FacturaNerqia } from "@/lib/conciliacionArca";
import { bytesDeArchivoArca } from "@/lib/misComprobantes";

const ENCABEZADO = ["Fecha", "Tipo", "Punto de Venta", "Número Desde", "Número Hasta", "Cód. Autorización", "Tipo Doc. Receptor",
  "Nro. Doc. Receptor", "Denominación Receptor", "Tipo Cambio", "Moneda", "Imp. Neto Gravado", "Imp. Neto No Gravado", "Imp. Op. Exentas", "IVA", "Imp. Total"];
const fila = (fecha: string, tipo: string, pv: number, desde: number, hasta: number, cae: string, total: string, moneda = "$") =>
  [fecha, tipo, pv, desde, hasta, cae, "80", "30712345671", "ZZ Cliente SA", "1,00", moneda, "", "", "", "", total];

const factura = (p: Partial<FacturaNerqia>): FacturaNerqia => ({
  id: `zz-${Math.random()}`, number: "F-1", issue_date: "2026-10-05", tipo_comprobante: 6, punto_venta: 3, numero_afip: 1,
  cae: "76123456789012", total: 1210, currency: "ARS", afip_status: "authorized", ...p,
});

describe("Mis Comprobantes Emitidos: lectura", () => {
  it("lee el Excel con fila de título, tipo con nombre, montos con coma y fechas dd/mm/aaaa", () => {
    const r = leerEmitidosArca([
      ["Mis Comprobantes Emitidos - CUIT 20123456786"],
      ENCABEZADO,
      fila("05/10/2026", "6 - Factura B", 3, 1, 1, "76123456789012", "1.210,00"),
      fila("06/10/2026", "Nota de Crédito B", 3, 1, 1, "76123456789013", "-121,00"),
    ]);
    expect(r.error).toBeNull();
    expect(r.comprobantes).toEqual([
      { fila: 3, fecha: "2026-10-05", tipo: 6, pv: 3, numero: 1, cae: "76123456789012", total: 1210, moneda: "$", receptor: "ZZ Cliente SA" },
      { fila: 4, fecha: "2026-10-06", tipo: 8, pv: 3, numero: 1, cae: "76123456789013", total: 121, moneda: "$", receptor: "ZZ Cliente SA" },
    ]);
    expect([r.desde, r.hasta]).toEqual(["2026-10-05", "2026-10-06"]);
  });

  it("expande un rango corto sin importe por comprobante y rechaza el resto con motivo", () => {
    const r = leerEmitidosArca([ENCABEZADO,
      fila("2026-10-05", "6", 3, 10, 12, "76123456789014", "300"),
      fila("2026-10-05", "6", 3, 1, 5000, "76123456789015", "1"),
      ["", "Factura", "", "", "", "", "", "", "", "", "", "", "", "", "", ""],
    ]);
    expect(r.comprobantes.map(c => [c.numero, c.total])).toEqual([[10, null], [11, null], [12, null]]);
    expect(r.problemas.map(p => p.fila)).toEqual([3, 4]);
  });

  it("explica qué archivo hace falta", () => {
    expect(leerEmitidosArca([["Hola"]]).error).toMatch(/Emitidos|emitidos/);
    const recibidos = ["Fecha", "Tipo", "Punto de Venta", "Número Desde", "Cód. Autorización", "Nro. Doc. Emisor", "Denominación Emisor", "Imp. Total"];
    expect(leerEmitidosArca([recibidos]).error).toMatch(/recibidos/);
  });

  it("abre el .zip que entrega ARCA y deja pasar un Excel entero", async () => {
    const zip = new JSZip();
    zip.file("Mis Comprobantes Emitidos.csv", "Fecha;Tipo\n05/10/2026;6");
    const bytes = await bytesDeArchivoArca(new Blob([await zip.generateAsync({ type: "uint8array" })]));
    expect(new TextDecoder().decode(bytes)).toContain("Fecha;Tipo");
    const xlsx = new JSZip();
    xlsx.file("[Content_Types].xml", "<Types/>");
    const crudo = await xlsx.generateAsync({ type: "uint8array" });
    expect((await bytesDeArchivoArca(new Blob([crudo]))).length).toBe(crudo.length);
  });
});

describe("Conciliación con lo autorizado en Nerqia", () => {
  const arca = leerEmitidosArca([ENCABEZADO,
    fila("2026-10-05", "6", 3, 1, 1, "76123456789012", "1210"),
    fila("2026-10-05", "6", 3, 2, 2, "76123456789099", "500"),
    fila("2026-10-06", "6", 3, 3, 3, "76123456789020", "100"),
    fila("2026-10-07", "11", 3, 1, 1, "76123456789021", "50"),
  ]).comprobantes;

  it("encuentra coincidencias, diferencias, CAE sin registrar y lo que falta en ARCA", () => {
    const enCurso = factura({ id: "zz-perdida", number: "F-3", cae: null, numero_afip: null, afip_status: "network_error", afip_candidate_number: 3, issue_date: "2026-10-06", total: 100 });
    const c = conciliar(arca, [
      factura({}),
      factura({ numero_afip: 2, cae: "76123456789030", total: 600 }),
      enCurso,
      factura({ numero_afip: 9, cae: "76123456789040" }),
      factura({ punto_venta: 8, numero_afip: 1, cae: "76123456789041" }),
      factura({ punto_venta: 9, numero_afip: 1, cae: "31234567890123", codigo_autorizacion_tipo: "A", caea_informado_at: null }),
    ]);
    expect(c.coinciden).toBe(1);
    expect(c.diferencias).toHaveLength(1);
    expect(c.diferencias[0].motivos.join(" ")).toMatch(/CAE distinto.*Importe distinto/);
    expect(c.soloEnArca.map(s => [s.arca.tipo, s.arca.numero, s.sinRegistrar?.id ?? null])).toEqual([[6, 3, "zz-perdida"], [11, 1, null]]);
    expect(c.soloEnNerqia.map(s => s.motivo)).toEqual([
      expect.stringMatching(/ARCA no la tiene registrada/),
      expect.stringMatching(/punto de venta \(8\).*filtraste/),
      expect.stringMatching(/CAEA y todavía no informada/),
    ]);
    const hoja = hojaConciliacion(c);
    expect(hoja[0][0]).toBe("Situación");
    expect(hoja.some(f => f[0] === "CAE sin registrar en Nerqia" && String(f[6]).includes("F-3"))).toBe(true);
  });

  it("no compara importes en monedas distintas", () => {
    const usd = leerEmitidosArca([ENCABEZADO, fila("2026-10-05", "6", 3, 1, 1, "76123456789012", "10", "DOL")]).comprobantes;
    expect(conciliar(usd, [factura({ total: 12100 })]).coinciden).toBe(1);
    expect(conciliar(usd, [factura({ total: 10, currency: "USD" })]).coinciden).toBe(1);
    expect(conciliar(usd, [factura({ total: 11, currency: "USD" })]).diferencias[0].motivos[0]).toMatch(/Importe distinto/);
  });
});
