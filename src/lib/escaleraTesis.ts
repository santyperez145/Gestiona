// Escalera de docs/TESIS.md §8 y E1, leída de `platform_escalera_tesis()`
// (migración 20261010002800). Las metas se copian de la tesis: si la tesis
// cambia, cambian acá y el test lo exige.

export const ESCALONES = [
  { id: "comercios_activos", nombre: "Comercios con ventas en 30 días", meta: 10 },
  { id: "tiendas", nombre: "Tiendas publicadas", meta: 8 },
  { id: "con_venta_online", nombre: "Con primera venta online", meta: 5 },
  { id: "vendiendo_todas_las_semanas", nombre: "Vendiendo todas las semanas (4 seguidas)", meta: 3 },
] as const;

export type EscalonId = (typeof ESCALONES)[number]["id"];

/** E1: el comercio de catálogo grande vuelve cada semana. */
export const META_E1_VENTAS_SEMANA = 20;
export const REVISION_PIVOTAR = "2026-12-15";

export interface ComercioEnEscalera {
  org_id: string;
  nombre: string;
  activo: boolean;
  tienda: boolean;
  online: boolean;
  semanal: boolean;
  /** Ventas por semana: [0] = últimos 7 días … [7] = hace 7–8 semanas. */
  semanas: number[];
}

export type Escalera = Record<EscalonId, number> & { medido_at: string; comercios: ComercioEnEscalera[] };

/** El primer escalón sin cumplir: es el que manda el trabajo de la semana. */
export function escalonActual(e: Escalera): (typeof ESCALONES)[number] | null {
  return ESCALONES.find(s => (Number(e[s.id]) || 0) < s.meta) ?? null;
}

/** Semanas, de la más vieja a la más reciente, para leer de izquierda a derecha. */
export function semanasCronologicas(c: ComercioEnEscalera): number[] {
  return [...(c.semanas ?? [])].map(n => Number(n) || 0).reverse();
}

export function cumpleE1(c: ComercioEnEscalera): boolean {
  return (Number(c.semanas?.[0]) || 0) >= META_E1_VENTAS_SEMANA;
}
