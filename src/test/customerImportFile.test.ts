import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import * as XLSX from "xlsx";
import { detectarSeparador, formatoDeArchivo, leerCsvDeClientes, leerExcelDeClientes, parsearCsv } from "@/lib/customerImportFile";

describe("importación de clientes: lectura del archivo", () => {
  it("acepta Excel y CSV, nada más", () => {
    expect(formatoDeArchivo("Clientes.XLSX")).toBe("xlsx");
    expect(formatoDeArchivo("viejo.xls")).toBe("xls");
    expect(formatoDeArchivo("agenda.csv")).toBe("csv");
    expect(formatoDeArchivo("agenda.pdf")).toBeNull();
  });

  it("CSV de Excel argentino: punto y coma, comillas escapadas y saltos dentro de comillas", () => {
    expect(detectarSeparador("Nombre;Email;Teléfono")).toBe(";");
    const texto = '\uFEFFNombre;Notas;Teléfono\r\n"Pérez, Juan";"Dijo ""volvé"" el lunes";1155554444\r\n"Ana";"línea 1\nlínea 2";\r\n\r\n';
    expect(parsearCsv(texto)).toEqual([
      ["Nombre", "Notas", "Teléfono"],
      ["Pérez, Juan", 'Dijo "volvé" el lunes', "1155554444"],
      ["Ana", "línea 1\nlínea 2", ""],
    ]);
    expect(leerCsvDeClientes(texto).filas).toHaveLength(2);
  });

  it("Excel: primera hoja con datos, fechas a YYYY-MM-DD y teléfonos sin notación científica", async () => {
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet([]), "Vacía");
    XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet([
      ["Nombre", "Celular", "Cumpleaños"],
      ["Juan Pérez", 5491155554444, new Date(Date.UTC(1990, 4, 17))],
      ["", "", ""],
      ["Ana", "", ""],
    ], { cellDates: true }), "Clientes");
    const buffer = XLSX.write(libro, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const archivo = await leerExcelDeClientes(buffer, "xlsx");
    expect(archivo.hoja).toBe("Clientes");
    expect(archivo.encabezados).toEqual(["Nombre", "Celular", "Cumpleaños"]);
    expect(archivo.filas).toEqual([["Juan Pérez", "5491155554444", "1990-05-17"], ["Ana", "", ""]]);
  });

  it("la pantalla de Clientes acepta Excel y manda el formato real al servidor", () => {
    const pagina = readFileSync("src/pages/CustomersPage.tsx", "utf8");
    expect(pagina).toContain('accept=".xlsx,.xls,.csv');
    expect(pagina).toContain("p_source_format: formato,");
    expect(pagina).not.toContain("parseCSVLine");
  });
});
