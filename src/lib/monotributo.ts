/**
 * Monotributo: cuánto se facturó en los últimos 12 meses y qué categoría
 * corresponde por ingresos (2026-10-21).
 *
 * Un monotributista que pasa el tope de su categoría tiene que recategorizarse,
 * y si pasa el de la K queda excluido del régimen. Nerqia ya tiene cada factura
 * con CAE: mostrarlo es más útil que pedirle que lo sume a mano.
 *
 * La escala la actualiza ARCA cada semestre. Es la publicada en
 * https://www.afip.gob.ar/monotributo/categorias.asp, «Valores de aplicación
 * desde el 1/08/2026». Cuando sale una nueva hay que reemplazarla acá; mientras
 * tanto la pantalla avisa que puede estar desactualizada en vez de dar por
 * buenos números viejos.
 *
 * La categoría depende también de la superficie, la energía y los alquileres;
 * esto sólo mira los ingresos, y lo dice.
 */

export const ESCALA_MONOTRIBUTO = {
  vigenteDesde: "2026-08-01",
  /** La próxima actualización semestral: desde acá la escala puede estar vieja. */
  revisarDesde: "2027-02-01",
  fuente: "https://www.afip.gob.ar/monotributo/categorias.asp",
  /** Precio unitario máximo para venta de cosas muebles. */
  precioUnitarioMaximo: 716_840.77,
  categorias: [
    { categoria: "A", tope: 12_009_410.45 },
    { categoria: "B", tope: 17_595_182.74 },
    { categoria: "C", tope: 24_670_494.31 },
    { categoria: "D", tope: 30_628_651.43 },
    { categoria: "E", tope: 36_028_231.33 },
    { categoria: "F", tope: 45_151_659.41 },
    { categoria: "G", tope: 53_995_798.87 },
    { categoria: "H", tope: 81_924_660.37 },
    { categoria: "I", tope: 91_699_761.90 },
    { categoria: "J", tope: 105_012_519.20 },
    { categoria: "K", tope: 126_610_838.75 },
  ],
} as const;

export interface ComprobanteMonotributo {
  issue_date: string;
  tipo_comprobante: number | null;
  total: number;
}

export interface SituacionMonotributo {
  desde: string;
  hasta: string;
  facturado: number;
  /** Categoría mínima por ingresos; null si superó la K. */
  categoria: string | null;
  tope: number | null;
  /** Lo que falta para el tope de esa categoría. */
  margen: number | null;
  /** Porcentaje usado del tope de la K. */
  usoDelMaximo: number;
  excedido: boolean;
  escalaDesactualizada: boolean;
}

const NOTAS_DE_CREDITO = new Set([3, 8, 13]);

/** Los 12 meses calendario completos anteriores a `hoy` más el mes en curso. */
export function ventanaDeDoceMeses(hoy: string): { desde: string; hasta: string } {
  const [anio, mes] = hoy.slice(0, 7).split("-").map(Number);
  const inicio = new Date(Date.UTC(anio, mes - 1 - 11, 1));
  return { desde: inicio.toISOString().slice(0, 10), hasta: hoy.slice(0, 10) };
}

export function situacionMonotributo(comprobantes: ComprobanteMonotributo[], hoy: string): SituacionMonotributo {
  const { desde, hasta } = ventanaDeDoceMeses(hoy);
  let centavos = 0;
  for (const c of comprobantes) {
    if (c.issue_date < desde || c.issue_date > hasta) continue;
    const signo = NOTAS_DE_CREDITO.has(Number(c.tipo_comprobante)) ? -1 : 1;
    centavos += signo * Math.round((Number(c.total) || 0) * 100);
  }
  const facturado = centavos / 100;
  const escala = ESCALA_MONOTRIBUTO.categorias;
  const maximo = escala[escala.length - 1].tope;
  const corresponde = escala.find(c => facturado <= c.tope) ?? null;
  return {
    desde,
    hasta,
    facturado,
    categoria: corresponde?.categoria ?? null,
    tope: corresponde?.tope ?? null,
    margen: corresponde ? Math.round((corresponde.tope - facturado) * 100) / 100 : null,
    usoDelMaximo: maximo > 0 ? Math.max(0, facturado) / maximo : 0,
    excedido: corresponde === null,
    escalaDesactualizada: hoy.slice(0, 10) >= ESCALA_MONOTRIBUTO.revisarDesde,
  };
}
