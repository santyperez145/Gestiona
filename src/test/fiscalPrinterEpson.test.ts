import { afterEach, describe, expect, it, vi } from "vitest";
import {
  interpretarLoteFactura, loteFacturaEpson, mensajeRetornoEpson, numeroEpson, textoEpson,
  type DocumentoControlador,
} from "@/lib/fiscalPrinter/epson";
import { documentoDesdeLineas } from "@/lib/fiscalPrinter/service";
import { enviarLoteEpson, hostValido, leerConfigControlador, guardarConfigControlador, urlControlador } from "@/lib/fiscalPrinter/transport";

const base: DocumentoControlador = {
  items: [{ descripcion: "Martillo Ñandú 500g", cantidad: 2, precioUnitario: 1210.5, tasaIva: 21, codigo: "MAR-500" }],
  pagos: [{ medio: "efectivo", monto: 2421 }],
  emisorSinIva: false,
};

describe("protocolo Epson TM-T900FA (manual rev. F Neptuno)", () => {
  it("codifica números con decimales implícitos según el largo e,d", () => {
    expect(numeroEpson(2, 5, 4)).toBe("20000");
    expect(numeroEpson(1210.5, 7, 4)).toBe("12105000");
    expect(numeroEpson(10.5, 2, 2)).toBe("1050");
    expect(numeroEpson(2421, 10, 2)).toBe("242100");
    expect(numeroEpson(0.1 + 0.2, 5, 4)).toBe("3000");
    expect(() => numeroEpson(-1, 5, 4)).toThrow();
    expect(() => numeroEpson(1_000_000, 5, 4)).toThrow(/demasiado grande/);
  });

  it("envía sólo ASCII imprimible sin separadores", () => {
    expect(textoEpson("Martillo Ñandú | 500g\n")).toBe("Martillo Nandu - 500g");
    expect(textoEpson("x".repeat(80))).toHaveLength(40);
  });

  it("arma abrir → ítems → pagos → cerrar del tique-factura (0B)", () => {
    const lote = loteFacturaEpson(base);
    expect(lote.map(c => c.command)).toEqual(["0B01", "0B02", "0B05", "0B06"]);
    // Consumidor final sin documento.
    expect(lote[0].fields).toEqual(["Consumidor Final", "", "", "", "", "", "", "F", "", "", "", ""]);
    // Bit 14: importes brutos (IVA incluido). 15 campos; código interno y no MTX.
    expect(lote[1].command_extension).toBe("4000");
    expect(lote[1].fields).toHaveLength(15);
    expect(lote[1].fields?.slice(4, 8)).toEqual(["Martillo Nandu 500g", "20000", "12105000", "2100"]);
    expect(lote[1].fields?.[11]).toBe("");
    expect(lote[1].fields?.slice(12)).toEqual(["MAR-500", "7", "7"]);
    // Pago: código 8 = efectivo, monto 10,2.
    expect(lote[2].fields?.slice(5)).toEqual(["8", "242100"]);
    // Cerrar: cortar papel + respuesta electrónica.
    expect(lote[3].command_extension).toBe("0003");
  });

  it("identifica al comprador con CUIT y responsabilidad", () => {
    const lote = loteFacturaEpson({ ...base, comprador: { nombre: "Ferretería Sur SRL", domicilio: "Av. Siempre Viva 1", documentoTipo: "CUIT", documentoNumero: "20-12345678-6", condicion: "responsable_inscripto" } });
    expect(lote[0].fields?.slice(0, 8)).toEqual(["Ferreteria Sur SRL", "", "Av. Siempre Viva 1", "", "", "T", "20123456786", "I"]);
    const dni = loteFacturaEpson({ ...base, comprador: { nombre: "Ana", documentoTipo: "DNI", documentoNumero: "30111222", condicion: "consumidor_final" } });
    expect(dni[0].fields?.slice(5, 8)).toEqual(["D", "30111222", "F"]);
    expect(() => loteFacturaEpson({ ...base, comprador: { nombre: "Mono", condicion: "monotributo" } })).toThrow(/CUIT/);
  });

  it("un emisor sin IVA envía tasa 0 y condición 'no corresponde'", () => {
    const item = loteFacturaEpson({ ...base, emisorSinIva: true })[1];
    expect(item.fields?.[7]).toBe("0");
    expect(item.fields?.[14]).toBe("0");
  });

  it("vende por kilo o metro con cantidad fraccionada", () => {
    const lote = loteFacturaEpson({ ...base, items: [{ descripcion: "Cable 2,5mm", cantidad: 12.75, precioUnitario: 850, tasaIva: 21, codigo: "CAB", unidad: "metro" }] });
    expect(lote[1].fields?.[5]).toBe("127500");
    expect(lote[1].fields?.[13]).toBe("2");
  });

  it("interpreta éxito, error a mitad de comprobante y falta de respuesta", () => {
    const lote = loteFacturaEpson(base);
    const ok = lote.map(() => ({ "return code": "0000", fields: [] as string[] }));
    ok[ok.length - 1].fields = ["00000123", "B", "242100", "42016"];
    expect(interpretarLoteFactura(ok, lote)).toEqual({ ok: true, numero: "00000123", tipo: "B", total: "242100", iva: "42016" });
    expect(interpretarLoteFactura([{ "return code": "0000" }, { "return code": "0304" }], lote))
      .toMatchObject({ ok: false, codigo: "0304", documentoAbierto: true, error: expect.stringMatching(/papel/) });
    expect(interpretarLoteFactura([{ "return code": "0101" }], lote)).toMatchObject({ ok: false, documentoAbierto: false });
    expect(interpretarLoteFactura([], lote)).toMatchObject({ ok: false });
    expect(mensajeRetornoEpson("0b03")).toMatch(/CUIT/);
    expect(mensajeRetornoEpson("ABCD")).toMatch(/ABCD/);
  });
});

describe("comprobante desde el ticket registrado", () => {
  it("usa los importes de la base y ajusta el último pago al total", () => {
    const doc = documentoDesdeLineas([
      { product_name: "A", quantity: 3, total_ars: 100, fiscal_tax_rate: 21, payment_method: "efectivo", split_payments: [{ method: "efectivo", amount: 33 }, { method: "debito", amount: 67 }], product_id: "p1", products: { sku: "SKU-A", tax_rate: 21 } },
      { product_name: "B", quantity: 1, total_ars: 50.5, fiscal_tax_rate: null, payment_method: "efectivo", split_payments: [{ method: "efectivo", amount: 17 }, { method: "debito", amount: 33 }], product_id: "p2", products: { sku: null, tax_rate: 10.5 } },
    ], { emisorSinIva: false, tasaPorDefecto: 21 });
    expect(doc.items.map(i => [i.precioUnitario, i.tasaIva, i.codigo])).toEqual([[33.3333, 21, "SKU-A"], [50.5, 10.5, "p2"]]);
    expect(doc.pagos.reduce((s, p) => s + p.monto, 0)).toBeCloseTo(150.5, 2);
    expect(doc.pagos.map(p => p.medio)).toEqual(["efectivo", "debito"]);
  });
});

describe("transporte y configuración del dispositivo", () => {
  afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

  it("valida el host y arma la URL con el puerto del protocolo", () => {
    expect(hostValido("192.168.1.1")).toBe(true);
    expect(hostValido("http://192.168.1.1")).toBe(false);
    expect(urlControlador({ host: "192.168.1.50", protocolo: "https" }, "/ext/batch")).toBe("https://192.168.1.50:8443/ext/batch");
    expect(urlControlador({ host: "10.0.0.2:9443", protocolo: "https" }, "/ext")).toBe("https://10.0.0.2:9443/ext");
    expect(urlControlador({ host: "10.0.0.2", protocolo: "http" }, "/ext")).toBe("http://10.0.0.2:80/ext");
  });

  it("guarda la configuración por organización en este dispositivo", () => {
    expect(leerConfigControlador("org")).toBeNull();
    guardarConfigControlador("org", { modelo: "epson_tm_t900fa", host: "192.168.1.1", protocolo: "https", emitirAlCobrar: true });
    expect(leerConfigControlador("org")).toMatchObject({ host: "192.168.1.1", emitirAlCobrar: true });
    expect(leerConfigControlador("otra")).toBeNull();
  });

  it("explica cómo resolver una conexión fallida", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(enviarLoteEpson({ modelo: "epson_tm_t900fa", host: "192.168.1.1", protocolo: "https", emitirAlCobrar: false }, []))
      .rejects.toThrow(/aceptar su certificado/);
  });
});
