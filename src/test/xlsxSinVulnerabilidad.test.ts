import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));
const lock = JSON.parse(readFileSync(resolve(ROOT, "package-lock.json"), "utf8"));
const instalado = JSON.parse(readFileSync(resolve(ROOT, "node_modules/xlsx/package.json"), "utf8"));

/**
 * `xlsx` no puede volver a la versión de npm.
 *
 * El paquete `xlsx` del registro está **abandonado en 0.18.5 a propósito**:
 * SheetJS movió la distribución a su propio CDN y ahí siguieron los arreglos.
 * Esa 0.18.5 arrastra dos avisos altos —contaminación de prototipo y ReDoS— y
 * los dos están en el **parser**, que es justo lo que corre sobre un archivo
 * que sube el comercio (`ProductsExcelImport`, `TiendanubeExcelImport`).
 *
 * Un `npm install xlsx` distraído reinstala la 0.18.5 y reabre el agujero sin
 * que nada falle. Por eso este test mira las tres puntas: lo declarado, lo
 * bloqueado y lo instalado.
 */
const MINIMA = [0, 20, 0];

function comparar(v: string) {
  const partes = v.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((partes[i] || 0) !== MINIMA[i]) return (partes[i] || 0) - MINIMA[i];
  }
  return 0;
}

describe("xlsx viene de la distribución con los arreglos", () => {
  it("package.json no apunta al registro de npm", () => {
    const declarado = pkg.dependencies?.xlsx || pkg.devDependencies?.xlsx || "";
    expect(declarado).toContain("cdn.sheetjs.com");
  });

  it("la versión instalada es 0.20 o mayor", () => {
    expect(comparar(instalado.version)).toBeGreaterThanOrEqual(0);
  });

  it("el lock fija el tarball con hash de integridad", () => {
    // Sin el hash, el CDN podría servir otros bytes y npm los instalaría
    // igual. Con él, un cambio rompe `npm ci` en vez de pasar en silencio.
    const entrada = lock.packages?.["node_modules/xlsx"];
    expect(entrada?.resolved).toContain("cdn.sheetjs.com");
    expect(entrada?.integrity).toMatch(/^sha\d+-/);
  });

  it("el parser no contamina Object.prototype", async () => {
    // La prueba real del aviso, no la ausencia de una línea en npm audit.
    const { utils, write, read } = await import("xlsx");
    const ws = utils.aoa_to_sheet([["__proto__", "nombre"], ['{"contaminado":true}', "ZZ"]]);
    const wb = utils.book_new();
    utils.book_append_sheet(wb, ws, "H");
    const buf = write(wb, { type: "buffer", bookType: "xlsx" });
    const back = read(buf, { type: "buffer" });
    utils.sheet_to_json(back.Sheets["H"], { defval: "" });
    expect(({} as Record<string, unknown>).contaminado).toBeUndefined();
  });

  it("sigue leyendo y escribiendo lo que la app necesita", async () => {
    // El salto 0.18 → 0.20 no debe romper export ni import: son los dos
    // caminos que usan Productos, Compras, Ajustes y los dos importadores.
    const { utils, write, read } = await import("xlsx");
    const wb = utils.book_new();
    utils.book_append_sheet(wb, utils.json_to_sheet([{ nombre: "ZZ", stock: 10 }]), "Productos");
    const buf = write(wb, { type: "buffer", bookType: "xlsx" });
    const rows = utils.sheet_to_json<{ nombre: string; stock: number }>(
      read(buf, { type: "buffer" }).Sheets["Productos"], { defval: "" },
    );
    expect(rows).toEqual([{ nombre: "ZZ", stock: 10 }]);
  });
});
