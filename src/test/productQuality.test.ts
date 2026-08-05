import { describe, it, expect } from "vitest";
import {
  REGLAS, PUNTAJE_MAXIMO, evaluarProducto, resumirCatalogo, tonoDeNivel,
  type ProductoParaEvaluar,
} from "@/lib/productQuality";

/** Un producto que cumple todo, para ir rompiéndolo de a una cosa. */
const completo: ProductoParaEvaluar = {
  id: "1",
  name: "LATTAFA ASAD",
  image_url: "https://x/a.jpg",
  image_urls: ["https://x/a.jpg", "https://x/b.jpg"],
  description: "x".repeat(120),
  brand: "LATTAFA",
  category: "perfume_arabe",
  gender: "masculino",
  sale_price_ars: 69258,
  weight_kg: 0.4,
  sku: "LAT-ASAD-100",
  tags: ["arabe", "nocturno"],
  tiene_ficha: true,
};

describe("las reglas", () => {
  it("suman 100 puntos: si no, el puntaje deja de ser un porcentaje", () => {
    expect(PUNTAJE_MAXIMO).toBe(100);
  });

  it("cada regla explica qué pasa si falta", () => {
    // Una lista de campos vacíos no se completa nunca; una lista que dice qué
    // se pierde, sí.
    for (const r of REGLAS) expect(r.porque.length).toBeGreaterThan(20);
  });

  it("no hay dos reglas con el mismo id", () => {
    expect(new Set(REGLAS.map(r => r.id)).size).toBe(REGLAS.length);
  });

  it("la foto pesa más que todo lo demás junto de lo administrativo", () => {
    const foto = REGLAS.find(r => r.id === "foto")!.puntos;
    const admin = REGLAS.filter(r => ["sku", "etiquetas", "marca", "categoria"].includes(r.id))
      .reduce((s, r) => s + r.puntos, 0);
    expect(foto).toBeGreaterThan(admin);
  });
});

describe("evaluarProducto", () => {
  it("un producto completo da 100", () => {
    const ev = evaluarProducto(completo);
    expect(ev.puntaje).toBe(100);
    expect(ev.faltantes).toEqual([]);
    expect(ev.nivel).toBe("completa");
  });

  it("un producto vacío da 0 y lista todo lo que falta", () => {
    const ev = evaluarProducto({});
    expect(ev.puntaje).toBe(0);
    expect(ev.faltantes).toHaveLength(REGLAS.length);
    expect(ev.nivel).toBe("incompleta");
  });

  it("sin foto pierde 25 puntos", () => {
    const ev = evaluarProducto({ ...completo, image_url: null, image_urls: null });
    // Se caen "foto" (25) y "al menos 2 fotos" (10): sin ninguna, tampoco hay dos.
    expect(ev.puntaje).toBe(65);
    expect(ev.faltantes[0].id).toBe("foto");
  });

  it("una foto sola cumple la principal pero no la segunda", () => {
    const ev = evaluarProducto({ ...completo, image_urls: ["https://x/a.jpg"] });
    expect(ev.items.find(i => i.id === "foto")!.cumple).toBe(true);
    expect(ev.items.find(i => i.id === "fotos_extra")!.cumple).toBe(false);
  });

  it("una foto en image_urls sin image_url cuenta igual", () => {
    // Los productos viejos tienen `image_url`; los nuevos, `image_urls`.
    const ev = evaluarProducto({ image_urls: ["https://x/a.jpg"] });
    expect(ev.items.find(i => i.id === "foto")!.cumple).toBe(true);
  });

  it("una descripción corta no cuenta", () => {
    expect(evaluarProducto({ ...completo, description: "Rico" }).puntaje).toBe(85);
  });

  it("los espacios en blanco no cuentan como contenido", () => {
    const ev = evaluarProducto({ ...completo, brand: "   ", sku: "  ", description: " ".repeat(200) });
    expect(ev.items.find(i => i.id === "brand" as never)).toBeUndefined();
    expect(ev.items.find(i => i.id === "marca")!.cumple).toBe(false);
    expect(ev.items.find(i => i.id === "sku")!.cumple).toBe(false);
    expect(ev.items.find(i => i.id === "descripcion")!.cumple).toBe(false);
  });

  it("el peso en cero es lo mismo que sin peso", () => {
    // Es el caso real: 59 de 60 productos vienen con 0 o null.
    expect(evaluarProducto({ ...completo, weight_kg: 0 }).items.find(i => i.id === "peso")!.cumple).toBe(false);
    expect(evaluarProducto({ ...completo, weight_kg: null }).items.find(i => i.id === "peso")!.cumple).toBe(false);
  });

  it("los faltantes vienen ordenados por impacto, no por orden de la lista", () => {
    const ev = evaluarProducto({ ...completo, sku: null, image_url: null, image_urls: null });
    expect(ev.faltantes.map(f => f.id)).toEqual(["foto", "fotos_extra", "sku"]);
  });

  it("los niveles cortan donde dicen", () => {
    expect(evaluarProducto(completo).nivel).toBe("completa");
    // 100 - 15 (peso) = 85 → buena
    expect(evaluarProducto({ ...completo, weight_kg: 0 }).nivel).toBe("buena");
    // 85 - 25 - 10 = 50 → aceptable
    expect(evaluarProducto({ ...completo, weight_kg: 0, image_url: null, image_urls: null }).nivel).toBe("aceptable");
  });

  it("aguanta campos que llegan con el tipo equivocado", () => {
    const raro = {
      image_urls: "no-es-un-array" as unknown as string[],
      tags: null,
      sale_price_ars: "0" as unknown as number,
    };
    expect(() => evaluarProducto(raro)).not.toThrow();
    expect(evaluarProducto(raro).items.find(i => i.id === "precio")!.cumple).toBe(false);
  });
});

describe("resumirCatalogo", () => {
  // Reproduce el estado real medido en producción: casi todo sin peso, unos
  // pocos sin foto.
  const catalogo: ProductoParaEvaluar[] = [
    ...Array.from({ length: 50 }, (_, i) => ({ ...completo, id: `c${i}`, weight_kg: 0, sku: null })),
    ...Array.from({ length: 10 }, (_, i) => ({
      ...completo, id: `s${i}`, weight_kg: 0, sku: null, image_url: null, image_urls: null,
    })),
  ];

  it("prioriza por impacto total, no por cuántos productos lo tienen mal", () => {
    // El peso le falta a los 60 y el SKU también, pero el peso vale 15 y el
    // SKU 2: cargar 60 SKUs es más trabajo y rinde menos.
    const r = resumirCatalogo(catalogo);
    expect(r.ranking[0].id).toBe("peso");
    const sku = r.ranking.find(x => x.id === "sku")!;
    const foto = r.ranking.find(x => x.id === "foto")!;
    expect(sku.productos).toBe(60);
    expect(foto.productos).toBe(10);
    // 10 fotos rinden más que 60 SKUs.
    expect(foto.puntosTotales).toBeGreaterThan(sku.puntosTotales);
  });

  it("cuenta bien cuántos productos tiene cada faltante", () => {
    const r = resumirCatalogo(catalogo);
    expect(r.productos).toBe(60);
    expect(r.ranking.find(x => x.id === "peso")!.productos).toBe(60);
  });

  it("el promedio refleja el catálogo, no el primer producto", () => {
    const r = resumirCatalogo(catalogo);
    // 50 en 83 (sin peso ni sku) y 10 en 48 (además sin fotos).
    expect(r.puntajePromedio).toBeGreaterThan(48);
    expect(r.puntajePromedio).toBeLessThan(83);
  });

  it("cuenta las incompletas, que son las de mirar hoy", () => {
    expect(resumirCatalogo(catalogo).incompletas).toBe(10);
  });

  it("un catálogo vacío no rompe ni divide por cero", () => {
    const r = resumirCatalogo([]);
    expect(r.puntajePromedio).toBe(0);
    expect(r.ranking).toEqual([]);
  });

  it("un catálogo perfecto no propone nada", () => {
    const r = resumirCatalogo([completo, completo]);
    expect(r.puntajePromedio).toBe(100);
    expect(r.ranking).toEqual([]);
  });
});

describe("tonoDeNivel", () => {
  it("da un color distinto por nivel", () => {
    const tonos = (["completa", "buena", "aceptable", "incompleta"] as const).map(tonoDeNivel);
    expect(new Set(tonos).size).toBe(4);
  });
});
