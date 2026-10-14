import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { plantillasParaSubir } from "@/lib/plantillasDePresupuesto";

// 2026-10-14: las plantillas vivían en el localStorage de cada navegador.
describe("plantillas de presupuesto en la base", () => {
  it("sube una vez las del navegador que no están (por nombre) y descarta basura", () => {
    const enLaBase = [{ name: "Kit baño", items: [] }];
    const locales = [
      { name: "kit baño ", items: [{ description: "x" }] },
      { name: "Kit cocina", items: [{ description: "y" }], notes: "Con instalación" },
      { name: 3, items: [] }, null, { name: "Sin items" },
    ];
    expect(plantillasParaSubir(locales, enLaBase)).toEqual([{ name: "Kit cocina", items: [{ description: "y" }], notes: "Con instalación" }]);
    expect(plantillasParaSubir("no es lista", enLaBase)).toEqual([]);
  });

  it("el editor ya no guarda plantillas en localStorage", () => {
    const editor = fs.readFileSync("src/components/presupuestos/EditorDePresupuesto.tsx", "utf8");
    expect(editor).not.toContain("localStorage");
    expect(editor).toContain("guardarPlantillaDB(orgId, tpl)");
  });
});
