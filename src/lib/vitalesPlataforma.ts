// Resumen de Core Web Vitals por comercio para Platform (migración 20261011001000).

/** Google: una página pasa si ≥ 75% de las visitas están en «bueno». */
export const META_VITALES_PCT = 75;
/** Por debajo de esto por métrica, el porcentaje es ruido. */
export const MIN_VISITAS_VITALES = 20;

export interface FilaVitales {
  org_id: string;
  comercio: string;
  metrica: "lcp" | "cls" | "inp";
  visitas: number;
  buenas: number;
  regulares: number;
  malas: number;
  pct_buenas: number | null;
}

export interface VitalesDeComercio {
  org_id: string;
  comercio: string;
  metricas: Partial<Record<FilaVitales["metrica"], { visitas: number; pct_buenas: number | null }>>;
  estado: "pasa" | "no_pasa" | "pocos_datos";
}

/** Agrupa por comercio; los que no pasan primero, después los de pocos datos. */
export function resumirVitales(filas: FilaVitales[]): VitalesDeComercio[] {
  const porOrg = new Map<string, VitalesDeComercio>();
  for (const f of filas) {
    const c = porOrg.get(f.org_id) ?? { org_id: f.org_id, comercio: f.comercio, metricas: {}, estado: "pocos_datos" as const };
    c.metricas[f.metrica] = { visitas: Number(f.visitas) || 0, pct_buenas: f.pct_buenas === null ? null : Number(f.pct_buenas) };
    porOrg.set(f.org_id, c);
  }
  const orden = { no_pasa: 0, pocos_datos: 1, pasa: 2 };
  return [...porOrg.values()].map(c => {
    const ms = (["lcp", "inp", "cls"] as const).map(m => c.metricas[m]);
    const conDatos = ms.filter(m => m && m.visitas >= MIN_VISITAS_VITALES && m.pct_buenas !== null);
    const alguna = conDatos.some(m => (m!.pct_buenas as number) < META_VITALES_PCT);
    const estado: VitalesDeComercio["estado"] = alguna ? "no_pasa" : conDatos.length === 3 ? "pasa" : "pocos_datos";
    return { ...c, estado };
  }).sort((a, b) => orden[a.estado] - orden[b.estado] || a.comercio.localeCompare(b.comercio));
}
