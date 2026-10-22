/** Estado del certificado de cada comercio para soporte (ADR 007). */

export interface CertificadoDeComercio {
  org_id: string;
  organization_name: string | null;
  cuit: string | null;
  environment: string | null;
  modo: string | null;
  certificado_vence: string | null;
  certificado_verificado_motivo: string | null;
  pedido_creado_at: string | null;
  last_error: string | null;
  estado: string;
}

/** Orden de urgencia para soporte, y cómo se dice cada estado. */
export const ESTADOS: { id: string; etiqueta: string; tono: string }[] = [
  { id: "vencido", etiqueta: "Vencido", tono: "text-destructive" },
  { id: "rechazado", etiqueta: "Rechazado por ARCA", tono: "text-destructive" },
  { id: "por_vencer", etiqueta: "Vence en 30 días", tono: "text-amber-600" },
  { id: "falta_verificar", etiqueta: "Falta verificar el punto de venta", tono: "text-amber-600" },
  { id: "pedido_pendiente", etiqueta: "Pedido generado, sin certificado", tono: "text-amber-600" },
  { id: "sin_certificado", etiqueta: "Sin certificado", tono: "text-muted-foreground" },
  { id: "sin_datos", etiqueta: "Sin datos fiscales", tono: "text-muted-foreground" },
  { id: "delegado", etiqueta: "Delegado (modelo anterior)", tono: "text-muted-foreground" },
  { id: "listo", etiqueta: "Listo", tono: "text-emerald-600" },
];

export function ordenarPorUrgencia(filas: CertificadoDeComercio[]): CertificadoDeComercio[] {
  const rango = (e: string) => { const i = ESTADOS.findIndex(x => x.id === e); return i < 0 ? ESTADOS.length : i; };
  return [...filas].sort((a, b) => rango(a.estado) - rango(b.estado)
    || String(a.certificado_vence ?? "9999").localeCompare(String(b.certificado_vence ?? "9999"))
    || String(a.organization_name ?? "").localeCompare(String(b.organization_name ?? "")));
}
