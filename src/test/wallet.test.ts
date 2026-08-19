import { describe, it, expect } from "vitest";
import {
  leerSaldo, validarRetiro, validarCbu, formatearCbu, explicarPendiente,
  saldoVacio, ESTADO_RETIRO, type SaldoBilletera,
} from "@/lib/wallet";

const saldo = (o: Partial<SaldoBilletera> = {}): SaldoBilletera => ({ ...saldoVacio, ...o });

describe("leerSaldo", () => {
  // El RPC devuelve jsonb y los numeric llegan como texto.
  it("convierte los números que llegan como texto", () => {
    const s = leerSaldo({ pendiente: "100000.00", disponible: "70000.00", retirable: "70000.00" });
    expect(s.pendiente).toBe(100000);
    expect(s.disponible).toBe(70000);
  });

  it("lo que falta o no es número cuenta como cero", () => {
    const s = leerSaldo({ disponible: "no soy un número" });
    expect(s.disponible).toBe(0);
    expect(s.total).toBe(0);
  });

  it("no explota sin datos", () => {
    expect(leerSaldo(null).total).toBe(0);
    expect(leerSaldo(undefined).moneda).toBe("ARS");
  });
});

describe("validarRetiro", () => {
  const fmt = (n: number) => `$${n.toLocaleString("es-AR")}`;

  // Primero lo que el comercio puede resolver: decirle "no te alcanza" a quien
  // además no tiene cuenta lo manda a arreglar lo que no era.
  it("sin cuenta bancaria, eso se avisa primero", () => {
    const v = validarRetiro(999999, saldo({ retirable: 0 }), false, fmt);
    expect(v.puede).toBe(false);
    expect(v.motivo).toContain("cuenta bancaria");
  });

  it("un monto en cero o negativo no va", () => {
    expect(validarRetiro(0, saldo({ retirable: 1000 }), true, fmt).puede).toBe(false);
    expect(validarRetiro(-5, saldo({ retirable: 1000 }), true, fmt).puede).toBe(false);
    expect(validarRetiro(NaN, saldo({ retirable: 1000 }), true, fmt).puede).toBe(false);
  });

  it("sin saldo disponible lo dice sin hablar de montos", () => {
    const v = validarRetiro(100, saldo({ pendiente: 50000, retirable: 0 }), true, fmt);
    expect(v.puede).toBe(false);
    expect(v.motivo).toContain("No tenés saldo");
  });

  it("por encima del retirable dice hasta cuánto se puede", () => {
    const v = validarRetiro(80000, saldo({ disponible: 100000, en_retiro: 30000, retirable: 70000 }), true, fmt);
    expect(v.puede).toBe(false);
    expect(v.motivo).toContain("70.000");
  });

  it("justo en el retirable se puede", () => {
    expect(validarRetiro(70000, saldo({ retirable: 70000 }), true, fmt).puede).toBe(true);
  });

  // Lo pendiente NO se puede retirar: es la distinción central de la billetera.
  it("lo pendiente no cuenta como retirable", () => {
    const v = validarRetiro(50000, saldo({ pendiente: 100000, disponible: 0, retirable: 0 }), true, fmt);
    expect(v.puede).toBe(false);
  });
});

describe("validarCbu", () => {
  // CBU con los dos dígitos verificadores calculados de verdad. La primera
  // versión de este test los inventó y falló: el código estaba bien, el dato
  // estaba mal.
  it("acepta un CBU válido", () => {
    expect(validarCbu("0170099220000067797394")).toBe(true);
  });

  it("acepta con espacios y guiones", () => {
    expect(validarCbu("0170 0992 2000 0067 7973 94")).toBe(true);
  });

  it("rechaza longitudes que no son 22", () => {
    expect(validarCbu("017009922000006779739")).toBe(false);
    expect(validarCbu("01700992200000677973941")).toBe(false);
    expect(validarCbu("")).toBe(false);
    expect(validarCbu(null)).toBe(false);
  });

  // Un CBU mal escrito no rebota en el momento: la transferencia sale y la
  // rechaza el banco días después.
  it("rechaza un dígito cambiado en el primer bloque", () => {
    expect(validarCbu("0171099220000067797394")).toBe(false);
  });

  it("rechaza un dígito cambiado en el segundo bloque", () => {
    expect(validarCbu("0170099220000067797384")).toBe(false);
  });

  it("rechaza texto", () => {
    expect(validarCbu("no es un cbu")).toBe(false);
  });
});

describe("formatearCbu", () => {
  it("agrupa de a cuatro para poder leerlo", () => {
    expect(formatearCbu("0170099220000067797394")).toBe("0170 0992 2000 0067 7973 94");
  });

  it("deja pasar lo que no tiene 22 dígitos", () => {
    expect(formatearCbu("123")).toBe("123");
  });
});

describe("explicarPendiente", () => {
  it("explica por qué esa plata no se puede usar", () => {
    expect(explicarPendiente(saldo({ pendiente: 100000 }))).toContain("todavía no lo acreditó");
  });

  it("no dice nada si no hay pendiente", () => {
    expect(explicarPendiente(saldo())).toBeNull();
    expect(explicarPendiente(null)).toBeNull();
  });
});

describe("estados de retiro", () => {
  it("cada estado tiene etiqueta y tono", () => {
    expect(ESTADO_RETIRO.pagado.label).toBe("Pagado");
    expect(ESTADO_RETIRO.rechazado.tono).toBe("red");
    expect(Object.keys(ESTADO_RETIRO)).toHaveLength(4);
  });
});
