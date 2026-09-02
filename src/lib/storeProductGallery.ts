/**
 * Galería de la ficha pública.
 *
 * Tiendanube y Shopify abren la foto, dejan pasar entre tomas y muestran la
 * imagen de la variante elegida. No copiamos su lightbox: el orden y el índice
 * son reglas puras para que la UI no invente un slide que no existe.
 */

export function galeriaDeProducto(input: {
  image_url?: string | null;
  image_urls?: string[] | null;
  variant_image?: string | null;
}): string[] {
  const raw = [input.variant_image, input.image_url, ...(input.image_urls ?? [])];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const src of raw) {
    const url = typeof src === "string" ? src.trim() : "";
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

export function clampIndice(i: number, total: number): number {
  if (total <= 0) return 0;
  if (!Number.isFinite(i)) return 0;
  return Math.min(Math.max(0, Math.trunc(i)), total - 1);
}

export function indiceSiguiente(i: number, total: number): number {
  if (total <= 1) return 0;
  return (clampIndice(i, total) + 1) % total;
}

export function indiceAnterior(i: number, total: number): number {
  if (total <= 1) return 0;
  return (clampIndice(i, total) - 1 + total) % total;
}

/** Desliz horizontal: izquierda = siguiente, derecha = anterior. */
export function indicePorDesliz(
  deltaX: number,
  i: number,
  total: number,
  umbral = 40,
): number {
  if (total <= 1 || !Number.isFinite(deltaX)) return clampIndice(i, total);
  if (deltaX <= -umbral) return indiceSiguiente(i, total);
  if (deltaX >= umbral) return indiceAnterior(i, total);
  return clampIndice(i, total);
}
