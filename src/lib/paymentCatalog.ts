/**
 * Catálogo de medios de cobro (modelo Pago Nube / plataforma de comercio).
 *
 * Nerqia Pay es el producto. Los proveedores externos viven en
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

/** Proveedores externos que necesitan conexión o habilitación comercial. */
export function mediosExternosDelCatalogo(medios: MedioCatalogo[] | null | undefined): MedioCatalogo[] {
  return (medios ?? [])
    .filter((m) => ["oauth", "contrato"].includes(m.conexion) && m.provider !== "mercadopago")
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

/** Sólo el rail Mercado Pago de Nerqia Pay tiene conexión operativa hoy. */
export function puedeConectarMedioCatalogo(m: Pick<MedioCatalogo, "conexion" | "integracion" | "provider">): boolean {
  if (m.conexion !== "oauth") return false;
  if (m.provider === "mercadopago") return false;
  // Sin adapter vivo: nunca Conectar, aunque el catálogo diga produccion.
  return false;
}
