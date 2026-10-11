import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { debeRegistrar, debeRegistrarConResultados, productosPorSinonimo, resumenDeBusquedas, terminoNormalizado, topBusquedas } from "@/lib/busquedasSinResultado";

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
    expect(tienda).toContain("if (sin) void recordStoreSearchGap(slugTienda, sin);");
    expect(tienda).toContain("}, 1200);");
    expect(panel).toContain("<BusquedasSinResultado orgId={orgId} />");
    expect(migration).not.toMatch(/visitor|ip inet|user_agent|email/i);
    expect(migration).toContain("USING (public.has_permission(org_id, 'ecommerce', 'view'));");
  });
});

describe("sinónimos de búsqueda", () => {
  const sinonimos = [
    { termino: "amoladora", product_id: "esmeriladora" },
    { termino: "amoladora angular", product_id: "esmeriladora-grande" },
    { termino: "latex", product_id: "pintura" },
  ];

  it("trae lo vinculado cuando todas las palabras de uno están en el otro", () => {
    expect([...productosPorSinonimo("Amoladora", sinonimos)].sort()).toEqual(["esmeriladora", "esmeriladora-grande"]);
    expect([...productosPorSinonimo("amoladora angular 115", sinonimos)].sort()).toEqual(["esmeriladora", "esmeriladora-grande"]);
    expect([...productosPorSinonimo("Látex", sinonimos)]).toEqual(["pintura"]);
  });

  it("no trae nada con palabras sueltas que no coinciden o búsquedas vacías", () => {
    expect(productosPorSinonimo("angular", sinonimos)).toEqual(new Set(["esmeriladora-grande"]));
    expect(productosPorSinonimo("taladro", sinonimos).size).toBe(0);
    expect(productosPorSinonimo("", sinonimos).size).toBe(0);
  });

  it("la tienda suma esos productos y el panel permite vincular con el selector con búsqueda", () => {
    const tienda = readFileSync(resolve(process.cwd(), "src/storefront/StoreProducts.tsx"), "utf8");
    const tarjeta = readFileSync(resolve(process.cwd(), "src/components/ecommerce/BusquedasSinResultado.tsx"), "utf8");
    const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20261011000600_sinonimos_de_busqueda.sql"), "utf8");
    expect(tienda).toContain("productosPorSinonimo(q, sinonimos)");
    expect(tienda).toContain("void getStoreSearchSynonyms(slugTienda)");
    expect(tarjeta).toContain("<ProductCombobox");
    expect(tarjeta).toContain('useHasPermission("ecommerce", "edit")');
    expect(migration).toContain("AND EXISTS (SELECT 1 FROM public.products p WHERE p.id = product_id AND p.org_id = store_search_synonyms.org_id)");
    expect(migration).toContain("JOIN public.products p ON p.id = s.product_id AND p.is_active");
  });
});

describe("las llamadas opcionales de la tienda no ensucian la consola al navegar", () => {
  it("un corte de red no se registra como error en sinónimos, búsquedas ni sello", async () => {
    const { isTransientPublicError } = await import("@/lib/publicDataSource");
    expect(isTransientPublicError({ message: "TypeError: Failed to fetch", code: "" } as never)).toBe(true);
    const datos = readFileSync(resolve(process.cwd(), "src/lib/publicDataSource.ts"), "utf8");
    const sello = readFileSync(resolve(process.cwd(), "src/storefront/SelloNerqia.tsx"), "utf8");
    expect(datos).toContain("else if (!isTransientPublicError(error)) console.error('[tienda] no se pudieron leer los sinónimos de búsqueda:'");
    expect(datos).toContain("if (isTransientPublicError(error)) return;\n  console.error('[tienda] no se pudo registrar la búsqueda sin resultados:'");
    expect(sello).toContain('if (!isTransientPublicError(error)) console.error("marca_nerqia_de_tienda", error);');
  });
});

describe("analítica de búsqueda", () => {
  it("registra con resultados una vez por término y nunca las vacías", () => {
    const enviados = new Set<string>();
    expect(debeRegistrarConResultados("Taladro", 3, enviados)).toBe("taladro");
    expect(debeRegistrarConResultados("taladro", 0, enviados)).toBeNull();
    enviados.add("taladro");
    expect(debeRegistrarConResultados("TALADRO", 5, enviados)).toBeNull();
    expect(debeRegistrarConResultados("a", 5, new Set())).toBeNull();
  });

  it("resume total, sin resultados, clics y lo más buscado sumando los días", () => {
    const r = resumenDeBusquedas(
      [
        { termino: "taladro", veces: 6, con_clic: 3 },
        { termino: "taladro", veces: 4, con_clic: 2 },
        { termino: "pintura", veces: 5, con_clic: 0 },
      ],
      [{ termino: "amoladora", veces: 5 }],
    );
    expect(r.total).toBe(20);
    expect(r.sinResultado).toBe(5);
    expect(r.pctSinResultado).toBe(25);
    expect(r.pctConClic).toBe(33);
    expect(r.top).toEqual([
      { termino: "taladro", veces: 10, con_clic: 5 },
      { termino: "pintura", veces: 5, con_clic: 0 },
    ]);
  });

  it("sin búsquedas no inventa porcentajes y nunca cuenta más clics que búsquedas", () => {
    expect(resumenDeBusquedas([], [])).toMatchObject({ total: 0, pctSinResultado: null, pctConClic: null });
    expect(resumenDeBusquedas([{ termino: "x y", veces: 1, con_clic: 4 }], []).pctConClic).toBe(100);
  });

  it("la tienda registra búsquedas y clics y el panel muestra el resumen", () => {
    const tienda = readFileSync(resolve(process.cwd(), "src/storefront/StoreProducts.tsx"), "utf8");
    const tarjeta = readFileSync(resolve(process.cwd(), "src/components/ecommerce/BusquedasSinResultado.tsx"), "utf8");
    const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20261011000700_analitica_de_busqueda.sql"), "utf8");
    expect(tienda).toContain('recordStoreSearch(slugTienda, termino, "busqueda")');
    expect(tienda).toContain('recordStoreSearch(slugTienda, termino, "clic")');
    expect(tienda).toContain("onClickCapture={alAbrirDesdeBusqueda}");
    expect(tarjeta).toContain("resumenDeBusquedas(");
    expect(migration).toContain("REVOKE ALL ON FUNCTION public._busqueda_de_tienda(text, text) FROM PUBLIC, anon, authenticated;");
    expect(migration).toContain("REVOKE INSERT, UPDATE, DELETE ON public.store_busquedas FROM authenticated;");
  });
});
