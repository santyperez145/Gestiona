// Sin dependencias a propósito: lo importa el respaldo (Deno) y lo prueba
// vitest sin arrastrar los imports por URL de las funciones.
// PostgREST devuelve como mucho 1000 filas por consulta (max_rows del
// proyecto) aunque se pida `.limit(50_001)`. Sin paginar, toda tabla de más de
// 1000 filas salía «truncada» y el respaldo entero se descartaba: Famatina y
// Exentry estuvieron sin respaldo válido desde el 8/10 y el 24/9 (medido
// 2026-10-13). Se lee de a 1000, ordenado por id para no saltear ni repetir.
export const SNAPSHOT_PAGE_SIZE = 1_000;

type Pagina = (desde: number, hasta: number) => PromiseLike<{
  data: unknown[] | null;
  error: { code?: string } | null;
  count?: number | null;
}>;

/**
 * Lee todas las páginas hasta `tope` filas. Devuelve el `count` de la primera
 * página (si se pidió) y deduplica por id por si una inserción concurrente
 * corre el offset.
 */
export async function leerPaginado(
  pagina: Pagina,
  tope: number,
): Promise<{ rows: Record<string, unknown>[]; count: number | null; error: { code?: string } | null }> {
  const vistos = new Set<unknown>();
  const rows: Record<string, unknown>[] = [];
  let count: number | null = null;
  for (let desde = 0; desde <= tope; desde += SNAPSHOT_PAGE_SIZE) {
    const hasta = Math.min(desde + SNAPSHOT_PAGE_SIZE, tope + 1) - 1;
    const { data, error, count: total } = await pagina(desde, hasta);
    if (error) return { rows, count, error };
    if (desde === 0) count = total ?? null;
    const lote = (data ?? []) as Record<string, unknown>[];
    for (const row of lote) {
      if (row.id !== undefined && vistos.has(row.id)) continue;
      vistos.add(row.id);
      rows.push(row);
    }
    if (lote.length < hasta - desde + 1) break;
  }
  return { rows, count, error: null };
}
