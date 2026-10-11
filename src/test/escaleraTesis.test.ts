import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ESCALONES, META_E1_VENTAS_SEMANA, REVISION_PIVOTAR, cumpleE1, escalonActual, semanasCronologicas, type Escalera } from "@/lib/escaleraTesis";

const tesis = readFileSync(resolve(process.cwd(), "docs/TESIS.md"), "utf8").replace(/\s+/g, " ");
const escalera = (over: Partial<Escalera>): Escalera => ({
  medido_at: "", comercios: [], comercios_activos: 0, tiendas: 0, con_venta_online: 0, vendiendo_todas_las_semanas: 0, ...over,
});

describe("escalera de la tesis (§8) y E1", () => {
  it("las metas son las de la tesis", () => {
    expect(ESCALONES.map(s => s.meta)).toEqual([10, 8, 5, 3]);
    expect(tesis).toContain("10 comercios → 8 tiendas → 5 primeras ventas online → 3 comercios vendiendo todas las semanas");
    expect(tesis).toContain(REVISION_PIVOTAR);
    expect(tesis).toContain(`≥ ${META_E1_VENTAS_SEMANA} ventas/semana`);
  });

  it("el escalón de ahora es el primero sin cumplir", () => {
    expect(escalonActual(escalera({ comercios_activos: 1 }))?.id).toBe("comercios_activos");
    expect(escalonActual(escalera({ comercios_activos: 10, tiendas: 3 }))?.id).toBe("tiendas");
    expect(escalonActual(escalera({ comercios_activos: 12, tiendas: 9, con_venta_online: 5, vendiendo_todas_las_semanas: 3 }))).toBeNull();
  });

  it("lee las semanas de izquierda (vieja) a derecha (esta) y mide E1 con la última", () => {
    const c = { org_id: "f", nombre: "Famatina", activo: true, tienda: false, online: false, semanal: false, semanas: [2, 0, 0, 0, 0, 0, 4, 0] };
    expect(semanasCronologicas(c)).toEqual([0, 4, 0, 0, 0, 0, 0, 2]);
    expect(cumpleE1(c)).toBe(false);
    expect(cumpleE1({ ...c, semanas: [20] })).toBe(true);
  });

  it("la base lo calcula sólo para plataforma y la pestaña existe", () => {
    const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20261010002800_escalera_de_la_tesis.sql"), "utf8");
    const page = readFileSync(resolve(process.cwd(), "src/pages/PlatformMetricsPage.tsx"), "utf8");
    expect(migration).toContain("NOT public.is_platform_admin(auth.uid())");
    expect(migration).toContain("p.semana BETWEEN 0 AND 3) = 4 AS semanal");
    expect(page).toContain("<EscaleraTesis />");
  });
});
