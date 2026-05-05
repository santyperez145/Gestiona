import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, { apiVersion: "2024-06-20" });
const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (req) => {
  const body = await req.text();
  const sig = req.headers.get("stripe-signature")!;

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
  } catch (err) {
    console.error("Webhook signature invalid:", err);
    return new Response("Webhook Error", { status: 400 });
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode !== "subscription") break;
      const orgId = session.subscription_data?.metadata?.org_id || session.metadata?.org_id;
      const planCode = session.subscription_data?.metadata?.plan_code || session.metadata?.plan_code;
      if (!orgId || !session.subscription) break;

      const sub = await stripe.subscriptions.retrieve(session.subscription as string);
      await upsertSubscription(orgId, planCode, sub);
      break;
    }

    case "customer.subscription.updated":
    case "customer.subscription.created": {
      const sub = event.data.object as Stripe.Subscription;
      const orgId = sub.metadata?.org_id;
      const planCode = sub.metadata?.plan_code;
      if (!orgId) break;
      await upsertSubscription(orgId, planCode, sub);
      break;
    }

    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const orgId = sub.metadata?.org_id;
      if (!orgId) break;
      await supabase
        .from("subscriptions")
        .update({ status: "canceled", cancel_at_period_end: true })
        .eq("org_id", orgId);
      break;
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const sub = invoice.subscription ? await stripe.subscriptions.retrieve(invoice.subscription as string) : null;
      if (!sub?.metadata?.org_id) break;
      await supabase
        .from("subscriptions")
        .update({ status: "past_due" })
        .eq("org_id", sub.metadata.org_id);
      break;
    }

    case "invoice.payment_succeeded": {
      const invoice = event.data.object as Stripe.Invoice;
      // Only handle subscription invoices (not one-off charges)
      if (!invoice.subscription) break;
      const sub = await stripe.subscriptions.retrieve(invoice.subscription as string);
      const orgId = sub.metadata?.org_id;
      if (!orgId) break;
      // Reactivate subscription if it was past_due
      await supabase
        .from("subscriptions")
        .update({
          status: "active",
          current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
        })
        .eq("org_id", orgId)
        .eq("status", "past_due");
      break;
    }
  }

  return new Response(JSON.stringify({ received: true }), { headers: { "Content-Type": "application/json" } });
});

async function upsertSubscription(orgId: string, planCode: string | undefined, sub: Stripe.Subscription) {
  let planId: string | null = null;
  if (planCode) {
    const { data: plan } = await supabase.from("plans").select("id").eq("code", planCode).maybeSingle();
    planId = plan?.id ?? null;
  }

  const status = sub.status === "trialing" ? "trialing"
    : sub.status === "active" ? "active"
    : sub.status === "past_due" ? "past_due"
    : sub.status === "canceled" ? "canceled"
    : "paused";

  const periodEnd = sub.current_period_end
    ? new Date(sub.current_period_end * 1000).toISOString()
    : null;

  await supabase.from("subscriptions").upsert(
    {
      org_id: orgId,
      plan_id: planId,
      stripe_subscription_id: sub.id,
      status,
      current_period_end: periodEnd,
      cancel_at_period_end: sub.cancel_at_period_end,
    },
    { onConflict: "org_id" },
  );

  if (planId) {
    await supabase.from("organizations").update({ plan_id: planId }).eq("id", orgId);
  }
}
