import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { debeRegistrar, terminoNormalizado, topBusquedas } from "@/lib/busquedasSinResultado";

describe("lo que buscan y no encuentran", () => {
  it("normaliza igual que la base y descarta lo corto", () => {
    expect(terminoNormalizado("  Taladro   INALÁMBRICO ")).toBe("taladro inalambrico");
    expect(terminoNormalizado("<script>")).toBe("script");
    expect(terminoNormalizado("a")).toBeNull();
    expect(terminoNormalizado("x".repeat(80))).toHaveLength(60);
  });

  it("registra sólo sin resultados y una vez por término en la visita", () => {
    const enviados = new Set<string>();
    expect(debeRegistrar("Taladro", 3, enviados)).toBeNull();
    expect(debeRegistrar("Taladro", 0, enviados)).toBe("taladro");
    enviados.add("taladro");
    expect(debeRegistrar("TALADRO", 0, enviados)).toBeNull();
  });

  it("suma los días por término y ordena de más a menos buscado", () => {
    expect(topBusquedas([
      { termino: "taladro", veces: 2 }, { termino: "pintura", veces: 5 }, { termino: "taladro", veces: 4 }, { termino: "amoladora", veces: 1 },
    ], 2)).toEqual([{ termino: "taladro", veces: 6 }, { termino: "pintura", veces: 5 }]);
  });

  it("la tienda lo registra con pausa y el panel lo muestra; la base no guarda al visitante", () => {
    const tienda = readFileSync(resolve(process.cwd(), "src/storefront/StoreProducts.tsx"), "utf8");
    const panel = readFileSync(resolve(process.cwd(), "src/pages/EcommerceStorePage.tsx"), "utf8");
    const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20261011000500_busquedas_sin_resultado.sql"), "utf8");
    expect(tienda).toContain("void recordStoreSearchGap(slugTienda, termino);");
    expect(tienda).toContain("}, 1200);");
    expect(panel).toContain("<BusquedasSinResultado orgId={orgId} />");
    expect(migration).not.toMatch(/visitor|ip inet|user_agent|email/i);
    expect(migration).toContain("USING (public.has_permission(org_id, 'ecommerce', 'view'));");
  });
});
