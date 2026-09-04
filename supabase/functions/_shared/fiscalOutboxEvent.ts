/**
 * Contrato del evento durable que puede pedir una autorización fiscal.
 *
 * El secreto de cron prueba que la llamada salió de infraestructura Nerqia;
 * este contrato además impide usar esa capacidad para autorizar una factura
 * arbitraria. La Edge Function vuelve a contrastar los ids contra
 * `domain_events`, `event_subscriptions` y `outbox_events` antes de actuar.
 */

export type FiscalOutboxEvent = {
  eventId: string;
  subscriptionId: string;
  orgId: string;
  invoiceId: string;
  eventType: "factura.creada" | "nota_credito.creada";
};

export type FiscalOutboxValidation = {
  value?: FiscalOutboxEvent;
  error?: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function uuid(value: unknown): string | null {
  return typeof value === "string" && UUID.test(value) ? value : null;
}

/**
 * Valida sólo forma y consistencia. La existencia/autenticidad de las filas se
 * verifica después contra la base con service_role.
 */
export function validarEventoFiscalOutbox(
  input: unknown,
  eventTypeHeader: string | null,
  eventIdHeader: string | null,
): FiscalOutboxValidation {
  const body = object(input);
  const data = object(body?.data);
  if (!body || !data) return { error: "Evento fiscal inválido" };

  const eventId = uuid(body.event_id);
  const subscriptionId = uuid(body.subscription_id);
  const orgId = uuid(body.org_id);
  const aggregateId = uuid(body.aggregate_id);
  const dataInvoiceId = uuid(data.invoice_id);
  const eventType = body.event_type === "factura.creada" || body.event_type === "nota_credito.creada"
    ? body.event_type
    : null;

  if (!eventType || eventTypeHeader !== eventType) {
    return { error: "Tipo de evento fiscal inválido" };
  }
  if (body.aggregate_type !== "factura") {
    return { error: "Agregado fiscal inválido" };
  }
  if (!eventId || !subscriptionId || !orgId || !aggregateId || !dataInvoiceId) {
    return { error: "Identificadores del evento fiscal inválidos" };
  }
  if (eventIdHeader !== eventId) {
    return { error: "El header no corresponde al evento fiscal" };
  }
  if (aggregateId !== dataInvoiceId) {
    return { error: "La factura no corresponde al agregado fiscal" };
  }

  return {
    value: {
      eventId,
      subscriptionId,
      orgId,
      invoiceId: aggregateId,
      eventType,
    },
  };
}
