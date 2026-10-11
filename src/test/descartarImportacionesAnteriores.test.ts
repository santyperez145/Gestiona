import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { anterioresSinTerminar } from "@/lib/catalogImportSession";

describe("descartar importaciones anteriores sin terminar", () => {
  it("conserva la más reciente sin terminar y no toca terminadas ni canceladas", () => {
    expect(anterioresSinTerminar([
      { id: "terminada", status: "completed" },
      { id: "ultima", status: "applying" },
      { id: "cancelada", status: "cancelled" },
      { id: "vieja1", status: "applying" },
      { id: "vieja2", status: "preparing" },
    ])).toEqual(["vieja1", "vieja2"]);
    expect(anterioresSinTerminar([{ id: "unica", status: "applying" }])).toEqual([]);
    expect(anterioresSinTerminar([])).toEqual([]);
  });

  it("pide confirmación y sólo cancela (no borra productos)", () => {
    const importador = readFileSync(resolve(process.cwd(), "src/components/products/ProductsExcelImport.tsx"), "utf8");
    expect(importador).toContain("Sí, descartarlas");
    expect(importador).toContain("for (const id of ids) await cancelCatalogImport(id);");
    const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20261003000200_catalog_import_sessions.sql"), "utf8");
    const cancelar = sql.slice(sql.indexOf("FUNCTION public.cancel_catalog_import"), sql.indexOf("REVOKE ALL ON FUNCTION public.catalog_import_status"));
    expect(cancelar).not.toMatch(/DELETE FROM public\.products/);
  });
});
