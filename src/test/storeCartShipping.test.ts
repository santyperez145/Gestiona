import {
  cartShippingCellText,
  cartShippingDisplay,
  checkoutShippingDisplay,
} from "@/lib/storeCartShipping";
import { describe, expect, it } from "vitest";

const fmt = (n: number) => `$${n}`;

describe("cartShippingDisplay — carrito honesto vs checkout", () => {
  it("en modo zones no dice Gratis ni inventa el flat", () => {
    const d = cartShippingDisplay({
      shippingMode: "zones",
      cartEmpty: false,
      flatShippingCost: 0,
      freeShippingUnlocked: true,
    });
    expect(d.amount).toBeNull();
    expect(cartShippingCellText(d, fmt)).toBe("Se calcula con tu provincia");
  });

  it("en modo free sí dice Gratis", () => {
    const d = cartShippingDisplay({
      shippingMode: "free",
      cartEmpty: false,
      flatShippingCost: 5000,
      freeShippingUnlocked: false,
    });
    expect(d).toEqual({ label: "Gratis", amount: 0 });
    expect(cartShippingCellText(d, fmt)).toBe("Gratis");
  });

  it("en modo flat muestra el costo o Gratis por umbral", () => {
    expect(
      cartShippingCellText(
        cartShippingDisplay({
          shippingMode: "flat",
          cartEmpty: false,
          flatShippingCost: 2500,
          freeShippingUnlocked: false,
        }),
        fmt,
      ),
    ).toBe("$2500");

    expect(
      cartShippingCellText(
        cartShippingDisplay({
          shippingMode: "flat",
          cartEmpty: false,
          flatShippingCost: 2500,
          freeShippingUnlocked: true,
        }),
        fmt,
      ),
    ).toBe("Gratis");
  });

  it("carrito vacío no promete envío", () => {
    expect(
      cartShippingDisplay({
        shippingMode: "zones",
        cartEmpty: true,
        flatShippingCost: 0,
        freeShippingUnlocked: false,
      }),
    ).toEqual({ label: "—", amount: 0 });
  });
});

describe("checkoutShippingDisplay — resumen sin mentir Gratis", () => {
  it("sin opción en zones no cierra en $0", () => {
    expect(
      checkoutShippingDisplay({
        selectedPrice: null,
        hasOptions: false,
        zonesMode: true,
        quoting: false,
        quoteUnavailable: false,
        flatShippingCost: 0,
      }),
    ).toEqual({ label: "Se calcula con tu provincia", amount: null });
  });

  it("con opciones pero sin elegir, pide elegir", () => {
    expect(
      checkoutShippingDisplay({
        selectedPrice: null,
        hasOptions: true,
        zonesMode: true,
        quoting: false,
        quoteUnavailable: false,
        flatShippingCost: 2500,
      }).label,
    ).toBe("Elegí una opción");
  });

  it("opción a $0 sí es Gratis", () => {
    expect(
      cartShippingCellText(
        checkoutShippingDisplay({
          selectedPrice: 0,
          hasOptions: true,
          zonesMode: true,
          quoting: false,
          quoteUnavailable: false,
          flatShippingCost: 2500,
        }),
        fmt,
      ),
    ).toBe("Gratis");
  });
});
