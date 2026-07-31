/**
 * El cruce cliente ↔ fila decide qué compras, deudas y puntos ve el comercio en
 * una ficha. Equivocarlo no rompe nada visiblemente: muestra el historial de
 * otra persona, o esconde el propio, y nadie se entera hasta que alguien
 * reclama.
 */
import { describe, it, expect } from "vitest";
import { normalizeName, belongsToCustomer, rowsOfCustomer } from "@/lib/customerMatch";

describe("normalizeName", () => {
  it("colapsa mayúsculas, acentos y espacios repetidos", () => {
    expect(normalizeName("Juan  PÉREZ")).toBe("juan perez");
    expect(normalizeName("juan perez")).toBe("juan perez");
    expect(normalizeName("  JUAN   Pérez  ")).toBe("juan perez");
  });

  it("cubre la ñ y la ç, que no son sólo tildes", () => {
    expect(normalizeName("Muñoz")).toBe("munoz");
    expect(normalizeName("François")).toBe("francois");
  });

  it("lo que no identifica a nadie es null, no cadena vacía", () => {
    expect(normalizeName("")).toBeNull();
    expect(normalizeName("   ")).toBeNull();
    expect(normalizeName(null)).toBeNull();
    expect(normalizeName(undefined)).toBeNull();
  });
});

describe("belongsToCustomer", () => {
  const ana = { id: "id-ana", name: "Ana Gómez" };
  const otra = { id: "id-otra", name: "Ana Gomez" };

  it("con customer_id manda el id", () => {
    expect(belongsToCustomer({ customer_id: "id-ana", customer_name: "Ana Gómez" }, ana)).toBe(true);
  });

  it("una fila enlazada a otro cliente NO vuelve por el nombre", () => {
    // El caso que justifica todo esto: dos personas con el mismo nombre.
    const fila = { customer_id: "id-otra", customer_name: "Ana Gomez" };
    expect(belongsToCustomer(fila, ana)).toBe(false);
    expect(belongsToCustomer(fila, otra)).toBe(true);
  });

  it("el id manda aunque el nombre haya cambiado después", () => {
    // Renombrar a alguien ya no le borra el historial.
    const fila = { customer_id: "id-ana", customer_name: "Ana G. (viejo)" };
    expect(belongsToCustomer(fila, ana)).toBe(true);
  });

  it("sin customer_id cruza por nombre normalizado", () => {
    // Es el caso de quien todavía no está cargado en el CRM: no hay trigger
    // que enlace lo viejo al darlo de alta.
    expect(belongsToCustomer({ customer_id: null, customer_name: "ana  GÓMEZ" }, ana)).toBe(true);
    expect(belongsToCustomer({ customer_id: null, customer_name: "Otro" }, ana)).toBe(false);
  });

  it("dos filas sin nombre no coinciden entre sí", () => {
    expect(belongsToCustomer({ customer_id: null, customer_name: "" }, { id: "x", name: "" })).toBe(false);
    expect(belongsToCustomer({ customer_id: null, customer_name: null }, { id: "x", name: null })).toBe(false);
  });

  it("una fila enlazada no coincide con un cliente sin id", () => {
    expect(belongsToCustomer({ customer_id: "id-ana", customer_name: "Ana Gómez" }, { name: "Ana Gómez" })).toBe(false);
  });
});

describe("rowsOfCustomer", () => {
  it("mezcla enlazadas y sueltas sin traer las ajenas", () => {
    const ana = { id: "id-ana", name: "Ana Gómez" };
    const filas = [
      { customer_id: "id-ana", customer_name: "Ana Gómez", n: 1 },
      { customer_id: null, customer_name: "ANA  gomez", n: 2 },   // vieja, sin enlazar
      { customer_id: "id-otra", customer_name: "Ana Gomez", n: 3 }, // homónima
      { customer_id: null, customer_name: "Pedro", n: 4 },
    ];
    expect(rowsOfCustomer(filas, ana).map(r => r.n)).toEqual([1, 2]);
  });
});
