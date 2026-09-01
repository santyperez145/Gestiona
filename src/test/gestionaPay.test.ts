import { describe, expect, it } from "vitest";
import {
  decidirRailGestionaPay,
  destinoOAuthPermitido,
  eventoCanonicoMercadoPago,
  eventoCanonicoStripe,
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
