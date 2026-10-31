/**
 * Velocidad de la tienda para el comercio (2026-10-31). Las Core Web Vitals
 * de visitas reales ya se miden (`store_vitales`, migración 20261011001000) y
 * hasta ahora sólo las veía la plataforma. Esto las resume para el dueño con
 * la vara de Google: una métrica pasa si al menos el 75% de las visitas es
 * buena; con menos de 20 visitas no hay datos para decir.
 */

export type MetricaVital = "lcp" | "inp" | "cls";

export interface FilaVitales {
  metrica: string;
  pagina: string;
  buenas: number;
  regulares: number;
  malas: number;
}

export interface ResumenMetrica {
  metrica: MetricaVital;
  visitas: number;
  /** % de visitas buenas, con un decimal; null sin visitas. */
  pctBuenas: number | null;
  estado: "pasa" | "a_mejorar" | "pocos_datos";
  /** La página con menos visitas buenas, para saber dónde mirar. */
  peorPagina: string | null;
}

export const DIAS_VELOCIDAD = 28;
export const MINIMO_VISITAS = 20;
export const META_BUENAS = 75;
const METRICAS: MetricaVital[] = ["lcp", "inp", "cls"];

export const NOMBRE_METRICA: Record<MetricaVital, string> = {
  lcp: "Carga de lo principal (LCP)",
  inp: "Respuesta al tocar (INP)",
  cls: "Estabilidad al cargar (CLS)",
};

/** Lo que el comercio puede hacer desde el panel, no desde el código. */
export const CONSEJO_METRICA: Record<MetricaVital, string> = {
  lcp: "Achicá las fotos de la portada y de los banners: la primera imagen grande es la que más tarda.",
  inp: "Revisá los píxeles y scripts de terceros (Meta, TikTok, chats): son los que más traban el toque.",
  cls: "Usá banners y fotos de un mismo tamaño para que la página no salte mientras carga.",
};

export const NOMBRE_PAGINA: Record<string, string> = {
  inicio: "la portada",
  productos: "el listado",
  producto: "la ficha de producto",
  otra: "otras páginas",
};

const entero = (n: unknown) => Math.max(0, Math.floor(Number(n) || 0));

export function resumirVitales(filas: FilaVitales[]): { metricas: ResumenMetrica[]; pasa: boolean | null } {
  const metricas = METRICAS.map((metrica): ResumenMetrica => {
    const propias = filas.filter(f => f.metrica === metrica);
    const porPagina = new Map<string, { buenas: number; visitas: number }>();
    let buenas = 0;
    let visitas = 0;
    for (const fila of propias) {
      const b = entero(fila.buenas);
      const v = b + entero(fila.regulares) + entero(fila.malas);
      buenas += b;
      visitas += v;
      const acumulada = porPagina.get(fila.pagina) ?? { buenas: 0, visitas: 0 };
      porPagina.set(fila.pagina, { buenas: acumulada.buenas + b, visitas: acumulada.visitas + v });
    }
    const pctBuenas = visitas > 0 ? Math.round((1000 * buenas) / visitas) / 10 : null;
    const estado = visitas < MINIMO_VISITAS ? "pocos_datos" : (pctBuenas ?? 0) >= META_BUENAS ? "pasa" : "a_mejorar";
    let peorPagina: string | null = null;
    let peorPct = Infinity;
    for (const [pagina, total] of porPagina) {
      if (total.visitas < 5) continue;
      const pct = total.buenas / total.visitas;
      if (pct < peorPct) { peorPct = pct; peorPagina = pagina; }
    }
    return { metrica, visitas, pctBuenas, estado, peorPagina };
  });
  const pasa = metricas.some(m => m.estado === "pocos_datos") ? null : metricas.every(m => m.estado === "pasa");
  return { metricas, pasa };
}
