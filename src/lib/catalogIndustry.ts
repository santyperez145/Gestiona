/**
 * El workspace no se presenta como una vertical concreta si el comercio
 * no opera ese rubro.
 *
 * Medido 2026-09-01: Exentry eligió `perfumes` y tiene 55 productos de
 * esa familia. `pruebas Workspace` no eligió rubro, tiene 0 productos y
 * 0 tipos — y aun así Productos ofrecía «Buscador perfume», Clientes
 * «Preferencias olfativas» / «Compra vapers», y el catálogo interno
 * «Filtros de perfume».
 *
 * Las fichas de rubro (`product_perfume_details`, `buys_vapers`, etc.)
 * siguen existiendo: son features de vertical, no una lista de
 * categorías a elegir. Acá sólo se decide si el chrome las nombra.
 * El formulario de producto sigue abriéndose cuando la categoría del
 * ítem es de esa familia.
 */

export const CATEGORIAS_PERFUME = ["perfume_arabe", "perfume_diseñador"] as const;
export const CATEGORIAS_VAPER = ["vaper", "liquido"] as const;

export function esCategoriaPerfume(slug: string | null | undefined): boolean {
  return slug === "perfume_arabe" || slug === "perfume_diseñador";
}

export function esCategoriaVaper(slug: string | null | undefined): boolean {
  return slug === "vaper" || slug === "liquido";
}

export function elCatalogoOperaPerfumes(args: {
  industryCode: string | null | undefined;
  categories: Array<string | null | undefined>;
}): boolean {
  if (args.industryCode === "perfumes") return true;
  return args.categories.some(esCategoriaPerfume);
}

export function elCatalogoOperaVapers(args: {
  industryCode: string | null | undefined;
  categories: Array<string | null | undefined>;
}): boolean {
  if (args.industryCode === "vapers") return true;
  return args.categories.some(esCategoriaVaper);
}
