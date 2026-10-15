/**
 * Las reglas de alerta que de verdad se revisan (2026-10-15).
 *
 * La pantalla Alertas administraba `smart_alert_rules`, que sólo evalúa el
 * motor de presupuestos: una regla de stock, ventas o clientes creada ahí se
 * guardaba y no disparaba nunca. Las que corren todos los días son las de
 * `alert_rules` (función check-alerts), y no se veían en ninguna pantalla:
 * Exentry tenía 6 activas sin saberlo. Acá está, por tipo, qué revisa cada una
 * y qué número se puede ajustar.
 */
export type TipoDeRegla =
  | "stock_low" | "low_margin" | "debt_overdue" | "customer_inactive"
  | "high_expense" | "product_expiry" | "stale_price";

export interface DefinicionDeRegla {
  tipo: TipoDeRegla;
  titulo: string;
  /** Qué revisa, con el número en {n}. */
  describe: string;
  campo: "threshold_value" | "threshold_days";
  unidad: string;
  porDefecto: number;
  minimo: number;
}

export const REGLAS_DE_ALERTA: DefinicionDeRegla[] = [
  { tipo: "stock_low", titulo: "Stock bajo", describe: "Productos activos con {n} unidades o menos.", campo: "threshold_value", unidad: "unidades", porDefecto: 5, minimo: 0 },
  { tipo: "product_expiry", titulo: "Vencimientos", describe: "Productos con stock que vencen en los próximos {n} días o ya vencieron.", campo: "threshold_days", unidad: "días", porDefecto: 30, minimo: 1 },
  { tipo: "low_margin", titulo: "Margen bajo", describe: "Productos activos con margen menor a {n}%.", campo: "threshold_value", unidad: "%", porDefecto: 15, minimo: 0 },
  { tipo: "stale_price", titulo: "Precio desactualizado", describe: "Precios que se alejan más de {n}% del que corresponde al dólar actual.", campo: "threshold_value", unidad: "%", porDefecto: 10, minimo: 1 },
  { tipo: "debt_overdue", titulo: "Deudas vencidas", describe: "Deudas de clientes vencidas hace más de {n} días.", campo: "threshold_days", unidad: "días", porDefecto: 7, minimo: 0 },
  { tipo: "customer_inactive", titulo: "Clientes que no vuelven", describe: "Clientes que compraron y no volvieron en {n} días.", campo: "threshold_days", unidad: "días", porDefecto: 60, minimo: 7 },
  { tipo: "high_expense", titulo: "Gastos del mes", describe: "Gastos del mes por encima de ${n}.", campo: "threshold_value", unidad: "$", porDefecto: 500000, minimo: 0 },
];

export function describirRegla(def: DefinicionDeRegla, valor: number): string {
  const n = def.unidad === "$" ? valor.toLocaleString("es-AR") : String(valor);
  return def.describe.replace("{n}", n);
}

/** Un umbral válido para guardar, o un mensaje que explica por qué no. */
export function validarUmbral(def: DefinicionDeRegla, crudo: string): { valor: number } | { error: string } {
  const v = Number(String(crudo).replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(v)) return { error: "Ingresá un número" };
  if (v < def.minimo) return { error: `El mínimo es ${def.minimo}` };
  if (def.campo === "threshold_days" && !Number.isInteger(v)) return { error: "Usá días enteros" };
  return { valor: v };
}
