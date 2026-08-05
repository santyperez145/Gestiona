/**
 * Categorías de la tienda.
 *
 * Hasta la sesión 94 el nombre de una categoría salía de un `Record`
 * hardcodeado con cuatro entradas de perfumería. En una plataforma
 * multi-tenant eso significa que quien venda ropa ve el slug crudo, y que
 * nadie puede renombrar, ordenar ni esconder una categoría sin tocar código.
 *
 * Ahora el nombre es un dato (`ecommerce_categories`) y esto resuelve la
 * transición: mientras una organización no haya creado las suyas, se sigue
 * mostrando lo de antes. El mismo criterio que `publicDataSource`: lo nuevo
 * primero, lo anterior como respaldo, y nunca una pantalla vacía.
 */

/** Los cuatro nombres históricos. Respaldo, no fuente de verdad. */
export const NOMBRES_HEREDADOS: Record<string, string> = {
  perfume_arabe: "Perfume Árabe",
  "perfume_diseñador": "Perfume Diseñador",
  vaper: "Vaper",
  electronico: "Electrónico",
};

export interface CategoriaTienda {
  id: string;
  name: string;
  slug: string;
  parent_id?: string | null;
  image_url?: string | null;
  description?: string | null;
  sort_order?: number | null;
  /** Productos publicados. Viene del RPC. */
  productos?: number;
}

/**
 * Convierte un slug en algo legible: `perfume_arabe` → `Perfume arabe`.
 * Es un punto de partida editable, no una traducción — por eso no intenta
 * acentuar ni adivinar.
 */
export function slugALegible(slug: string): string {
  const limpio = String(slug ?? "").replace(/[_-]+/g, " ").trim();
  if (!limpio) return "";
  return limpio.charAt(0).toUpperCase() + limpio.slice(1);
}

/**
 * Nombre a mostrar para un slug, en orden: la categoría cargada por el
 * comercio, el nombre heredado, y por último el slug hecho legible. Nunca
 * devuelve vacío: una categoría sin nombre en el menú es un botón sin texto.
 */
export function nombreDeCategoria(
  slug: string,
  categorias: CategoriaTienda[] = [],
): string {
  const propia = categorias.find(c => c.slug === slug);
  if (propia?.name?.trim()) return propia.name.trim();
  return NOMBRES_HEREDADOS[slug] ?? slugALegible(slug);
}

/**
 * El menú de la tienda.
 *
 * Con categorías cargadas manda ese orden, y **se esconden las vacías**: una
 * categoría sin productos en el menú es un callejón sin salida. Sin
 * categorías cargadas se cae a los slugs que traen los productos, que es como
 * funcionaba antes.
 */
export function menuDeCategorias(
  categorias: CategoriaTienda[],
  slugsDeProductos: string[],
): { slug: string; label: string }[] {
  if (categorias.length > 0) {
    const conProductos = new Set(slugsDeProductos);
    return categorias
      .filter(c => (c.productos ?? 0) > 0 || conProductos.has(c.slug))
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      .map(c => ({ slug: c.slug, label: nombreDeCategoria(c.slug, categorias) }));
  }

  return [...new Set(slugsDeProductos.filter(Boolean))]
    .map(s => ({ slug: s, label: nombreDeCategoria(s) }));
}

/**
 * Slug a partir de un nombre escrito por el comercio. Se usa al crear una
 * categoría nueva: `Ropa de Verano` → `ropa-de-verano`.
 *
 * Los acentos se transliteran en vez de borrarse — `Diseñador` tiene que dar
 * `disenador` y no `diseador`, que es lo que pasa si se filtra sin normalizar.
 */
export function slugDeNombre(nombre: string): string {
  return String(nombre ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** Mensaje de error, o `undefined` si el nombre sirve. */
export function validarNombre(
  nombre: string,
  existentes: CategoriaTienda[],
  idQueSeEdita?: string,
): string | undefined {
  const n = String(nombre ?? "").trim();
  if (n.length < 2) return "El nombre es muy corto";
  if (n.length > 60) return "El nombre es muy largo";

  const slug = slugDeNombre(n);
  if (!slug) return "Poné un nombre con letras o números";

  const choca = existentes.some(c => c.slug === slug && c.id !== idQueSeEdita);
  if (choca) return "Ya existe una categoría con ese nombre";

  return undefined;
}
