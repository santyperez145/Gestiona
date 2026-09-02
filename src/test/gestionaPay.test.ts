import { describe, expect, it } from "vitest";
import {
  decidirRailGestionaPay,
  destinoOAuthPermitido,
  esMedioGestionaPay,
  etiquetaMedioTienda,
  eventoCanonicoMercadoPago,
  eventoCanonicoStripe,
  MEDIO_GESTIONA_PAY,
  mediosDePagoOfrecibles,
  normalizarDescuentosMedios,
  normalizarMediosTienda,
} from "@/lib/gestionaPay";

describe("decidirRailGestionaPay", () => {
  it("en Argentina elige Mercado Pago aunque Stripe esté conectado", () => {
    const d = decidirRailGestionaPay({
      pais: "AR",
      conectados: ["stripe", "mercadopago"],
    });
    expect(d.provider).toBe("mercadopago");
    expect(d.listo).toBe(true);
  });

  it("en Argentina sin OAuth el rail sigue siendo Mercado Pago, no listo", () => {
    const d = decidirRailGestionaPay({ pais: "ar", conectados: ["stripe"] });
    expect(d.provider).toBe("mercadopago");
    expect(d.listo).toBe(false);
    expect(d.motivo.toLowerCase()).toContain("stripe");
    expect(d.motivo.toLowerCase()).toContain("gestiona pay");
  });

  it("en un mercado Stripe no usa Mercado Pago por default", () => {
    const d = decidirRailGestionaPay({ pais: "US", conectados: [] });
    expect(d.provider).toBe("stripe");
    expect(d.listo).toBe(false);
  });
});

describe("eventos canónicos", () => {
  it("traduce estados de Mercado Pago al contrato de Gestiona Pay", () => {
    expect(eventoCanonicoMercadoPago("approved")).toBe("payment.succeeded");
    expect(eventoCanonicoMercadoPago("rejected")).toBe("payment.failed");
    expect(eventoCanonicoMercadoPago("charged_back")).toBe("payment.disputed");
    expect(eventoCanonicoMercadoPago("in_process")).toBe("payment.created");
    expect(eventoCanonicoMercadoPago("no-existe")).toBeNull();
  });

  it("mapea eventos Stripe de Connect sin tratar billing de Gestiona como cobro merchant", () => {
    expect(eventoCanonicoStripe("payment_intent.succeeded")).toBe("payment.succeeded");
    expect(eventoCanonicoStripe("invoice.payment_succeeded")).toBeNull();
    expect(eventoCanonicoStripe("charge.dispute.created")).toBe("payment.disputed");
  });
});

describe("medio canónico gestiona_pay", () => {
  it("reconoce canónico y alias legacy", () => {
    expect(esMedioGestionaPay("gestiona_pay")).toBe(true);
    expect(esMedioGestionaPay("mercadopago")).toBe(true);
    expect(esMedioGestionaPay("transferencia")).toBe(false);
  });

  it("etiqueta Gestiona Pay, nunca Mercado Pago (Gestiona Pay)", () => {
    expect(etiquetaMedioTienda("gestiona_pay")).toBe("Gestiona Pay");
    expect(etiquetaMedioTienda("mercadopago")).toBe("Gestiona Pay");
    expect(etiquetaMedioTienda("gestiona_pay")).not.toMatch(/Mercado Pago \(Gestiona Pay\)/);
  });

  it("normaliza mercadopago a gestiona_pay sin duplicar", () => {
    expect(normalizarMediosTienda(["mercadopago", "transferencia", "gestiona_pay"]))
      .toEqual([MEDIO_GESTIONA_PAY, "transferencia"]);
    expect(normalizarDescuentosMedios({ mercadopago: 10, transferencia: 5 }))
      .toEqual({ gestiona_pay: 10, transferencia: 5 });
  });
});

describe("mediosDePagoOfrecibles", () => {
  it("saca Stripe y PayPal, y normaliza el canónico de Pay", () => {
    expect(mediosDePagoOfrecibles(["mercadopago", "stripe", "paypal", "transferencia"]))
      .toEqual(["gestiona_pay", "transferencia"]);
  });

  it("no inventa transferencia cuando el array viene vacío", () => {
    expect(mediosDePagoOfrecibles([])).toEqual([]);
    expect(mediosDePagoOfrecibles(null)).toEqual([]);
  });
});

describe("destinoOAuthPermitido", () => {
  const origin = "https://app.gestiona.example";

  it("acepta volver a Commerce o a Integraciones", () => {
    expect(destinoOAuthPermitido(`${origin}/tienda-online?tab=settings`, origin))
      .toBe("/tienda-online?tab=settings");
    expect(destinoOAuthPermitido(`${origin}/integraciones?tab=conexiones`, origin))
      .toBe("/integraciones?tab=conexiones");
  });

  it("rechaza otro origen y rutas ajenas", () => {
    expect(destinoOAuthPermitido("https://evil.example/tienda-online", origin)).toBeNull();
    expect(destinoOAuthPermitido(`${origin}/ajustes`, origin)).toBeNull();
    expect(destinoOAuthPermitido("javascript:alert(1)", origin)).toBeNull();
  });
});
