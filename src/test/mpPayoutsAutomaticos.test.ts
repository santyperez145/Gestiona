import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Guardia del lote de pagos automáticos a creadores vía Mercado Pago Payouts.
 *
 * Contrato verificado contra docs oficiales MP (2026-09-24):
 * POST /v1/payouts con X-Idempotency-Key obligatorio, external_reference
 * único, transacciones type=account con email destino, amount ARS,
 * X-test-token:true en pruebas, y sincronización por GET /transactions.
 */

const read = (p: string) => readFileSync(p, "utf8");

describe("MP Payouts: Edge Function mp-payouts", () => {
  const edge = read("supabase/functions/mp-payouts/index.ts");

  it("usa el endpoint oficial con idempotencia obligatoria", () => {
    expect(edge).toContain("https://api.mercadopago.com/v1/payouts");
    expect(edge).toContain('"X-Idempotency-Key"');
    // La llave idempotente es el external_reference del lote en la base:
    // un reintento no duplica transferencias.
    expect(edge).toContain("X-Idempotency-Key\": externalReference");
  });

  it("envía transacciones válidas: cuenta MP destino + ARS + referencia única", () => {
    expect(edge).toContain('type: "account"');
    expect(edge).toContain("account: { email }".replace("account: { email }", "account: { email }") === "" ? "" : "account: { email }");
    expect(edge).toContain('currency: "ARS"');
    expect(edge).toContain("nerqia-w-${item.withdrawal_id}".slice(0, 10));
    expect(edge).toContain("external_reference: `nerqia-w-${item.withdrawal_id}`");
  });

  it("en modo TEST envía X-test-token (contrato de pruebas MP)", () => {
    expect(edge).toContain('"X-test-token"');
    expect(edge).toContain("creds.liveMode");
  });

  it("la autoridad es server-side: permisos y estado via RPC create_payout_batch", () => {
    expect(edge).toContain('rpc("create_payout_batch"');
    // El access token nunca se hardcodea: sale de la conexión OAuth cifrada.
    expect(edge).toContain("getMpCredentials");
    expect(edge).not.toMatch(/Bearer\s+["']APP_USR/);
  });

  it("sincroniza: MP aprobado → retiro pagado via resolve_creator_withdrawal", () => {
    expect(edge).toContain('rpc("resolve_creator_withdrawal"');
    expect(edge).toContain("/v1/payouts/${encodeURIComponent(batch.mp_payout_id)}/transactions");
    expect(edge).toContain('"partially_completed"');
  });

  it("nunca inventa destino: sin email se excluye y se informa", () => {
    expect(edge).toContain("sinDestino");
    expect(edge).toContain("excluidos_sin_email");
  });
});

describe("MP Payouts: base y UI de la marca", () => {
  const migracion = read("supabase/migrations/20260924000800_influencer_payout_batches.sql");

  it("existen las tablas de lotes con RLS por org", () => {
    expect(migracion).toContain("CREATE TABLE IF NOT EXISTS public.influencer_payout_batches");
    expect(migracion).toContain("CREATE TABLE IF NOT EXISTS public.influencer_payout_batch_items");
    expect(migracion).toContain("ALTER TABLE public.influencer_payout_batches ENABLE ROW LEVEL SECURITY");
    expect(migracion).toContain("can_manage_influencers(org_id, 'edit')");
  });

  it("create_payout_batch exige retiros aprobados de una sola org", () => {
    expect(migracion).toContain("public.create_payout_batch");
    expect(migracion).toContain("status = 'approved'");
    expect(migracion).toContain("Todos los retiros deben estar aprobados y pertenecer a tu organización");
  });

  it("la página de pagos tiene selección múltiple + botón MP + lotes", () => {
    const page = read("src/pages/InfluencerPaymentsPage.tsx");
    expect(page).toContain("Pagar con Mercado Pago");
    expect(page).toContain("mp-payouts");
    expect(page).toContain("Lotes enviados a Mercado Pago");
    expect(page).toContain("sincronizarLote");
    // El flujo manual sigue disponible para retiros pendientes.
    expect(page).toContain("resolve(w.id, 'rejected')");
  });
});