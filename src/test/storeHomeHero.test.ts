import { describe, expect, it } from "vitest";
import { textoMediosHero } from "@/lib/storeHomeHero";

describe("textoMediosHero", () => {
  it("no inventa «pagos seguros» sin medios", () => {
    expect(textoMediosHero(null)).toBe("Elegí el medio en el checkout");
    expect(textoMediosHero([])).toBe("Elegí el medio en el checkout");
  });

  it("lista los medios reales", () => {
    expect(textoMediosHero(["transferencia"])).toMatch(/transferencia/i);
    expect(textoMediosHero(["transferencia", "gestiona_pay"])).toMatch(/ o /);
  });
});
