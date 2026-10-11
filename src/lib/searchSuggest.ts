/**
 * Sugerencias del buscador de la tienda.
 *
 * El buscador ya andaba, pero había que escribir, apretar Enter y esperar a que
 * cargue el catálogo para saber si existía lo que se buscaba. Las
 * plataformas de comercio muestran sugerencias mientras se tipea, y eso cambia dos cosas:
 * el que no sabe cómo se escribe "Khamrah" lo encuentra igual, y el que buscó
 * algo que no está se entera en el acto en vez de llegar a una página vacía.
 *
 * ── Qué se sugiere, y en qué orden ───────────────────────────────────────
 *
 * Primero **marcas y categorías**, porque son atajos a muchos productos: quien
 * escribe "lattafa" casi nunca quiere un perfume puntual, quiere ver la marca.
 * Después productos, y ahí manda que el término aparezca **al principio del
 * nombre** — buscar "asad" tiene que traer "ASAD ZANZIBAR" antes que
 * "LATTAFA ASAD".
 *
 * Todo se resuelve sobre el catálogo que ya está en memoria: no hay una
 * consulta más por tecla apretada.
 */
import { normalizeText, queryTokens, matchesAllTokens, matchesAllTokensAprox } from "./searchText";

export interface ProductoBuscable {
  id: string;
  name: string;
  brand?: string | null;
  category?: string | null;
  description?: string | null;
  stock?: number | null;
  image_url?: string | null;
  total_sold?: number | null;
}

export type TipoSugerencia = "producto" | "marca" | "categoria";

export interface Sugerencia {
  tipo: TipoSugerencia;
  /** Lo que se muestra. */
  label: string;
  /** Para `producto`, su id; para los demás, el valor por el que se filtra. */
  valor: string;
  /** Cuántos productos hay detrás. Sólo para marca y categoría. */
  cantidad?: number;
  imagen?: string | null;
  /** Para marca: la marca; para producto: su marca, como segunda línea. */
  detalle?: string | null;
}

const MIN_LARGO = 2;

/** Shared by predictive search and Enter: exact matches always win, before facets. */
export function buscarProductosDeTienda<T extends ProductoBuscable>(
  query: string,
  productos: T[],
  nombreCategoria: (slug: string) => string = s => s,
): { productos: T[]; aproximada: boolean } {
  const tokens = queryTokens(query);
  if (!tokens.length) return { productos, aproximada: false };
  const literales = productos.filter(p => matchesAllTokens(
    `${p.name} ${p.brand ?? ""} ${p.description ?? ""} ${p.category ?? ""} ${p.category ? nombreCategoria(p.category) : ""}`,
    tokens,
  ));
  // Approximate names/brands, not long descriptions that produce noisy matches.
  const matches = literales.length ? literales : productos.filter(p =>
    matchesAllTokensAprox(`${p.name} ${p.brand ?? ""}`, tokens));
  const q = normalizeText(query).trim();
  const wordStart = new RegExp(`\\b${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
  const rank = (p: T) => {
    const name = normalizeText(p.name);
    return name.startsWith(q) ? 0 : wordStart.test(name) ? 1 : 2;
  };
  return {
    productos: [...matches].sort((a, b) => rank(a) - rank(b)
      || (Number(b.total_sold) || 0) - (Number(a.total_sold) || 0)
      || a.name.localeCompare(b.name)),
    aproximada: !literales.length && matches.length > 0,
  };
}

/**
 * Sugerencias para lo que se está tipeando.
 *
 * Con menos de dos caracteres no devuelve nada: con una letra sola cualquier
 * lista es ruido y el desplegable tapa la pantalla apenas se toca el buscador.
 */
export function sugerenciasDeBusqueda(
  query: string,
  productos: ProductoBuscable[],
  opciones: {
    limite?: number;
    /** Resuelve el nombre visible de una categoría. */
    nombreCategoria?: (slug: string) => string;
    /** Productos que trae un sinónimo del comercio para esta búsqueda. */
    porSinonimo?: Set<string>;
  } = {},
): Sugerencia[] {
  const { limite = 7, nombreCategoria = (s) => s, porSinonimo } = opciones;

  const q = normalizeText(query).trim();
  if (q.length < MIN_LARGO) return [];

  const tokens = queryTokens(query);
  const directos = buscarProductosDeTienda(query, productos, nombreCategoria).productos;
  // Lo que el comercio vinculó a esta palabra («lo buscan como X, lo tengo
  // como Y») va después de lo que coincide por nombre.
  const ya = new Set(directos.map(p => p.id));
  const matches = porSinonimo?.size
    ? [...directos, ...productos.filter(p => porSinonimo.has(p.id) && !ya.has(p.id))]
    : directos;
  const conStock = matches.filter(p => (Number(p.stock) || 0) > 0);
  // Sin stock igual se sugiere si no hay nada más: la ficha existe y ofrece
  // avisar cuando vuelva, que es mejor que "no encontramos nada".
  const universo = conStock.length > 0 ? conStock : matches;

  const salida: Sugerencia[] = [];

  // ── Marcas ───────────────────────────────────────────────────────────
  const marcas = new Map<string, number>();
  for (const p of universo) {
    const m = (p.brand ?? "").trim();
    if (m && matchesAllTokens(m, tokens)) marcas.set(m, (marcas.get(m) ?? 0) + 1);
  }
  for (const [marca, cantidad] of [...marcas.entries()].sort((a, b) => b[1] - a[1])) {
    salida.push({ tipo: "marca", label: marca, valor: marca, cantidad });
  }

  // ── Categorías ───────────────────────────────────────────────────────
  const cats = new Map<string, number>();
  for (const p of universo) {
    const c = (p.category ?? "").trim();
    if (!c) continue;
    if (matchesAllTokens(nombreCategoria(c), tokens) || matchesAllTokens(c, tokens)) {
      cats.set(c, (cats.get(c) ?? 0) + 1);
    }
  }
  for (const [slug, cantidad] of [...cats.entries()].sort((a, b) => b[1] - a[1])) {
    salida.push({ tipo: "categoria", label: nombreCategoria(slug), valor: slug, cantidad });
  }

  for (const p of universo) {
    salida.push({
      tipo: "producto",
      label: p.name,
      valor: p.id,
      imagen: p.image_url ?? null,
      detalle: p.brand ?? null,
    });
  }

  return salida.slice(0, limite);
}

/** A dónde lleva cada sugerencia. */
export function destinoSugerencia(s: Sugerencia, base: string): string {
  switch (s.tipo) {
    case "producto":  return `${base}/producto/${s.valor}`;
    case "categoria": return `${base}/productos?cat=${encodeURIComponent(s.valor)}`;
    case "marca":     return `${base}/productos?q=${encodeURIComponent(s.valor)}`;
  }
}

/**
 * Mueve la selección con las flechas.
 *
 * `-1` es "nada seleccionado", que es donde tiene que volver al pasarse por
 * arriba: si no, con la primera opción marcada, Enter navega a algo que el
 * comprador no eligió en vez de buscar lo que escribió.
 */
export function moverSeleccion(actual: number, delta: number, total: number): number {
  if (total === 0) return -1;
  const siguiente = actual + delta;
  if (siguiente < -1) return total - 1;
  if (siguiente >= total) return -1;
  return siguiente;
}

/**
 * Faceta de marcas para el catálogo de la tienda: cuántos productos hay de
 * cada marca entre los resultados, la más numerosa primero. Con una sola
 * marca (o ninguna) no sirve para filtrar y devuelve [] — no se muestra.
 * Medido 2026-10-11: Ferretería Famatina tiene 127 marcas en 5.500 productos;
 * sin este filtro, buscar «disco» mezcla todas.
 */
export function facetaDeMarcas(
  productos: { brand?: string | null }[],
  limite = 12,
): { marca: string; cantidad: number }[] {
  const cuenta = new Map<string, number>();
  for (const p of productos) {
    const m = (p.brand ?? "").trim();
    if (m) cuenta.set(m, (cuenta.get(m) ?? 0) + 1);
  }
  if (cuenta.size < 2) return [];
  return [...cuenta.entries()]
    .map(([marca, cantidad]) => ({ marca, cantidad }))
    .sort((a, b) => b.cantidad - a.cantidad || a.marca.localeCompare(b.marca, "es"))
    .slice(0, limite);
}
