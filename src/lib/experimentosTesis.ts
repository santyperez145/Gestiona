/**
 * Los cinco experimentos de docs/TESIS.md §9 contra su criterio de éxito
 * escrito antes de empezar. Las mediciones vienen de
 * `platform_experimentos_tesis()` (migración 20261011001200); los criterios y
 * las fechas se copian de TESIS.md y un test exige que coincidan.
 */

export interface MedicionesTesis {
  e1: { ventas: number; comercio: string | null };
  e2: { total: number; confirman: number };
  e3: { minutos: number | null; terminadas: number; intentos: number };
  e4: { marcas: number };
  e5: { con_4_semanas: number; pagan: number };
}

export type EstadoExperimento = "logrado" | "en_curso" | "vencido";

export interface Experimento {
  id: "E1" | "E2" | "E3" | "E4" | "E5";
  hipotesis: string;
  criterio: string;
  fecha: string;
  /** Lo medido hoy, en una línea. */
  medido: string;
  estado: EstadoExperimento;
}

export const CRITERIOS_TESIS = {
  E1: { ventasPorSemana: 20, fecha: "2026-11-07" },
  E2: { entrevistas: 15, confirman: 10, fecha: "2026-10-31" },
  E3: { minutos: 30, fecha: "2026-11-15" },
  E4: { marcas: 1, fecha: "2026-12-01" },
  E5: { pct: 30, fecha: "2026-12-15" },
} as const;

const estado = (logrado: boolean, fecha: string, hoy: string): EstadoExperimento =>
  logrado ? "logrado" : hoy > fecha ? "vencido" : "en_curso";

export function experimentosTesis(m: MedicionesTesis, hoy: string): Experimento[] {
  const c = CRITERIOS_TESIS;
  const pct = m.e5.con_4_semanas > 0 ? Math.round((m.e5.pagan / m.e5.con_4_semanas) * 100) : null;
  return [
    {
      id: "E1", hipotesis: "El comercio de catálogo grande vuelve cada semana",
      criterio: `≥ ${c.E1.ventasPorSemana} ventas por semana`, fecha: c.E1.fecha,
      medido: m.e1.comercio ? `${m.e1.ventas} ventas en los últimos 7 días (${m.e1.comercio})` : "Sin ventas en los últimos 7 días",
      estado: estado(m.e1.ventas >= c.E1.ventasPorSemana, c.E1.fecha, hoy),
    },
    {
      id: "E2", hipotesis: "Las herramientas sueltas duelen y se pagan",
      criterio: `≥ ${c.E2.confirman} de ${c.E2.entrevistas} entrevistas confirman`, fecha: c.E2.fecha,
      medido: `${m.e2.total} de ${c.E2.entrevistas} entrevistas · ${m.e2.confirman} confirman`,
      estado: estado(m.e2.confirman >= c.E2.confirman, c.E2.fecha, hoy),
    },
    {
      id: "E3", hipotesis: "Migrar es rápido",
      criterio: `Catálogo listo en < ${c.E3.minutos} min`, fecha: c.E3.fecha,
      medido: m.e3.minutos !== null
        ? `La más rápida: ${Math.round(m.e3.minutos)} min (${m.e3.terminadas} de ${m.e3.intentos} terminadas)`
        : `Ninguna importación terminada (${m.e3.intentos} intentos)`,
      estado: estado(m.e3.minutos !== null && m.e3.minutos < c.E3.minutos, c.E3.fecha, hoy),
    },
    {
      id: "E4", hipotesis: "Creators trae marcas",
      criterio: `≥ ${c.E4.marcas} marca nueva referida por sus influencers`, fecha: c.E4.fecha,
      medido: `${m.e4.marcas} ${m.e4.marcas === 1 ? "marca referida" : "marcas referidas"}`,
      estado: estado(m.e4.marcas >= c.E4.marcas, c.E4.fecha, hoy),
    },
    {
      id: "E5", hipotesis: "Se paga al reemplazar herramientas",
      criterio: `≥ ${c.E5.pct}% de los comercios con 4 semanas paga`, fecha: c.E5.fecha,
      medido: pct === null ? "Ningún comercio con 4 semanas todavía" : `${m.e5.pagan} de ${m.e5.con_4_semanas} pagan (${pct}%)`,
      estado: estado(pct !== null && pct >= c.E5.pct, c.E5.fecha, hoy),
    },
  ];
}
