// Stripe webhook handler — idempotent via processed event log.
// Events handled: checkout.session.completed, subscription CRUD,
// invoice.payment_succeeded/failed, trial_will_end, subscription.paused/resumed.
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, { apiVersion: "2024-06-20" });
const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// ── Idempotency guard ─────────────────────────────────────────────────────────
// Returns true if event was already processed (stored in settings as a rolling log).
// Using a dedicated table would be cleaner but this avoids an extra migration for now.
async function markEventProcessed(eventId: string): Promise<boolean> {
  // Use a small jsonb column in a dedicated table if it exists, else skip
  try {
    const { error } = await supabase
      .from("stripe_events")
      .insert({ event_id: eventId, processed_at: new Date().toISOString() });
    // unique constraint violation = already processed
    if (error?.code === "23505") return true;
  } catch {
    // Table doesn't exist — fall through (no idempotency in that case)
  }
  return false;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getOrgIdFromSub(sub: Stripe.Subscription | string): Promise<{ orgId: string; planCode?: string } | null> {
  const resolved = typeof sub === "string" ? await stripe.subscriptions.retrieve(sub) : sub;
  const orgId = resolved.metadata?.org_id;
  if (!orgId) return null;
  return { orgId, planCode: resolved.metadata?.plan_code };
}

async function notify(orgId: string, title: string, message: string, type = "billing") {
  const { data: mb } = await supabase
    .from("memberships")
    .select("user_id")
    .eq("org_id", orgId)
    .in("role", ["owner", "admin"])
    .limit(1)
    .maybeSingle();
  if (!mb?.user_id) return;
  try {
    const { error: errNotificacion } = await supabase
      .from("notifications").insert({
      user_id: mb.user_id,
      org_id: orgId,
      title,
      message,
      type,
    });
    // Un insert sin mirar `.error` convierte «no se guardó» en «listo»:
    // es lo que escondió durante meses que check-alerts no guardaba nada.
    if (errNotificacion) console.error("stripe-webhook: no se pudo notificar", errNotificacion);
  } catch { /* silent */ }
}

async function upsertSubscription(orgId: string, planCode: string | undefined, sub: Stripe.Subscription) {
  let planId: string | null = null;
  if (planCode) {
    const { data: plan } = await supabase.from("plans").select("id").eq("code", planCode).maybeSingle();
    planId = plan?.id ?? null;
  }

  const statusMap: Record<string, string> = {
    trialing: "trialing",
    active: "active",
    past_due: "past_due",
    canceled: "canceled",
    paused: "paused",
    unpaid: "past_due",
    incomplete: "past_due",
    incomplete_expired: "canceled",
  };
  const status = statusMap[sub.status] ?? "paused";
  const periodEnd = sub.current_period_end
    ? new Date(sub.current_period_end * 1000).toISOString()
    : null;

  await supabase.from("subscriptions").upsert(
    {
      org_id: orgId,
      plan_id: planId,
      stripe_subscription_id: sub.id,
      stripe_customer_id: typeof sub.customer === "string" ? sub.customer : sub.customer?.id,
      status,
      current_period_end: periodEnd,
      cancel_at_period_end: sub.cancel_at_period_end,
      trial_end: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
    },
    { onConflict: "org_id" },
  );

  if (planId) {
    await supabase.from("organizations").update({ plan_id: planId }).eq("id", orgId);
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const body = await req.text();
  const sig = req.headers.get("stripe-signature")!;

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
  } catch (err) {
    console.error("Stripe signature invalid:", err);
    return new Response("Webhook Error", { status: 400 });
  }

  // Idempotency: skip already-processed events
  const alreadyDone = await markEventProcessed(event.id);
  if (alreadyDone) {
    console.log(`Skipping already-processed event: ${event.id}`);
    return new Response(JSON.stringify({ received: true, skipped: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  console.log(`Processing Stripe event: ${event.type} (${event.id})`);

  try {
    switch (event.type) {
      // ── Checkout completed (new subscription) ─────────────────────────────
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode !== "subscription") break;
        const orgId = session.subscription_data?.metadata?.org_id || session.metadata?.org_id;
        const planCode = session.subscription_data?.metadata?.plan_code || session.metadata?.plan_code;
        if (!orgId || !session.subscription) break;

        const sub = await stripe.subscriptions.retrieve(session.subscription as string);
        await upsertSubscription(orgId, planCode, sub);
        await notify(orgId, "Suscripción activada", `Tu plan fue activado correctamente. ¡Bienvenido!`);
        break;
      }

      // ── Subscription created / updated ────────────────────────────────────
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        const res = await getOrgIdFromSub(sub);
        if (!res) break;
        await upsertSubscription(res.orgId, res.planCode, sub);
        break;
      }

      // ── Subscription cancelled ────────────────────────────────────────────
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const res = await getOrgIdFromSub(sub);
        if (!res) break;
        await supabase
          .from("subscriptions")
          .update({ status: "canceled", cancel_at_period_end: false })
          .eq("org_id", res.orgId);
        await notify(
          res.orgId,
          "Suscripción cancelada",
          "Tu suscripción fue cancelada. Podés reactivarla en cualquier momento desde Ajustes → Plan.",
          "billing_warning",
        );
        break;
      }

      // ── Subscription paused (voluntary) ──────────────────────────────────
      case "customer.subscription.paused": {
        const sub = event.data.object as Stripe.Subscription;
        const res = await getOrgIdFromSub(sub);
        if (!res) break;
        await supabase
          .from("subscriptions")
          .update({ status: "paused" })
          .eq("org_id", res.orgId);
        await notify(res.orgId, "Suscripción pausada", "Tu suscripción fue pausada. Reactivala cuando quieras.", "billing_warning");
        break;
      }

      // ── Subscription resumed ──────────────────────────────────────────────
      case "customer.subscription.resumed": {
        const sub = event.data.object as Stripe.Subscription;
        const res = await getOrgIdFromSub(sub);
        if (!res) break;
        await upsertSubscription(res.orgId, res.planCode, sub);
        await notify(res.orgId, "Suscripción reactivada", "Tu plan fue reactivado correctamente.");
        break;
      }

      // ── Trial ending soon (3 days notice) ────────────────────────────────
      case "customer.subscription.trial_will_end": {
        const sub = event.data.object as Stripe.Subscription;
        const res = await getOrgIdFromSub(sub);
        if (!res) break;
        const trialEnd = sub.trial_end ? new Date(sub.trial_end * 1000) : null;
        const daysLeft = trialEnd ? Math.ceil((trialEnd.getTime() - Date.now()) / 86_400_000) : 3;
        await notify(
          res.orgId,
          `Tu prueba termina en ${daysLeft} día${daysLeft !== 1 ? "s" : ""}`,
          "Agregá un método de pago en Ajustes → Plan para continuar usando Gestiona sin interrupciones.",
          "billing_warning",
        );
        break;
      }

      // ── Payment succeeded (reactivates past_due) ──────────────────────────
      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice;
        if (!invoice.subscription) break;
        const sub = await stripe.subscriptions.retrieve(invoice.subscription as string);
        const orgId = sub.metadata?.org_id;
        if (!orgId) break;

        await supabase
          .from("subscriptions")
          .update({
            status: "active",
            current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
          })
          .eq("org_id", orgId)
          .in("status", ["past_due", "paused", "unpaid"]);
        break;
      }

      // ── Payment failed (dunning) ──────────────────────────────────────────
      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        if (!invoice.subscription) break;
        const sub = await stripe.subscriptions.retrieve(invoice.subscription as string);
        const orgId = sub.metadata?.org_id;
        if (!orgId) break;

        const attempt = invoice.attempt_count || 1;
        await supabase
          .from("subscriptions")
          .update({ status: "past_due" })
          .eq("org_id", orgId);

        const message = attempt >= 3
          ? "Tercer intento de cobro fallido. Tu cuenta será suspendida pronto. Actualizá tu método de pago en Ajustes → Plan."
          : `Intento de cobro ${attempt} fallido. Actualizá tu método de pago para evitar interrupciones.`;

        await notify(orgId, "Fallo en el pago", message, "billing_warning");
        break;
      }

      // ── Invoice requires action (3DS / bank auth) ─────────────────────────
      case "invoice.payment_action_required": {
        const invoice = event.data.object as Stripe.Invoice;
        if (!invoice.subscription) break;
        const sub = await stripe.subscriptions.retrieve(invoice.subscription as string);
        const orgId = sub.metadata?.org_id;
        if (!orgId) break;

        await notify(
          orgId,
          "Se requiere acción de pago",
          "Tu banco requiere autenticación adicional. Ingresá a Ajustes → Plan para completar el pago.",
          "billing_warning",
        );
        break;
      }

      default:
        console.log(`Unhandled Stripe event type: ${event.type}`);
    }
  } catch (handlerErr) {
    console.error(`Error handling ${event.type}:`, handlerErr);
    // Still return 200 so Stripe doesn't retry indefinitely for processing errors
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
  });
});
