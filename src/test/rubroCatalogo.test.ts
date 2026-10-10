import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { camposDelRubro } from "@/lib/rubroCampos";

describe("el catálogo sigue al rubro del comercio", () => {
  it("una ferretería no ve género ni mililitros; una perfumería sí", () => {
    expect(camposDelRubro("ferreteria")).toEqual({ genero: false, contenidoMl: false });
    expect(camposDelRubro("otro")).toEqual({ genero: false, contenidoMl: false });
    expect(camposDelRubro("perfumes")).toEqual({ genero: true, contenidoMl: true });
    expect(camposDelRubro("indumentaria").genero).toBe(true);
    // Un tipo de producto concreto abre su ficha aunque el rubro sea otro.
    expect(camposDelRubro("ferreteria", { perfume: true }).genero).toBe(true);
  });

  it("la ficha oculta los campos que el rubro no usa", () => {
    const page = readFileSync("src/pages/ProductsPage.tsx", "utf8");
    expect(page).toContain("{campos.genero && <div><label");
    expect(page).toContain("{campos.contenidoMl && !fichaTecnologia");
  });

  it("las altas entran categorizadas y nada se manda a «otro»", () => {
    const sql = readFileSync("supabase/migrations/20261010001000_categorias_por_rubro.sql", "utf8");
    expect(sql).toContain("BEFORE INSERT ON public.products");
    expect(sql).toContain("slug := 'varios'; nombre := 'Varios';");
    expect(sql).toContain("INSERT INTO public.categorizacion_cambios");
  });

  it("borrar un producto con ventas no intenta devolverle stock", () => {
    const sql = readFileSync("supabase/migrations/20261010000950_borrar_producto_con_ventas.sql", "utf8");
    expect(sql).toContain("AND EXISTS (SELECT 1 FROM public.products p WHERE p.id = OLD.product_id)");
  });

  it("el borrado masivo va por lotes y avisa el resultado en pantalla", () => {
    const store = readFileSync("src/lib/supabaseStore.ts", "utf8");
    expect(store).toContain(".delete().in('id', lote)");
    const page = readFileSync("src/pages/ProductsPage.tsx", "utf8");
    expect(page).toContain("toast.loading(`Eliminando");
  });
});
