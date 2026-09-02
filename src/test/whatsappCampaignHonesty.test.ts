import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  whatsappCampaignChannelReady,
  whatsappCampaignSendSucceeded,
} from "@/lib/whatsappCampaignHonesty";

const ROOT = resolve(process.cwd());

describe("whatsappCampaignHonesty", () => {
  it("sin whatsapp_listo no se ofrece el canal", () => {
    expect(whatsappCampaignChannelReady({ whatsapp_listo: false })).toBe(false);
    expect(whatsappCampaignChannelReady({ whatsapp_listo: null })).toBe(false);
    expect(whatsappCampaignChannelReady({})).toBe(false);
    expect(whatsappCampaignChannelReady({ whatsapp_listo: true })).toBe(true);
  });

  it("cero enviados no es un éxito", () => {
    expect(whatsappCampaignSendSucceeded({ sent: 0 })).toBe(false);
    expect(whatsappCampaignSendSucceeded({ sent: 0, error: null })).toBe(false);
    expect(whatsappCampaignSendSucceeded({ sent: 3 })).toBe(true);
    expect(whatsappCampaignSendSucceeded({ sent: 2, error: "x" })).toBe(false);
  });

  it("la UI y el servidor dejan de pedir Evolution como puerta", () => {
    const page = readFileSync(resolve(ROOT, "src/pages/WhatsAppCampaignsPage.tsx"), "utf8");
    const fn = readFileSync(resolve(ROOT, "supabase/functions/send-whatsapp/index.ts"), "utf8");
    expect(page).toContain("mensajeria_de_plataforma");
    expect(page).toContain("whatsappCampaignChannelReady");
    expect(page).toContain("mensajeDeEdgeFunction");
    expect(page).toContain("whatsappCampaignSendSucceeded");
    expect(page).toContain("canalListo === false");
    expect(fn).toContain("whatsapp_listo");
    expect(fn).toContain("mensajeria_de_plataforma");
    expect(fn).toContain("enviarWhatsApp");
    expect(fn).not.toContain("getEvolutionCredentials");
    expect(fn).not.toMatch(/Evolution API no configurada/);
    expect(fn).toContain('status = sent === 0 ? "failed" : "sent"');
  });
});
