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
 * categorías a elegir. Acá se decide (1) si el chrome las nombra y
 * (2) si la ficha de un producto abre esa vertical.
 *
 * P0.1.4: con `product_type_id` tipado, el slug del tipo manda. Sin tipo
 * (legado / org sin Profiler) la categoría heredada sigue abriendo la ficha.
 */

export const CATEGORIAS_PERFUME = ["perfume_arabe", "perfume_diseñador"] as const;
export const CATEGORIAS_VAPER = ["vaper", "liquido"] as const;

/** Slugs de `product_types` sembrados por el Business Profiler. */
export const TIPOS_PERFUME = ["perfume"] as const;
export const TIPOS_VAPER = ["dispositivo-vape", "e-liquid"] as const;
export const TIPOS_TECNOLOGIA = ["tecnologia"] as const;

export function esCategoriaPerfume(slug: string | null | undefined): boolean {
  return slug === "perfume_arabe" || slug === "perfume_diseñador";
}

export function esCategoriaVaper(slug: string | null | undefined): boolean {
  return slug === "vaper" || slug === "liquido";
}

export function esTipoPerfume(slug: string | null | undefined): boolean {
  return slug === "perfume";
}

export function esTipoVaper(slug: string | null | undefined): boolean {
  return slug === "dispositivo-vape" || slug === "e-liquid";
}

export function esTipoTecnologia(slug: string | null | undefined): boolean {
  return slug === "tecnologia";
}

/**
 * ¿Esta ficha de producto muestra chrome de perfume?
 * Tipo tipado gana; sin tipo, la categoría legacy sigue abriendo.
 */
export function laFichaEsPerfume(args: {
  productTypeSlug?: string | null;
  category?: string | null;
}): boolean {
  const tipo = String(args.productTypeSlug ?? "").trim();
  if (tipo) return esTipoPerfume(tipo);
  return esCategoriaPerfume(args.category);
}

export function laFichaEsVaper(args: {
  productTypeSlug?: string | null;
  category?: string | null;
}): boolean {
  const tipo = String(args.productTypeSlug ?? "").trim();
  if (tipo) return esTipoVaper(tipo);
  return esCategoriaVaper(args.category);
}

export function laFichaEsTecnologia(args: {
  productTypeSlug?: string | null;
  category?: string | null;
}): boolean {
  const tipo = String(args.productTypeSlug ?? "").trim();
  if (tipo) return esTipoTecnologia(tipo);
  return args.category === "electronico";
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
