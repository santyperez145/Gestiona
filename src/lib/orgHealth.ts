/**
 * Señales de salud de un comercio, del lado de la plataforma.
 *
 * El cálculo vive en la vista `platform_org_health` —el servidor es la
 * autoridad, igual que con las comisiones— y acá sólo se interpreta. Lo que sí
 * es decisión de producto y vive acá: qué señal es urgente y en qué orden se
 * miran. `SENALES` es espejo del `CASE` de
 * `20260802000010_salud_por_organizacion.sql`: si se toca una, se toca la otra.
 */

export type Senal =
  | "en_riesgo" | "sin_activar" | "cayendo" | "dormido" | "creciendo" | "estable";

export interface OrgHealthRow {
  org_id: string;
  org_name: string;
  slug: string | null;
  org_creada: string;
  plan_name: string | null;
  subscription_status: string;
  gmv_30d: number;
  gmv_prev_30d: number;
  gmv_total: number;
  comision_30d: number;
  comision_total: number;
  cobros_30d: number;
  cobros_total: number;
  ultimo_cobro: string | null;
  dias_sin_cobrar: number | null;
  miembros: number;
  productos: number;
  tiendas_activas: number;
  variacion_pct: number | null;
  senal: Senal;
}

interface SenalMeta {
  label: string;
  /** Qué hacer con ese comercio. Una señal sin acción es un adorno. */
  accion: string;
  /** Menor = más urgente. Ordena la lista y el resumen. */
  prioridad: number;
  tono: "destructive" | "warning" | "blue" | "success" | "primary";
}

export const SENALES: Record<Senal, SenalMeta> = {
  en_riesgo: {
    label: "En riesgo",
    accion: "Facturaba y este mes no vendió nada. Es el llamado urgente.",
    prioridad: 1,
    tono: "destructive",
  },
  cayendo: {
    label: "Cayendo",
    accion: "Factura menos de la mitad que el mes pasado.",
    prioridad: 2,
    tono: "warning",
  },
  sin_activar: {
    label: "Sin activar",
    accion: "Se registró y nunca cobró un peso. Es onboarding, no churn.",
    prioridad: 3,
    tono: "blue",
  },
  dormido: {
    label: "Dormido",
    accion: "Más de 90 días sin cobrar. Ya se fue, aunque el plan siga activo.",
    prioridad: 4,
    tono: "warning",
  },
  creciendo: {
    label: "Creciendo",
    accion: "Factura más de un 20% que el mes pasado.",
    prioridad: 5,
    tono: "success",
  },
  estable: {
    label: "Estable",
    accion: "Vende parecido al mes pasado.",
    prioridad: 6,
    tono: "primary",
  },
};

/** Las que piden que alguien haga algo hoy. */
export const SENALES_URGENTES: Senal[] = ["en_riesgo", "cayendo", "sin_activar"];

export function esUrgente(s: Senal): boolean {
  return SENALES_URGENTES.includes(s);
}

/**
 * Ordena por urgencia y, dentro de la misma señal, por lo que está en juego:
 * un comercio que factura un millón y cae vale más atención que uno que
 * factura mil y cae.
 */
export function ordenarPorAtencion(rows: OrgHealthRow[]): OrgHealthRow[] {
  return [...rows].sort((a, b) => {
    const pa = SENALES[a.senal]?.prioridad ?? 99;
    const pb = SENALES[b.senal]?.prioridad ?? 99;
    if (pa !== pb) return pa - pb;
    return Math.max(b.gmv_30d, b.gmv_prev_30d) - Math.max(a.gmv_30d, a.gmv_prev_30d);
  });
}

export interface ResumenPlataforma {
  comercios: number;
  gmv30: number;
  gmvPrev30: number;
  comision30: number;
  comisionTotal: number;
  /** Comercios que cobraron al menos una vez en los últimos 30 días. */
  activos30: number;
  /** GMV en riesgo: lo que facturaron el mes pasado los que hoy están mal. */
  gmvEnRiesgo: number;
  porSenal: Record<Senal, number>;
  /** Variación del GMV total, o null si no hay mes anterior contra qué comparar. */
  variacionPct: number | null;
}

export function resumirPlataforma(rows: OrgHealthRow[]): ResumenPlataforma {
  const porSenal = Object.fromEntries(
    (Object.keys(SENALES) as Senal[]).map(s => [s, 0]),
  ) as Record<Senal, number>;

  let gmv30 = 0, gmvPrev30 = 0, comision30 = 0, comisionTotal = 0;
  let activos30 = 0, gmvEnRiesgo = 0;

  for (const r of rows) {
    gmv30 += Number(r.gmv_30d) || 0;
    gmvPrev30 += Number(r.gmv_prev_30d) || 0;
    comision30 += Number(r.comision_30d) || 0;
    comisionTotal += Number(r.comision_total) || 0;
    if ((Number(r.cobros_30d) || 0) > 0) activos30++;
    if (porSenal[r.senal] !== undefined) porSenal[r.senal]++;
    // Lo que se pierde si no se hace nada: se mide con el mes anterior, que es
    // lo que ese comercio demostró que puede facturar.
    if (r.senal === "en_riesgo" || r.senal === "cayendo") {
      gmvEnRiesgo += Number(r.gmv_prev_30d) || 0;
    }
  }

  return {
    comercios: rows.length,
    gmv30, gmvPrev30, comision30, comisionTotal, activos30, gmvEnRiesgo, porSenal,
    variacionPct: gmvPrev30 > 0
      ? Math.round(((gmv30 - gmvPrev30) / gmvPrev30) * 1000) / 10
      : null,
  };
}

/** Pesos redondeados, que es como se lee un tablero. */
export function pesos(n: number): string {
  return `$${Math.round(Number(n) || 0).toLocaleString("es-AR")}`;
}

/** "hace 3 días", "hoy", "nunca". Un ISO crudo en una tabla no se lee. */
export function desdeUltimoCobro(dias: number | null): string {
  if (dias === null || dias === undefined) return "nunca";
  if (dias <= 0) return "hoy";
  if (dias === 1) return "ayer";
  if (dias < 30) return `hace ${dias} días`;
  const meses = Math.floor(dias / 30);
  return meses === 1 ? "hace 1 mes" : `hace ${meses} meses`;
}
