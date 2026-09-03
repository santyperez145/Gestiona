import { describe, expect, it } from "vitest";
import { resumenEnvioCarrito } from "@/lib/storeCartProvince";

describe("resumenEnvioCarrito", () => {
  it("elige el domicilio más barato y no el retiro", () => {
    expect(
      resumenEnvioCarrito([
        { carrier: "retiro", price: 0, label: "Retiro" },
        { carrier: "correo", price: 4500, label: "Estándar" },
        { carrier: "correo", price: 2500, label: "Económico" },
      ]),
    ).toEqual({ amount: 2500, subtitle: "Económico" });
  });

  it("si sólo hay retiro, lo muestra", () => {
    expect(
      resumenEnvioCarrito([{ carrier: "retiro", price: 0, label: "Retiro en local" }]),
    ).toEqual({ amount: 0, subtitle: "Retiro en local" });
  });

  it("lista vacía = sin resumen (no inventa Gratis)", () => {
    expect(resumenEnvioCarrito([])).toBeNull();
  });
});
