import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { origenDeVueltaPermitido } from "../../supabase/functions/_shared/origenDeVuelta";

/**
 * Vuelta del pago (2026-11-05). store-pay tomaba cualquier origen que mandara
 * el navegador: con un link de pago armado a mano, el comprador volvía de
 * Mercado Pago a un sitio que imitaba la tienda.
 */
const base = { basePublica: "https://nerqia.app" };

describe("origen de vuelta del pago", () => {
  it("acepta Nerqia, sus subdominios, el dominio propio verificado y localhost", () => {
    expect(origenDeVueltaPermitido("https://nerqia.app/tienda/x", base)).toBe("https://nerqia.app");
    expect(origenDeVueltaPermitido("https://www.nerqia.app", base)).toBe("https://www.nerqia.app");
    expect(origenDeVueltaPermitido("https://tienda.ejemplo.com.ar", { ...base, dominioPropio: "tienda.ejemplo.com.ar" }))
      .toBe("https://tienda.ejemplo.com.ar");
    expect(origenDeVueltaPermitido("http://localhost:4179", base)).toBe("http://localhost:4179");
  });

  it("rechaza orígenes ajenos y trucos de URL", () => {
    for (const ataque of [
      "https://evil.example",
      "https://nerqia.app.evil.example",
      "https://evilnerqia.app",
      "http://nerqia.app",
      "https://nerqia.app@evil.example",
      "https://usuario:clave@nerqia.app",
      "javascript:alert(1)",
      "//evil.example",
      "http://localhost.evil.example",
      "",
      null,
      42,
    ]) {
      expect(origenDeVueltaPermitido(ataque, base), String(ataque)).toBeNull();
    }
    // Un dominio propio sin verificar no se pasa: lo decide store-pay.
    expect(origenDeVueltaPermitido("https://tienda.ejemplo.com.ar", base)).toBeNull();
  });

  it("store-pay usa el validador y sólo con el dominio propio activo", () => {
    const fuente = readFileSync("supabase/functions/store-pay/index.ts", "utf8");
    expect(fuente).toContain("origenDeVueltaPermitido(returnUrl");
    expect(fuente).toContain('custom_domain_status === "active"');
    expect(fuente).not.toMatch(/safeReturnBase\(returnUrl\)/);
  });

  it("mp-subscribe tampoco devuelve a un back_url ajeno", () => {
    const fuente = readFileSync("supabase/functions/mp-subscribe/index.ts", "utf8");
    expect(fuente).toContain("origenDeVueltaPermitido(body.back_url");
    expect(fuente).not.toMatch(/String\(body\.back_url\)/);
  });
});
