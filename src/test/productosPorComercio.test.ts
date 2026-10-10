import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resumirProductosPorComercio, type ProductosDeComercio } from "@/lib/loQueReemplaza";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20261010001900_productos_por_comercio.sql"), "utf8");
const panel = readFileSync(resolve(process.cwd(), "src/components/platform/ProductosPorComercio.tsx"), "utf8");
const page = readFileSync(resolve(process.cwd(), "src/pages/PlatformMetricsPage.tsx"), "utf8");

const fila = (over: Partial<ProductosDeComercio>): ProductosDeComercio => ({
  org_id: "o", org_name: "X", org_creada: "2026-10-01", productos: [], productos_en_uso: 0,
  herramientas: [], paga_hoy_ars: 0, herramientas_cargadas: 0, ...over,
});

describe("productos Nerqia por comercio (TESIS §6, E2, E5)", () => {
  it("promedia sólo entre comercios activos y cuenta los multiproducto", () => {
    expect(resumirProductosPorComercio([])).toEqual({
      comercios: 0, promedioProductosActivos: null, comerciosConDosOMas: 0, comerciosConMontos: 0, pagaHoyTotal: 0,
    });
    const r = resumirProductosPorComercio([
      fila({ productos_en_uso: 2, herramientas_cargadas: 1, paga_hoy_ars: 25000 }),
      fila({ productos_en_uso: 1 }),
      fila({ productos_en_uso: 0, herramientas_cargadas: 2, paga_hoy_ars: 18000.5 }),
    ]);
    expect(r).toEqual({
      comercios: 3, promedioProductosActivos: 1.5, comerciosConDosOMas: 1, comerciosConMontos: 2, pagaHoyTotal: 43000.5,
    });
  });

  it("una sola definición de las señales, usada por Mi plan y por Platform", () => {
    expect(migration).toContain("'productos', public._senales_uso_nerqia(p_org)");
    expect(migration).toContain("public._senales_uso_nerqia(organization.id)");
    expect(migration).toContain("public._herramientas_reemplazadas_json(organization.id)");
  });

  it("la vista es sólo de plataforma y las funciones se protegen solas", () => {
    expect(migration).toContain("WHERE public.is_platform_admin(auth.uid());");
    expect(migration).toContain("REVOKE ALL ON public.platform_org_productos_nerqia FROM PUBLIC, anon;");
    expect(migration.match(/OR public\.is_platform_admin\(auth\.uid\(\)\)\) THEN/g)).toHaveLength(2);
    expect(migration).toContain("public.is_org_member(p_org, auth.uid())");
  });

  it("Platform la muestra en Métricas y avisa si falta la migración", () => {
    expect(page).toContain("<ProductosPorComercio />");
    expect(page).toContain('value="products"');
    expect(panel).toContain("isMissingRelation(queryError)");
    expect(panel).toContain("console.error(\"platform_org_productos_nerqia\"");
  });
});
