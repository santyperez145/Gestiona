import { describe, expect, it } from "vitest";
import {
  isAmbiguousMercadoPagoStatus,
  mercadoPagoRefundPublicError,
} from "../../supabase/functions/_shared/mpProviderOutcome";

describe("clasificación de respuestas de Mercado Pago", () => {
  it.each([408, 409, 425, 429, 500, 502, 503])(
    "conserva HTTP %s como resultado ambiguo",
    (status) => expect(isAmbiguousMercadoPagoStatus(status)).toBe(true),
  );

  it.each([400, 401, 403, 404, 422])(
    "trata HTTP %s como rechazo concluyente",
    (status) => expect(isAmbiguousMercadoPagoStatus(status)).toBe(false),
  );

  it("devuelve mensajes operativos sin payload técnico", () => {
    expect(mercadoPagoRefundPublicError(401)).toContain("Integraciones");
    expect(mercadoPagoRefundPublicError(404)).toContain("cobro original");
    expect(mercadoPagoRefundPublicError(422)).toContain("saldo");
    expect(mercadoPagoRefundPublicError(503)).toContain("Verificá el estado");
  });
});
