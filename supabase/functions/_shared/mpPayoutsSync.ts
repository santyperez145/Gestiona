/**
 * Sincronización de lotes de payouts con Mercado Pago.
 *
 * Compartido por `mp-payouts` (acción `sync`, botón de la marca) y por
 * `mercadopago-webhook` (notificación asíncrona `payout` firmada con HMAC).
 *
 * Regla de autoridad: el estado REAL se consulta a la API de MP con el token
 * OAuth de la organización; el body de la notificación nunca se confía.
 * Cuando MP reporta `approved`, se resuelve el retiro como `paid` vía
 * `resolve_creator_withdrawal` — RPC idempotente que asienta la liquidación
 * en `influencer_payouts` (nota `withdrawal:<id>`), así que reintentos del
 * webhook no duplican pagos ni balances.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { getMpCredentials } from "./mpToken.ts";

const MP_PAYOUTS_URL = "https://api.mercadopago.com/v1/payouts";

const json2 = (b: unknown, s: number) =>
  new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

// deno-lint-ignore no-explicit-any
function extractErrorMessage(payload: any): string {
  const msg = payload?.message || payload?.error || payload?.cause?.[0]?.description;
  return typeof msg === "string" ? msg : "Error de Mercado Pago";
}

export interface SyncResultado {
  ok: boolean;
  status: string;
  aprobados: number;
  rechazados: number;
}

/**
 * Consulta MP y refleja el estado real en `influencer_payout_batches` e
 * `influencer_payout_batch_items`. Devuelve el resultado o una Response
 * lista para devolver al llamador.
 */
export async function sincronizarLotePayouts(
  admin: SupabaseClient,
  batchId: string,
): Promise<SyncResultado | Response> {
  const { data: batch } = await admin
    .from("influencer_payout_batches")
    .select("id, org_id, mp_payout_id, external_reference, status")
    .eq("id", batchId)
    .maybeSingle();
  if (!batch) return json2({ error: "Lote no encontrado" }, 404);
  if (!batch.mp_payout_id) {
    return json2({ error: "El lote todavía no fue enviado a Mercado Pago" }, 400);
  }

  const creds = await getMpCredentials(admin, batch.org_id);
  if (!creds) return json2({ error: "Mercado Pago no está conectado" }, 400);

  const res = await fetch(
    `${MP_PAYOUTS_URL}/${encodeURIComponent(batch.mp_payout_id)}/transactions`,
    {
      signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${creds.accessToken}`, Accept: "application/json" },
    },
  );
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) return json2({ error: extractErrorMessage(payload) }, res.status);

  // deno-lint-ignore no-explicit-any
  const mpItems: any[] = payload?.transactions ?? [];
  let aprobados = 0;
  let rechazados = 0;

  for (const t of mpItems) {
    const ref = String(t?.external_reference ?? "");
    const withdrawalId = ref.startsWith("nerqia-w-") ? ref.slice("nerqia-w-".length) : null;
    if (!withdrawalId) continue;
    const status = String(t?.status ?? "").toLowerCase();

    if (status === "approved") {
      // MP confirmó la transferencia: resolver el retiro como pagado.
      // resolve_creator_withdrawal asienta la liquidación (idempotente).
      const { error } = await admin.rpc("resolve_creator_withdrawal", {
        p_request_id: withdrawalId,
        p_status: "paid",
      });
      if (!error) aprobados += 1;
    } else if (status === "rejected" || status === "cancelled") {
      rechazados += 1;
    }

    await admin.from("influencer_payout_batch_items")
      .update({
        status: ["approved", "rejected", "cancelled"].includes(status) ? status : "processing",
        mp_transaction_id: t?.id ? String(t.id) : null,
        failure_reason: t?.status_detail ? String(t.status_detail) : null,
        updated_at: new Date().toISOString(),
      })
      .eq("batch_id", batchId)
      .eq("withdrawal_id", withdrawalId);
  }

  const batchStatus = rechazados === 0
    ? (aprobados === mpItems.length ? "completed" : "processing")
    : (aprobados > 0 ? "partially_completed" : "failed");

  await admin.from("influencer_payout_batches")
    .update({
      status: batchStatus,
      updated_at: new Date().toISOString(),
      completed_at: batchStatus === "completed" ? new Date().toISOString() : null,
    })
    .eq("id", batchId);

  return { ok: true, status: batchStatus, aprobados, rechazados };
}
