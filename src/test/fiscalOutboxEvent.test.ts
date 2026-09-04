import { describe, expect, it } from "vitest";
import { validarEventoFiscalOutbox } from "../../supabase/functions/_shared/fiscalOutboxEvent";

const EVENT = "11111111-1111-4111-8111-111111111111";
const SUB = "22222222-2222-4222-8222-222222222222";
const ORG = "33333333-3333-4333-8333-333333333333";
const INVOICE = "44444444-4444-4444-8444-444444444444";

const payload = {
  event_id: EVENT,
  subscription_id: SUB,
  event_type: "factura.creada",
  aggregate_type: "factura",
  aggregate_id: INVOICE,
  org_id: ORG,
  data: { invoice_id: INVOICE },
};

describe("evento fiscal de la outbox", () => {
  it("acepta el contrato exacto emitido por el Business Core", () => {
    expect(validarEventoFiscalOutbox(payload, "factura.creada", EVENT)).toEqual({
      value: {
        eventId: EVENT,
        subscriptionId: SUB,
        orgId: ORG,
        invoiceId: INVOICE,
        eventType: "factura.creada",
      },
    });
  });

  it("acepta una nota de crédito sólo con su tipo exacto en el header", () => {
    expect(validarEventoFiscalOutbox(
      { ...payload, event_type: "nota_credito.creada" },
      "nota_credito.creada",
      EVENT,
    ).value?.eventType).toBe("nota_credito.creada");
  });

  it("no permite convertir otro evento en un comando fiscal", () => {
    expect(validarEventoFiscalOutbox(
      { ...payload, event_type: "venta.registrada" },
      "venta.registrada",
      EVENT,
    ).error).toMatch(/Tipo/);
  });

  it("exige que body, header y agregado identifiquen lo mismo", () => {
    expect(validarEventoFiscalOutbox(payload, "factura.creada", SUB).error).toMatch(/header/);
    expect(validarEventoFiscalOutbox(
      { ...payload, data: { invoice_id: EVENT } },
      "factura.creada",
      EVENT,
    ).error).toMatch(/agregado/);
  });

  it("rechaza ids con forma inválida antes de consultar la base", () => {
    expect(validarEventoFiscalOutbox(
      { ...payload, subscription_id: "no-es-uuid" },
      "factura.creada",
      EVENT,
    ).error).toMatch(/Identificadores/);
  });
});
