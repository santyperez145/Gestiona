import { describe, it, expect } from "vitest";
import {
  MODELOS, redondearPeso, pesoEstimadoKg, planDePesos, diferenciaContraDefault,
  type ProductoParaPesar,
} from "@/lib/weightEstimate";

describe("pesoEstimadoKg", () => {
  it("un perfume de 100 ml encajado da alrededor de 0,4 kg", () => {
    // Es el caso real: 54 de los 60 productos activos son de 100 ml.
    expect(pesoEstimadoKg("perfume_arabe", 100)).toBe(0.4);
    expect(pesoEstimadoKg("perfume_diseñador", 100)).toBe(0.4);
  });

  it("el peso crece con el contenido", () => {
    const p30 = pesoEstimadoKg("perfume_arabe", 30)!;
    const p50 = pesoEstimadoKg("perfume_arabe", 50)!;
    const p100 = pesoEstimadoKg("perfume_arabe", 100)!;
    expect(p30).toBeLessThan(p50);
    expect(p50).toBeLessThan(p100);
  });

  it("un vaper pesa mucho menos que un perfume del mismo contenido", () => {
    // Plástico y batería contra vidrio grueso: el envase manda.
    expect(pesoEstimadoKg("vaper", 100)!).toBeLessThan(pesoEstimadoKg("perfume_arabe", 100)!);
  });

  it("devuelve null cuando no hay con qué estimar, en vez de inventar", () => {
    // Un número inventado sería volver al problema de origen con otra cara.
    expect(pesoEstimadoKg("electronico", 100)).toBeNull();
    expect(pesoEstimadoKg("categoria_nueva", 100)).toBeNull();
    expect(pesoEstimadoKg("perfume_arabe", null)).toBeNull();
    expect(pesoEstimadoKg("perfume_arabe", 0)).toBeNull();
    expect(pesoEstimadoKg(null, 100)).toBeNull();
  });

  it("aguanta un ml que llega como texto o basura", () => {
    expect(pesoEstimadoKg("perfume_arabe", "100" as unknown as number)).toBe(0.4);
    expect(pesoEstimadoKg("perfume_arabe", "x" as unknown as number)).toBeNull();
    expect(pesoEstimadoKg("perfume_arabe", -50)).toBeNull();
  });

  it("todo modelo tiene base y coeficiente positivos", () => {
    for (const m of Object.values(MODELOS)) {
      expect(m.base).toBeGreaterThan(0);
      expect(m.porMl).toBeGreaterThan(0);
    }
  });
});

describe("redondearPeso", () => {
  it("redondea a 50 g: el modelo no da para más precisión", () => {
    expect(redondearPeso(0.4)).toBe(0.4);
    expect(redondearPeso(0.417)).toBe(0.4);
    expect(redondearPeso(0.43)).toBe(0.45);
    expect(redondearPeso(0.176)).toBe(0.2);
  });
});

describe("planDePesos", () => {
  const productos: ProductoParaPesar[] = [
    { id: "a", name: "LATTAFA 100ml", category: "perfume_arabe", content_ml: 100, weight_kg: 0 },
    { id: "b", name: "AFNAN 100ml", category: "perfume_arabe", content_ml: 100, weight_kg: null },
    { id: "c", name: "Pesado a mano", category: "perfume_arabe", content_ml: 100, weight_kg: 0.42 },
    { id: "d", name: "Cargador", category: "electronico", content_ml: 1, weight_kg: 0 },
    { id: "e", name: "Vaper", category: "vaper", content_ml: 50, weight_kg: 0 },
  ];

  it("propone sólo los que no tienen peso y se pueden estimar", () => {
    const plan = planDePesos(productos);
    expect(plan.aplicar.map(p => p.id)).toEqual(["a", "b", "e"]);
  });

  it("no pisa un peso cargado a mano: alguien lo pesó y vale más que el modelo", () => {
    const plan = planDePesos(productos);
    expect(plan.yaTenian.map(p => p.id)).toContain("c");
    expect(plan.aplicar.map(p => p.id)).not.toContain("c");
  });

  it("con pisarExistentes sí lo recalcula", () => {
    const plan = planDePesos(productos, { pisarExistentes: true });
    expect(plan.aplicar.map(p => p.id)).toContain("c");
    expect(plan.aplicar.find(p => p.id === "c")!.actual).toBe(0.42);
  });

  it("los que no se pueden estimar se muestran aparte, no se esconden", () => {
    const plan = planDePesos(productos);
    expect(plan.sinModelo.map(p => p.id)).toEqual(["d"]);
  });

  it("no manda a la base un cambio que no cambia nada", () => {
    // 0,4 estimado sobre 0,4 ya cargado: escribirlo sería ruido en el historial.
    const plan = planDePesos(
      [{ id: "x", category: "perfume_arabe", content_ml: 100, weight_kg: 0.4 }],
      { pisarExistentes: true },
    );
    expect(plan.aplicar).toEqual([]);
    expect(plan.yaTenian.map(p => p.id)).toEqual(["x"]);
  });

  it("una lista vacía da un plan vacío, no rompe", () => {
    const plan = planDePesos([]);
    expect(plan.aplicar).toEqual([]);
    expect(plan.sinModelo).toEqual([]);
  });
});

describe("diferenciaContraDefault", () => {
  it("separa las dos direcciones, porque no son el mismo problema", () => {
    // De más = ventas perdidas por envío caro. De menos = margen perdido.
    // Un neto escondería cuál de las dos está pasando.
    const d = diferenciaContraDefault([
      { id: "a", name: "", actual: 0, estimado: 0.9 },   // 0,4 de menos
      { id: "b", name: "", actual: 0, estimado: 0.2 },   // 0,3 de más
      { id: "c", name: "", actual: 0, estimado: 1.5 },   // 1,0 de menos
    ]);
    expect(d.deMenos).toBe(1.4);
    expect(d.deMas).toBe(0.3);
  });

  it("el caso real del catálogo: todo pesa menos que el default", () => {
    // 55 perfumes de 0,40 contra un default de 0,50: la tienda cotiza de más.
    const perfumes = Array.from({ length: 5 }, (_, i) => ({
      id: String(i), name: "", actual: 0, estimado: 0.4,
    }));
    const d = diferenciaContraDefault(perfumes);
    expect(d.deMas).toBe(0.5);
    expect(d.deMenos).toBe(0);
  });

  it("respeta un peso por defecto distinto", () => {
    const d = diferenciaContraDefault([{ id: "a", name: "", actual: 0, estimado: 1 }], 0.3);
    expect(d.deMenos).toBe(0.7);
    expect(d.deMas).toBe(0);
  });

  it("una lista vacía da cero en las dos direcciones", () => {
    expect(diferenciaContraDefault([])).toEqual({ deMas: 0, deMenos: 0 });
  });
});
