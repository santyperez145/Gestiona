// Guardián de margen (Profit): productos que se venden por debajo del costo.
//
// Medido 2026-10-10 en Ferretería Famatina: 21 productos con precio igual o
// menor al costo, varios a $0,10 (discos de corte de cientos o miles de pesos
// de costo). Cada venta de esos pierde plata y nada lo avisaba: el Inicio
// decía «margen < 30%» y abría Productos sin filtro. Una sola regla para el
// Inicio y para el filtro de Productos («Margen negativo»).
//
// 📌 Sin costo conocido (o en dólares sin cotización) el producto no cuenta:
// un margen que no se puede calcular no es negativo.
import { costoArsONull } from "@/lib/exchangeRate";

export interface ProductoConPrecio {
  sale_price_ars?: number | string | null;
  total_cost_usd?: number | null;
  cost_ars?: number | null;
  cost_currency?: string | null;
}

export function seVendeBajoCosto(p: ProductoConPrecio, cotizacion: number | null): boolean {
  const precio = Number(p.sale_price_ars) || 0;
  if (precio <= 0) return false;
  const costo = costoArsONull({ costUsd: p.total_cost_usd, costArs: p.cost_ars, costCurrency: p.cost_currency }, cotizacion);
  return costo !== null && precio < costo;
}

export function contarBajoCosto(productos: ProductoConPrecio[], cotizacion: number | null): number {
  return productos.reduce((n, p) => n + (seVendeBajoCosto(p, cotizacion) ? 1 : 0), 0);
}

/** Filtros de margen de Productos que se pueden abrir desde un enlace. */
const FILTROS_DE_MARGEN = ["negative", "low", "mid", "high"] as const;
export type FiltroDeMargen = (typeof FILTROS_DE_MARGEN)[number];

export function filtroDeMargenDesdeUrl(valor: string | null): FiltroDeMargen | null {
  return valor && (FILTROS_DE_MARGEN as readonly string[]).includes(valor) ? (valor as FiltroDeMargen) : null;
}
