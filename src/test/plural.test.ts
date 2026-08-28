import { describe, it, expect } from "vitest";
import { plural, palabra } from "@/lib/plural";

/**
 * ⚠️ Medido en producción el 2026-08-28: el Dashboard decía «1 productos con
 * margen < 30%» y Gastos, «1 gastos». En la tienda ya se habían corregido tres
 * iguales, entre ellos «¡Últimas 1 unidades!».
 */
describe("plural", () => {
  it("uno va en singular", () => {
    expect(plural(1, "producto")).toBe("1 producto");
    expect(plural(1, "gasto")).toBe("1 gasto");
  });

  it("cero y muchos van en plural", () => {
    // ⚠️ El cero es plural en castellano: «0 productos», no «0 producto».
    expect(plural(0, "producto")).toBe("0 productos");
    expect(plural(2, "producto")).toBe("2 productos");
    expect(plural(34, "venta")).toBe("34 ventas");
  });

  it("el plural irregular se pasa, no se adivina", () => {
    /**
     * 📌 Agregar «s» a ciegas da «ordens», «mess» y «categorías» mal formadas.
     * Es peor que el bug que esto viene a arreglar, porque suena a error de
     * quien escribió el sistema y no a un descuido.
     */
    expect(plural(1, "orden", "órdenes")).toBe("1 orden");
    expect(plural(5, "orden", "órdenes")).toBe("5 órdenes");
    expect(plural(1, "mes", "meses")).toBe("1 mes");
    expect(plural(3, "mes", "meses")).toBe("3 meses");
    expect(plural(2, "categoría", "categorías")).toBe("2 categorías");
  });

  it("un negativo también es singular en valor absoluto", () => {
    // Aparece en variaciones y diferencias: «−1 producto», no «−1 productos».
    expect(plural(-1, "producto")).toBe("-1 producto");
    expect(plural(-3, "producto")).toBe("-3 productos");
  });

  it("`palabra` da sólo el sustantivo, para las tarjetas de KPI", () => {
    // El número va grande arriba y la etiqueta debajo: ahí no se repite.
    expect(palabra(1, "venta")).toBe("venta");
    expect(palabra(9, "venta")).toBe("ventas");
    expect(palabra(1, "orden", "órdenes")).toBe("orden");
  });
});
