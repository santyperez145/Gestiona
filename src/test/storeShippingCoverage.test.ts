import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  etiquetaProvinciaCheckout,
  provinciasConEnvio,
  textoAnuncioEnvioAutomatico,
  textoCoberturaDomicilio,
} from "@/lib/storeShippingCoverage";

describe("cobertura de envío honesta", () => {
  it("el caso Exentry: una tarifa no es el país", () => {
    const codes = provinciasConEnvio(["AR-C", "AR-C", "XX", ""]);
    expect(codes).toEqual(["AR-C"]);
    expect(textoCoberturaDomicilio(codes)).toBe("Envío a domicilio en CABA");
    expect(textoAnuncioEnvioAutomatico({
      freeShippingAbove: 150000,
      fmt: (n) => `$${n}`,
      shippingProvinces: codes,
    })).toBe("Envío gratis desde $150000 · Envío a domicilio en CABA");
    expect(etiquetaProvinciaCheckout("AR-X", "Córdoba", codes)).toContain("sin envío a domicilio");
    expect(etiquetaProvinciaCheckout("AR-C", "Ciudad Autónoma de Buenos Aires", codes))
      .toBe("Ciudad Autónoma de Buenos Aires");
  });

  it("sin tarifario no promete envío gratis", () => {
    expect(textoAnuncioEnvioAutomatico({ freeShippingAbove: 150000, fmt: (n) => `$${n}` })).toBeNull();
    expect(textoCoberturaDomicilio([])).toBeNull();
    expect(textoCoberturaDomicilio(null)).toBeNull();
  });

  it("el checkout y el anuncio leen la cobertura del Core", () => {
    const checkout = readFileSync(resolve(process.cwd(), "src/storefront/StoreCheckout.tsx"), "utf8");
    const layout = readFileSync(resolve(process.cwd(), "src/storefront/StoreLayout.tsx"), "utf8");
    const home = readFileSync(resolve(process.cwd(), "src/storefront/StoreHome.tsx"), "utf8");
    expect(checkout).toContain("etiquetaProvinciaCheckout");
    expect(layout).toContain("textoCoberturaDomicilio");
    expect(home).toContain("textoCoberturaDomicilio");
  });
});
