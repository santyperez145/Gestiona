/**
 * Lee todas las filas de una consulta sin el tope de 1.000 de PostgREST.
 *
 * Divide el espacio de UUID en 16 rangos por el primer dígito hexadecimal y
 * pagina cada rango por keyset (`id > último`) en paralelo. A diferencia de
 * `offset`, una inserción concurrente no duplica ni saltea filas, y 9.000
 * productos se leen en un solo viaje en paralelo en lugar de 9 secuenciales.
 * Postgres compara UUID byte a byte, igual que el orden de su texto hex.
 */

export const PAGINA_KEYSET = 1000;
const HEX = "0123456789abcdef";

type Pagina<T> = PromiseLike<{ data: T[] | null; error: unknown }>;

/** Construye una consulta filtrada al rango [desde, hasta) y posterior a `despues`. */
export type ConsultaPorRango<T> = (rango: { desde: string; hasta: string | null; despues: string | null; limite: number }) => Pagina<T>;

export function rangosUuid(): { desde: string; hasta: string | null }[] {
  return [...HEX].map((digito, i) => ({
    desde: `${digito}0000000-0000-0000-0000-000000000000`,
    hasta: i + 1 < HEX.length ? `${HEX[i + 1]}0000000-0000-0000-0000-000000000000` : null,
  }));
}

export async function selectAllRows<T extends { id: string }>(consulta: ConsultaPorRango<T>, limite = PAGINA_KEYSET): Promise<T[]> {
  // Un catálogo chico entra en una página: no hace falta abrir 16 consultas.
  const primera = await consulta({ desde: rangosUuid()[0].desde, hasta: null, despues: null, limite });
  if (primera.error) throw primera.error;
  if ((primera.data?.length ?? 0) < limite) return primera.data ?? [];

  const partes = await Promise.all(rangosUuid().map(async ({ desde, hasta }) => {
    const filas: T[] = [];
    let despues: string | null = null;
    for (;;) {
      const { data, error } = await consulta({ desde, hasta, despues, limite });
      if (error) throw error;
      if (!data?.length) break;
      filas.push(...data);
      despues = data[data.length - 1].id;
      if (data.length < limite) break;
    }
    return filas;
  }));
  return partes.flat();
}
