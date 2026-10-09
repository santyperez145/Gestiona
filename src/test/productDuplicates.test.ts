import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { claveNombre, detectarDuplicados } from "@/lib/productDuplicates";
import { posProductIsSellable } from "@/lib/posCatalog";

const p = (id: string, campos: Record<string, unknown> = {}) => ({ id, name: `Producto ${id}`, ...campos });

describe("detección de productos duplicados", () => {
  it("agrupa por SKU, código de barras o alternativo sin distinguir mayúsculas", () => {
    const grupos = detectarDuplicados([
      p("1", { sku: "TOR-6" }), p("2", { sku: "tor-6 " }),
      p("3", { barcode: "779001" }), p("4", { barcode_aliases: ["779001"] }),
      p("5", { sku: "UNICO" }),
    ]);
    expect(grupos.map(g => g.productos.map(x => x.id).sort())).toEqual([["1", "2"], ["3", "4"]]);
    expect(grupos.every(g => g.motivo === "codigo")).toBe(true);
  });

  it("agrupa por nombre y marca ignorando tildes, espacios y signos", () => {
    expect(claveNombre({ name: "Tornillo 6 mm", brand: "Fischer" })).toBe(claveNombre({ name: "tornillo 6mm", brand: "FÍSCHER" }));
    const grupos = detectarDuplicados([p("a", { name: "Tornillo 6 mm", brand: "Fischer" }), p("b", { name: "tornillo 6mm", brand: "fischer" }), p("c", { name: "Tornillo 6mm", brand: "Otra" })]);
    expect(grupos).toHaveLength(1);
    expect(grupos[0]).toMatchObject({ motivo: "nombre" });
    expect(grupos[0].productos.map(x => x.id)).toEqual(["a", "b"]);
  });

  it("une cadenas transitivas y no incluye archivados", () => {
    const grupos = detectarDuplicados([p("1", { sku: "A" }), p("2", { sku: "a", barcode: "X" }), p("3", { barcode: "x" }), p("4", { sku: "A", is_active: false })]);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].productos.map(x => x.id)).toEqual(["1", "2", "3"]);
  });

  it("sugiere conservar el más vendido, luego el de más stock, luego el más antiguo", () => {
    expect(detectarDuplicados([p("1", { sku: "A", total_sold: 2 }), p("2", { sku: "A", total_sold: 9 })])[0].sugerido).toBe("2");
    expect(detectarDuplicados([p("1", { sku: "A", stock: 1 }), p("2", { sku: "A", stock: 5 })])[0].sugerido).toBe("2");
    expect(detectarDuplicados([p("1", { sku: "A", created_at: "2026-02-01" }), p("2", { sku: "A", created_at: "2026-01-01" })])[0].sugerido).toBe("2");
  });

  it("procesa 11.000 productos rápido", () => {
    const productos = Array.from({ length: 11_000 }, (_, i) => p(String(i), { sku: `S${i % 10_500}`, name: `Producto ${i}`, brand: "M" }));
    const inicio = performance.now();
    expect(detectarDuplicados(productos)).toHaveLength(500);
    expect(performance.now() - inicio).toBeLessThan(500);
  });

  it("el POS no vende productos archivados", () => {
    expect(posProductIsSellable({ is_active: false, maneja_stock: false })).toBe(false);
    expect(posProductIsSellable({ is_active: true, stock: 1 })).toBe(true);
  });

  it("la unificación va por la RPC transaccional", () => {
    const dialog = readFileSync("src/components/products/ProductDuplicatesDialog.tsx", "utf8");
    expect(dialog).toContain('supabase.rpc("unificar_productos"');
    expect(dialog).not.toMatch(/from\(["']products["']\)\.delete/);
  });
});
