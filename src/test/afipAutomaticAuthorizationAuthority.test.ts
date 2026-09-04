import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");
const migration = read("supabase/migrations/20260903000100_factura_creada_autorizacion_automatica.sql");
const handler = read("supabase/functions/afip-authorize/index.ts");

describe("autorización ARCA automática", () => {
  it("consume factura.creada por la misma outbox durable", () => {
    expect(migration).toContain("'factura.creada'");
    expect(migration).toContain("'nota_credito.creada'");
    expect(migration).toContain("'edge_function'");
    expect(migration).toContain("'afip-authorize'");
    expect(migration).not.toContain("CREATE TABLE public.invoices");
  });

  it("el secreto de cron no alcanza: evento, suscripción y entrega se revalidan", () => {
    expect(handler).toContain("esLlamadaDeCron(req)");
    expect(handler).toContain("validarEventoFiscalOutbox");
    expect(handler).toContain('.from("domain_events")');
    expect(handler).toContain('.from("event_subscriptions")');
    expect(handler).toContain('.from("outbox_events")');
    expect(handler).toContain("invoice.org_id !== eventoFiscal?.orgId");
    expect(handler).toContain("subscription.patron !== evento.eventType");
  });

  it("el camino humano conserva owner/admin y el sistema no acepta un actor falso", () => {
    expect(handler).toContain("if (!llamadaOutbox)");
    expect(handler).toContain('.in("role", ["owner", "admin"])');
    expect(handler).toContain("p_requested_by: actorId");
    expect(migration).toContain("p_requested_by IS NOT NULL AND NOT public.has_org_role");
    expect(migration).toContain("FROM PUBLIC, anon, authenticated");
  });

  it("persiste el candidato antes del request y reconcilia antes de repetir", () => {
    const candidate = handler.indexOf('"afip_autorizacion_candidato"');
    const request = handler.indexOf("solicitarCAE({");
    expect(candidate).toBeGreaterThan(-1);
    expect(request).toBeGreaterThan(candidate);
    expect(handler).toContain("consultarComprobante({");
    expect(handler).toContain('"FECompConsultar"');
    expect(migration).toContain("afip_candidate_number");
  });

  it("una respuesta ambigua conserva retry; un rechazo fiscal termina", () => {
    expect(handler).toContain('return err("La autorización fiscal sigue en curso y será reconciliada", 503)');
    expect(handler).toContain('["rejected", "config_error", "validation_error"]');
    expect(handler).toContain('terminal: true');
  });

  it("expone fallas de configuración aunque ocurran antes de reservar", () => {
    expect(handler).toContain('"afip_autorizacion_preflight_error"');
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.afip_autorizacion_preflight_error");
    expect(migration).toContain("p_status NOT IN ('config_error', 'validation_error')");
  });
});
