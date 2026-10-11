// Búsquedas de la tienda sin resultado (migración 20261011000500). La tienda
// las registra; el comercio ve qué le piden y no tiene. Sin datos del
// visitante: sólo el término normalizado y un contador por día.

/** Lo mismo que hace la base (texto_catalogo): para no mandar lo que va a descartar. */
export function terminoNormalizado(texto: string): string | null {
  const t = (texto ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .slice(0, 60);
  return t.length >= 2 ? t : null;
}

/** Decide si registrar: hay término, no hubo resultados y no se mandó antes en la visita. */
export function debeRegistrar(termino: string, resultados: number, yaEnviados: Set<string>): string | null {
  const t = terminoNormalizado(termino);
  if (!t || resultados > 0 || yaEnviados.has(t)) return null;
  return t;
}

export interface FilaBusqueda {
  termino: string;
  veces: number;
}

/** Suma por término (las filas vienen por día) y ordena de más a menos buscado. */
export function topBusquedas(filas: FilaBusqueda[], limite = 10): FilaBusqueda[] {
  const total = new Map<string, number>();
  for (const f of filas) total.set(f.termino, (total.get(f.termino) ?? 0) + (Number(f.veces) || 0));
  return [...total.entries()]
    .map(([termino, veces]) => ({ termino, veces }))
    .sort((a, b) => b.veces - a.veces || a.termino.localeCompare(b.termino))
    .slice(0, limite);
}
