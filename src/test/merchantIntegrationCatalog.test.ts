import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  filterMerchantCatalog,
  merchantIntegrationCta,
  merchantIntegrationHref,
} from "@/lib/merchantIntegrationCatalog";

const ROOT = process.cwd();

describe("mercado de integraciones del comercio", () => {
  it("CTA de envíos listos manda a precios por provincia", () => {
    expect(merchantIntegrationHref("gestiona_envios")).toBe("/envios?tab=zonas");
    expect(merchantIntegrationCta({
      integration_key: "gestiona_envios",
      lifecycle: "production",
      requires_contract: false,
    }).label).toMatch(/provincia/i);
  });

  it("Correo/Andreani/OCA no se presentan como listos sin contrato", () => {
    for (const key of ["correo_argentino", "andreani", "oca"] as const) {
      const cta = merchantIntegrationCta({
        integration_key: key,
        lifecycle: "needs_contract",
        requires_contract: true,
      });
      expect(cta.href).toBe("/envios?tab=transportistas");
      expect(cta.label).toMatch(/transportistas/i);
    }
  });

  it("el filtro no inventa filas", () => {
    const rows = [
      {
        integration_key: "gestiona_envios",
        display_name: "Envíos Nerqia",
        category: "shipping",
        connection_mode: "manual",
        lifecycle: "production",
        description: "Tarifario",
        capabilities: ["tarifario_provincia"],
        requires_contract: false,
        sort_order: 1,
      },
      {
        integration_key: "mercadopago",
        display_name: "Mercado Pago",
        category: "payments",
        connection_mode: "oauth",
        lifecycle: "production",
        description: "Cobros",
        capabilities: ["checkout"],
        requires_contract: false,
        sort_order: 2,
      },
    ];
    expect(filterMerchantCatalog(rows, { category: "shipping" })).toHaveLength(1);
    expect(filterMerchantCatalog(rows, { query: "andreani" })).toHaveLength(0);
    expect(filterMerchantCatalog(rows, { query: "mercado" })[0].integration_key).toBe("mercadopago");
  });

  it("la migración crea catálogo merchant-safe y siembra OCA + Envíos Nerqia", () => {
    const mig = readFileSync(
      resolve(ROOT, "supabase/migrations/20260903000010_merchant_integration_marketplace.sql"),
      "utf8",
    );
    expect(mig).toContain("CREATE OR REPLACE VIEW public.merchant_integration_catalog");
    expect(mig).toContain("GRANT SELECT ON public.merchant_integration_catalog TO authenticated");
    expect(mig).toContain("REVOKE ALL ON public.merchant_integration_catalog FROM PUBLIC, anon");
    expect(mig).toContain("'gestiona_envios'");
    expect(mig).toContain("'oca'");
    expect(mig).not.toMatch(/access_token|password|api_key/i);
  });

  it("Integraciones monta el mercado y no promete Envío Nube", () => {
    const page = readFileSync(resolve(ROOT, "src/pages/IntegrationsPage.tsx"), "utf8");
    const panel = readFileSync(
      resolve(ROOT, "src/components/integrations/IntegrationsMarketplace.tsx"),
      "utf8",
    );
    expect(page).toContain("IntegrationsMarketplace");
    expect(page).toContain('value="mercado"');
    expect(panel).toContain("merchant_integration_catalog");
    expect(panel).not.toMatch(/Envío Nube|envío nube/i);
    expect(panel).toContain("sin contrato");
  });
});
