/**
 * Reconciliación programada de reintegros de tienda contra MercadoPago.
 *
 * ── Por qué existe ──────────────────────────────────────────────────────────
 *
 * El reintegro de una tienda pasa por tres estados: `not_started` →
 * `processing` → `refunded`/`failed`. La única autoridad del dinero es
 * MercadoPago, y el paso a `refunded` puede quedar en el aire cuando:
 *
 *  - el POST del reintegro contesta 202 (`processing`) y MP nunca manda el
 *    webhook posterior, o el webhook se pierde;
 *  - el operador nunca vuelve a pulsar «Consultar estado» en el portal.
 *
 * El resultado es dinero real atrapado: el cliente no ve su plata, el RMA
 * queda `approved/processing` para siempre y la orden en `partial` sin que
 * nadie se entere. El webhook ya reconcilia en caliente; este job barre cada
 * 10 minutos **todas** las orgs con reintegros `processing` y cierra los que
 * el proveedor ya confirmó.
 *
 * ── Seguridad ───────────────────────────────────────────────────────────────
 *
 * Sólo el cron de la base puede dispararla (`exigirCron` + `x-cron-secret`).
 * Los tokens de MP salen de `payment_connections` por organización y nunca
 * salen de la Edge. Los RPCs `pago_reintegro_*` revalidan org, monto y estado
 * en SQL: la base decide el dinero, este job sólo trae la verdad del
 * proveedor.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { exigirCron } from "../_shared/cronAuth.ts";
import { reconcileStoreRefunds } from "../_shared/storeRefundReconciliation.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-cron-secret",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Sólo el cron de la base: sin el secreto no pasa nadie. Va antes de
  // cualquier trabajo.
  const gate = exigirCron(req, corsHeaders);
  if (gate) return gate;

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const outcome = await reconcileStoreRefunds({
      admin,
      source: "reconcile_cron",
    });

    return new Response(
      JSON.stringify({ ok: true, ...outcome }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    // Falla ruidoso: un reconciler que muere en silencio vuelve a dejar el
    // dinero colgado sin que nadie lo mire.
    console.error("reconcile-store-refunds:", error);
    return new Response(
      JSON.stringify({ ok: false, error: "No se pudo reconciliar" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});