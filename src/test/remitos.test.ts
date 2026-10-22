import { describe, expect, it } from "vitest";
import {
  avisoDelCai, codigoDeVenta, datosParaEmitir, erroresDelRemito, erroresDelTalonario, estadoDeEntrega, leerCantidad,
  letraDelRemito, mensajeDeRemito, numeroDeRemito, pendientesDeEntrega, remitoHtml, remitosCsv, textoDelRemito,
  type FormularioRemito, type Remito,
} from "@/lib/remitos";
import { esPasajero } from "@/lib/remitosDatos";

const remito = (cambios: Partial<Remito> = {}): Remito => ({
  id: "r1", punto_venta: 2, numero: 37, letra: "X", cai: null, cai_vence: null, fecha: "2026-10-22",
  sale_transaction_id: null, customer_id: null, cliente_nombre: "Ferretería <Sur>", cliente_cuit: "30712345671",
  cliente_domicilio: "Av. Siempre Viva 742, Quilmes", transportista: "Expreso ZZ", bultos: 3, valor_declarado: 150000,
  observaciones: null, estado: "emitido", entregado_at: null, recibio_nombre: null, recibio_dni: null, anulado_at: null,
  anulado_motivo: null, created_at: "2026-10-22T13:00:00Z",
  remito_items: [{ sale_id: "s1", product_id: null, descripcion: "Tornillo 6 mm", cantidad: 6, unidad: "caja" }],
  ...cambios,
});

const formulario = (cambios: Partial<FormularioRemito> = {}): FormularioRemito => ({
  fecha: "2026-10-22", clienteNombre: "ZZ", clienteCuit: "", clienteDomicilio: "", transportista: "", bultos: "",
  valorDeclarado: "", observaciones: "", renglones: [{ saleId: "s1", descripcion: "Tornillo", cantidad: "4", unidad: "un", pendiente: 4 }],
  ...cambios,
});

describe("numeración", () => {
  it("usa 5 dígitos de punto de venta y 8 de número", () => {
    expect(numeroDeRemito(1, 1)).toBe("00001-00000001");
    expect(numeroDeRemito(12, 501)).toBe("00012-00000501");
  });
  it("el código de venta es el mismo que muestra Ventas", () => {
    expect(codigoDeVenta("8f1c2d3e-aaaa-bbbb-cccc-0123456789ab")).toBe("456789AB");
  });
});

describe("pendiente de entrega", () => {
  const lineas = [
    { id: "s1", product_name: "Tornillo", quantity: 10, returned_quantity: 0 },
    { id: "s2", product_name: "Tuerca", quantity: 5, returned_quantity: 1 },
  ];

  it("vendido − devuelto − remitido, y los anulados no cuentan", () => {
    const p = pendientesDeEntrega(lineas, [
      remito({ remito_items: [{ sale_id: "s1", product_id: null, descripcion: "", cantidad: 6, unidad: "un" }] }),
      remito({ estado: "anulado", remito_items: [{ sale_id: "s1", product_id: null, descripcion: "", cantidad: 4, unidad: "un" }] }),
      remito({ estado: "entregado", remito_items: [{ sale_id: "s2", product_id: null, descripcion: "", cantidad: 1.5, unidad: "kg" }] }),
    ]);
    expect(p).toEqual([
      { saleId: "s1", descripcion: "Tornillo", vendido: 10, devuelto: 0, remitido: 6, pendiente: 4 },
      { saleId: "s2", descripcion: "Tuerca", vendido: 5, devuelto: 1, remitido: 1.5, pendiente: 2.5 },
    ]);
    expect(estadoDeEntrega(p)).toBe("parcial");
  });

  it("nunca da pendiente negativo y reconoce la entrega completa", () => {
    const p = pendientesDeEntrega([{ id: "s1", quantity: 2 }], [remito({ remito_items: [{ sale_id: "s1", product_id: null, descripcion: "", cantidad: 3, unidad: "un" }] })]);
    expect(p[0].pendiente).toBe(0);
    expect(estadoDeEntrega(p)).toBe("completa");
  });

  it("sin remitos es «sin remitir»; todo devuelto es «nada que entregar»", () => {
    expect(estadoDeEntrega(pendientesDeEntrega(lineas, []))).toBe("sin_remitir");
    expect(estadoDeEntrega(pendientesDeEntrega([{ id: "s1", quantity: 3, returned_quantity: 3 }], []))).toBe("nada_que_entregar");
  });

  it("suma decimales sin arrastrar error de coma flotante", () => {
    const items = [0.1, 0.2].map(c => ({ sale_id: "s1", product_id: null, descripcion: "", cantidad: c, unidad: "kg" }));
    expect(pendientesDeEntrega([{ id: "s1", quantity: 0.3 }], [remito({ remito_items: items })])[0].pendiente).toBe(0);
  });
});

describe("talonario y CAI", () => {
  it("la letra es R sólo con CAI vigente a la fecha del remito", () => {
    expect(letraDelRemito(null, "2026-10-22")).toBe("X");
    expect(letraDelRemito({ cai: "12345678901234", cai_vence: "2026-10-22" }, "2026-10-22")).toBe("R");
    expect(letraDelRemito({ cai: "12345678901234", cai_vence: "2026-10-21" }, "2026-10-22")).toBe("X");
  });

  it("avisa el CAI vencido y el que vence en 15 días o menos", () => {
    expect(avisoDelCai({ cai: "12345678901234", cai_vence: "2026-10-20" }, "2026-10-22")?.tono).toBe("error");
    expect(avisoDelCai({ cai: "12345678901234", cai_vence: "2026-10-23" }, "2026-10-22")?.texto).toMatch(/en 1 día/);
    expect(avisoDelCai({ cai: "12345678901234", cai_vence: "2026-10-22" }, "2026-10-22")?.texto).toMatch(/vence hoy/);
    expect(avisoDelCai({ cai: "12345678901234", cai_vence: "2026-12-31" }, "2026-10-22")).toBeNull();
    expect(avisoDelCai(null, "2026-10-22")).toBeNull();
  });

  it("valida el talonario como la base", () => {
    expect(erroresDelTalonario({ puntoVenta: "2", cai: "", caiVence: "", proximoNumero: "" }, 1)).toEqual([]);
    expect(erroresDelTalonario({ puntoVenta: "0", cai: "123", caiVence: "", proximoNumero: "5" }, 10)).toEqual([
      "El punto de venta va de 1 a 99999.",
      "El CAI tiene 14 dígitos.",
      "El CAI y su vencimiento van juntos.",
      "El próximo número no puede ser menor a 10: ya se emitió el 9.",
    ]);
  });
});

describe("formulario", () => {
  it("lee cantidades con coma decimal y separador de miles", () => {
    expect(leerCantidad("1.234,5")).toBe(1234.5);
    expect(leerCantidad("2,75")).toBe(2.75);
    expect(leerCantidad("3")).toBe(3);
    expect(leerCantidad("-1")).toBeNaN();
    expect(leerCantidad("")).toBeNaN();
  });

  it("no deja entregar más de lo pendiente ni un remito vacío", () => {
    expect(erroresDelRemito(formulario())).toEqual([]);
    expect(erroresDelRemito(formulario({ renglones: [{ saleId: "s1", descripcion: "Tornillo", cantidad: "5", unidad: "un", pendiente: 4 }] })))
      .toEqual(["Tornillo: quedan 4 por entregar."]);
    expect(erroresDelRemito(formulario({ renglones: [{ saleId: "s1", descripcion: "Tornillo", cantidad: "", unidad: "un", pendiente: 4 }] })))
      .toEqual(["Indicá qué cantidad se entrega en al menos un renglón."]);
  });

  it("valida CUIT o DNI, bultos y renglones libres", () => {
    expect(erroresDelRemito(formulario({
      clienteNombre: " ", clienteCuit: "20-11111111-1", bultos: "2,5",
      renglones: [{ saleId: null, descripcion: "", cantidad: "1", unidad: "un", pendiente: null }],
    }))).toEqual([
      "Falta a quién se entrega.",
      "El CUIT o DNI del cliente no es válido.",
      "Los bultos son un número entero.",
      "Renglón 1: falta qué se entrega.",
    ]);
    expect(erroresDelRemito(formulario({ clienteCuit: "30.123.456" }))).toEqual([]);
  });

  it("arma lo que recibe emitir_remito sin los renglones vacíos", () => {
    const d = datosParaEmitir(formulario({
      clienteCuit: "30-71234567-1", valorDeclarado: "1.500,50", bultos: "2",
      renglones: [
        { saleId: "s1", descripcion: "Tornillo", cantidad: "4", unidad: "caja", pendiente: 4 },
        { saleId: "s2", descripcion: "Tuerca", cantidad: "", unidad: "un", pendiente: 2 },
        { saleId: null, descripcion: " Flete ", cantidad: "1", unidad: "un", pendiente: null },
      ],
    }), { saleTransactionId: "tx" });
    expect(d).toMatchObject({ sale_transaction_id: "tx", cliente_cuit: "30712345671", valor_declarado: 1500.5, bultos: 2 });
    expect(d.items).toEqual([
      { sale_id: "s1", descripcion: "Tornillo", cantidad: 4, unidad: "caja" },
      { descripcion: "Flete", cantidad: 1, unidad: "un" },
    ]);
  });

  it("muestra los mensajes de la base y oculta los técnicos", () => {
    expect(mensajeDeRemito({ code: "22023", message: "Renglón 1: de «Tornillo» quedan 4 por entregar" }, "emitir el remito")).toMatch(/quedan 4/);
    expect(mensajeDeRemito({ code: "XX000", message: "internal: relation foo" }, "emitir el remito")).toBe("No se pudo emitir el remito. Probá de nuevo en unos minutos.");
    expect(mensajeDeRemito({ message: "TypeError: Failed to fetch" }, "anular el remito")).toMatch(/Sin conexión/);
  });

  it("reconoce los errores pasajeros (y no los de permiso)", () => {
    expect(esPasajero({ message: "TypeError: Failed to fetch" })).toBe(true);
    expect(esPasajero({ message: "Service Unavailable", status: 503 })).toBe(true);
    expect(esPasajero({ code: "PGRST116", message: "network-ish text" })).toBe(false);
    expect(esPasajero({ code: "42501", message: "No tenés permiso" })).toBe(false);
    expect(esPasajero(null)).toBe(false);
  });
});

describe("papel", () => {
  const emisor = { nombre: "ZZ Comercio", razonSocial: "ZZ Comercio SRL", cuit: "30712345671", domicilio: "Calle 1", tipoEmisor: "responsable_inscripto", ingresosBrutos: "901-123456-7", inicioActividades: "2020-01-01" };

  it("el X dice que no es factura; original y duplicado; escapa el texto", () => {
    const html = remitoHtml(remito(), emisor);
    expect(html).toContain("Documento no válido como factura");
    expect(html).toContain("ORIGINAL");
    expect(html).toContain("DUPLICADO");
    expect(html).toContain("00002-00000037");
    expect(html).toContain("Ferretería &lt;Sur&gt;");
    expect(html).not.toContain("Ferretería <Sur>");
    expect(html).toContain("30-71234567-1");
    expect(html).toContain("IVA Responsable Inscripto");
    expect(html).not.toContain("COD. 91");
  });

  it("el R lleva el código 91, el CAI y su vencimiento", () => {
    const html = remitoHtml(remito({ letra: "R", cai: "12345678901234", cai_vence: "2026-12-31" }), emisor);
    expect(html).toContain("COD. 91");
    expect(html).toContain("CAI N.º 12345678901234");
    expect(html).toContain("31/12/2026");
    expect(html).not.toContain("Documento no válido como factura");
  });

  it("el anulado lleva el sello", () => {
    expect(remitoHtml(remito({ estado: "anulado" }), emisor)).toContain("ANULADO");
  });

  it("WhatsApp y Excel resumen lo entregado", () => {
    expect(textoDelRemito(remito(), emisor)).toContain("• 6 caja — Tornillo 6 mm");
    const csv = remitosCsv([remito({ cliente_nombre: "=HACK()" })]).split("\r\n");
    expect(csv).toHaveLength(2);
    expect(csv[0].split(";")[1]).toBe('"Número"');
    expect(csv[1]).toContain(`"'=HACK()"`);
    expect(csv[1]).toContain('"150000"');
  });
});
