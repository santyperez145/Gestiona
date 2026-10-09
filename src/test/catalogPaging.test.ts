import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { paginarPorMarca, PRODUCTOS_POR_PAGINA } from "@/lib/catalogPaging";

const producto = (i: number, brand: string | null, stock = 1) => ({ id: `p${i}`, brand, stock });

describe("paginación del catálogo", () => {
  it("una marca enorme no dibuja más de una página de filas", () => {
    const productos = Array.from({ length: 11_000 }, (_, i) => producto(i, i < 8_000 ? null : `Marca ${i % 300}`));
    const pagina = paginarPorMarca(productos, 0);
    const filas = pagina.grupos.reduce((s, g) => s + g.items.length, 0);
    expect(filas).toBe(PRODUCTOS_POR_PAGINA);
    expect(pagina.totalPaginas).toBe(Math.ceil(11_000 / PRODUCTOS_POR_PAGINA));
    expect(pagina.ordenados).toHaveLength(11_000);
  });

  it("agrupa sin distinguir mayúsculas, conserva la primera grafía y el orden recibido", () => {
    const pagina = paginarPorMarca([producto(1, "bosch"), producto(2, "Acme"), producto(3, "BOSCH"), producto(4, "")], 0);
    expect(pagina.grupos.map(g => [g.marca, g.items.map(i => i.id)])).toEqual([
      ["Acme", ["p2"]],
      ["bosch", ["p1", "p3"]],
      ["Sin marca", ["p4"]],
    ]);
  });

  it("los totales de la marca cubren todo el filtro aunque continúe en otra página", () => {
    const productos = Array.from({ length: 5 }, (_, i) => producto(i, "Única", 2));
    const primera = paginarPorMarca(productos, 0, 3);
    const segunda = paginarPorMarca(productos, 1, 3);
    expect(primera.grupos[0]).toMatchObject({ total: 5, stockTotal: 10 });
    expect(primera.grupos[0].items).toHaveLength(3);
    expect(segunda.grupos[0].items).toHaveLength(2);
  });

  it("acota una página fuera de rango y nunca devuelve cero páginas", () => {
    expect(paginarPorMarca([producto(1, "A")], 9).pagina).toBe(0);
    expect(paginarPorMarca([], 0)).toMatchObject({ totalPaginas: 1, grupos: [], pagina: 0 });
  });

  it("es lineal: 11.000 productos y 2.000 marcas se agrupan rápido", () => {
    const productos = Array.from({ length: 11_000 }, (_, i) => producto(i, `Marca ${i % 2000}`));
    const inicio = performance.now();
    paginarPorMarca(productos, 3);
    expect(performance.now() - inicio).toBeLessThan(250);
  });

  it("Productos no vuelve a renderizar el catálogo entero", () => {
    const page = readFileSync("src/pages/ProductsPage.tsx", "utf8");
    expect(page).not.toContain("Object.keys(acc).find");
    expect(page).not.toMatch(/\{filteredSorted\.map\(\(p: any\) => \(/);
    expect(page).toContain("useDeferredValue(search)");
  });
});
