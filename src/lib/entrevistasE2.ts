// Experimento E2 de docs/TESIS.md: «Las herramientas sueltas duelen y se
// pagan». 15 entrevistas, 5 por puerta de §4. Éxito si ≥ 10 usan 3 o más
// herramientas y nombran el margen real como pregunta sin respuesta.
// Fecha: 2026-10-31. Regla Lean: el criterio está escrito antes de empezar;
// acá sólo se cuenta contra él.

export type Puerta = "catalogo_grande" | "marca_influencers" | "muchos_gastos";

export const PUERTAS: { id: Puerta; nombre: string }[] = [
  { id: "catalogo_grande", nombre: "Catálogo grande" },
  { id: "marca_influencers", nombre: "Marca con influencers" },
  { id: "muchos_gastos", nombre: "Negocio con muchos gastos" },
];

export const META_E2 = { entrevistas: 15, porPuerta: 5, exitos: 10, herramientas: 3, fecha: "2026-10-31" } as const;

export interface EntrevistaE2 {
  id: string;
  fecha: string;
  puerta: Puerta;
  comercio: string;
  rubro: string | null;
  herramientas: string[];
  pago_mensual_ars: number | null;
  margen_sin_respuesta: boolean;
  preguntas_sin_respuesta: string | null;
  notas: string | null;
}

/** Cumple la hipótesis: 3+ herramientas y el margen real sin respuesta. */
export function confirmaHipotesis(e: Pick<EntrevistaE2, "herramientas" | "margen_sin_respuesta">): boolean {
  return e.herramientas.filter(h => h.trim()).length >= META_E2.herramientas && e.margen_sin_respuesta;
}

export type EstadoE2 = "en_curso" | "validada" | "refutada";

export interface ResumenE2 {
  total: number;
  confirman: number;
  porPuerta: Record<Puerta, number>;
  faltanPorPuerta: Record<Puerta, number>;
  estado: EstadoE2;
  /** Mediana de lo que pagan por mes los que lo dijeron; null si nadie. */
  pagoMediano: number | null;
}

export function resumirE2(entrevistas: EntrevistaE2[]): ResumenE2 {
  const porPuerta = { catalogo_grande: 0, marca_influencers: 0, muchos_gastos: 0 } as Record<Puerta, number>;
  for (const e of entrevistas) porPuerta[e.puerta] += 1;
  const faltanPorPuerta = Object.fromEntries(
    PUERTAS.map(p => [p.id, Math.max(0, META_E2.porPuerta - porPuerta[p.id])]),
  ) as Record<Puerta, number>;
  const confirman = entrevistas.filter(confirmaHipotesis).length;
  const total = entrevistas.length;
  // Validada en cuanto alcanza las 10; refutada sólo cuando ya no puede
  // alcanzarlas con las que faltan para llegar a 15.
  const pendientes = Math.max(0, META_E2.entrevistas - total);
  const estado: EstadoE2 = confirman >= META_E2.exitos ? "validada"
    : confirman + pendientes < META_E2.exitos ? "refutada"
    : "en_curso";
  const pagos = entrevistas.map(e => e.pago_mensual_ars).filter((n): n is number => n !== null && Number.isFinite(Number(n))).map(Number).sort((a, b) => a - b);
  const pagoMediano = pagos.length === 0 ? null
    : pagos.length % 2 ? pagos[(pagos.length - 1) / 2]
    : (pagos[pagos.length / 2 - 1] + pagos[pagos.length / 2]) / 2;
  return { total, confirman, porPuerta, faltanPorPuerta, estado, pagoMediano };
}

/** «Excel, Tango; Tiendanube» → ["Excel", "Tango", "Tiendanube"], sin repetidas. */
export function parsearHerramientas(texto: string): string[] {
  const vistas = new Set<string>();
  const out: string[] = [];
  for (const parte of texto.split(/[,;\n]/)) {
    const h = parte.trim().slice(0, 60);
    if (!h || vistas.has(h.toLowerCase())) continue;
    vistas.add(h.toLowerCase());
    out.push(h);
  }
  return out.slice(0, 20);
}
