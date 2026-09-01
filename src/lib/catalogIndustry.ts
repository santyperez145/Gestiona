/**
 * El workspace de catálogo no se presenta como una perfumería
 * si el comercio no opera ese rubro.
 *
 * Medido 2026-09-01: Exentry eligió `perfumes` y tiene 55 productos de
 * esa familia. `pruebas Workspace` no eligió rubro, tiene 0 productos y
 * 0 tipos — y aun así Productos ofrecía «Buscador perfume».
 *
 * La ficha olfativa (`product_perfume_details`) sigue existiendo: es una
 * feature de rubro, no una lista de categorías. Acá sólo se decide si el
 * chrome del listado la nombra. El formulario sigue abriéndose cuando la
 * categoría del producto es de perfume.
 */

export const CATEGORIAS_PERFUME = ["perfume_arabe", "perfume_diseñador"] as const;

export function esCategoriaPerfume(slug: string | null | undefined): boolean {
  return slug === "perfume_arabe" || slug === "perfume_diseñador";
}

export function elCatalogoOperaPerfumes(args: {
  industryCode: string | null | undefined;
  categories: Array<string | null | undefined>;
}): boolean {
  if (args.industryCode === "perfumes") return true;
  return args.categories.some(esCategoriaPerfume);
}
