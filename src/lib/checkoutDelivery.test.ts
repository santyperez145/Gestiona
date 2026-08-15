import { describe, expect, it } from "vitest";
import { requiereDireccionDeEntrega } from "./checkoutDelivery";

describe("requiereDireccionDeEntrega", () => {
  it("no pide domicilio al retiro en tienda", () => {
    expect(requiereDireccionDeEntrega({ carrier: "retiro" }, true)).toBe(false);
  });

  it("pide domicilio para cualquier envío", () => {
    expect(requiereDireccionDeEntrega({ carrier: "andreani" }, true)).toBe(true);
    expect(requiereDireccionDeEntrega({ carrier: "propio" }, false)).toBe(true);
  });

  it("antes de cotizar sólo omite la dirección si existe retiro", () => {
    expect(requiereDireccionDeEntrega(null, true)).toBe(false);
    expect(requiereDireccionDeEntrega(null, false)).toBe(true);
  });
});
