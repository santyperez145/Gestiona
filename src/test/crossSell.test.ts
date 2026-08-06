import { describe, it, expect } from "vitest";
import {
  sugerenciasParaElCarrito, TEXTO_MOTIVO, TOLERANCIA_ENVIO,
  type ProductoSugerible, type LineaDelCarrito,
} from "@/lib/crossSell";

const p = (over: Partial<ProductoSugerible> & { id: string; precio?: number }): ProductoSugerible & { precio: number } => ({
  name: over.id, brand: null, category: null, stock: 5, total_sold: 0, image_url: null,
  precio: 10_000, ...over,
} as ProductoSugerible & { precio: number });

const precioDe = (x: ProductoSugerible & { precio?: number }) => Number(x.precio) || 0;

const carrito = (id: string, price = 10_000, qty = 1): LineaDelCarrito =>
  ({ productId: id, price, qty });

describe("sugerenciasParaElCarrito", () => {
  it("con el carrito vacío no sugiere nada", () => {
    expect(sugerenciasParaElCarrito({
      cart: [], productos: [p({ id: "a" })], precioDe,
    })).toEqual([]);
  });

  it("nunca ofrece algo que ya está en el carrito", () => {
    const productos = [p({ id: "enCarrito" }), p({ id: "otro" })];
    const out = sugerenciasParaElCarrito({
      cart: [carrito("enCarrito")], productos, precioDe,
    });
    expect(out.map(s => s.producto.id)).not.toContain("enCarrito");
  });

  it("nunca ofrece algo sin stock: sugerir lo agotado es prometer y no cumplir", () => {
    const productos = [
      p({ id: "a" }),
      p({ id: "agotado", stock: 0 }),
      p({ id: "negativo", stock: -3 }),
    ];
    const ids = sugerenciasParaElCarrito({ cart: [carrito("a")], productos, precioDe })
      .map(s => s.producto.id);
    expect(ids).not.toContain("agotado");
    expect(ids).not.toContain("negativo");
  });

  it("ni algo con precio cero", () => {
    const productos = [p({ id: "a" }), p({ id: "sinPrecio", precio: 0 })];
    expect(sugerenciasParaElCarrito({ cart: [carrito("a")], productos, precioDe })
      .map(s => s.producto.id)).not.toContain("sinPrecio");
  });

  describe("el empujón del envío gratis", () => {
    const productos = [
      p({ id: "enCarrito", precio: 30_000 }),
      p({ id: "justo", precio: 20_000 }),
      p({ id: "barato", precio: 5_000 }),
      p({ id: "carisimo", precio: 200_000 }),
    ];

    it("prioriza el que completa el umbral, por encima de todo lo demás", () => {
      const out = sugerenciasParaElCarrito({
        cart: [carrito("enCarrito")], productos, precioDe, faltaEnvioGratis: 18_000,
      });
      expect(out[0].producto.id).toBe("justo");
      expect(out[0].motivo).toBe("envio_gratis");
      expect(out[0].faltaba).toBe(18_000);
    });

    it("no ofrece uno que se pasa por lejos: eso no completa nada", () => {
      // Un producto de $200.000 para un faltante de $18.000 no es completar el
      // envío, es intentar vender diez veces más caro.
      const out = sugerenciasParaElCarrito({
        cart: [carrito("enCarrito")], productos, precioDe, faltaEnvioGratis: 18_000,
      });
      expect(out.find(s => s.producto.id === "carisimo")?.motivo).not.toBe("envio_gratis");
    });

    it("no ofrece uno que no alcanza el umbral como si lo completara", () => {
      const out = sugerenciasParaElCarrito({
        cart: [carrito("enCarrito")], productos, precioDe, faltaEnvioGratis: 18_000,
      });
      expect(out.find(s => s.producto.id === "barato")?.motivo).not.toBe("envio_gratis");
    });

    it("respeta la tolerancia declarada", () => {
      const justoAlBorde = [
        p({ id: "c" }),
        p({ id: "borde", precio: 10_000 * TOLERANCIA_ENVIO }),
      ];
      const out = sugerenciasParaElCarrito({
        cart: [carrito("c")], productos: justoAlBorde, precioDe, faltaEnvioGratis: 10_000,
      });
      expect(out[0].motivo).toBe("envio_gratis");
    });

    it("sin envío gratis configurado no inventa el motivo", () => {
      const out = sugerenciasParaElCarrito({
        cart: [carrito("enCarrito")], productos, precioDe, faltaEnvioGratis: null,
      });
      expect(out.every(s => s.motivo !== "envio_gratis")).toBe(true);
    });

    it("si ya alcanzó el envío gratis tampoco", () => {
      const out = sugerenciasParaElCarrito({
        cart: [carrito("enCarrito")], productos, precioDe, faltaEnvioGratis: 0,
      });
      expect(out.every(s => s.motivo !== "envio_gratis")).toBe(true);
    });
  });

  describe("afinidad", () => {
    const productos = [
      p({ id: "enCarrito", brand: "LATTAFA", category: "perfume_arabe" }),
      p({ id: "mismaMarca", brand: "LATTAFA", category: "otra", precio: 8_000 }),
      p({ id: "mismaCat", brand: "OTRA", category: "perfume_arabe", precio: 9_000 }),
      p({ id: "ajeno", brand: "X", category: "y", precio: 1_000, total_sold: 999 }),
    ];

    it("la marca gana a la categoría, y las dos al más vendido", () => {
      const out = sugerenciasParaElCarrito({
        cart: [carrito("enCarrito")], productos, precioDe, limite: 3,
      });
      expect(out.map(s => s.producto.id)).toEqual(["mismaMarca", "mismaCat", "ajeno"]);
      expect(out.map(s => s.motivo)).toEqual(["misma_marca", "misma_categoria", "mas_vendido"]);
    });

    it("dentro de un motivo ofrece lo más barato: es un agregado, no un reemplazo", () => {
      const varios = [
        p({ id: "c", brand: "L" }),
        p({ id: "caro", brand: "L", precio: 50_000 }),
        p({ id: "barato", brand: "L", precio: 3_000 }),
      ];
      const out = sugerenciasParaElCarrito({ cart: [carrito("c")], productos: varios, precioDe });
      expect(out[0].producto.id).toBe("barato");
    });

    it("mira todas las líneas del carrito, no sólo la primera", () => {
      const dos = [
        p({ id: "uno", brand: "A" }),
        p({ id: "dos", brand: "B" }),
        p({ id: "deB", brand: "B", precio: 7_000 }),
      ];
      const out = sugerenciasParaElCarrito({
        cart: [carrito("uno"), carrito("dos")], productos: dos, precioDe,
      });
      expect(out[0].producto.id).toBe("deB");
    });
  });

  it("no repite un producto aunque encaje en dos motivos", () => {
    const productos = [
      p({ id: "c", brand: "L", category: "cat" }),
      p({ id: "ambos", brand: "L", category: "cat", precio: 20_000 }),
    ];
    const out = sugerenciasParaElCarrito({
      cart: [carrito("c")], productos, precioDe, faltaEnvioGratis: 18_000,
    });
    expect(out).toHaveLength(1);
    expect(out[0].motivo).toBe("envio_gratis");
  });

  it("respeta el límite", () => {
    const muchos = [p({ id: "c" }), ...Array.from({ length: 20 }, (_, i) => p({ id: `x${i}` }))];
    expect(sugerenciasParaElCarrito({ cart: [carrito("c")], productos: muchos, precioDe, limite: 2 }))
      .toHaveLength(2);
  });

  it("sin candidatos devuelve vacío en vez de romper", () => {
    expect(sugerenciasParaElCarrito({
      cart: [carrito("solo")], productos: [p({ id: "solo" })], precioDe,
    })).toEqual([]);
  });

  it("cada motivo tiene un texto para mostrar", () => {
    for (const t of Object.values(TEXTO_MOTIVO)) expect(t.length).toBeGreaterThan(5);
  });
});
