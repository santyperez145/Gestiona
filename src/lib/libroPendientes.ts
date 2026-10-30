/**
 * Lo que devuelve `ledger_asentar_pendientes` (migración 20261030001100) y
 * cómo se le cuenta al comercio: cuántas se asentaron, cuántas no y por qué,
 * agrupadas por motivo.
 */

export interface ResultadoPendientes {
  asentadas?: number;
  fallidas?: number;
  quedan?: number;
  motivos?: Record<string, number>;
}

/** Los motivos de la base, en palabras del comercio. */
function motivoLegible(motivo: string): string {
  if (/alicuota/i.test(motivo)) return "no tienen alícuota de IVA registrada (ventas viejas): hay que asentarlas a mano con el contador";
  if (/tipo de emisor/i.test(motivo)) return "el tipo de emisor del negocio no está configurado (se elige en «ARCA y factura electrónica»)";
  if (/no tiene importe/i.test(motivo)) return "no tienen importe";
  return motivo;
}

export function textoDePendientes(r: ResultadoPendientes | null): { titulo: string; detalle: string } {
  const asentadas = Number(r?.asentadas ?? 0);
  const fallidas = Number(r?.fallidas ?? 0);
  const quedan = Number(r?.quedan ?? 0);
  const titulo = fallidas > 0
    ? `${asentadas === 1 ? "Se asentó 1 operación" : `Se asentaron ${asentadas} operaciones`}; ${fallidas === 1 ? "1 no se pudo" : `${fallidas} no se pudieron`}`
    : asentadas === 1 ? "Se asentó 1 operación en el libro" : `Se asentaron ${asentadas} operaciones en el libro`;
  const motivos = Object.entries(r?.motivos ?? {})
    .sort((a, b) => b[1] - a[1])
    .map(([m, n]) => `${n} ${motivoLegible(m)}`);
  const resto = quedan > fallidas ? [`Quedan ${quedan - fallidas} más: volvé a tocar «Asentar ahora».`] : [];
  return { titulo, detalle: [...motivos, ...resto].join(" · ") };
}
