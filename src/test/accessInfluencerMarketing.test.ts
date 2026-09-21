import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { aliasRedirects, businessRoutes, influencerMarketingProductRoutes } from "@/app/routeManifest";

const ROOT = resolve(__dirname, "../..");
const APP = readFileSync(resolve(ROOT, "src/App.tsx"), "utf8");
const LAYOUT = readFileSync(resolve(ROOT, "src/components/AppLayout.tsx"), "utf8");
const GATE = readFileSync(resolve(ROOT, "src/components/influencers/InfluencerMarketingGate.tsx"), "utf8");
const MIGRATION = readFileSync(resolve(ROOT, "supabase/migrations/20260921000100_influencer_product_surface.sql"), "utf8");

describe("Nerqia Influencers es una superficie de producto alcanzable", () => {
  it("aparece como plataforma propia en el sidebar Business", () => {
    expect(LAYOUT).toContain('to="/influencer-marketing"');
    expect(LAYOUT).toContain("forModule('influencers').canView");
    expect(LAYOUT).toContain("Nerqia Influencers");
  });

  it("sus páginas están anidadas bajo una única URL canónica", () => {
    const paths = influencerMarketingProductRoutes().map(route => route.path);
    expect(paths).toEqual([
      "/influencer-marketing",
      "/influencer-marketing/campanas",
      "/influencer-marketing/creadores",
      "/influencer-marketing/descubrir",
      "/influencer-marketing/matching",
      "/influencer-marketing/briefs",
      "/influencer-marketing/colaboraciones",
      "/influencer-marketing/contratos",
      "/influencer-marketing/entregables",
      "/influencer-marketing/pagos",
      "/influencer-marketing/portal-marca",
    ]);
    expect(APP).toContain('route.path.slice("/influencer-marketing/".length)');
    expect(businessRoutes("admin").some(route => route.path.startsWith("/influencer-marketing"))).toBe(false);
  });

  it("los enlaces históricos redirigen a la superficie nueva", () => {
    expect(aliasRedirects()["/influencers"]).toBe("/influencer-marketing/creadores");
    expect(aliasRedirects()["/canjes"]).toBe("/influencer-marketing/colaboraciones");
    expect(aliasRedirects()["/brand-portal"]).toBe("/influencer-marketing/portal-marca");
  });
});

describe("el acceso no se simula en el navegador", () => {
  it("el gate usa el RPC compartido y permite solicitar acceso", () => {
    expect(GATE).toContain('from "@/hooks/useInfluencerProductAccess"');
    expect(GATE).toContain("requestAccess");
    expect(GATE).not.toContain("setTimeout");
  });

  it("la base reconoce el producto en consulta, solicitud y decisión", () => {
    expect(MIGRATION).toContain("p_product_key NOT IN ('business', 'finance', 'influencers')");
    expect(MIGRATION).toContain("p_product_key NOT IN ('finance', 'influencers')");
    expect(MIGRATION).toContain("public.has_permission(p_org_id, 'influencers', 'view')");
    expect(MIGRATION).toContain("organization_product_access_events");
  });
});
