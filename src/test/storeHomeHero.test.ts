import { describe, expect, it } from "vitest";
import { storeHomeShowsCommerceChrome, textoMediosHero } from "@/lib/storeHomeHero";

describe("textoMediosHero", () => {
  it("no inventa «pagos seguros» sin medios", () => {
    expect(textoMediosHero(null)).toBe("Elegí el medio en el checkout");
    expect(textoMediosHero([])).toBe("Elegí el medio en el checkout");
  });

  it("lista los medios reales", () => {
    expect(textoMediosHero(["transferencia"])).toMatch(/transferencia/i);
    expect(textoMediosHero(["transferencia", "gestiona_pay"])).toMatch(/ o /);
  });

  it("va con mayúscula inicial: es un valor suelto, no parte de una frase", () => {
    expect(textoMediosHero(["transferencia"])).toBe("Transferencia");
    expect(textoMediosHero(["efectivo", "transferencia"])).toBe("Efectivo o transferencia");
    expect(textoMediosHero(["saldo_a_favor"])).toBe("Tu saldo a favor");
  });
});

describe("storeHomeShowsCommerceChrome", () => {
  it("sin catálogo no monta trust ni hero de conversión", () => {
    expect(storeHomeShowsCommerceChrome(0)).toBe(false);
  });

  it("con al menos un producto sí", () => {
    expect(storeHomeShowsCommerceChrome(1)).toBe(true);
  });
});
