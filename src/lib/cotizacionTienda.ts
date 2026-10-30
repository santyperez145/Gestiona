/**
 * Pedidos de cotización hechos desde la tienda (2026-10-30, migración
 * 20261030000700): lo que devuelve `mis_cotizaciones_tienda` y cómo se lee
 * cada estado para el comprador.
 */

export type EstadoCotizacion = "pendiente" | "respondida" | "pagada" | "rechazada" | "vencida";

export interface CotizacionDelComprador {
  quote_number: string;
  estado: EstadoCotizacion;
  /** Vacío hasta que el comercio responde: el borrador no muestra precios. */
  total: number | null;
  items: number;
  valid_until: string | null;
  created_at: string;
  pago_id: string | null;
}

const ESTADOS: Record<EstadoCotizacion, { texto: string }> = {
  pendiente: { texto: "Esperando respuesta de la tienda" },
  respondida: { texto: "Respondida" },
  pagada: { texto: "Pagada" },
  rechazada: { texto: "La tienda no pudo cotizarla" },
  vencida: { texto: "Vencida: pedí una nueva" },
};

export function estadoDeCotizacion(estado: string): { texto: string } {
  return ESTADOS[estado as EstadoCotizacion] ?? { texto: estado };
}
