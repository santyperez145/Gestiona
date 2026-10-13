import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { contarSemaforos, pantallaDe, type SaludComercio } from "@/lib/saludComercios";

const c = (semaforo: SaludComercio["semaforo"]): SaludComercio => ({ org_id: Math.random().toString(), nombre: "ZZ", semaforo, ventas_7d: 0, motivos: [] });

describe("semáforo de comercios", () => {
  it("cuenta por color", () => {
    expect(contarSemaforos([c("rojo"), c("rojo"), c("verde")])).toEqual({ rojo: 2, ambar: 0, verde: 1 });
  });

  it("dice en qué pantalla del comercio se resuelve cada motivo", () => {
    expect(pantallaDe("/productos?margen=negative")).toBe("Productos › Margen negativo");
    expect(pantallaDe("/mi-plan")).toBe("Mi plan");
    expect(pantallaDe("/otra")).toBe("/otra");
  });

  it("cada destino que devuelve la base tiene nombre, y la pestaña no enlaza al comercio propio", () => {
    const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20261010002900_salud_de_comercios.sql"), "utf8");
    const rutas = [...migration.matchAll(/'ir', '([^']+)'/g)].map(m => m[1]);
    expect(rutas.length).toBeGreaterThanOrEqual(6);
    for (const r of rutas) expect(pantallaDe(r)).not.toBe(r);
    const ui = readFileSync(resolve(process.cwd(), "src/components/platform/SemaforoComercios.tsx"), "utf8");
    expect(ui).not.toMatch(/<Link|href=/);
    expect(migration).toContain("NOT public.is_platform_admin(auth.uid())");
    expect(readFileSync(resolve(process.cwd(), "src/pages/PlatformMetricsPage.tsx"), "utf8")).toContain("<SemaforoComercios />");
  });
});

describe("semáforo: respaldo que falla en silencio", () => {
  // Del 24/9 al 13/10 los respaldos de Exentry y Famatina fallaron cada noche
  // sin que ninguna pantalla lo mostrara.
  it("la migración marca en rojo a quien lleva 48 h sin respaldo válido", async () => {
    const fs = await import("node:fs");
    const sql = fs.readFileSync("supabase/migrations/20261013000200_semaforo_sin_respaldo.sql", "utf8");
    expect(sql).toContain("'id', 'respaldo'");
    expect(sql).toMatch(/'nivel', 'rojo', 'id', 'respaldo'/);
    expect(sql).toContain("interval '48 hours'");
    // org_entitlements exige ser miembro: desde Platform rompería el semáforo.
    expect(sql).not.toMatch(/org_entitlements\(o\.id\)/);
  });

  it("dice en qué pantalla del comercio se resuelve", () => {
    expect(pantallaDe("/ajustes#system")).toBe("Ajustes › Sistema (respaldos)");
  });
});
