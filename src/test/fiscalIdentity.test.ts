import { describe, it, expect } from "vitest";
import {
  discriminaIva, tipoDeComprobante, validarCuit, validarDni, formatearCuit,
  documentoRequerido, tipoDocAfip, mensajeDocumentoFaltante, TIPO_DOC,
  CONDICIONES_IVA, esCondicionIva,
  faltantesIdentidadFiscal, mensajeIdentidadFiscalFaltante,
} from "@/lib/fiscalIdentity";

describe("discriminaIva — lo decide el emisor", () => {
  it("sólo el responsable inscripto discrimina", () => {
    expect(discriminaIva("responsable_inscripto")).toBe(true);
  });

  // El bug que destapó todo esto: la organización es monotributo y sus órdenes
  // llevaban $84.305 de IVA discriminado.
  it("un monotributista NO discrimina", () => {
    expect(discriminaIva("monotributo")).toBe(false);
  });

  it("un exento tampoco", () => {
    expect(discriminaIva("exento")).toBe(false);
  });

  it("sin configurar no se inventa", () => {
    expect(discriminaIva(null)).toBe(false);
    expect(discriminaIva(undefined)).toBe(false);
    expect(discriminaIva("cualquier_cosa")).toBe(false);
  });
});

describe("tipoDeComprobante", () => {
  it("un monotributista emite C a todo el mundo", () => {
    for (const receptor of ["responsable_inscripto", "consumidor_final", "monotributo", "exento"]) {
      expect(tipoDeComprobante("monotributo", receptor).letra).toBe("C");
    }
  });

  it("un exento también emite C siempre", () => {
    expect(tipoDeComprobante("exento", "responsable_inscripto").letra).toBe("C");
  });

  // La A existe para que el receptor se tome el crédito fiscal.
  it("inscripto a inscripto es A", () => {
    const c = tipoDeComprobante("responsable_inscripto", "responsable_inscripto");
    expect(c.letra).toBe("A");
    expect(c.codigoAfip).toBe(1);
    expect(c.discriminaIva).toBe(true);
  });

  it("inscripto a consumidor final es B", () => {
    expect(tipoDeComprobante("responsable_inscripto", "consumidor_final").letra).toBe("B");
  });

  // Un monotributista no puede tomarse el crédito fiscal, así que recibe B.
  it("inscripto a monotributista es B, no A", () => {
    expect(tipoDeComprobante("responsable_inscripto", "monotributo").letra).toBe("B");
  });

  it("inscripto a exento es B", () => {
    expect(tipoDeComprobante("responsable_inscripto", "exento").letra).toBe("B");
  });

  it("los códigos de ARCA son 1 / 6 / 11", () => {
    expect(tipoDeComprobante("responsable_inscripto", "responsable_inscripto").codigoAfip).toBe(1);
    expect(tipoDeComprobante("responsable_inscripto", "consumidor_final").codigoAfip).toBe(6);
    expect(tipoDeComprobante("monotributo", "consumidor_final").codigoAfip).toBe(11);
  });

  it("sin receptor declarado se emite B, que es lo que corresponde a un consumidor final", () => {
    expect(tipoDeComprobante("responsable_inscripto", null).letra).toBe("B");
  });
});

describe("validarCuit — módulo 11", () => {
  it("acepta CUIT reales", () => {
    expect(validarCuit("33-69345023-9")).toBe(true);   // ARCA
    expect(validarCuit("20123456786")).toBe(true);
    expect(validarCuit("27-30395639-0")).toBe(true);
    expect(validarCuit("30712345671")).toBe(true);
  });

  it("rechaza un dígito verificador equivocado", () => {
    expect(validarCuit("33-69345023-8")).toBe(false);
    expect(validarCuit("20123456787")).toBe(false);
  });

  it("rechaza longitudes que no son 11", () => {
    expect(validarCuit("2012345678")).toBe(false);
    expect(validarCuit("201234567861")).toBe(false);
    expect(validarCuit("")).toBe(false);
    expect(validarCuit(null)).toBe(false);
  });

  it("rechaza prefijos que ARCA no asigna", () => {
    // Mismo cuerpo, prefijo inventado.
    expect(validarCuit("99-12345678-6")).toBe(false);
  });

  it("rechaza todos los dígitos iguales", () => {
    expect(validarCuit("20222222222")).toBe(false);
  });

  // Cuando la cuenta da 10 el número no existe. Mapearlo a 9 —como hacen
  // varias implementaciones— acepta un CUIT inexistente.
  it("rechaza el caso en que el verificador daría 10", () => {
    expect(validarCuit("20000000010")).toBe(false);
    expect(validarCuit("20000000019")).toBe(false);
  });

  it("tolera guiones, puntos y espacios", () => {
    expect(validarCuit(" 20.12345678.6 ")).toBe(true);
  });
});

describe("formatearCuit", () => {
  it("agrupa como se escribe en una factura", () => {
    expect(formatearCuit("20123456786")).toBe("20-12345678-6");
  });

  it("deja pasar lo que no tiene 11 dígitos en vez de romperlo", () => {
    expect(formatearCuit("123")).toBe("123");
  });
});

describe("validarDni", () => {
  it("acepta 7 y 8 dígitos", () => {
    expect(validarDni("1234567")).toBe(true);
    expect(validarDni("30.395.639")).toBe(true);
  });

  it("rechaza lo demás", () => {
    expect(validarDni("123456")).toBe(false);
    expect(validarDni("123456789")).toBe(false);
    expect(validarDni("0000000")).toBe(false);
  });
});

describe("documentoRequerido", () => {
  it("la factura A no existe sin CUIT", () => {
    const e = documentoRequerido("responsable_inscripto", "A", 1000, null);
    expect(e).toEqual({ obligatorio: true, tipo: "CUIT", motivo: "factura_a" });
  });

  it("quien declara una condición que no es consumidor final se identifica", () => {
    const e = documentoRequerido("monotributo", "C", 1000, null);
    expect(e.obligatorio).toBe(true);
    expect(e.tipo).toBe("CUIT");
  });

  it("un consumidor final por debajo del umbral no tiene que identificarse", () => {
    const e = documentoRequerido("consumidor_final", "B", 10_000, 100_000);
    expect(e.obligatorio).toBe(false);
    expect(e.tipo).toBe("SIN_IDENTIFICAR");
  });

  it("arriba del umbral sí, con DNI", () => {
    const e = documentoRequerido("consumidor_final", "B", 100_000, 100_000);
    expect(e).toEqual({ obligatorio: true, tipo: "DNI", motivo: "monto" });
  });

  // El umbral lo fija una resolución que se actualiza. Sin cargarlo no se
  // exige: es preferible a hornear un número que en seis meses está viejo.
  it("sin umbral configurado no se exige por monto", () => {
    expect(documentoRequerido("consumidor_final", "B", 99_999_999, null).obligatorio).toBe(false);
    expect(documentoRequerido("consumidor_final", "B", 99_999_999, 0).obligatorio).toBe(false);
  });
});

describe("tipoDocAfip", () => {
  it("usa el código de ARCA de cada documento", () => {
    expect(tipoDocAfip("CUIT", "20123456786")).toBe(80);
    expect(tipoDocAfip("DNI", "30395639")).toBe(96);
    expect(tipoDocAfip("CUIL", "20123456786")).toBe(86);
  });

  it("sin número es consumidor final no identificado", () => {
    expect(tipoDocAfip("DNI", "")).toBe(TIPO_DOC.SIN_IDENTIFICAR);
    expect(tipoDocAfip(null, null)).toBe(99);
  });

  it("sin tipo declarado, 11 dígitos sólo puede ser CUIT", () => {
    expect(tipoDocAfip(null, "20123456786")).toBe(80);
    expect(tipoDocAfip(null, "30395639")).toBe(96);
  });
});

describe("mensajeDocumentoFaltante", () => {
  it("explica el motivo sin jerga", () => {
    expect(mensajeDocumentoFaltante(documentoRequerido("responsable_inscripto", "A", 0, null)))
      .toBe("Para emitir factura A necesitamos tu CUIT");
    expect(mensajeDocumentoFaltante(documentoRequerido("consumidor_final", "B", 100, 100)))
      .toBe("Por el monto de la compra necesitamos tu DNI para la factura");
  });

  it("no dice nada cuando no hace falta", () => {
    expect(mensajeDocumentoFaltante({ obligatorio: false, tipo: "SIN_IDENTIFICAR" })).toBeNull();
  });
});

describe("catálogo de condiciones", () => {
  it("guarda los códigos de ARCA", () => {
    expect(CONDICIONES_IVA.responsable_inscripto.codigo).toBe(1);
    expect(CONDICIONES_IVA.exento.codigo).toBe(4);
    expect(CONDICIONES_IVA.consumidor_final.codigo).toBe(5);
    expect(CONDICIONES_IVA.monotributo.codigo).toBe(6);
  });

  it("esCondicionIva filtra lo que llega de afuera", () => {
    expect(esCondicionIva("consumidor_final")).toBe(true);
    expect(esCondicionIva("responsable_no_inscripto")).toBe(false);
    expect(esCondicionIva(null)).toBe(false);
  });
});

describe("identidad fiscal del emisor — no se adivina", () => {
  it("razón social y domicilio son los dos que van impresos", () => {
    expect(faltantesIdentidadFiscal({ razonSocial: "Exentry", domicilio: "CABA" })).toEqual([]);
    expect(faltantesIdentidadFiscal({ razonSocial: "  ", domicilio: "" })).toEqual([
      "razonSocial",
      "domicilio",
    ]);
    expect(faltantesIdentidadFiscal({ razonSocial: "Exentry", domicilio: null })).toEqual([
      "domicilio",
    ]);
  });

  it("el mensaje coincide con lo que la base va a rechazar", () => {
    expect(mensajeIdentidadFiscalFaltante({ razonSocial: "Exentry", domicilio: "CABA" })).toBeNull();
    expect(mensajeIdentidadFiscalFaltante({ razonSocial: "Exentry", domicilio: " " }))
      .toBe("Falta el domicilio fiscal");
    expect(mensajeIdentidadFiscalFaltante({ razonSocial: "", domicilio: "CABA" }))
      .toBe("Falta la razón social");
    expect(mensajeIdentidadFiscalFaltante({ razonSocial: null, domicilio: null }))
      .toBe("Faltan la razón social y el domicilio fiscal");
  });
});
