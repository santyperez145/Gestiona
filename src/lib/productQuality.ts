/**
 * Calidad de la publicación.
 *
 * Es la herramienta de merchandising más conocida de MercadoLibre y Tiendanube
 * no la tiene: en vez de un catálogo donde todo se ve igual, le dice al
 * comercio qué le falta a cada producto **y en qué orden conviene arreglarlo**.
 *
 * No es una idea abstracta. Medido contra la base de producción hoy:
 *
 *   - 10 de 60 productos activos **no tienen foto** y están publicados.
 *   - 59 de 60 **no tienen peso**, así que el envío se cotiza con el peso por
 *     defecto (0,5 kg) y cada despacho más pesado se cobra de menos. Ése es el
 *     único ítem de esta lista que cuesta plata en cada venta, no ventas
 *     perdidas: por eso pesa como pesa.
 *   - 33 de 60 tienen una descripción de menos de 80 caracteres.
 *
 * Los pesos salen de cuánto mueve la aguja cada cosa en una tienda online, no
 * de cuánto cuesta completarla. Sin foto no se vende: eso solo vale un cuarto
 * del puntaje.
 */

export interface ProductoParaEvaluar {
  id?: string;
  name?: string | null;
  image_url?: string | null;
  image_urls?: string[] | null;
  description?: string | null;
  brand?: string | null;
  category?: string | null;
  gender?: string | null;
  sale_price_ars?: number | null;
  weight_kg?: number | null;
  sku?: string | null;
  tags?: string[] | null;
  is_active?: boolean | null;
  /** ¿Tiene la ficha técnica cargada con algo? (perfumes) */
  tiene_ficha?: boolean;
}

export type ImpactoId =
  | "foto" | "fotos_extra" | "descripcion" | "precio" | "peso"
  | "marca" | "categoria" | "ficha" | "sku" | "etiquetas";

export interface ReglaCalidad {
  id: ImpactoId;
  label: string;
  /** Qué pasa si falta. Es lo que convierte la lista en algo que se usa. */
  porque: string;
  puntos: number;
  cumple: (p: ProductoParaEvaluar) => boolean;
}

const texto = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export const REGLAS: ReglaCalidad[] = [
  {
    id: "foto",
    label: "Foto principal",
    porque: "Un producto sin foto no se vende: en el catálogo ocupa lugar y nadie lo abre.",
    puntos: 25,
    cumple: p => texto(p.image_url) !== "" || lista(p.image_urls).length > 0,
  },
  {
    id: "descripcion",
    label: "Descripción de al menos 80 caracteres",
    porque: "Es lo que contesta la duda antes de que la pregunten, y es lo que lee Google.",
    puntos: 15,
    cumple: p => texto(p.description).length >= 80,
  },
  {
    id: "peso",
    label: "Peso del producto",
    porque: "Sin peso el envío se cotiza con el valor por defecto y cada despacho más pesado se cobra de menos. Es el único de esta lista que cuesta plata en cada venta.",
    puntos: 15,
    cumple: p => (Number(p.weight_kg) || 0) > 0,
  },
  {
    id: "fotos_extra",
    label: "Al menos 2 fotos",
    porque: "La segunda foto —el frasco de atrás, la caja— es la que saca la duda de si es original.",
    puntos: 10,
    cumple: p => lista(p.image_urls).length >= 2,
  },
  {
    id: "precio",
    label: "Precio de venta cargado",
    porque: "Con precio en cero la tienda lo muestra gratis o lo esconde, según la pantalla.",
    puntos: 10,
    cumple: p => (Number(p.sale_price_ars) || 0) > 0,
  },
  {
    id: "ficha",
    label: "Ficha técnica",
    porque: "Familia olfativa, duración y notas: es lo que decide la compra de un perfume que no se puede oler.",
    puntos: 10,
    cumple: p => p.tiene_ficha === true,
  },
  {
    id: "marca",
    label: "Marca",
    porque: "La mitad de las búsquedas de perfume arrancan por la marca.",
    puntos: 5,
    cumple: p => texto(p.brand) !== "",
  },
  {
    id: "categoria",
    label: "Categoría",
    porque: "Sin categoría no aparece en los filtros del catálogo ni en la home.",
    puntos: 5,
    cumple: p => texto(p.category) !== "",
  },
  {
    id: "etiquetas",
    label: "Etiquetas",
    porque: "Son lo que permite armar una colección o una promoción sin elegir producto por producto.",
    puntos: 3,
    cumple: p => lista(p.tags).length > 0,
  },
  {
    id: "sku",
    label: "Código interno (SKU)",
    porque: "Sin SKU no se puede importar stock ni cruzar contra una orden de compra.",
    puntos: 2,
    cumple: p => texto(p.sku) !== "",
  },
];

/** Suma de todos los puntos posibles. Se calcula, no se escribe a mano. */
export const PUNTAJE_MAXIMO = REGLAS.reduce((s, r) => s + r.puntos, 0);

export interface ItemEvaluado {
  id: ImpactoId;
  label: string;
  porque: string;
  puntos: number;
  cumple: boolean;
}

export interface Evaluacion {
  puntaje: number;
  /** Lo que falta, de mayor a menor impacto. */
  faltantes: ItemEvaluado[];
  items: ItemEvaluado[];
  nivel: "incompleta" | "aceptable" | "buena" | "completa";
}

/** El nivel de un puntaje suelto — sirve para el promedio del catálogo. */
export function nivelDePuntaje(puntaje: number): Evaluacion["nivel"] {
  return puntaje >= 95 ? "completa"
       : puntaje >= 75 ? "buena"
       : puntaje >= 50 ? "aceptable"
       : "incompleta";
}

export function evaluarProducto(p: ProductoParaEvaluar): Evaluacion {
  const items = REGLAS.map(r => ({
    id: r.id, label: r.label, porque: r.porque, puntos: r.puntos,
    cumple: r.cumple(p),
  }));

  const ganados = items.filter(i => i.cumple).reduce((s, i) => s + i.puntos, 0);
  const puntaje = Math.round((ganados / PUNTAJE_MAXIMO) * 100);

  return {
    puntaje,
    items,
    faltantes: items.filter(i => !i.cumple).sort((a, b) => b.puntos - a.puntos),
    nivel: nivelDePuntaje(puntaje),
  };
}

export interface FaltanteAgregado {
  id: ImpactoId;
  label: string;
  porque: string;
  /** Cuántos productos lo tienen sin completar. */
  productos: number;
  /** Puntos que se recuperan en todo el catálogo si se completa. */
  puntosTotales: number;
}

export interface ResumenCatalogo {
  productos: number;
  puntajePromedio: number;
  /** Los que ni siquiera llegan a la mitad: son los que hay que mirar hoy. */
  incompletas: number;
  /** Qué conviene arreglar primero, por impacto total y no por cantidad. */
  ranking: FaltanteAgregado[];
}

/**
 * Ordena los arreglos por **impacto total** (productos × puntos), no por
 * cuántos productos lo tienen mal. Cargarle el SKU a los 60 es más trabajo y
 * rinde menos que sacarle la foto a los 10 que no tienen.
 */
export function resumirCatalogo(productos: ProductoParaEvaluar[]): ResumenCatalogo {
  if (productos.length === 0) {
    return { productos: 0, puntajePromedio: 0, incompletas: 0, ranking: [] };
  }

  const evaluaciones = productos.map(evaluarProducto);
  const conteo = new Map<ImpactoId, FaltanteAgregado>();

  for (const ev of evaluaciones) {
    for (const f of ev.faltantes) {
      const actual = conteo.get(f.id) ?? {
        id: f.id, label: f.label, porque: f.porque, productos: 0, puntosTotales: 0,
      };
      actual.productos += 1;
      actual.puntosTotales += f.puntos;
      conteo.set(f.id, actual);
    }
  }

  return {
    productos: productos.length,
    puntajePromedio: Math.round(
      evaluaciones.reduce((s, e) => s + e.puntaje, 0) / evaluaciones.length,
    ),
    incompletas: evaluaciones.filter(e => e.nivel === "incompleta").length,
    ranking: [...conteo.values()].sort((a, b) => b.puntosTotales - a.puntosTotales),
  };
}

/** Color del semáforo, para que el puntaje se lea sin leerlo. */
export function tonoDeNivel(nivel: Evaluacion["nivel"]): string {
  switch (nivel) {
    case "completa":   return "text-emerald-400";
    case "buena":      return "text-blue-400";
    case "aceptable":  return "text-yellow-400";
    default:           return "text-red-400";
  }
}
