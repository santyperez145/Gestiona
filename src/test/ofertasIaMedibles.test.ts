import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(process.cwd());

describe("ofertas IA medibles", () => {
  it("el panel confirma con dialog propio y muestra AI Action Rate", () => {
    const panel = readFileSync(
      resolve(ROOT, "src/components/marketing/OfferRecommenderPanel.tsx"),
      "utf8",
    );
    expect(panel).toContain("useConfirmDialog");
    expect(panel).toContain("apply_ai_offer_recommendation");
    expect(panel).toContain("AI Action Rate");
    expect(panel).toContain("mensajeDeEdgeFunction");
    expect(panel).not.toMatch(/\bconfirm\s*\(/);
  });

  it("el Dashboard aterriza en la vista Ofertas, no en Publicaciones", () => {
    const dash = readFileSync(resolve(ROOT, "src/pages/Dashboard.tsx"), "utf8");
    const marketing = readFileSync(resolve(ROOT, "src/pages/MarketingPage.tsx"), "utf8");
    const manifest = readFileSync(resolve(ROOT, "src/app/routeManifest.ts"), "utf8");
    const foco = readFileSync(resolve(ROOT, "src/lib/dashboardFocus.ts"), "utf8");
    const focoUi = readFileSync(resolve(ROOT, "src/components/dashboard/FocoDelDia.tsx"), "utf8");
    expect(dash).toContain('/marketing?vista=ofertas');
    expect(marketing).toContain('marketingParams.get("vista")');
    expect(marketing).toMatch(/vista === ['"]ofertas['"]/);
    expect(marketing).toMatch(/\[[^\]]*['"]ofertas['"][^\]]*\]\.map/);
    expect(marketing).toMatch(/activeTab === ['"]ofertas['"][\s\S]{0,200}OfferRecommenderPanel/);
    expect(marketing).toMatch(/activeTab === ['"]posts['"][^\n]*<PostsTab/);
    expect(marketing).not.toMatch(/activeTab === ['"]posts['"][^\n]*OfferRecommenderPanel/);
    expect(manifest).toContain('/ofertas-ia');
    expect(manifest).toContain("redirectTo: \"/marketing?vista=ofertas\"");
    expect(foco).toContain("ofertasIaPendientes");
    expect(foco).toContain('/marketing?vista=ofertas');
    expect(focoUi).toContain("ai_offer_recommendations");
    expect(focoUi).toContain('status", "pending"');
  });
});
