import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCatalogMigrationRows } from "@/lib/catalogMigration";

describe("redirects de categorías al migrar desde Tiendanube", () => {
  const filas = [
    { "Identificador de URL": "remera-lisa", Nombre: "Remera lisa", "Categorías": "Hombre > Remeras, Ofertas", Precio: "1000", Stock: "3" },
    { "Identificador de URL": "buzo", Nombre: "Buzo", "Categorías": "Abrigos", Precio: "2000", Stock: "1" },
    { "Identificador de URL": "gorra", Nombre: "Gorra", "Categorías": "", Precio: "500", Stock: "1" },
  ];

  it("redirige la categoría principal de cada producto, con la ruta completa y la corta", () => {
    const r = parseCatalogMigrationRows(filas, "tiendanube.csv");
    expect(r.source).toBe("tiendanube");
    const rutas = (r.categoryRedirects ?? []).map(x => x.source_path);
    expect(rutas).toEqual(["/hombre/remeras", "/remeras", "/abrigos"]);
    // La categoría secundaria no se redirige: el filtro quedaría vacío.
    expect(rutas).not.toContain("/ofertas");
    const destino = new Map((r.categoryRedirects ?? []).map(x => [x.source_path, x.category]));
    const remera = r.products.find(p => p.external_key === "remera-lisa");
    expect(destino.get("/hombre/remeras")).toBe(encodeURIComponent(String(remera?.category)));
    expect(decodeURIComponent(destino.get("/remeras") ?? "")).toBe("hombre > remeras");
  });

  it("otras plataformas no generan redirects de categorías", () => {
    expect(parseCatalogMigrationRows([{ Nombre: "X", Categoría: "Remeras", "Precio venta ARS": "10" }]).categoryRedirects).toEqual([]);
  });

  it("la base no pisa redirects, no usa rutas propias y ata cada redirect al lote", () => {
    const sql = readFileSync("supabase/migrations/20261030000400_redirects_categorias.sql", "utf8");
    expect(sql).toContain("ON CONFLICT (store_id, source_path) DO NOTHING;");
    expect(sql).toContain("split_part(v_origen, '/', 2) = ANY (v_reservadas)");
    expect(sql).toContain("'/productos?cat=' || v_cat, 301, v_batch");
  });
});
