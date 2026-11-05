import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { csvCell } from "@/lib/csv";
import { toCSV } from "@/lib/orgDataExport";

/**
 * CSV sin fórmulas (2026-11-04). Un comprador que se llama «=HYPERLINK(…)»
 * queda como cliente; si el comercio exporta y abre el archivo en Excel, la
 * fórmula se ejecuta. Toda exportación tiene que pasar por csvCell (o toCSV).
 *
 * PENDIENTES es deuda conocida: archivos que arman su CSV a mano. La lista
 * sólo puede achicarse; un archivo nuevo que genere CSV sin el helper falla.
 */
const PENDIENTES = new Set<string>([]);

// Las librerías que ya arman sus celdas con csvCell cuentan como helper;
// finance_export_batch_csv las arma en la base con csv_celda (20261105000100).
const HELPER = /csvCell|toCSV|@\/lib\/csv"|@\/lib\/orgDataExport|buildStoreOrdersCsv|remitosCsv|inventoryCapitalCsv|buildIdentityReviewCsv|finance_export_batch_csv/;
// Genera un CSV quien arma un archivo text/csv para bajar (importar uno no).
const GENERA_CSV = /type:\s*["'`]text\/csv/;

const archivos = (dir: string): string[] =>
  readdirSync(dir).flatMap(nombre => {
    const ruta = join(dir, nombre);
    return statSync(ruta).isDirectory() ? archivos(ruta) : /\.(ts|tsx)$/.test(nombre) ? [ruta.replace(/\\/g, "/")] : [];
  });

describe("CSV sin fórmulas", () => {
  it("csvCell y toCSV neutralizan lo que Excel ejecutaría", () => {
    for (const ataque of ['=HYPERLINK("http://evil.example","clic")', "+1+1", "-2+3", "@SUM(A1)", "  =1+1"]) {
      expect(csvCell(ataque)).toMatch(/^"'/);
      expect(toCSV([{ nombre: ataque }]).split("\r\n")[1]).toMatch(/^"?'/);
    }
    // Un número negativo sigue siendo un número.
    expect(toCSV([{ saldo: -150 }]).split("\r\n")[1]).toBe("-150");
    expect(csvCell("-150.00")).toBe('"-150.00"');
    expect(toCSV([{ saldo: "-1.234,50" }]).split("\r\n")[1]).toBe('"-1.234,50"');
  });

  it("ningún archivo nuevo arma CSV sin el helper", () => {
    const sinHelper = archivos("src")
      .filter(f => !f.startsWith("src/test"))
      .filter(f => {
        const fuente = readFileSync(f, "utf8");
        return GENERA_CSV.test(fuente) && !HELPER.test(fuente);
      });
    expect(sinHelper.filter(f => !PENDIENTES.has(f)), "usar csvCell de @/lib/csv").toEqual([]);
  });

  it("la deuda sólo se achica: un pendiente que ya usa el helper sale de la lista", () => {
    const resueltos = [...PENDIENTES].filter(f => HELPER.test(readFileSync(f, "utf8")));
    expect(resueltos, "sacalos de PENDIENTES").toEqual([]);
  });
});
