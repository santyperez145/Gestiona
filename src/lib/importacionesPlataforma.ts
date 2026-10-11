// Importaciones de catálogo vistas desde Platform (vista
// `platform_importaciones_catalogo`, migración 20261010002700). E3 de
// docs/TESIS.md: «catálogo listo en < 30 min». También muestra las trabadas:
// las 12 de Ferretería Famatina (08–10/10) sólo se vieron mirando la base.

export const META_E3_MINUTOS = 30;

export interface ImportacionPlataforma {
  id: string;
  org_id: string;
  org_name: string;
  filename: string;
  status: "preparing" | "ready" | "applying" | "completed" | "cancelled";
  total: number;
  prepared: number;
  applied: number;
  created_at: string;
  updated_at: string;
  minutos: number | null;
  trabada: boolean;
}

export interface ImportacionesDeComercio {
  orgId: string;
  comercio: string;
  intentos: number;
  terminadas: number;
  trabadas: number;
  /** Minutos de la importación terminada más rápida; null si ninguna terminó. */
  mejorMinutos: number | null;
  /** Lo más lejos que llegó una sesión: filas aplicadas de cuántas. */
  avanceMaximo: { aplicadas: number; total: number } | null;
  cumpleE3: boolean;
}

export function resumirImportaciones(filas: ImportacionPlataforma[]): ImportacionesDeComercio[] {
  const porComercio = new Map<string, ImportacionPlataforma[]>();
  for (const f of filas) porComercio.set(f.org_id, [...(porComercio.get(f.org_id) ?? []), f]);
  return [...porComercio.entries()].map(([orgId, lista]) => {
    const terminadas = lista.filter(f => f.status === "completed");
    const tiempos = terminadas.map(f => Number(f.minutos)).filter(Number.isFinite);
    const mejorMinutos = tiempos.length ? Math.min(...tiempos) : null;
    const avance = lista.reduce<ImportacionPlataforma | null>((mejor, f) =>
      !mejor || Number(f.applied) > Number(mejor.applied) ? f : mejor, null);
    return {
      orgId,
      comercio: lista[0].org_name,
      intentos: lista.length,
      terminadas: terminadas.length,
      trabadas: lista.filter(f => f.trabada).length,
      mejorMinutos,
      avanceMaximo: avance ? { aplicadas: Number(avance.applied), total: Number(avance.total) } : null,
      cumpleE3: mejorMinutos !== null && mejorMinutos < META_E3_MINUTOS,
    };
  }).sort((a, b) => b.trabadas - a.trabadas || b.intentos - a.intentos);
}
