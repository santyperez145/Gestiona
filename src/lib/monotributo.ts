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
  /**
   * Tope de ingresos y cuota mensual total (impuesto integrado + jubilación +
   * obra social), para venta de cosas muebles y para servicios. Vence el 20.
   */
  categorias: [
    { categoria: "A", tope: 12_009_410.45, cuotaVenta: 49_527.18, cuotaServicios: 49_527.18 },
    { categoria: "B", tope: 17_595_182.74, cuotaVenta: 56_379.08, cuotaServicios: 56_379.08 },
    { categoria: "C", tope: 24_670_494.31, cuotaVenta: 64_530.58, cuotaServicios: 66_020.12 },
    { categoria: "D", tope: 30_628_651.43, cuotaVenta: 82_564.81, cuotaServicios: 84_612.93 },
    { categoria: "E", tope: 36_028_231.33, cuotaVenta: 108_267.51, cuotaServicios: 119_811.45 },
    { categoria: "F", tope: 45_151_659.41, cuotaVenta: 129_930.65, cuotaServicios: 150_784.21 },
    { categoria: "G", tope: 53_995_798.87, cuotaVenta: 158_815.05, cuotaServicios: 230_312.94 },
    { categoria: "H", tope: 81_924_660.37, cuotaVenta: 317_895.01, cuotaServicios: 522_706.68 },
    { categoria: "I", tope: 91_699_761.90, cuotaVenta: 474_992.78, cuotaServicios: 963_747.86 },
    { categoria: "J", tope: 105_012_519.20, cuotaVenta: 580_793.69, cuotaServicios: 1_167_299.76 },
    { categoria: "K", tope: 126_610_838.75, cuotaVenta: 702_103.24, cuotaServicios: 1_614_446.04 },
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

/**
 * Próxima recategorización (semestral): vence el 5 de febrero y el 5 de agosto,
 * con lo facturado en los 12 meses que cierran el 31 de diciembre y el 30 de
 * junio. `completo` dice si el período ya cerró (y la cifra es definitiva).
 */
export function proximaRecategorizacion(hoy: string): { vence: string; desde: string; hasta: string; completo: boolean } {
  const anio = Number(hoy.slice(0, 4));
  const dia = hoy.slice(0, 10);
  const candidatos = [
    { vence: `${anio}-02-05`, desde: `${anio - 1}-01-01`, hasta: `${anio - 1}-12-31` },
    { vence: `${anio}-08-05`, desde: `${anio - 1}-07-01`, hasta: `${anio}-06-30` },
    { vence: `${anio + 1}-02-05`, desde: `${anio}-01-01`, hasta: `${anio}-12-31` },
  ];
  const proxima = candidatos.find(c => c.vence >= dia)!;
  return { ...proxima, completo: dia > proxima.hasta };
}

/** Categoría mínima por ingresos para un monto facturado. */
export function categoriaPorIngresos(facturado: number) {
  return ESCALA_MONOTRIBUTO.categorias.find(c => facturado <= c.tope) ?? null;
}

/** Lo facturado entre dos fechas (notas de crédito restan). */
export function facturadoEntre(comprobantes: ComprobanteMonotributo[], desde: string, hasta: string): number {
  let centavos = 0;
  for (const c of comprobantes) {
    if (c.issue_date < desde || c.issue_date > hasta) continue;
    const signo = NOTAS_DE_CREDITO.has(Number(c.tipo_comprobante)) ? -1 : 1;
    centavos += signo * Math.round((Number(c.total) || 0) * 100);
  }
  return centavos / 100;
}
