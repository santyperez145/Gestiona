// Contrato del cliente con `ajustar_precios_en_bloque`
// (supabase/migrations/20261010001700_ajuste_de_precios_en_bloque.sql).
// La base valida lo mismo; esto evita un viaje para un pedido que va a fallar.

export type QueAjustar = "precio" | "costo" | "costo_y_precio";

export const QUE_AJUSTAR: { value: QueAjustar; label: string }[] = [
  { value: "costo_y_precio", label: "El proveedor aumentó: costo y precio" },
  { value: "precio", label: "Sólo el precio de venta" },
  { value: "costo", label: "Sólo el costo (el precio queda)" },
];

export const REDONDEOS = [
  { value: 1, label: "Sin redondeo" },
  { value: 10, label: "$10" },
  { value: 50, label: "$50" },
  { value: 100, label: "$100" },
] as const;

export interface AjusteEnBloque {
  porcentaje: number;
  que: QueAjustar;
  categoria: string | null;
  marca: string | null;
  proveedor: string | null;
  redondeo: number;
}

export interface ResultadoAjuste {
  aplicado: boolean;
  afectados: number;
  muestra: {
    id: string;
    nombre: string;
    moneda: "ARS" | "USD";
    precio_antes: number | null;
    precio_despues: number | null;
    costo_antes: number | null;
    costo_despues: number | null;
  }[];
}

/** El motivo por el que el pedido no se puede mandar, o `null`. */
export function errorDelAjuste(a: AjusteEnBloque): string | null {
  if (!Number.isFinite(a.porcentaje) || a.porcentaje === 0) return "Ingresá un porcentaje distinto de 0.";
  if (a.porcentaje <= -90 || a.porcentaje > 500) return "El porcentaje tiene que estar entre -90% y 500%.";
  if (!REDONDEOS.some(r => r.value === a.redondeo)) return "Elegí un redondeo de la lista.";
  return null;
}

/** Marcas distintas del catálogo, ordenadas, sin vacíos. */
export function marcasDelCatalogo(productos: { brand?: string | null }[]): string[] {
  const set = new Set<string>();
  for (const p of productos) {
    // El valor va tal cual: la base filtra por igualdad exacta.
    if (p.brand && p.brand.trim()) set.add(p.brand);
  }
  return [...set].sort((a, b) => a.localeCompare(b, "es"));
}
