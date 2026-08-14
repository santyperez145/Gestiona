import { describe, it, expect } from "vitest";
import { exportReadme, summarizeExport, toCSV, type ExportTableResult } from "@/lib/orgDataExport";

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

describe("manifiesto del export", () => {
  const tables: ExportTableResult[] = [
    { table: "products", status: "exported", row_count: 2, rows: [{ id: "1" }] },
    { table: "sales", status: "empty", row_count: 0, rows: [] },
    { table: "ecommerce_orders", status: "truncated", row_count: 50_000, available_row_count: 50_001, rows: [], reason: "Se alcanzó el límite" },
    { table: "shipments", status: "error", row_count: 0, rows: [], reason: "No se pudo leer la tabla (42P01)" },
  ];

  it("cuenta exportadas, vacías, truncadas y fallidas sin esconder ninguna", () => {
    expect(summarizeExport(tables)).toEqual({ exported: 1, empty: 1, truncated: 1, failed: 1 });
  });

  it("explica las limitaciones y nombra la tabla con observación", () => {
    const readme = exportReadme({
      schema_version: 1,
      generated_at: "2026-08-14T12:00:00.000Z",
      org_id: "org-1",
      max_rows_per_table: 50_000,
      tables,
      excluded_credentials: ["afip_credentials"],
    }, "Mi negocio", summarizeExport(tables));

    expect(readme).toContain("no es una copia completa");
    expect(readme).toContain("shipments: error");
    expect(readme).toContain("credenciales de acceso");
  });
});
