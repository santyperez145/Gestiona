/**
 * Paginación del catálogo por productos, agrupados por marca para la lista.
 *
 * Antes se paginaba por marcas: una página eran 30 marcas completas, y una
 * marca con miles de productos (p. ej. "Sin marca" en una ferretería) dibujaba
 * miles de filas a la vez. Ahora cada página tiene un tope de filas y una marca
 * puede continuar en la página siguiente; el encabezado conserva sus totales.
 */

export const PRODUCTOS_POR_PAGINA = 60;

type ConMarca = { brand?: string | null; stock?: number | null };

export type GrupoMarca<T> = {
  marca: string;
  items: T[];
  /** Totales de la marca en todo el filtro, no sólo en esta página. */
  total: number;
  stockTotal: number;
};

export type PaginaCatalogo<T> = {
  /** Productos en orden de marca y luego del orden elegido. */
  ordenados: T[];
  grupos: GrupoMarca<T>[];
  pagina: number;
  totalPaginas: number;
};

/**
 * Agrupa por marca sin distinguir mayúsculas (gana la primera grafía vista),
 * respeta el orden recibido dentro de cada marca y corta una página de filas.
 * O(n log m), con m marcas: no recorre las marcas por cada producto.
 */
export function paginarPorMarca<T extends ConMarca>(
  productos: T[],
  pagina: number,
  porPagina: number = PRODUCTOS_POR_PAGINA,
): PaginaCatalogo<T> {
  const grafia = new Map<string, string>();
  const porMarca = new Map<string, T[]>();
  for (const producto of productos) {
    const cruda = producto.brand?.trim() || "Sin marca";
    const clave = cruda.toLowerCase();
    if (!grafia.has(clave)) grafia.set(clave, cruda);
    const lista = porMarca.get(clave);
    if (lista) lista.push(producto); else porMarca.set(clave, [producto]);
  }

  const claves = [...porMarca.keys()].sort((a, b) => grafia.get(a)!.localeCompare(grafia.get(b)!, "es"));
  const ordenados = claves.flatMap(clave => porMarca.get(clave)!);
  const totalPaginas = Math.max(1, Math.ceil(ordenados.length / porPagina));
  const actual = Math.min(Math.max(0, pagina), totalPaginas - 1);
  const pagina_ = ordenados.slice(actual * porPagina, (actual + 1) * porPagina);

  const grupos: GrupoMarca<T>[] = [];
  for (const producto of pagina_) {
    const clave = (producto.brand?.trim() || "Sin marca").toLowerCase();
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.marca.toLowerCase() === clave) {
      ultimo.items.push(producto);
      continue;
    }
    const todos = porMarca.get(clave)!;
    grupos.push({
      marca: grafia.get(clave)!,
      items: [producto],
      total: todos.length,
      stockTotal: todos.reduce((s, p) => s + (Number(p.stock) || 0), 0),
    });
  }
  return { ordenados, grupos, pagina: actual, totalPaginas };
}
