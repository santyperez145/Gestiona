import { describe, expect, it } from "vitest";
import { campoDeEncabezado, detectarMapeo, detectarOrigen, filasParaImportar } from "@/lib/customerImportMapping";

const TIENDANUBE = [
  "Nombre", "E-mail", "Teléfono", "DNI / CUIT", "Dirección", "Número", "Piso", "Localidad",
  "Ciudad", "Código postal", "Provincia o estado", "País", "Total consumido", "Cantidad de compras", "Última compra",
];

describe("importación de clientes: mapeo de columnas", () => {
  it("reconoce el export de clientes de Tiendanube", () => {
    expect(detectarOrigen(TIENDANUBE)).toBe("tiendanube");
    expect(detectarOrigen(["Nombre", "Email", "Teléfono"])).toBe("generic");
  });

  it("asigna cada columna sin confundir empresa con nombre", () => {
    expect(campoDeEncabezado("Nombre de la empresa")).toBe("company");
    expect(campoDeEncabezado("Razón social")).toBe("company");
    expect(campoDeEncabezado("Nombre y apellido")).toBe("name");
    expect(campoDeEncabezado("E-mail")).toBe("email");
    expect(campoDeEncabezado("DNI / CUIT")).toBe("tax_id");
    expect(campoDeEncabezado("Código postal")).toBe("address_extra");
    expect(campoDeEncabezado("Total consumido")).toBe("notes");
    expect(campoDeEncabezado("País")).toBe("");
  });

  it("del export de Tiendanube no se pierde la dirección ni el documento", () => {
    const fila = ["Ana Pérez", "ana@example.com", "11 5555-0000", "27-12345678-9", "Av. Siempreviva", "742", "3B",
      "Palermo", "CABA", "1425", "Buenos Aires", "Argentina", "152000", "4", "2026-09-30"];
    const [c] = filasParaImportar(TIENDANUBE, [fila], detectarMapeo(TIENDANUBE), "tiendanube");
    expect(c.name).toBe("Ana Pérez");
    expect(c.address).toBe("Av. Siempreviva, 742, 3B, Palermo, CABA, 1425, Buenos Aires");
    expect(c.notes).toBe("DNI/CUIT: 27-12345678-9 · Total consumido: 152000 · Cantidad de compras: 4 · Última compra: 2026-09-30");
    expect(c.tags).toEqual(["tiendanube", "importado"]);
  });

  it("une nombre y apellido, descarta filas vacías y no inventa etiquetas", () => {
    const enc = ["Nombre", "Apellido", "Email"];
    const filas = filasParaImportar(enc, [["Juan", "Gómez", "j@example.com"], ["", "", ""]], detectarMapeo(enc));
    expect(filas).toEqual([{ name: "Juan Gómez", email: "j@example.com", phone: undefined, address: undefined,
      company: undefined, birthday: undefined, notes: undefined, tags: undefined }]);
  });
});
