/**
 * Catálogo de medios de cobro (modelo Pago Nube / Tiendanube).
 *
 * Nerqia Pay es el producto. Los OAuth externos viven en
 * `payment_providers` con `integracion` honesta: declarado = próximamente,
 * sin botón Conectar. Mercado Pago es el rail de Pay, no una tarjeta aparte.
 */

export type MedioCatalogo = {
  provider: string;
  nombre: string;
  descripcion: string | null;
  conexion: string;
  integracion: string;
  conectado: boolean;
  habilitado: boolean;
  cuenta: string | null;
  soporta_cuotas: boolean;
  orden: number;
};

/** Proveedores que el panel muestra como «más medios» (OAuth externo). */
export function mediosOAuthDelCatalogo(medios: MedioCatalogo[] | null | undefined): MedioCatalogo[] {
  return (medios ?? [])
    .filter((m) => m.conexion === "oauth" && m.provider !== "mercadopago")
    .slice()
    .sort((a, b) => a.orden - b.orden || a.provider.localeCompare(b.provider));
}

export function etiquetaEstadoMedio(integracion: string | null | undefined): {
  label: string;
  tone: "live" | "beta" | "soon";
} {
  switch (String(integracion ?? "")) {
    case "produccion":
      return { label: "Disponible", tone: "live" };
    case "beta":
      return { label: "Beta", tone: "beta" };
    default:
      return { label: "Próximamente", tone: "soon" };
  }
}

/**
 * ¿El panel puede ofrecer «Conectar»?
 * Slice B: ningún OAuth externo tiene adapter. Sólo Nerqia Pay (rail MP)
 * conecta de verdad. Un `produccion` sin adapter no inventa un botón.
 */
export function puedeConectarMedioCatalogo(m: Pick<MedioCatalogo, "conexion" | "integracion" | "provider">): boolean {
  if (m.conexion !== "oauth") return false;
  if (m.provider === "mercadopago") return false;
  // Sin adapter vivo: nunca Conectar, aunque el catálogo diga produccion.
  return false;
}
