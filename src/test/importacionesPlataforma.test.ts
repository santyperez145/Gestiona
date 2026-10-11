import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resumirImportaciones, type ImportacionPlataforma } from "@/lib/importacionesPlataforma";

const s = (over: Partial<ImportacionPlataforma>): ImportacionPlataforma => ({
  id: Math.random().toString(), org_id: "f", org_name: "Famatina", filename: "lista.xlsx", status: "applying",
  total: 11534, prepared: 11534, applied: 0, created_at: "2026-10-10", updated_at: "2026-10-10", minutos: 3, trabada: false, ...over,
});

describe("importaciones en Platform (E3)", () => {
  it("resume intentos, trabadas y hasta dónde llegó sin terminar", () => {
    const [f] = resumirImportaciones([
      s({ applied: 4000, trabada: true }), s({ applied: 5500, trabada: true }), s({ status: "cancelled", applied: 5750 }),
    ]);
    expect(f).toMatchObject({ comercio: "Famatina", intentos: 3, terminadas: 0, trabadas: 2, mejorMinutos: null, cumpleE3: false });
    expect(f.avanceMaximo).toEqual({ aplicadas: 5750, total: 11534 });
  });

  it("cumple E3 con una importación terminada en menos de 30 minutos", () => {
    const r = resumirImportaciones([
      s({ org_id: "a", org_name: "A", status: "completed", minutos: 45, applied: 11534 }),
      s({ org_id: "a", org_name: "A", status: "completed", minutos: 22.5, applied: 11534 }),
      s({ org_id: "b", org_name: "B", status: "completed", minutos: 31, applied: 100 }),
    ]);
    expect(r.find(c => c.orgId === "a")).toMatchObject({ mejorMinutos: 22.5, cumpleE3: true });
    expect(r.find(c => c.orgId === "b")?.cumpleE3).toBe(false);
  });

  it("la vista es sólo de plataforma y la pestaña existe", () => {
    const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20261010002700_platform_importaciones.sql"), "utf8");
    const page = readFileSync(resolve(process.cwd(), "src/pages/PlatformMetricsPage.tsx"), "utf8");
    expect(migration).toContain("WHERE public.is_platform_admin(auth.uid());");
    expect(migration).toContain("AND s.updated_at < now() - interval '30 minutes' AS trabada");
    expect(page).toContain("<ImportacionesPlataforma />");
  });
});
