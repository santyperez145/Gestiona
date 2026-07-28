import { describe, it, expect } from "vitest";
import { toCSV, EXPORTABLE_TABLES } from "@/lib/orgDataExport";

describe("toCSV", () => {
  it("devuelve cadena vacía sin filas", () => {
    expect(toCSV([])).toBe("");
  });

  it("arma encabezado y filas", () => {
    expect(toCSV([{ a: 1, b: "x" }, { a: 2, b: "y" }]))
      .toBe("a,b\r\n1,x\r\n2,y");
  });

  it("entrecomilla los valores con coma — el caso que rompe los exports", () => {
    // Un nombre de producto como "PERFUME 100ML, ÁRABE" partiría la columna.
    expect(toCSV([{ nombre: "PERFUME, ÁRABE" }]))
      .toBe('nombre\r\n"PERFUME, ÁRABE"');
  });

  it("duplica las comillas internas", () => {
    expect(toCSV([{ nota: 'dijo "hola"' }]))
      .toBe('nota\r\n"dijo ""hola"""');
  });

  it("entrecomilla los saltos de línea", () => {
    expect(toCSV([{ nota: "linea1\nlinea2" }]))
      .toBe('nota\r\n"linea1\nlinea2"');
  });

  it("null y undefined quedan como celda vacía, no como 'null'", () => {
    expect(toCSV([{ a: null, b: undefined, c: 0 }]))
      .toBe("a,b,c\r\n,,0");
  });

  it("serializa objetos y arrays como JSON", () => {
    expect(toCSV([{ tags: ["a", "b"] }]))
      .toBe('tags\r\n"[""a"",""b""]"');
  });

  it("une las columnas de filas con formas distintas", () => {
    // Postgres puede omitir claves nulas según el cliente.
    const csv = toCSV([{ a: 1 }, { b: 2 }]);
    expect(csv.split("\r\n")[0]).toBe("a,b");
    expect(csv.split("\r\n")[1]).toBe("1,");
    expect(csv.split("\r\n")[2]).toBe(",2");
  });
});

describe("EXPORTABLE_TABLES", () => {
  it("no tiene duplicados", () => {
    expect(new Set(EXPORTABLE_TABLES).size).toBe(EXPORTABLE_TABLES.length);
  });

  it("incluye las tablas centrales del negocio", () => {
    for (const t of ["products", "sales", "customers", "expenses", "debts"]) {
      expect(EXPORTABLE_TABLES).toContain(t as never);
    }
  });
});
