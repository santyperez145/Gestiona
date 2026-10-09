import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buscarLiteral, camposProducto, crearIndiceBusqueda } from "@/lib/catalogSearch";
import { literalFilter } from "@/lib/searchText";

const productos = [
  { id: "1", name: "Taladro Percutor 13mm", brand: "Bosch", sku: "TP-13", barcode: "779001", barcode_aliases: ["ALT-9"] },
  { id: "2", name: "Árbol de levas", brand: "Ácme", sku: null, barcode: null, barcode_aliases: [] },
  { id: "3", name: "Taladro inalámbrico", brand: "Makita", sku: "MK-1", barcode: null, barcode_aliases: null },
];

describe("búsqueda literal indexada", () => {
  const indice = crearIndiceBusqueda(productos, p => camposProducto(p));

  it("exige todos los términos, sin tildes ni mayúsculas", () => {
    expect(buscarLiteral(indice, "taladro bosch").map(p => p.id)).toEqual(["1"]);
    expect(buscarLiteral(indice, "ARBOL acme").map(p => p.id)).toEqual(["2"]);
    expect(buscarLiteral(indice, "taladro").map(p => p.id)).toEqual(["1", "3"]);
  });

  it("encuentra por SKU y por código alternativo", () => {
    expect(buscarLiteral(indice, "mk-1").map(p => p.id)).toEqual(["3"]);
    expect(buscarLiteral(indice, "alt-9").map(p => p.id)).toEqual(["1"]);
  });

  it("una consulta vacía no devuelve nada", () => {
    expect(buscarLiteral(indice, "   ")).toEqual([]);
  });

  it("coincide con la regla de literalFilter", () => {
    for (const q of ["taladro", "bosch 13", "levas", "makita taladro", "zz"]) {
      expect(buscarLiteral(indice, q)).toEqual(literalFilter(productos, q, camposProducto));
    }
  });

  it("busca en 11.000 productos en pocos milisegundos tras indexar una vez", () => {
    const grandes = Array.from({ length: 11_000 }, (_, i) => ({ name: `Producto ${i} tornillo`, brand: `Marca ${i % 300}`, sku: `SKU-${i}`, barcode: null, barcode_aliases: [] }));
    const idx = crearIndiceBusqueda(grandes, camposProducto);
    const inicio = performance.now();
    for (let n = 0; n < 20; n += 1) buscarLiteral(idx, "tornillo marca 12");
    expect((performance.now() - inicio) / 20).toBeLessThan(25);
  });

  it("el POS no reconstruye el índice difuso en cada tecla ni dibuja todo el catálogo", () => {
    const pos = readFileSync("src/pages/POSPage.tsx", "utf8");
    expect(pos).toContain("useDeferredValue(search)");
    expect(pos).toContain("gridProducts.map((prod)");
    expect(pos).not.toMatch(/const filtered = useMemo\(\(\) => \{[\s\S]{0,600}new FuseClass/);
    expect(pos).not.toContain("supabase.from('sales').select('product_id, quantity')");
  });
});
