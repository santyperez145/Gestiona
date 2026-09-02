import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("ofertas IA medibles", () => {
  it("el panel confirma con dialog propio y muestra AI Action Rate", () => {
    const panel = readFileSync(
      resolve(process.cwd(), "src/components/marketing/OfferRecommenderPanel.tsx"),
      "utf8",
    );
    expect(panel).toContain("useConfirmDialog");
    expect(panel).toContain("apply_ai_offer_recommendation");
    expect(panel).toContain("AI Action Rate");
    expect(panel).not.toMatch(/\bconfirm\s*\(/);
  });
});
