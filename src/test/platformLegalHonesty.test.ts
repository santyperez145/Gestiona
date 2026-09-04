import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PLATFORM_LEGAL, PLATFORM_PROCESSORS } from "@/lib/platformLegal";
import { redactTelemetryText, sanitizeTelemetryUrl } from "@/lib/sentry";

const ROOT = resolve(__dirname, "../..");
const terms = readFileSync(resolve(ROOT, "src/pages/TermsPage.tsx"), "utf8");
const privacy = readFileSync(resolve(ROOT, "src/pages/PrivacyPage.tsx"), "utf8");
const sentry = readFileSync(resolve(ROOT, "src/lib/sentry.ts"), "utf8");

describe("los documentos legales de plataforma describen el producto real", () => {
  it("no vuelven a prometer Stripe, USD, borrado automático ni un SLA inventado", () => {
    const publicCopy = `${terms}\n${privacy}`;
    expect(publicCopy).not.toMatch(/Stripe|dólares estadounidenses|99\.5%|48 horas continuas|por 30 días para permitir la recuperación/i);
  });

  it("declaran Mercado Pago, pesos, transferencia internacional y la identidad faltante", () => {
    expect(terms).toMatch(/pesos argentinos/i);
    expect(terms).toContain("Mercado Pago");
    expect(privacy).toContain("us-east-1, Estados Unidos");
    expect(privacy).toMatch(/no integra la lista argentina de países con nivel adecuado/i);
    expect(PLATFORM_LEGAL.providerIdentityComplete).toBe(false);
  });

  it("cada proveedor informa finalidad, datos y condición de uso", () => {
    expect(PLATFORM_PROCESSORS.length).toBeGreaterThanOrEqual(5);
    for (const processor of PLATFORM_PROCESSORS) {
      expect(processor.name.trim()).not.toBe("");
      expect(processor.purpose.trim()).not.toBe("");
      expect(processor.data.trim()).not.toBe("");
      expect(processor.condition.trim()).not.toBe("");
    }
  });
});

describe("la observabilidad minimiza datos antes de salir del navegador", () => {
  it("desactiva replay y no desactiva el enmascarado por accidente", () => {
    expect(sentry).toContain("replaysSessionSampleRate: 0");
    expect(sentry).toContain("replaysOnErrorSampleRate: 0");
    expect(sentry).not.toContain("replayIntegration(");
    expect(sentry).not.toContain("maskAllText: false");
    expect(sentry).not.toContain("blockAllMedia: false");
  });

  it("quita parámetros, email y credenciales de ejemplos representativos", () => {
    expect(sanitizeTelemetryUrl("https://nerqia.app/pedidos?email=cliente@test.com&token=secreto#detalle"))
      .toBe("https://nerqia.app/pedidos");
    expect(redactTelemetryText("falló cliente@test.com Bearer abc.def"))
      .toBe("falló [EMAIL_REDACTED] Bearer [REDACTED]");
  });
});
