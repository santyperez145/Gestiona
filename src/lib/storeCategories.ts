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
    // **Sólo las de primer nivel.** Con subcategorías, devolver la lista plana
    // hace que el menú agarre dos hijas y el padre no aparezca nunca — y
    // entonces tampoco aparece el desplegable, que es donde viven las hijas.
    // Se cuenta la rama entera: un padre sin productos propios pero con hijas
    // llenas tiene que estar.
    return arbolDeCategorias(categorias)
      .filter(n => n.productosEnRama > 0 || conProductos.has(n.slug))
      .map(n => ({ slug: n.slug, label: nombreDeCategoria(n.slug, categorias) }));
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

// ── Subcategorías ───────────────────────────────────────────────────────────
//
// `parent_id` estaba en la tabla y en el RPC desde el principio y no lo usaba
// nadie. Es lo que permite "Perfumes → Árabes / Diseñador" en vez de una fila
// plana de ocho botones, que es como se ve cualquier tienda con más de un
// puñado de rubros.

export interface NodoCategoria extends CategoriaTienda {
  hijos: NodoCategoria[];
  /** Productos propios más los de toda su descendencia. */
  productosEnRama: number;
}

/**
 * Arma el árbol.
 *
 * Tolera dos cosas que rompen un armado ingenuo y que pasan de verdad:
 * un `parent_id` que apunta a una categoría borrada o escondida —esa fila
 * quedaría huérfana y desaparecería del menú— y un **ciclo**, que con una
 * recursión sin guarda cuelga la pestaña del navegador. En los dos casos el
 * nodo se trata como raíz: es preferible verlo fuera de lugar que no verlo.
 */
export function arbolDeCategorias(categorias: CategoriaTienda[]): NodoCategoria[] {
  const porId = new Map<string, NodoCategoria>();
  for (const c of categorias) {
    porId.set(c.id, { ...c, hijos: [], productosEnRama: c.productos ?? 0 });
  }

  /** ¿`id` desciende de sí mismo pasando por `padre`? */
  const hayCiclo = (id: string, padre: string | null | undefined): boolean => {
    let actual = padre;
    const vistos = new Set<string>();
    while (actual) {
      if (actual === id) return true;
      if (vistos.has(actual)) return true;
      vistos.add(actual);
      actual = porId.get(actual)?.parent_id ?? null;
    }
    return false;
  };

  const raices: NodoCategoria[] = [];
  for (const nodo of porId.values()) {
    const padre = nodo.parent_id ? porId.get(nodo.parent_id) : undefined;
    if (!padre || hayCiclo(nodo.id, nodo.parent_id)) {
      raices.push(nodo);
    } else {
      padre.hijos.push(nodo);
    }
  }

  const ordenar = (ns: NodoCategoria[]) => {
    ns.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name));
    for (const n of ns) ordenar(n.hijos);
  };
  ordenar(raices);

  // El total de la rama se suma de abajo hacia arriba: una categoría padre sin
  // productos propios pero con hijos llenos tiene que aparecer en el menú.
  const acumular = (n: NodoCategoria): number => {
    n.productosEnRama = (n.productos ?? 0) + n.hijos.reduce((s, h) => s + acumular(h), 0);
    return n.productosEnRama;
  };
  for (const r of raices) acumular(r);

  return raices;
}

/**
 * El slug pedido más el de toda su descendencia.
 *
 * Es lo que hace que entrar a "Perfumes" muestre también lo que está en
 * "Perfumes → Árabes". Sin esto, tocar una categoría padre da una página vacía
 * y el comprador concluye que no hay stock.
 */
export function slugsDeRama(slug: string, categorias: CategoriaTienda[]): string[] {
  const raiz = categorias.find(c => c.slug === slug);
  if (!raiz) return [slug];

  const salida = new Set<string>([slug]);
  const pendientes = [raiz.id];
  const vistos = new Set<string>();

  while (pendientes.length > 0) {
    const id = pendientes.pop()!;
    if (vistos.has(id)) continue;   // corta ciclos
    vistos.add(id);
    for (const c of categorias) {
      if (c.parent_id === id && !vistos.has(c.id)) {
        salida.add(c.slug);
        pendientes.push(c.id);
      }
    }
  }
  return [...salida];
}

/**
 * ¿Se puede colgar `id` de `nuevoPadre`? Devuelve el motivo si no.
 *
 * Sin esto, elegirse a sí mismo o a un descendiente como padre deja el árbol en
 * un ciclo que después hay que arreglar desde SQL.
 */
export function validarPadre(
  id: string,
  nuevoPadre: string | null,
  categorias: CategoriaTienda[],
): string | undefined {
  if (!nuevoPadre) return undefined;
  if (nuevoPadre === id) return "Una categoría no puede ser su propia subcategoría";

  const descendientes = new Set<string>();
  const pendientes = [id];
  while (pendientes.length > 0) {
    const actual = pendientes.pop()!;
    for (const c of categorias) {
      if (c.parent_id === actual && !descendientes.has(c.id)) {
        descendientes.add(c.id);
        pendientes.push(c.id);
      }
    }
  }
  if (descendientes.has(nuevoPadre)) {
    return "Esa categoría ya está adentro de la que estás moviendo";
  }

  // Dos niveles alcanzan para una tienda y es lo que el menú puede desplegar
  // sin volverse un árbol de carpetas.
  const padre = categorias.find(c => c.id === nuevoPadre);
  if (padre?.parent_id) return "Sólo se permiten dos niveles";

  return undefined;
}
