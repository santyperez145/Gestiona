/**
 * Índice de búsqueda literal para catálogos grandes.
 *
 * `literalFilter` normaliza (minúsculas + sin tildes) los campos de cada ítem
 * en cada tecla. Con 11.000 productos eso es trabajo repetido: acá el texto
 * normalizado se arma una sola vez por lista y cada búsqueda sólo compara
 * términos. La regla es la misma de `searchText.ts`: todos los términos deben
 * aparecer; si no hay coincidencias, el llamador decide si cae al difuso.
 */
import { normalizeText, queryTokens } from "@/lib/searchText";

export type IndiceBusqueda<T> = { items: T[]; textos: string[] };

export function crearIndiceBusqueda<T>(
  items: T[],
  campos: (item: T) => Array<string | null | undefined>,
): IndiceBusqueda<T> {
  return {
    items,
    textos: items.map(item => normalizeText(campos(item).filter(Boolean).join(" "))),
  };
}

export function buscarLiteral<T>(indice: IndiceBusqueda<T>, consulta: string): T[] {
  const terminos = queryTokens(consulta);
  if (!terminos.length) return [];
  const resultado: T[] = [];
  for (let i = 0; i < indice.textos.length; i += 1) {
    const texto = indice.textos[i];
    let coincide = true;
    for (const termino of terminos) {
      if (!texto.includes(termino)) { coincide = false; break; }
    }
    if (coincide) resultado.push(indice.items[i]);
  }
  return resultado;
}

/** Campos de búsqueda de un producto: nombre, marca y códigos. */
export function camposProducto(p: {
  name?: string | null; brand?: string | null; sku?: string | null; barcode?: string | null; barcode_aliases?: string[] | null;
}): Array<string | null | undefined> {
  return [p.name, p.brand, p.sku, p.barcode, ...(p.barcode_aliases ?? [])];
}
