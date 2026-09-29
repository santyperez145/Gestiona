/**
 * mp-payouts — adaptador opcional de Mercado Pago Payouts.
 *
 * Este producto no forma parte del contrato publico de Split 1:1. Por eso la
 * funcion permanece cerrada salvo que Nerqia tenga habilitacion contractual
 * explicita (`MP_PAYOUTS_ENABLED=true`). El flujo normal usa destinos cifrados
 * y liquidacion externa con referencia comprobable.
 *
 * ── Contrato de cartera habilitada ─────────────────────────────────────────
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

    if (action === "capability") {
      return json({
        enabled: Deno.env.get("MP_PAYOUTS_ENABLED") === "true",
        notification_configured: Boolean(Deno.env.get("MP_PAYOUTS_NOTIFICATION_URL")),
      });
    }

    if (Deno.env.get("MP_PAYOUTS_ENABLED") !== "true") {
      return json({
        error: "Los pagos masivos de Mercado Pago requieren habilitación comercial. Usá la liquidación por destino del creador.",
        code: "provider_capability_unavailable",
      }, 409);
    }

    // ── create/dispatch: armar una vez y reenviar siempre el mismo lote ───
    if (action === "create" || action === "dispatch") {
      const withdrawalIds: string[] = Array.isArray(body?.withdrawalIds) ? body.withdrawalIds : [];
      let batchId: string | undefined = body?.batchId;
      if (action === "create") {
        if (!withdrawalIds.length) return json({ error: "Elegí al menos un retiro aprobado" }, 400);
        // Autoridad: la RPC valida permiso, organización, destino y que no
        // exista otro lote activo para el mismo retiro.
        const { data: created, error: batchErr } = await asUser.rpc("create_payout_batch", {
          p_withdrawal_ids: withdrawalIds,
        });
        if (batchErr || !created) {
          return json({ error: batchErr?.message ?? "No se pudo crear el lote" }, 400);
        }
        batchId = created.id;
      }
      if (!batchId) return json({ error: "batchId requerido" }, 400);

      const { data: batch } = await admin
        .from("influencer_payout_batches")
        .select("id, org_id, external_reference, mp_payout_id")
        .eq("id", batchId)
        .maybeSingle();
      if (!batch) return json({ error: "Lote no encontrado" }, 404);

      // Un reintento manual también debe pertenecer a la organización actual.
      const { data: membership } = await asUser
        .from("memberships").select("role")
        .eq("org_id", batch.org_id).eq("user_id", userId).maybeSingle();
      if (!membership || !["owner", "admin"].includes(membership.role)) {
        return json({ error: "Necesitás ser administrador de esta organización" }, 403);
      }

      if (batch.mp_payout_id) {
        const synced = await sincronizarLotePayouts(admin, batchId);
        if (synced instanceof Response) return json(await synced.json(), synced.status);
        return json({ ...synced, batch_id: batchId, already_dispatched: true });
      }

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

      // El destino sale del snapshot cifrado del retiro, no del email general
      // del perfil. Sólo service_role puede obtener este payload descifrado.
      const { data: dispatchPayload, error: payloadError } = await admin.rpc(
        "creator_payout_batch_dispatch_payload",
        { p_batch_id: batchId },
      );
      if (payloadError || !dispatchPayload) {
        await admin.from("influencer_payout_batches")
          .update({ status: "failed", last_error: "El destino del lote no es válido", updated_at: new Date().toISOString() })
          .eq("id", batchId);
        return json({ error: "Revisá los destinos de cobro del lote", batch_id: batchId }, 400);
      }

      const items = Array.isArray(dispatchPayload.items) ? dispatchPayload.items : [];
      const transactions = items.map((item: { withdrawal_id: string; amount_ars: number; destination_email: string }) => {
        const email = String(item.destination_email ?? "").trim().toLowerCase();
        if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("La cuenta Mercado Pago de un retiro no es un email válido");
        return {
          type: "account",
          description: `Comisiones Nerqia retiro ${item.withdrawal_id.slice(0, 8)}`.slice(0, 100),
          account: { email },
          amount: { currency: "ARS", value: Number(item.amount_ars) },
          external_reference: `nerqia-w-${item.withdrawal_id}`.slice(0, 64),
        };
      });

      const notificationUrl = Deno.env.get("MP_PAYOUTS_NOTIFICATION_URL");

      const payload = {
        external_reference: externalReference,
        description: "Pago automático de comisiones a creadores".slice(0, 100),
        transactions,
        ...(notificationUrl ? { config: { notification_url: notificationUrl } } : {}),
      };

      // Idempotencia: el external_reference del lote ES la llave; un reintento
      // sobre el mismo lote no duplica transferencias.
      let res: Response;
      try {
        res = await fetch(MP_PAYOUTS_URL, {
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
      } catch (networkError) {
        // El proveedor pudo haber aceptado el POST antes del timeout. No se
        // crea otro lote: el operador reenvía ESTE batch con la misma llave.
        await admin.from("influencer_payout_batches")
          .update({ status: "awaiting_confirmation", last_error: "Resultado pendiente de confirmación del proveedor", updated_at: new Date().toISOString() })
          .eq("id", batchId);
        return json({
          error: "Mercado Pago no confirmó el resultado. Reintentá el mismo lote; no se duplicará el pago.",
          code: "payout_confirmation_pending",
          batch_id: batchId,
        }, 202);
      }
      const mpPayload = await res.json().catch(() => ({}));

      if (!res.ok) {
        const ambiguous = res.status === 409 || res.status >= 500;
        await admin.from("influencer_payout_batches")
          .update({ status: ambiguous ? "awaiting_confirmation" : "failed", last_error: extractErrorMessage(mpPayload), updated_at: new Date().toISOString() })
          .eq("id", batchId);
        if (!ambiguous) {
          await admin.from("influencer_payout_batch_items")
            .update({ status: "failed", failure_reason: extractErrorMessage(mpPayload), updated_at: new Date().toISOString() })
            .eq("batch_id", batchId);
        }
        return json({
          error: ambiguous
            ? "Mercado Pago no confirmó el resultado. Reintentá el mismo lote; no se duplicará el pago."
            : extractErrorMessage(mpPayload),
          code: ambiguous ? "payout_confirmation_pending" : "payout_rejected",
          batch_id: batchId,
        }, ambiguous ? 202 : res.status);
      }

      if (!mpPayload?.id) {
        await admin.from("influencer_payout_batches")
          .update({ status: "awaiting_confirmation", last_error: "Mercado Pago respondió sin identificar el lote", updated_at: new Date().toISOString() })
          .eq("id", batchId);
        return json({
          error: "Mercado Pago recibió el lote pero todavía no confirmó su identificador. Reintentá el mismo lote.",
          code: "payout_confirmation_pending",
          batch_id: batchId,
        }, 202);
      }

      await admin.from("influencer_payout_batches")
        .update({
          mp_payout_id: String(mpPayload?.id ?? ""),
          status: "processing",
          updated_at: new Date().toISOString(),
        })
        .eq("id", batchId);
      await admin.from("influencer_payout_batch_items")
        .update({ status: "processing", updated_at: new Date().toISOString() })
        .eq("batch_id", batchId);

      return json({
        ok: true,
        batch_id: batchId,
        mp_payout_id: mpPayload?.id ?? null,
        enviados: transactions.length,
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
