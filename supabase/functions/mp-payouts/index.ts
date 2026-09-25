/**
 * mp-payouts — pago automático de comisiones a creadores vía Mercado Pago
 * Payouts (paridad Go-Marz: la marca paga a los influencers desde la
 * plataforma, sin transferencias manuales).
 *
 * ── Contrato oficial (docs MP, verificado 2026-09-24) ─────────────────────
 * POST https://api.mercadopago.com/v1/payouts
 *   Headers obligatorios: Authorization: Bearer, X-Idempotency-Key (UUID)
 *   Body: external_reference (único ≤64), description (≤100),
 *         config.notification_url, transactions[]:
 *           type: "account", account: { email } (cuenta MP destino),
 *           amount: { currency: "ARS", value }, external_reference único.
 *   Pruebas: header X-test-token: true (credenciales TEST).
 *   Consulta: GET /v1/payouts/{payout_id} y /transactions/{id}.
 *
 * ── Flujo ──────────────────────────────────────────────────────────────────
 * 1. La marca (owner/admin + can_manage_influencers) arma el lote con los
 *    retiros APROBADOS. El destino es la cuenta MP del creador ligada por
 *    email (la del influencers.email); si el creador no tiene email de
 *    cuenta MP, el ítem queda excluido con motivo — nunca inventamos destino.
 * 2. Se crea el lote en la base (create_payout_batch) ANTES de llamar a MP:
 *    el external_reference de la base es la llave idempotente de MP.
 * 3. Un solo POST /v1/payouts con todas las transacciones.
 * 4. El estado por transacción se consulta con `status` (acción sync):
 *    cuando MP aprueba el ítem, se resuelve el retiro como 'paid' — la RPC
 *    resolve_creator_withdrawal asienta la liquidación idempotente.
 *
 * ── Secretos ───────────────────────────────────────────────────────────────
 * Requiere MP_PAYOUTS_NOTIFICATION_URL (webhook propio). El access_token sale
 * de payment_connections (OAuth, cifrado en reposo) vía getMpCredentials.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { requireEnv } from "../_shared/env.ts";
import { getMpCredentials } from "../_shared/mpToken.ts";
import { sincronizarLotePayouts } from "../_shared/mpPayoutsSync.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const MP_PAYOUTS_URL = "https://api.mercadopago.com/v1/payouts";

// deno-lint-ignore no-explicit-any
function extractErrorMessage(payload: any): string {
  const msg = payload?.message || payload?.error || payload?.cause?.[0]?.description;
  return typeof msg === "string" ? msg : "Error de Mercado Pago";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  try {
    const supabaseUrl = requireEnv("SUPABASE_URL");
    const anonKey = requireEnv("SUPABASE_ANON_KEY");
    const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
    const admin = createClient(supabaseUrl, serviceKey);

    const asUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
    });
    const { data: userRes } = await asUser.auth.getUser();
    const userId = userRes?.user?.id;
    if (!userId) return json({ error: "No autenticado" }, 401);

    const body = await req.json();
    const action = body?.action ?? "create";

    // ── create: armar y enviar el lote a MP ───────────────────────────────
    if (action === "create") {
      const withdrawalIds: string[] = Array.isArray(body?.withdrawalIds) ? body.withdrawalIds : [];
      if (!withdrawalIds.length) return json({ error: "Elegí al menos un retiro aprobado" }, 400);

      // Autoridad: la RPC valida permisos, org única y estado 'approved'.
      const { data: batch, error: batchErr } = await asUser.rpc("create_payout_batch", {
        p_withdrawal_ids: withdrawalIds,
      });
      if (batchErr || !batch) {
        return json({ error: batchErr?.message ?? "No se pudo crear el lote" }, 400);
      }
      const batchId: string = batch.id;
      const orgId: string = batch.org_id;
      const externalReference: string = batch.external_reference;

      // Credenciales MP de la org (OAuth, cifradas en reposo).
      const creds = await getMpCredentials(admin, orgId);
      if (!creds) {
        await admin.from("influencer_payout_batches")
          .update({ status: "failed", last_error: "Mercado Pago no está conectado para esta organización", updated_at: new Date().toISOString() })
          .eq("id", batchId);
        return json({ error: "Conectá Mercado Pago antes de pagar (Configuración → Cobros)" }, 400);
      }

      // Ítems del lote + email de destino (cuenta MP del creador).
      const { data: items } = await admin
        .from("influencer_payout_batch_items")
        .select("id, withdrawal_id, influencer_id, amount_ars")
        .eq("batch_id", batchId);
      const influencerIds = (items ?? []).map(i => i.influencer_id);
      const { data: influencers } = await admin
        .from("influencers")
        .select("id, email, name")
        .in("id", influencerIds);

      // Sin email = sin cuenta MP destino: se excluye con motivo explícito.
      // deno-lint-ignore no-explicit-any
      const emailById = new Map<string, string>((influencers ?? []).map((i: any) => [i.id, i.email].filter(Boolean) as [string, string]));
      const sinDestino: string[] = [];
      const transactions: unknown[] = [];
      for (const item of items ?? []) {
        const email = emailById.get(item.influencer_id);
        if (!email) { sinDestino.push(item.influencer_id); continue; }
        transactions.push({
          type: "account",
          description: `Comisiones Nerqia retiro ${item.withdrawal_id.slice(0, 8)}`.slice(0, 100),
          account: { email },
          amount: { currency: "ARS", value: Number(item.amount_ars) },
          external_reference: `nerqia-w-${item.withdrawal_id}`.slice(0, 64),
        });
      }

      if (!transactions.length) {
        await admin.from("influencer_payout_batches")
          .update({ status: "failed", last_error: "Ningún creador del lote tiene email de cuenta Mercado Pago", updated_at: new Date().toISOString() })
          .eq("id", batchId);
        return json({ error: "Los creadores del lote no tienen email de cuenta Mercado Pago" }, 400);
      }

      const notificationUrl = Deno.env.get("MP_PAYOUTS_NOTIFICATION_URL");

      const payload = {
        external_reference: externalReference,
        description: "Pago automático de comisiones a creadores".slice(0, 100),
        transactions,
        ...(notificationUrl ? { config: { notification_url: notificationUrl } } : {}),
      };

      // Idempotencia: el external_reference del lote ES la llave; un reintento
      // sobre el mismo lote no duplica transferencias.
      const res = await fetch(MP_PAYOUTS_URL, {
        method: "POST",
        signal: AbortSignal.timeout(20_000),
        headers: {
          Authorization: `Bearer ${creds.accessToken}`,
          "Content-Type": "application/json",
          "X-Idempotency-Key": externalReference,
          ...(creds.liveMode ? {} : { "X-test-token": "true" }),
        },
        body: JSON.stringify(payload),
      });
      const mpPayload = await res.json().catch(() => ({}));

      if (!res.ok) {
        await admin.from("influencer_payout_batches")
          .update({ status: "failed", last_error: extractErrorMessage(mpPayload), updated_at: new Date().toISOString() })
          .eq("id", batchId);
        return json({ error: extractErrorMessage(mpPayload), batch_id: batchId }, res.status);
      }

      await admin.from("influencer_payout_batches")
        .update({
          mp_payout_id: String(mpPayload?.id ?? ""),
          status: "processing",
          updated_at: new Date().toISOString(),
        })
        .eq("id", batchId);

      return json({
        ok: true,
        batch_id: batchId,
        mp_payout_id: mpPayload?.id ?? null,
        enviados: transactions.length,
        excluidos_sin_email: sinDestino.length,
      });
    }

    // ── sync: consultar estado del lote en MP y reflejarlo ─────────────────
    if (action === "sync") {
      const batchId: string | undefined = body?.batchId;
      if (!batchId) return json({ error: "batchId requerido" }, 400);

      const { data: batch } = await admin
        .from("influencer_payout_batches")
        .select("id, org_id")
        .eq("id", batchId)
        .maybeSingle();
      if (!batch) return json({ error: "Lote no encontrado" }, 404);

      // La marca sólo sincroniza sus propios lotes.
      const { data: membership } = await asUser
        .from("memberships").select("role")
        .eq("org_id", batch.org_id).eq("user_id", userId).maybeSingle();
      if (!membership || !["owner", "admin"].includes(membership.role)) {
        return json({ error: "Necesitás ser administrador de esta organización" }, 403);
      }

      const resultado = await sincronizarLotePayouts(admin, batchId);
      if (resultado instanceof Response) return json(await resultado.json(), resultado.status);
      return json(resultado);
    }

    return json({ error: "Acción no válida" }, 400);
  } catch (err) {
    console.error("[mp-payouts]", err);
    return json({ error: err instanceof Error ? err.message : "Error inesperado" }, 500);
  }
});