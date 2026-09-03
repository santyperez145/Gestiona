/**
 * Mercado de integraciones del comercio (Tiendanube Apps, traducido).
 * Catálogo de producto + CTA: sin tokens, sin fingir API live con contrato.
 */

export type MerchantIntegrationRow = {
  integration_key: string;
  display_name: string;
  category: string;
  connection_mode: string;
  lifecycle: string;
  description: string;
  capabilities: string[] | null;
  requires_contract: boolean;
  sort_order: number;
};

export const MERCHANT_CATEGORY_LABEL: Record<string, string> = {
  payments: "Cobros",
  shipping: "Envíos",
  commerce: "Canales",
  tax: "Fiscal",
  messaging: "Mensajería",
  automation: "Automatización",
  platform: "Plataforma",
};

export const MERCHANT_LIFECYCLE_LABEL: Record<string, string> = {
  production: "Listo para usar",
  beta: "Beta",
  needs_setup: "Falta configurar",
  needs_contract: "Requiere contrato",
  planned: "Próximamente",
};

/** Destino accionable; null = sólo lectura informativa. */
export function merchantIntegrationHref(key: string): string | null {
  switch (key) {
    case "mercadopago":
    case "gestiona_pay":
      return "/integraciones?tab=conexiones";
    case "mercadolibre":
      return "/integraciones?tab=conexiones";
    case "arca":
      return "/afip";
    case "gestiona_envios":
      return "/envios?tab=zonas";
    case "correo_argentino":
    case "andreani":
    case "oca":
      return "/envios?tab=transportistas";
    case "webhooks":
      return "/integraciones?tab=webhooks";
    case "evolution_api":
      return "/integraciones?tab=conexiones";
    default:
      return null;
  }
}

export function merchantIntegrationCta(row: Pick<MerchantIntegrationRow, "integration_key" | "lifecycle" | "requires_contract">): {
  label: string;
  href: string | null;
} {
  const href = merchantIntegrationHref(row.integration_key);
  if (row.lifecycle === "planned") {
    return { label: "Todavía no disponible", href: null };
  }
  if (row.requires_contract || row.lifecycle === "needs_contract") {
    return { label: "Ver transportistas", href: href ?? "/envios?tab=transportistas" };
  }
  if (row.lifecycle === "needs_setup") {
    return { label: "Configurar", href };
  }
  if (row.integration_key === "gestiona_envios") {
    return { label: "Cargar precios por provincia", href: href ?? "/envios?tab=zonas" };
  }
  return { label: "Abrir", href };
}

export function filterMerchantCatalog(
  rows: MerchantIntegrationRow[],
  opts: { category?: string; query?: string },
): MerchantIntegrationRow[] {
  const q = String(opts.query ?? "").trim().toLowerCase();
  return rows
    .filter((r) => !opts.category || opts.category === "all" || r.category === opts.category)
    .filter((r) => {
      if (!q) return true;
      const hay = [
        r.display_name,
        r.description,
        r.integration_key,
        ...(r.capabilities ?? []),
      ].join(" ").toLowerCase();
      return hay.includes(q);
    })
    .sort((a, b) => a.sort_order - b.sort_order || a.display_name.localeCompare(b.display_name, "es"));
}
